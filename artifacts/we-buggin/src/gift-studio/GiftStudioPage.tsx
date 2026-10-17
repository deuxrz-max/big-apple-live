import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { useAuth } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Archive, Check, ChevronRight, Download, Pipette, FileVideo2, LockKeyhole, Pause, Play, RefreshCw, Scissors, ShieldCheck, Upload, X, Pencil, Trash2, Save } from 'lucide-react';
import {
  getGetActiveGiftStudioMediaQueryKey,
  getGetGiftStudioLibraryQueryKey,
  getGetSocialMeQueryKey,
  useAssignGiftStudioVersionToGift,
  useGetActiveGiftStudioMedia,
  useGetGiftStudioLibrary,
  useSetGiftStudioVersionActive,
} from '@workspace/api-client-react';
import type { GiftStudioGiftId, GiftStudioVersion } from '@workspace/api-client-react';
import type { ClipSettings, KeyColor } from './processClip';
import { GiftAnimationPlayer, giftStudioMediaUrl } from '@/gifts/GiftAnimationPlayer';
import { classifyKeyColor, detectVideoEdgeColor, drawKeyedPreview, sampleVideoColorAtPoint } from './liveKeyPreview';
import { createTransparentPngFramesZip } from './downloadPngFramesZip';
import './gift-studio.css';
import './gift-studio-production.css';

const GIFTS: { id: GiftStudioGiftId; label: string }[] = [
  { id: 'heart', label: 'Heart' },
  { id: 'spirit-pup', label: 'Spirit Pup' },
  { id: 'moonfox', label: 'Moonfox' },
  { id: 'cosmic-encore', label: 'Cosmic Encore' },
  { id: 'fireworks', label: 'Fireworks' },
  { id: 'rose-shower', label: 'Rose Shower' },
  { id: 'whip', label: 'Whip' },
];
const KEY_PRESETS: { id: KeyColor; label: string; value: string }[] = [
  { id: 'green', label: 'Green', value: '#00ff00' },
  { id: 'magenta', label: 'Magenta', value: '#ff00ff' },
  { id: 'black', label: 'Black', value: '#000000' },
];
const MAX_BYTES = 100 * 1024 * 1024;
const MAX_SECONDS = 15;
const MAX_DRAFT_NAME = 60;
const formatBytes = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
type GiftSetupMode = 'new' | 'replace';
const PRODUCTION_STEPS = ['Name & type', 'Upload', 'Remove background', 'Review', 'Activate'];

const errorText = (error: unknown) => {
  if (!error) return 'Something went wrong. Please try again.';
  const e = error as { message?: string; status?: number; response?: { status?: number; data?: { message?: string; error?: string } } };
  return e.response?.data?.message ?? e.response?.data?.error ?? e.message ?? 'Something went wrong. Please try again.';
};
const isDenied = (error: unknown) => {
  const e = error as { status?: number; response?: { status?: number } } | undefined;
  return e?.status === 401 || e?.status === 403 || e?.response?.status === 401 || e?.response?.status === 403;
};
const ownerErrorText = (error: unknown) => isDenied(error)
  ? `Owner access is required for this action. Sign in with the gift owner account and retry. ${errorText(error)}`
  : errorText(error);
const timeLabel = (value: number) => `${Math.floor(value / 60)}:${Math.floor(value % 60).toString().padStart(2, '0')}`;

type AuthTokenGetter = () => Promise<string | null>;

class GiftStudioRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function responseError(response: Response, fallback: string): Promise<GiftStudioRequestError> {
  const raw = await response.text();
  let message = '';
  try {
    const parsed = JSON.parse(raw) as { message?: string; error?: string; detail?: string };
    message = parsed.message ?? parsed.detail ?? parsed.error ?? '';
  } catch {
    message = raw.trim();
  }
  return new GiftStudioRequestError(message || fallback, response.status);
}

async function processClipOnServer(
  file: File,
  settings: ClipSettings,
  signal: AbortSignal,
  getToken: AuthTokenGetter,
): Promise<{ blob: Blob; processingSession: string | null }> {
  const form = new FormData();
  form.append('sourceVideo', file, file.name);
  form.append('settings', JSON.stringify(settings));
  const token = await getToken();
  const response = await fetch('/api/social/admin/gift-studio/process', {
    method: 'POST',
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
    signal,
  });
  if (!response.ok) {
    throw await responseError(response, `Streamtalk could not process this clip (server error ${response.status}).`);
  }
  const output = await response.blob();
  if (output.size === 0) throw new Error('The processor returned an empty video. Try processing again.');
  // This endpoint only returns alpha-verified VP9 WebM. Normalize the Blob type even
  // if a proxy/browser adds codec parameters or drops the response MIME type.
  const processingSession = response.headers.get('X-Gift-Studio-Processing-Session');
  return { blob: new Blob([output], { type: 'video/webm' }), processingSession };
}

async function saveGiftStudioClip(input: {
  original: File;
  processed: Blob;
  processingSession: string | null;
  draftName: string;
  giftId: GiftStudioGiftId | '';
  settings: ClipSettings;
  getToken: AuthTokenGetter;
}): Promise<GiftStudioVersion> {
  const token = await input.getToken();
  const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const trimmedName = input.draftName.trim();

  if (input.processingSession) {
    const response = await fetch('/api/social/admin/gift-studio/save-processed', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({
        processingSession: input.processingSession,
        draftName: trimmedName,
        ...(input.giftId ? { giftId: input.giftId } : {}),
      }),
    });
    if (response.status !== 410) {
      if (!response.ok) throw await responseError(response, `Streamtalk could not save this gift (server error ${response.status}).`);
      return await response.json() as GiftStudioVersion;
    }
    // A dev preview/server restart may expire its temporary copy. The browser still
    // has both files, so upload those explicit file parts instead.
  }

  const form = new FormData();
  form.append('sourceVideo', input.original, input.original.name || 'source.mp4');
  const baseName = trimmedName.normalize('NFKD').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'gift';
  const processedFile = new File([input.processed], `${baseName}-alpha.webm`, { type: 'video/webm' });
  form.append('processedWebm', processedFile, processedFile.name);
  form.append('settings', JSON.stringify({ ...input.settings, draftName: trimmedName }));
  if (input.giftId) form.append('giftId', input.giftId);
  const response = await fetch('/api/social/admin/gift-studio/versions', {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders,
    body: form,
  });
  if (!response.ok) throw await responseError(response, `Streamtalk could not save this gift (server error ${response.status}).`);
  return await response.json() as GiftStudioVersion;
}

async function giftStudioLibraryRequest(url: string, method: 'PATCH' | 'DELETE', getToken: AuthTokenGetter, body?: unknown) {
  const token = await getToken();
  const response = await fetch(url, {
    method,
    credentials: 'include',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const raw = await response.text();
  let data: { message?: string; error?: string } = {};
  try { data = raw ? JSON.parse(raw) as typeof data : {}; } catch { /* keep the short fallback below */ }
  if (!response.ok) throw new Error(data.message ?? data.error ?? `Gift Studio could not ${method === 'DELETE' ? 'delete' : 'update'} this saved item.`);
  return data;
}

export function GiftStudioPage() {
  const { getToken } = useAuth();
  const client = useQueryClient();
  const library = useGetGiftStudioLibrary({ query: { queryKey: getGetGiftStudioLibraryQueryKey(), retry: false } });
  const setActive = useSetGiftStudioVersionActive();
  const assignVersion = useAssignGiftStudioVersionToGift();
  const [file, setFile] = useState<File | null>(null);
  const [originalUrl, setOriginalUrl] = useState('');
  const [processedUrl, setProcessedUrl] = useState('');
  const [processedBlob, setProcessedBlob] = useState<Blob | null>(null);
  const [processingSession, setProcessingSession] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [frameRatio, setFrameRatio] = useState<number | null>(null);
  const [giftMode, setGiftMode] = useState<GiftSetupMode>('replace');
  const [giftId, setGiftId] = useState<GiftStudioGiftId | ''>('');
  const [draftName, setDraftName] = useState('');
  const [reviewMode, setReviewMode] = useState<'checker' | 'sample'>('checker');
  const [previewConfirmed, setPreviewConfirmed] = useState(false);
  const [activeProductionStep, setActiveProductionStep] = useState(1);
  const [keyPreset, setKeyPreset] = useState<KeyColor>('green');
  const [keyColor, setKeyColor] = useState('#00ff00');
  const [tolerance, setTolerance] = useState(.12);
  const [softness, setSoftness] = useState(.08);
  const [spill, setSpill] = useState(.72);
  const [maxDimension, setMaxDimension] = useState<ClipSettings['maxDimension']>(480);
  const [backdrop, setBackdrop] = useState<'checker' | 'light' | 'dark'>('checker');
  const [processing, setProcessing] = useState(false);
  const [serverProcessing, setServerProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [downloadingFrames, setDownloadingFrames] = useState(false);
  const [frameZipProgress, setFrameZipProgress] = useState(0);
  const [framesZipBlob, setFramesZipBlob] = useState<Blob | null>(null);
  const [livePreviewError, setLivePreviewError] = useState('');
  const [detectedKeyColor, setDetectedKeyColor] = useState<string | null>(null);
  const [keyDetecting, setKeyDetecting] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [savingVersion, setSavingVersion] = useState(false);
  const [savedVersionId, setSavedVersionId] = useState<string | null>(null);
  const [savedVersionPreview, setSavedVersionPreview] = useState<GiftStudioVersion | null>(null);
  const [selectedPreview, setSelectedPreview] = useState<GiftStudioVersion | null>(null);
  const [playingPreview, setPlayingPreview] = useState<GiftStudioVersion | null>(null);
  const [playingSample, setPlayingSample] = useState<GiftStudioVersion | null>(null);
  const [libraryActionId, setLibraryActionId] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  const serverAbortRef = useRef<AbortController | null>(null);
  const originalVideoRef = useRef<HTMLVideoElement>(null);
  const processedVideoRef = useRef<HTMLVideoElement>(null);
  const livePreviewCanvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<import('@ffmpeg/ffmpeg').FFmpeg | null>(null);
  const isSeekingRef = useRef(false);
  const keyWasChangedRef = useRef(false);
  const nameWasEditedRef = useRef(false);
  const metadataHandledUrlRef = useRef<string | null>(null);
  const processedSettingsRef = useRef<string | null>(null);
  const productionStepRefs = useRef<Array<HTMLElement | null>>([]);
  const [playhead, setPlayhead] = useState(0);

  const settings = useMemo<ClipSettings>(() => ({
    preset: keyPreset, keyColor, tolerance, softness, spill, maxDimension,
  }), [keyPreset, keyColor, tolerance, softness, spill, maxDimension]);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const activeGiftId = (giftId || 'heart') as GiftStudioGiftId;
  const activeGiftQuery = useGetActiveGiftStudioMedia(activeGiftId, {
    query: {
      queryKey: getGetActiveGiftStudioMediaQueryKey(activeGiftId),
      enabled: giftMode === 'replace' && Boolean(giftId),
      staleTime: 0,
    },
  });
  const activeGiftName = activeGiftQuery.data?.media?.name
    || GIFTS.find((gift) => gift.id === giftId)?.label
    || '';

  useEffect(() => {
    if (giftMode !== 'replace' || !giftId || nameWasEditedRef.current || !activeGiftName) return;
    setDraftName(activeGiftName);
  }, [giftMode, giftId, activeGiftName]);

  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      const top = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      const step = Number((top?.target as HTMLElement | undefined)?.dataset.productionStep);
      if (Number.isInteger(step) && step > 0) setActiveProductionStep(step);
    }, { rootMargin: '-18% 0px -62% 0px', threshold: [0, 0.1, 0.35, 0.6] });
    productionStepRefs.current.forEach((section) => section && observer.observe(section));
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => {
    if (originalUrl) URL.revokeObjectURL(originalUrl);
  }, [originalUrl]);
  useEffect(() => () => {
    if (processedUrl) URL.revokeObjectURL(processedUrl);
  }, [processedUrl]);
  useEffect(() => () => {
    engineRef.current?.terminate();
  }, []);

  useEffect(() => {
    if (!selectedPreview) return;
    const returnFocus = document.activeElement as HTMLElement | null;
    const handleDialogKeys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setSelectedPreview(null);
      }
      if (event.key === 'Tab') {
        const dialog = document.querySelector('[data-testid="dialog-version-preview"]');
        const focusables = dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), video[controls], [href], input:not([disabled])');
        if (!focusables?.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', handleDialogKeys);
    window.setTimeout(() => document.querySelector<HTMLElement>('[data-testid="button-close-version-preview"]')?.focus(), 0);
    return () => {
      window.removeEventListener('keydown', handleDialogKeys);
      returnFocus?.focus();
    };
  }, [selectedPreview]);

  const resetOutput = () => {
    if (processedUrl) URL.revokeObjectURL(processedUrl);
    setProcessedUrl('');
    setProcessedBlob(null);
    setProcessingSession(null);
    setFramesZipBlob(null);
    setSavedVersionId(null);
    setSavedVersionPreview(null);
    processedSettingsRef.current = null;
    setPreviewConfirmed(false);
    setStatus('');
    setError('');
    setSaveError('');
    setLivePreviewError('');
  };
  useEffect(() => {
    if (processedUrl && processedSettingsRef.current !== JSON.stringify(settings)) {
      resetOutput();
      setStatus('Settings changed. Process again to review an export made with these settings.');
    }
  }, [settings]);
  const loadFile = (candidate?: File) => {
    if (!candidate) return;
    setError('');
    if (!/\.(mp4|webm|mov)$/i.test(candidate.name) || !['video/mp4', 'video/webm', 'video/quicktime', ''].includes(candidate.type)) {
      setError('Choose an MP4, WebM, or MOV video.');
      return;
    }
    if (candidate.size > MAX_BYTES) {
      setError('This file is over 100 MB. Choose a smaller clip.');
      return;
    }
    resetOutput();
    keyWasChangedRef.current = false;
    metadataHandledUrlRef.current = null;
    setKeyDetecting(true);
    setDetectedKeyColor(null);
    if (originalUrl) URL.revokeObjectURL(originalUrl);
    const nextUrl = URL.createObjectURL(candidate);
    setOriginalUrl(nextUrl);
    setFile(candidate);
    setDuration(0);
    setFrameRatio(null);
    setPlayhead(0);
    setStatus('Checking clip length…');
  };
  const onOriginalMetadata = () => {
    const video = originalVideoRef.current;
    if (!video || metadataHandledUrlRef.current === originalUrl) return;
    metadataHandledUrlRef.current = originalUrl;
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      setFrameRatio(video.videoWidth / video.videoHeight);
    }
    setDuration(video.duration);
    if (!Number.isFinite(video.duration) || video.duration > MAX_SECONDS) {
      setError('Clip must be 15 seconds or shorter.');
      setStatus('');
      setFile(null);
      setOriginalUrl('');
      setKeyDetecting(false);
      return;
    }
    setStatus('Detecting the background color…');
    setKeyDetecting(true);
    void video.play().catch(() => setStatus('Tap Play to start the clip preview.')).then(() => detectVideoEdgeColor(video)).then((color) => {
      if (keyWasChangedRef.current) return;
      if (!color) {
        setStatus('No solid edge color was detected. Tap the background in the video to choose it.');
        return;
      }
      const family = classifyKeyColor(color);
      const detectedSettings: ClipSettings = {
        ...settingsRef.current,
        preset: family === 'green' || family === 'magenta' ? family : 'custom',
        keyColor: color,
        tolerance: .12,
        softness: .08,
        spill: .72,
      };
      setDetectedKeyColor(color);
      setKeyColor(color);
      setKeyPreset(detectedSettings.preset);
      setTolerance(.12);
      setSoftness(.08);
      setSpill(.72);
      setStatus(`Background detected (${color.toUpperCase()}). Removing it now…`);
      void process(detectedSettings);
    }).catch((cause) => {
      if (!keyWasChangedRef.current) {
        setStatus(cause instanceof Error ? cause.message : 'Tap the background in the video to choose its color.');
      }
    }).finally(() => setKeyDetecting(false));
  };

  useEffect(() => {
    const video = originalVideoRef.current;
    const canvas = livePreviewCanvasRef.current;
    if (!file || !originalUrl || processedUrl || !video || !canvas) return;
    let frameId = 0;
    let lastTime = -1;
    let disposed = false;
    const render = () => {
      if (disposed) return;
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && Math.abs(video.currentTime - lastTime) > 0.008) {
        try {
          drawKeyedPreview(video, canvas, settings);
          lastTime = video.currentTime;
          setLivePreviewError('');
        } catch (cause) {
          setLivePreviewError(cause instanceof Error ? cause.message : 'Live cutout preview is unavailable in this browser.');
        }
      }
      frameId = window.requestAnimationFrame(render);
    };
    const resizeObserver = new ResizeObserver(() => {
      if (disposed || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      try {
        drawKeyedPreview(video, canvas, settings);
        setLivePreviewError('');
      } catch (cause) {
        setLivePreviewError(cause instanceof Error ? cause.message : 'Live cutout preview is unavailable in this browser.');
      }
    });
    if (canvas.parentElement) resizeObserver.observe(canvas.parentElement);
    frameId = window.requestAnimationFrame(render);
    return () => {
      disposed = true;
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
    };
  }, [file, originalUrl, processedUrl, settings]);

  const onProcessedMetadata = () => {
    const output = processedVideoRef.current;
    const source = originalVideoRef.current;
    if (!output) return;
    output.currentTime = Math.min(source?.currentTime ?? playhead, Math.max(0, output.duration - 0.02));
    if (source && !source.paused) void output.play().catch(() => undefined);
  };

  const cancelProcessing = () => {
    cancelledRef.current = true;
    engineRef.current?.terminate();
    engineRef.current = null;
    serverAbortRef.current?.abort();
    serverAbortRef.current = null;
    resetOutput();
    setProcessing(false);
    setServerProcessing(false);
    setProgress(0);
    setStatus('Processing cancelled. Temporary clip data was cleared.');
    setError('');
  };
  const process = async (processSettings: ClipSettings = settingsRef.current) => {
    if (!file || processing) return;
    cancelledRef.current = false;
    resetOutput();
    setProcessing(true);
    setServerProcessing(false);
    setProgress(0);
    setError('');
    setStatus('Loading local video engine…');
    const preferServer = /Android/i.test(navigator.userAgent);
    try {
      let resultBlob: Blob;
      let resultSession: string | null = null;
      let usedServerProcessor = preferServer;
      if (preferServer) {
        setServerProcessing(true);
        setStatus('Using Streamtalk’s Android-safe processor (480 px, 24 fps)…');
        const controller = new AbortController();
        serverAbortRef.current = controller;
        const result = await processClipOnServer(file, processSettings, controller.signal, getToken);
        resultBlob = result.blob;
        resultSession = result.processingSession;
      } else {
        try {
          const { processClipLocally } = await import('./processClip');
          if (cancelledRef.current) return;
          const result = await processClipLocally(file, processSettings, (value) => setProgress(value), (engine) => {
            engineRef.current = engine;
          }, (stage) => setStatus(stage));
          resultBlob = result.blob;
        } catch (localCause) {
          if (cancelledRef.current) return;
          usedServerProcessor = true;
          setServerProcessing(true);
          setProgress(0);
          setStatus('Phone encoding could not finish. Retrying with Streamtalk’s low-memory processor (480 px, 24 fps)…');
          const controller = new AbortController();
          serverAbortRef.current = controller;
          try {
            const result = await processClipOnServer(file, processSettings, controller.signal, getToken);
            resultBlob = result.blob;
            resultSession = result.processingSession;
          } catch (serverCause) {
            if (cancelledRef.current) return;
            const localMessage = localCause instanceof Error && localCause.message
              ? localCause.message
              : 'the phone video encoder stopped unexpectedly';
            throw new Error(`${localMessage} Server fallback also failed: ${errorText(serverCause)}`);
          }
        }
      }
      if (cancelledRef.current) return;
      const url = URL.createObjectURL(resultBlob);
      setProcessedUrl(url);
      setProcessedBlob(resultBlob);
      setProcessingSession(resultSession);
      processedSettingsRef.current = JSON.stringify(processSettings);
      setProgress(1);
      setActiveProductionStep(4);
      setPreviewConfirmed(false);
      setStatus(usedServerProcessor
        ? 'Finished with low-memory server processing. The transparent WebM passed the alpha check.'
        : 'Finished. The transparent WebM passed the local alpha check.');
    } catch (cause) {
      if (cancelledRef.current || String(cause).toLowerCase().includes('terminated')) {
        setStatus('Processing cancelled. Temporary clip data was cleared.');
      } else {
        setError(errorText(cause));
        setStatus('');
      }
    } finally {
      setProcessing(false);
      setServerProcessing(false);
      serverAbortRef.current = null;
      engineRef.current = null;
    }
  };

  const synchronizePlay = async () => {
    const a = originalVideoRef.current;
    const b = processedVideoRef.current;
    if (!a) return;
    if (a.paused) {
      if (b) b.currentTime = a.currentTime;
      try { await a.play(); await b?.play(); } catch { setStatus('Tap play again to start both previews.'); }
    } else {
      a.pause(); b?.pause();
    }
  };
  const syncTime = () => {
    const current = originalVideoRef.current?.currentTime ?? 0;
    setPlayhead(current);
    const output = processedVideoRef.current;
    if (output && !isSeekingRef.current && Math.abs(output.currentTime - current) > .12) output.currentTime = current;
  };
  const seek = (value: number) => {
    isSeekingRef.current = true;
    setPlayhead(value);
    if (originalVideoRef.current) originalVideoRef.current.currentTime = value;
    if (processedVideoRef.current) processedVideoRef.current.currentTime = value;
    window.setTimeout(() => { isSeekingRef.current = false; }, 100);
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  const safeGiftFilePrefix = () => (draftName.trim() || 'gift')
    .normalize('NFKD')
    .replace(/[^\w-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'gift';

  const downloadFramesZip = async () => {
    if (!processedUrl) return;
    setDownloadingFrames(true);
    setFrameZipProgress(0);
    setError('');
    try {
      const zip = await createTransparentPngFramesZip(processedUrl, safeGiftFilePrefix(), setFrameZipProgress);
      setFramesZipBlob(zip);
      setError('');
      setStatus('PNG frames are ready. Tap Download PNG frames ZIP to save them.');
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setDownloadingFrames(false);
    }
  };

  const choosePreset = (preset: KeyColor) => {
    keyWasChangedRef.current = true;
    setKeyDetecting(false);
    setKeyPreset(preset);
    const found = KEY_PRESETS.find((option) => option.id === preset);
    if (found) {
      setKeyColor(found.value);
      setDetectedKeyColor(found.value);
      const nextSettings = { ...settingsRef.current, preset, keyColor: found.value };
      if (file && duration > 0 && !processing) void process(nextSettings);
    }
  };
  const pickVideoKeyColor = (event: MouseEvent<HTMLElement>) => {
    const source = originalVideoRef.current;
    if (!source) return;
    const color = sampleVideoColorAtPoint(source, event.clientX, event.clientY, event.currentTarget.getBoundingClientRect());
    if (!color) return;
    keyWasChangedRef.current = true;
    setKeyDetecting(false);
    setDetectedKeyColor(color);
    const family = classifyKeyColor(color);
    const preset = family === 'green' || family === 'magenta' ? family : 'custom';
    setKeyPreset(preset);
    setKeyColor(color);
    setStatus(`Sampled ${color.toUpperCase()} from the clip. The live preview updated.`);
    if (file && duration > 0 && !processing) void process({ ...settingsRef.current, preset, keyColor: color });
  };
  const sampleColor = async () => {
    const EyeDropperApi = (window as Window & { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;
    if (!EyeDropperApi) {
      document.getElementById('gs-key-color')?.focus();
      setStatus('Eye dropper is not available in this browser. Use the color picker to set a custom key.');
      return;
    }
    try {
      const result = await new EyeDropperApi().open();
      keyWasChangedRef.current = true;
      setKeyDetecting(false);
      setDetectedKeyColor(result.sRGBHex.toLowerCase());
      const family = classifyKeyColor(result.sRGBHex);
      const preset = family === 'green' || family === 'magenta' ? family : 'custom';
      setKeyPreset(preset);
      setKeyColor(result.sRGBHex.toLowerCase());
      setStatus(`Custom key color set to ${result.sRGBHex}.`);
      if (file && duration > 0 && !processing) {
        void process({ ...settingsRef.current, preset, keyColor: result.sRGBHex.toLowerCase() });
      }
    } catch {
      setStatus('Color selection cancelled.');
    }
  };

  const approve = async () => {
    const trimmedName = draftName.trim();
    const replacing = giftMode === 'replace';
    if (!file || !processedBlob || !trimmedName || savingVersion || !previewConfirmed || (replacing && !giftId)) return;
    setSavingVersion(true);
    setSaveError('');
    setError('');
    try {
      const saved = await saveGiftStudioClip({
        original: file,
        processed: processedBlob,
        processingSession,
        draftName: trimmedName,
        giftId: replacing ? giftId : '',
        settings: settingsRef.current,
        getToken,
      });
      await Promise.all([
        client.invalidateQueries({ queryKey: getGetGiftStudioLibraryQueryKey() }),
        ...(replacing && giftId
          ? [
            client.invalidateQueries({ queryKey: getGetActiveGiftStudioMediaQueryKey(giftId) }),
            client.invalidateQueries({ queryKey: getGetSocialMeQueryKey() }),
          ]
          : []),
      ]);
      setSavedVersionId(saved.id);
      setStatus(replacing && giftId
        ? `${GIFTS.find((gift) => gift.id === giftId)?.label} is now “${trimmedName}” and its new animation is active. The previous version is kept in Saved gifts as a backup.`
        : `Saved “${trimmedName}” as a new Gift Studio draft. It needs a catalog credit price before it can be activated.`);
      setSavedVersionPreview(saved);
      setSaveError('');
      setActiveProductionStep(5);
    } catch (cause) {
      setSaveError(ownerErrorText(cause));
    } finally {
      setSavingVersion(false);
    }
  };
  const attachVersion = (version: GiftStudioVersion, targetGiftId: GiftStudioGiftId) => {
    assignVersion.mutate({ versionId: version.id, data: { giftId: targetGiftId } }, {
      onSuccess: (updated) => {
        void client.invalidateQueries({ queryKey: getGetGiftStudioLibraryQueryKey() });
        void client.invalidateQueries({ queryKey: getGetActiveGiftStudioMediaQueryKey(updated.giftId!) });
        setSelectedPreview((current) => current?.id === updated.id ? updated : current);
        setStatus(`Added “${versionName(updated)}” to ${GIFTS.find((gift) => gift.id === updated.giftId)?.label} as a draft version. Activate it from the library when ready.`);
      },
      onError: (cause) => setError(ownerErrorText(cause)),
    });
  };
  const toggleVersion = (version: GiftStudioVersion, active: boolean) => {
    if (!version.giftId) {
      setError('Add this standalone draft to an existing gift before activating it.');
      return;
    }
    setActive.mutate({ versionId: version.id, data: { active } }, {
      onSuccess: (updated) => {
        void client.invalidateQueries({ queryKey: getGetGiftStudioLibraryQueryKey() });
        if (updated.giftId) {
          void client.invalidateQueries({ queryKey: getGetActiveGiftStudioMediaQueryKey(updated.giftId) });
          void client.invalidateQueries({ queryKey: getGetSocialMeQueryKey() });
        }
        setSelectedPreview((current) => current?.id === updated.id ? updated : current);
        setStatus(active ? `${GIFTS.find((gift) => gift.id === updated.giftId)?.label} version ${updated.version} is now active.` : `Version ${updated.version} returned to draft.`);
      },
      onError: (cause) => setError(ownerErrorText(cause)),
    });
  };
  const renameVersion = async (version: GiftStudioVersion, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Enter a name before saving.');
      return;
    }
    setLibraryActionId(version.id);
    setError('');
    try {
      const updated = await giftStudioLibraryRequest(`/api/social/admin/gift-studio/versions/${version.id}/name`, 'PATCH', getToken, { name: trimmed }) as GiftStudioVersion;
      await client.invalidateQueries({ queryKey: getGetGiftStudioLibraryQueryKey() });
      if (updated.status === 'active' && updated.giftId) {
        await Promise.all([
          client.invalidateQueries({ queryKey: getGetActiveGiftStudioMediaQueryKey(updated.giftId) }),
          client.invalidateQueries({ queryKey: getGetSocialMeQueryKey() }),
        ]);
      }
      setStatus(`Saved gift renamed to “${trimmed}”.`);
      setSelectedPreview((current) => current?.id === version.id ? { ...current, settings: { ...current.settings, draftName: trimmed } } : current);
    } catch (cause) {
      setError(ownerErrorText(cause));
    } finally {
      setLibraryActionId(null);
    }
  };
  const removeVersion = async (version: GiftStudioVersion) => {
    if (!window.confirm(`Delete “${versionName(version)}” and its saved animation files? This cannot be undone.`)) return;
    setLibraryActionId(version.id);
    setError('');
    try {
      await giftStudioLibraryRequest(`/api/social/admin/gift-studio/versions/${version.id}/delete`, 'DELETE', getToken);
      await client.invalidateQueries({ queryKey: getGetGiftStudioLibraryQueryKey() });
      if (selectedPreview?.id === version.id) setSelectedPreview(null);
      if (playingPreview?.id === version.id) setPlayingPreview(null);
      if (playingSample?.id === version.id) setPlayingSample(null);
      setStatus(`“${versionName(version)}” was removed from saved gifts.`);
    } catch (cause) {
      setError(ownerErrorText(cause));
    } finally {
      setLibraryActionId(null);
    }
  };
  const previewVersion = (version: GiftStudioVersion) => setSelectedPreview(version);
  const nameAndTypeReady = Boolean(draftName.trim()) && (giftMode === 'new' || Boolean(giftId));
  const stepComplete = [
    nameAndTypeReady,
    Boolean(file && duration > 0 && duration <= MAX_SECONDS),
    Boolean(processedUrl),
    previewConfirmed,
    Boolean(savedVersionId),
  ];
  const canVisitStep = (step: number) => step <= 1 || stepComplete.slice(0, step - 1).every(Boolean);
  const goToProductionStep = (step: number) => {
    if (!canVisitStep(step)) return;
    setActiveProductionStep(step);
    productionStepRefs.current[step - 1]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const changeGiftMode = (mode: GiftSetupMode) => {
    if (savedVersionId) return;
    setGiftMode(mode);
    setPreviewConfirmed(false);
    if (mode === 'new') {
      setGiftId('');
      nameWasEditedRef.current = false;
      setDraftName('');
    } else {
      setGiftId('');
      nameWasEditedRef.current = false;
      setDraftName('');
    }
  };
  const changeGiftTarget = (nextGiftId: GiftStudioGiftId) => {
    if (savedVersionId) return;
    setGiftId(nextGiftId);
    nameWasEditedRef.current = false;
    setDraftName(GIFTS.find((gift) => gift.id === nextGiftId)?.label ?? '');
    setPreviewConfirmed(false);
  };
  const advanceToStep = (step: number) => {
    setActiveProductionStep(step);
    window.setTimeout(() => productionStepRefs.current[step - 1]?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };

  if (library.isError && isDenied(library.error)) {
    return <main className="gs"><div className="gs-shell"><section className="gs-error-panel" role="alert" data-testid="state-owner-denied"><ShieldCheck size={23} /><h1 className="gs-panel-title">Gift Studio is for owners</h1><p>Your account does not have permission to manage gift animation versions. Sign in with the owner account, then try again.</p><button className="gs-button" type="button" onClick={() => void library.refetch()} data-testid="button-retry-access"><RefreshCw size={15} /> Check access again</button></section></div></main>;
  }

  const libraryItems = library.data?.items ?? [];
  const filteredItems = selectedPreview ? [selectedPreview, ...libraryItems.filter((item) => item.id !== selectedPreview.id)] : libraryItems;
  const previewStageStyle = frameRatio && Number.isFinite(frameRatio)
    ? { width: `min(100%, ${52 * frameRatio}dvh)`, maxHeight: '52dvh', aspectRatio: String(frameRatio), marginInline: 'auto' }
    : undefined;
  return (
    <main className="gs">
      <div className="gs-shell">
        <div className="gs-topline"><span className="gs-topline-mark" /> STREAMTALK · GIFT STUDIO</div>
        <header className="gs-production-intro">
          <h1>Gift production</h1>
          <p>Name it, remove the screen, check the transparent animation, then activate it in Streamtalk.</p>
          <div className="gs-private"><LockKeyhole size={13} /> Owner-only workspace</div>
        </header>

        <div className="gs-production">
          <nav className="gs-production-stepper" aria-label="Gift production progress" data-testid="gift-production-stepper">
            <div className="gs-production-stepper-head">
              <strong>Step {activeProductionStep} of 5</strong>
              <span>{PRODUCTION_STEPS[activeProductionStep - 1]}</span>
            </div>
            <div className="gs-production-track" aria-hidden="true">
              <span className="gs-production-track-fill" style={{ width: `${activeProductionStep * 20}%` }} />
            </div>
            <div className="gs-production-step-links">
              {PRODUCTION_STEPS.map((label, index) => {
                const step = index + 1;
                return <button
                  className={`gs-production-step-link${stepComplete[index] ? ' is-complete' : ''}`}
                  type="button"
                  key={label}
                  aria-current={activeProductionStep === step ? 'step' : undefined}
                  disabled={!canVisitStep(step)}
                  onClick={() => goToProductionStep(step)}
                  data-testid={`button-production-step-${step}`}
                >{step}. {label}</button>;
              })}
            </div>
          </nav>

          <section
            className="gs-production-step"
            id="gift-step-name"
            aria-labelledby="gs-step-name-title"
            data-production-step="1"
            data-testid="production-step-name"
            ref={(node) => { productionStepRefs.current[0] = node; }}
          >
            <div className="gs-production-step-head">
              <span className="gs-production-step-number">01</span>
              <div><h2 id="gs-step-name-title">Name and gift type</h2><p>Choose a new draft or select the catalog gift to replace.</p></div>
            </div>
            <div className="gs-production-step-body">
              <label className="gs-name-field">
                <span>Gift name <small>Required</small></span>
                <input
                  type="text"
                  value={draftName}
                  maxLength={MAX_DRAFT_NAME}
                  onChange={(event) => { nameWasEditedRef.current = true; setDraftName(event.target.value); }}
                  disabled={processing || Boolean(savedVersionId)}
                  placeholder="For example, Midnight Rose"
                  autoComplete="off"
                  aria-required="true"
                  data-testid="input-draft-name"
                />
              </label>
              <div className="gs-gift-mode" role="radiogroup" aria-label="New gift or replacement">
                <label className="gs-gift-mode-choice">
                  <input type="radio" name="gift-setup-mode" checked={giftMode === 'new'} onChange={() => changeGiftMode('new')} disabled={Boolean(savedVersionId)} data-testid="radio-new-gift" />
                  <span><strong>New gift</strong><small>Save as a new draft. A credit price is required before it can join the live catalog.</small></span>
                </label>
                <label className="gs-gift-mode-choice">
                  <input type="radio" name="gift-setup-mode" checked={giftMode === 'replace'} onChange={() => changeGiftMode('replace')} disabled={Boolean(savedVersionId)} data-testid="radio-replace-gift" />
                  <span><strong>Replace an existing gift</strong><small>Activate its new animation and name; keep the previous version as a backup.</small></span>
                </label>
              </div>
              {giftMode === 'replace' && <label className="gs-name-field gs-gift-mode-control">
                <span>Gift to replace</span>
                <select value={giftId} onChange={(event) => changeGiftTarget(event.target.value as GiftStudioGiftId)} disabled={Boolean(savedVersionId)} data-testid="select-gift-target">
                  <option value="">Choose a catalog gift…</option>
                  {GIFTS.map((gift) => <option key={gift.id} value={gift.id}>{gift.label}</option>)}
                </select>
                {giftId && <small>{activeGiftQuery.isFetching ? 'Loading current gift name…' : `Current name: ${activeGiftName}`}</small>}
              </label>}
              {error && <div className="gs-error" role="alert" data-testid="state-error">{error}</div>}
              <div className="gs-activation-actions">
                <button className="gs-button primary" type="button" disabled={!nameAndTypeReady} onClick={() => advanceToStep(2)} data-testid="button-continue-name">Continue to upload <ChevronRight size={16} /></button>
              </div>
            </div>
          </section>

          <section
            className="gs-production-step"
            id="gift-step-upload"
            aria-labelledby="gs-step-upload-title"
            data-production-step="2"
            data-testid="production-step-upload"
            ref={(node) => { productionStepRefs.current[1] = node; }}
          >
            <div className="gs-production-step-head">
              <span className="gs-production-step-number">02</span>
              <div><h2 id="gs-step-upload-title">Upload video</h2><p>MP4, WebM or MOV · up to 15 seconds and 100 MB.</p></div>
            </div>
            <div className="gs-production-step-body">
              <label className="gs-upload gs-production-upload" htmlFor="gs-file-input" data-testid="upload-video-dropzone">
                {file ? <><div className="gs-file-row"><span className="gs-file-name">{file.name}</span><span className="gs-file-meta">{formatBytes(file.size)}</span></div><small>{duration ? `${duration.toFixed(1)} seconds` : 'Checking clip length'} · tap to replace</small></> :
                  <><span className="gs-upload-icon"><FileVideo2 size={23} /></span><strong>Choose a gift video</strong><small>MP4, WebM or MOV. Maximum 15 seconds and 100 MB.</small><span className="gs-upload-cta"><Upload size={17} /> Browse phone</span></>}
                <input id="gs-file-input" type="file" accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov" disabled={processing || Boolean(savedVersionId)} onChange={(event) => { loadFile(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} data-testid="input-source-video" aria-label="Choose a video clip" />
              </label>
              {originalUrl && <div className="gs-upload-summary"><strong>Source clip ready</strong> · {file?.name} · {duration ? `${duration.toFixed(1)} sec` : 'Reading duration'} · {formatBytes(file?.size ?? 0)}</div>}
              {originalUrl && <div className="gs-preview">
                <div className="gs-preview-label">Original clip <span>Source video</span></div>
                <div className={`gs-preview-stage ${backdrop}`} style={previewStageStyle} onClick={pickVideoKeyColor} data-testid="preview-original" title="Tap the background to sample its color">
                  <video ref={originalVideoRef} src={originalUrl} muted playsInline loop autoPlay preload="metadata" onLoadedMetadata={onOriginalMetadata} onError={() => { setKeyDetecting(false); setError('This clip could not be decoded in the browser. Try an MP4 or WebM export and reload it.'); }} onTimeUpdate={syncTime} />
                </div>
              </div>}
              {error && <div className="gs-error" role="alert" data-testid="state-upload-error">{error}</div>}
              <div className="gs-activation-actions">
                <button className="gs-button" type="button" onClick={() => goToProductionStep(1)} data-testid="button-back-upload">Back to name</button>
                <button className="gs-button primary" type="button" disabled={!file || !duration || duration > MAX_SECONDS} onClick={() => advanceToStep(3)} data-testid="button-continue-upload">Continue to removal <ChevronRight size={16} /></button>
              </div>
            </div>
          </section>

          <section
            className="gs-production-step"
            id="gift-step-remove"
            aria-labelledby="gs-step-remove-title"
            data-production-step="3"
            data-testid="production-step-remove"
            ref={(node) => { productionStepRefs.current[2] = node; }}
          >
            <div className="gs-production-step-head">
              <span className="gs-production-step-number">03</span>
              <div><h2 id="gs-step-remove-title">Remove background</h2><p>Streamtalk detects the screen color and starts processing automatically.</p></div>
            </div>
            <div className="gs-production-step-body">
              <div className="gs-auto-key-status" role="status" data-testid="text-detected-key-color">
                {keyDetecting ? <>Detecting background color… <span className="gs-progress-mini" /></> : detectedKeyColor
                  ? <><strong>Background detected</strong> <span className="gs-detected-swatch" style={{ backgroundColor: detectedKeyColor }} /> <code>{detectedKeyColor.toUpperCase()}</code>. Auto-removal starts as soon as detection finishes.</>
                  : file ? 'Tap the background in the source clip above if automatic detection needs help.' : 'Upload a clip to detect and remove its background.'}
              </div>
              {keyPreset === 'black' && <p className="gs-warning" role="note" data-testid="warning-black-key"><AlertTriangle size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Black keying also removes black car bodies, tires, and shadows.</p>}
              <details className="gs-adjust" data-testid="details-adjust">
                <summary>Adjust color and edge cleanup</summary>
                <p className="gs-caption">Tap the screen behind the subject in the source preview above to choose its exact color. Changes update the live preview; run removal again to export the adjusted result.</p>
                <fieldset className="gs-settings" disabled={processing}>
                  <div>
                    <div className="gs-kicker" style={{ marginBottom: 8 }}>Key color</div>
                    <div className="gs-choice-row" role="group" aria-label="Key color preset">
                      {KEY_PRESETS.map((preset) => <button className="gs-choice" type="button" key={preset.id} aria-pressed={keyPreset === preset.id} onClick={() => choosePreset(preset.id)} data-testid={`button-key-${preset.id}`}><span className="gs-swatch" style={{ backgroundColor: preset.value }} />{preset.label}</button>)}
                      <button className="gs-choice" type="button" aria-pressed={keyPreset === 'custom'} onClick={() => void sampleColor()} data-testid="button-eyedropper"><Pipette size={14} /> Eyedropper</button>
                      <label className="gs-sr-only" htmlFor="gs-key-color">Custom key color</label>
                      <input className="gs-color-input" id="gs-key-color" type="color" value={keyColor} onChange={(event) => { keyWasChangedRef.current = true; setKeyDetecting(false); setDetectedKeyColor(event.target.value); const family = classifyKeyColor(event.target.value); const preset = family === 'green' || family === 'magenta' ? family : 'custom'; setKeyPreset(preset); setKeyColor(event.target.value); }} aria-label="Choose custom key color" data-testid="input-key-color" />
                    </div>
                  </div>
                  <div className="gs-field-row"><div><label htmlFor="gs-tolerance">Tolerance <output>{tolerance.toFixed(2)}</output></label><input className="gs-range" id="gs-tolerance" type="range" min=".02" max=".65" step=".01" value={tolerance} onChange={(event) => setTolerance(Number(event.target.value))} data-testid="input-tolerance" /></div></div>
                  <div className="gs-field-row"><div><label htmlFor="gs-softness">Edge softness <output>{softness.toFixed(2)}</output></label><input className="gs-range" id="gs-softness" type="range" min="0" max=".5" step=".01" value={softness} onChange={(event) => setSoftness(Number(event.target.value))} data-testid="input-softness" /></div></div>
                  <div className="gs-field-row"><div><label htmlFor="gs-spill">Spill reduction <output>{spill.toFixed(2)}</output></label><input className="gs-range" id="gs-spill" type="range" min="0" max="1" step=".01" value={spill} onChange={(event) => setSpill(Number(event.target.value))} disabled={keyPreset === 'black'} data-testid="input-spill" /></div></div>
                  <label className="gs-kicker" htmlFor="gs-max-size">Maximum output dimension</label>
                  <select className="gs-chip-button" id="gs-max-size" value={maxDimension ?? 'original'} onChange={(event) => setMaxDimension(event.target.value === 'original' ? null : Number(event.target.value) as 480 | 720 | 1080)} data-testid="select-max-dimension"><option value="original">Keep original size</option><option value="480">480 px · smallest</option><option value="720">720 px · balanced</option><option value="1080">1080 px · sharpest</option></select>
                </fieldset>
              </details>
              {processing && <div className="gs-progress" role="status" aria-live="polite" data-testid="state-processing"><div className="gs-progress-track"><div className={`gs-progress-fill${serverProcessing ? ' is-indeterminate' : ''}`} style={serverProcessing ? undefined : { width: `${Math.round(progress * 100)}%` }} /></div><div className="gs-progress-copy"><span>{status}</span><span>{serverProcessing ? 'Working' : `${Math.round(progress * 100)}%`}</span></div><button className="gs-button quiet" type="button" onClick={cancelProcessing} data-testid="button-cancel-processing"><X size={15} /> Cancel</button></div>}
              {!processing && file && !processedUrl && <button className="gs-button primary gs-auto-process" type="button" onClick={() => void process(settingsRef.current)} disabled={keyDetecting || duration <= 0 || duration > MAX_SECONDS} data-testid="button-process">{error ? 'Try background removal again' : detectedKeyColor ? 'Remove background again' : 'Process with current key'} <ChevronRight size={16} /></button>}
              {error && <div className="gs-error" role="alert" data-testid="state-error">{error}</div>}
              {status && !processing && <p className="gs-caption" role="status" aria-live="polite" data-testid="state-status">{status}</p>}
              <div className="gs-activation-actions">
                <button className="gs-button" type="button" onClick={() => goToProductionStep(2)} data-testid="button-back-remove">Back to upload</button>
                <button className="gs-button primary" type="button" disabled={!processedUrl} onClick={() => advanceToStep(4)} data-testid="button-continue-remove">Review result <ChevronRight size={16} /></button>
              </div>
            </div>
          </section>

          <section
            className="gs-production-step"
            id="gift-step-review"
            aria-labelledby="gs-step-review-title"
            data-production-step="4"
            data-testid="production-step-review"
            ref={(node) => { productionStepRefs.current[3] = node; }}
          >
            <div className="gs-production-step-head">
              <span className="gs-production-step-number">04</span>
              <div><h2 id="gs-step-review-title">Review the transparent result</h2><p>Fit the whole frame. Check transparency before activation.</p></div>
            </div>
            <div className="gs-production-step-body">
              <div className="gs-result-toggle" role="group" aria-label="Result preview mode">
                <button type="button" aria-pressed={reviewMode === 'checker'} onClick={() => setReviewMode('checker')} data-testid="button-review-checker">Checkerboard</button>
                <button type="button" aria-pressed={reviewMode === 'sample'} onClick={() => setReviewMode('sample')} data-testid="button-review-sample">Sample stream</button>
              </div>
              <div className={`gs-result-preview${reviewMode === 'sample' ? ' is-sample' : ''}`} style={previewStageStyle} data-testid="preview-final-result">
                {reviewMode === 'sample' && <><div className="gs-stream-mock-top"><span className="gs-live-dot" /> LIVE · STREAMTALK</div><div className="gs-stream-mock-chat">Chat stays visible under the gift.</div><div className="gs-stream-mock-name">{draftName || 'Gift preview'}</div></>}
                {processedUrl
                  ? <video key={processedUrl} ref={processedVideoRef} src={processedUrl} muted playsInline loop autoPlay preload="metadata" onLoadedMetadata={onProcessedMetadata} onTimeUpdate={syncTime} aria-label="Processed transparent gift animation" data-testid="video-final-result" />
                  : originalUrl
                    ? <canvas ref={livePreviewCanvasRef} onClick={pickVideoKeyColor} aria-label="Live transparent cutout preview while processing" data-testid="canvas-live-cutout" />
                    : <div className="gs-empty-preview">Upload a clip to preview the final animation here.</div>}
                {livePreviewError && !processedUrl && <div className="gs-preview-note" role="status">{livePreviewError}</div>}
              </div>
              {processedUrl ? <div className="gs-auto-key-status gs-transparency-passed" role="status" data-testid="status-alpha-check"><Check size={17} /><strong>Transparency check passed</strong><span>The exported animation is playing with its verified alpha channel.</span></div> :
                error ? <div className="gs-error" role="alert">{error} Open Adjust to refine the key and try again.</div> :
                  <div className="gs-upload-summary">The live cutout appears here while the finished transparent export is processing.</div>}
              <div className="gs-controls">
                <button className="gs-icon-button" type="button" onClick={() => void synchronizePlay()} disabled={!file} aria-label={originalVideoRef.current?.paused ? 'Play both previews' : 'Pause both previews'} data-testid="button-play-pause">{originalVideoRef.current?.paused ? <Play size={16} /> : <Pause size={16} />}</button>
                <input className="gs-range" type="range" min="0" max={duration || 1} step=".05" value={Math.min(playhead, duration || 0)} onChange={(event) => seek(Number(event.target.value))} disabled={!file} aria-label="Scrub both previews" data-testid="input-preview-scrubber" />
                <span className="gs-file-meta" data-testid="text-preview-time">{timeLabel(playhead)} / {timeLabel(duration)}</span>
              </div>
              {processedUrl && <div className="gs-after-downloads">
                <button className="gs-button quiet" type="button" onClick={() => processedBlob && downloadBlob(processedBlob, `${safeGiftFilePrefix()}-transparent.webm`)} disabled={!processedBlob} data-testid="button-download-webm"><Download size={14} /> Download WebM</button>
                <button className="gs-button quiet" type="button" onClick={() => framesZipBlob ? downloadBlob(framesZipBlob, `${safeGiftFilePrefix()}-png-frames.zip`) : void downloadFramesZip()} disabled={downloadingFrames} data-testid="button-download-png-zip"><Archive size={14} /> {downloadingFrames ? `Preparing ZIP ${Math.round(frameZipProgress * 100)}%` : framesZipBlob ? 'Download PNG frames ZIP' : 'Prepare PNG frames ZIP'}</button>
              </div>}
              <div className="gs-activation-actions">
                <button className="gs-button" type="button" onClick={() => goToProductionStep(3)} data-testid="button-back-preview">Back to removal</button>
                <button className="gs-button primary" type="button" disabled={!processedUrl} onClick={() => { setPreviewConfirmed(true); advanceToStep(5); }} data-testid="button-approve-preview">Looks good — continue to activate <ChevronRight size={16} /></button>
              </div>
            </div>
          </section>

          <section
            className="gs-production-step"
            id="gift-step-activate"
            aria-labelledby="gs-step-activate-title"
            data-production-step="5"
            data-testid="production-step-activate"
            ref={(node) => { productionStepRefs.current[4] = node; }}
          >
            <div className="gs-production-step-head">
              <span className="gs-production-step-number">05</span>
              <div><h2 id="gs-step-activate-title">Activate in Streamtalk</h2><p>Save the finished clip to the real gift library.</p></div>
            </div>
            <div className="gs-production-step-body">
              <div className="gs-activation-summary">
                {giftMode === 'replace'
                  ? <><strong>Replacing {GIFTS.find((gift) => gift.id === giftId)?.label ?? 'a catalog gift'}</strong><br />Current name: {activeGiftName || 'Loading current name…'}<br />New name: {draftName || 'Enter a gift name above.'} · Existing price and credit rules stay unchanged.</>
                  : <><strong>New gift: {draftName || 'Enter a gift name above.'}</strong><br />It will be saved as a named draft. A credit price is needed before a new item can be added to the live gift picker.</>}
              </div>
              {!previewConfirmed && <p className="gs-caption">Review the processed result in step 4 before activating.</p>}
              <div className="gs-activation-actions">
                <button className="gs-button" type="button" onClick={() => goToProductionStep(4)} data-testid="button-back-activate">Back to result</button>
                <button className="gs-button primary" type="button" onClick={() => void approve()} disabled={!file || !processedBlob || !draftName.trim() || (giftMode === 'replace' && !giftId) || !previewConfirmed || savingVersion || Boolean(savedVersionId)} data-testid="button-save-as-gift">
                  {savingVersion ? 'Saving…' : savedVersionId ? 'Saved' : giftMode === 'replace' ? 'Activate replacement' : 'Save new gift draft'} <Check size={15} />
                </button>
              </div>
              {saveError && <div className="gs-error" role="alert" data-testid="state-upload-error">{saveError}</div>}
              {savedVersionPreview && <div className="gs-save-confirmation" data-testid={savedVersionPreview.giftId ? 'panel-active-gift-confirmation' : 'panel-new-gift-draft-confirmation'}>
                <strong>{savedVersionPreview.giftId ? `${GIFTS.find((gift) => gift.id === savedVersionPreview.giftId)?.label} is now “${versionName(savedVersionPreview)}” in the gift picker.` : `“${versionName(savedVersionPreview)}” is saved as a draft.`}</strong>
                <div className="gs-library-preview checker">
                  <video src={giftStudioMediaUrl(savedVersionPreview.webmUrl)} muted playsInline loop autoPlay preload="metadata" aria-label={`Preview of ${versionName(savedVersionPreview)}`} data-testid="video-confirmed-active-gift" />
                </div>
                <p className="gs-caption">{savedVersionPreview.giftId ? 'The previous animation is saved as a backup. The active gift price and credit rules are unchanged.' : 'This new draft is stored in Saved gifts, but is not in the live picker until a credit price is set.'}</p>
              </div>}
              {error && <div className="gs-error" role="alert" data-testid="state-error">{error}</div>}
              {status && !processing && <p className="gs-caption" role="status" aria-live="polite" data-testid="state-status">{status}</p>}
              {downloadingFrames && <p className="gs-caption" role="status" aria-live="polite">Preparing transparent PNG frames…</p>}
            </div>
          </section>

          <section className="gs-production-step gs-saved-gifts" aria-labelledby="gs-library-title" data-testid="section-saved-gifts">
            <div className="gs-production-step-head">
              <span className="gs-production-step-number"><Archive size={15} /></span>
              <div><h2 id="gs-library-title">Saved gifts</h2><p>Active versions and restorable backups.</p></div>
              <span className="gs-status">{libraryItems.length} saved</span>
            </div>
            {library.isLoading ? <div className="gs-library-list" aria-label="Loading gift versions" data-testid="state-library-loading">{[1, 2, 3].map((i) => <div className="gs-library-card" key={i}><div className="gs-version-mark" /><div className="gs-version-info"><strong>Loading saved version</strong><small>Fetching your library…</small></div></div>)}</div> :
              library.isError ? <div className="gs-error-panel" role="alert" data-testid="state-library-error"><p>{errorText(library.error)}</p><button className="gs-button" type="button" onClick={() => void library.refetch()} data-testid="button-retry-library"><RefreshCw size={14} /> Try again</button></div> :
                libraryItems.length === 0 ? <div className="gs-empty-library" data-testid="state-library-empty">Saved gifts and replacement backups will appear here.</div> :
                  <div className="gs-library-list" data-testid="list-gift-versions">{filteredItems.map((version) => <LibraryVersion key={version.id} version={version} onPreview={previewVersion} onToggle={toggleVersion} onAssign={attachVersion} onRename={renameVersion} onDelete={removeVersion} pending={setActive.isPending || assignVersion.isPending || libraryActionId === version.id} />)}</div>}
          </section>
        </div>
        <div className="gs-sr-only" aria-live="polite" data-testid="state-announcer">{status}</div>
      </div>

      {selectedPreview && <div role="dialog" aria-modal="true" aria-labelledby="gs-version-dialog-title" className="gs-modal-wrap" onClick={(event) => { if (event.target === event.currentTarget) setSelectedPreview(null); }} data-testid="dialog-version-preview">
        <section className="gs-panel gs-modal">
          <div className="gs-panel-head"><div><div className="gs-kicker">{selectedPreview.status} · version {selectedPreview.version}</div><h2 className="gs-panel-title" id="gs-version-dialog-title">{versionName(selectedPreview)} animation</h2></div><button type="button" className="gs-icon-button" onClick={() => setSelectedPreview(null)} aria-label="Close version preview" data-testid="button-close-version-preview"><X size={16} /></button></div>
          <div className="gs-preview-stage checker"><video src={giftStudioMediaUrl(selectedPreview.webmUrl)} controls muted playsInline preload="metadata" data-testid={`video-library-version-${selectedPreview.id}`} /></div>
          <div className="gs-controls">
            <button type="button" className="gs-button primary" onClick={() => setPlayingSample(selectedPreview)} data-testid={`button-play-version-sample-${selectedPreview.id}`}>Play over sample stream</button>
            {selectedPreview.giftId ? <>
              <button type="button" className="gs-button" onClick={() => setPlayingPreview(selectedPreview)} data-testid={`button-play-version-overlay-${selectedPreview.id}`}>Play through gift overlay</button>
              <button type="button" className="gs-button" onClick={() => toggleVersion(selectedPreview, selectedPreview.status !== 'active')} disabled={setActive.isPending} data-testid={`button-toggle-version-${selectedPreview.id}`}>{selectedPreview.status === 'active' ? 'Return to draft' : 'Activate this version'}</button>
            </> : <p className="gs-caption">To use this saved clip in gifts, choose an existing catalog gift in its card and activate the attached version.</p>}
            <button type="button" className="gs-button quiet" onClick={() => setSelectedPreview(null)}>Done</button>
          </div>
        </section>
      </div>}
      {playingPreview?.giftId && <GiftAnimationPlayer
        key={`gift-studio-preview-${playingPreview.id}`}
        giftId={playingPreview.giftId}
        senderName="Preview"
        mediaOverride={{
          versionId: playingPreview.id,
           name: versionName(playingPreview),
          webmUrl: playingPreview.webmUrl,
          safariUrl: playingPreview.safariUrl,
          durationMs: playingPreview.durationMs,
        }}
        onFinish={() => setPlayingPreview(null)}
      />}
      {playingSample && <GiftStudioSamplePreview version={playingSample} onClose={() => setPlayingSample(null)} />}
    </main>
  );
}

export default GiftStudioPage;

function LibraryVersion({ version, onPreview, onToggle, onAssign, onRename, onDelete, pending }: {
  version: GiftStudioVersion;
  onPreview: (version: GiftStudioVersion) => void;
  onToggle: (version: GiftStudioVersion, active: boolean) => void;
  onAssign: (version: GiftStudioVersion, giftId: GiftStudioGiftId) => void;
  onRename: (version: GiftStudioVersion, name: string) => void;
  onDelete: (version: GiftStudioVersion) => void;
  pending: boolean;
}) {
  const [giftTarget, setGiftTarget] = useState<GiftStudioGiftId | ''>('');
  const label = versionName(version);
  const [name, setName] = useState(label);
  useEffect(() => setName(label), [label]);
  return <article className="gs-library-card" data-testid={`card-gift-version-${version.id}`}>
    <div className="gs-library-preview checker"><video src={giftStudioMediaUrl(version.webmUrl)} muted playsInline loop autoPlay preload="metadata" aria-label={`${label} looping transparent preview`} data-testid={`video-library-loop-${version.id}`} /></div>
    <div className="gs-version-info"><strong>{label}</strong><small>{version.giftId ? `${GIFTS.find((gift) => gift.id === version.giftId)?.label} · ` : 'Standalone draft · not in gift selection · '}{new Date(version.createdAt).toLocaleDateString()} · {formatBytes(version.webmBytes)} WebM · {version.durationMs / 1000}s</small><span className={`gs-status ${version.status === 'active' ? 'active' : ''}`} data-testid={`status-version-${version.id}`}>{version.status}</span></div>
    <div className="gs-card-actions">
      <button className="gs-icon-button" type="button" onClick={() => onPreview(version)} aria-label={`Preview ${label} version ${version.version}`} data-testid={`button-preview-version-${version.id}`}><Play size={14} /></button>
      <button className="gs-chip-button" type="button" onClick={() => onDelete(version)} disabled={pending} aria-label={`Delete ${label}`} data-testid={`button-delete-version-${version.id}`}><Trash2 size={14} /> Delete</button>
      {version.giftId ? <button className="gs-chip-button" type="button" onClick={() => onToggle(version, version.status !== 'active')} disabled={pending} data-testid={`button-activate-version-${version.id}`}>{version.status === 'active' ? 'Return to draft' : 'Activate'}</button> :
        <div className="gs-assign-row">
          <select className="gs-chip-button" value={giftTarget} onChange={(event) => setGiftTarget(event.target.value as GiftStudioGiftId | '')} aria-label={`Choose a gift for ${label}`} data-testid={`select-assign-gift-${version.id}`}>
            <option value="">Choose gift…</option>
            {GIFTS.map((gift) => <option key={gift.id} value={gift.id}>{gift.label}</option>)}
          </select>
          <button className="gs-chip-button" type="button" onClick={() => giftTarget && onAssign(version, giftTarget)} disabled={pending || !giftTarget} data-testid={`button-assign-gift-${version.id}`}>Add to gift</button>
        </div>}
    </div>
    <form className="gs-library-rename" onSubmit={(event) => { event.preventDefault(); onRename(version, name); }}>
      <label htmlFor={`gift-name-${version.id}`}>Rename saved gift</label>
      <input id={`gift-name-${version.id}`} value={name} maxLength={MAX_DRAFT_NAME} onChange={(event) => setName(event.target.value)} aria-label={`Name for ${label}`} data-testid={`input-rename-version-${version.id}`} />
      <button className="gs-chip-button" type="submit" disabled={pending || !name.trim() || name.trim() === label}><Save size={14} /> Save name</button>
    </form>
  </article>;
}

function GiftStudioSamplePreview({ version, onClose }: { version: GiftStudioVersion; onClose: () => void }) {
  return <div className="gs-sample-preview-wrap" role="dialog" aria-modal="true" aria-label={`${versionName(version)} sample stream preview`} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }} data-testid="dialog-sample-stream-preview">
    <div className="gs-sample-stream" aria-label="Sample live stream background">
      <div className="gs-sample-stream-scene" />
      <div className="gs-sample-stream-top"><span className="gs-live-dot" /> SAMPLE STREAM</div>
      <div className="gs-sample-stream-chat">The gift animation is playing over the sample stream.</div>
      <video src={giftStudioMediaUrl(version.webmUrl)} muted playsInline loop autoPlay preload="auto" aria-label={`${versionName(version)} looping animation`} data-testid="video-sample-stream-preview" />
      <div className="gs-sample-stream-name">{versionName(version)}</div>
    </div>
    <button type="button" className="gs-sample-close" onClick={onClose} aria-label="Close sample stream preview"><X size={20} /> Close</button>
  </div>;
}

function versionName(version: GiftStudioVersion) {
  return version.settings.draftName?.trim()
    || `${GIFTS.find((gift) => gift.id === version.giftId)?.label ?? 'Gift Studio'} · ${version.originalName}`;
}
