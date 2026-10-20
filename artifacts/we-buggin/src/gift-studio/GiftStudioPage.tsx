import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { useAuth } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Archive, Check, ChevronRight, Download, Pipette, FileVideo2, LockKeyhole, Pause, Play, RefreshCw, Scissors, ShieldCheck, Upload, X, Pencil, Trash2, Save } from 'lucide-react';
import {
  getGetActiveGiftStudioMediaQueryKey,
  getGetGiftStudioLibraryQueryKey,
  getGetSocialMeQueryKey,
  getGetDeveloperContentSyncQueryKey,
  getGetHangoutRewardSettingsQueryKey,
  useAssignGiftStudioVersionToGift,
  useGetActiveGiftStudioMedia,
  useGetDeveloperContentSync,
  useGetHangoutRewardSettings,
  useGetGiftStudioLibrary,
  useRunDeveloperContentSync,
  useSetHangoutRewardInterval,
  useSetGiftStudioVersionActive,
  useUpdateGiftStudioCatalogItem,
  useRenameGiftStudioVersion,
  useDeleteGiftStudioVersion,
} from '@workspace/api-client-react';
import type {
  GiftStudioCatalogGift,
  GiftStudioGiftId,
  GiftStudioProductType,
  GiftStudioVersion,
  GiftStudioIconStatus,
  SocialGiftCatalogId,
} from '@workspace/api-client-react';
import type { ClipSettings, KeyColor } from './processClip';
import { GiftAnimationPlayer, giftStudioMediaUrl } from '@/gifts/GiftAnimationPlayer';
import { CoinAmount, GiftIcon } from '@/social/common';
import { RoomGiftIcon, type RoomGiftId } from '@/gifts/SpiritPup';
import { classifyKeyColor, detectVideoBackground, detectVideoEdgeColor, drawKeyedPreview, sampleVideoColorAtPoint } from './liveKeyPreview';
import { createTransparentPngFramesZip } from './downloadPngFramesZip';
import './gift-studio.css';
import './gift-studio-production.css';

const GIFTS: { id: GiftStudioGiftId; label: string }[] = [
  { id: 'good-vibes', label: 'Good vibes' },
  { id: 'big-love', label: 'Big love' },
  { id: 'standing-ovation', label: 'Standing ovation' },
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
const PRODUCTION_STEPS = ['Name & type', 'Upload', 'Background', 'Review', 'Activate'];

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
    throw await responseError(response, `Deux Wild could not process this clip (server error ${response.status}).`);
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
  productType?: GiftStudioProductType;
  catalogCost?: number;
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
        ...(input.productType ? { productType: input.productType } : {}),
        ...(input.giftId && input.catalogCost !== undefined ? { cost: input.catalogCost } : {}),
      }),
    });
    if (response.status !== 410) {
      if (!response.ok) throw await responseError(response, `Deux Wild could not save this gift (server error ${response.status}).`);
      return await response.json() as GiftStudioVersion;
    }
    // A dev preview/server restart may expire its temporary copy. The browser still
    // has both files, so upload those explicit file parts instead.
  }

  const form = new FormData();
  form.append('sourceVideo', input.original, input.original.name || 'source.mp4');
  const baseName = trimmedName.normalize('NFKD').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'gift';
  const processedFile = new File(
    [input.processed],
    `${baseName}-${input.settings.backgroundMode === 'black' ? 'black-background' : 'alpha'}.webm`,
    { type: 'video/webm' },
  );
  form.append('processedWebm', processedFile, processedFile.name);
  form.append('settings', JSON.stringify({ ...input.settings, draftName: trimmedName }));
  if (input.giftId) form.append('giftId', input.giftId);
  if (input.productType) form.append('productType', input.productType);
  if (input.giftId && input.catalogCost !== undefined) form.append('cost', String(input.catalogCost));
  const response = await fetch('/api/social/admin/gift-studio/versions', {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders,
    body: form,
  });
  if (!response.ok) throw await responseError(response, `Deux Wild could not save this gift (server error ${response.status}).`);
  return await response.json() as GiftStudioVersion;
}

export function GiftStudioPage() {
  const { getToken } = useAuth();
  const client = useQueryClient();
  const library = useGetGiftStudioLibrary({ query: { queryKey: getGetGiftStudioLibraryQueryKey(), retry: false } });
  const contentSync = useGetDeveloperContentSync({
    query: { queryKey: getGetDeveloperContentSyncQueryKey(), retry: false, refetchInterval: 30_000 },
  });
  const hangoutSettings = useGetHangoutRewardSettings({
    query: { queryKey: getGetHangoutRewardSettingsQueryKey(), retry: false },
  });
  const [hangoutIntervalDraft, setHangoutIntervalDraft] = useState('60');
  const [hangoutNotice, setHangoutNotice] = useState('');
  useEffect(() => {
    if (hangoutSettings.data) setHangoutIntervalDraft(String(hangoutSettings.data.averageIntervalMinutes));
  }, [hangoutSettings.data?.averageIntervalMinutes]);
  const saveHangoutInterval = useSetHangoutRewardInterval({
    mutation: {
      onSuccess: result => {
        client.setQueryData(getGetHangoutRewardSettingsQueryKey(), result);
        setHangoutNotice(`Coin drops now average about ${result.averageIntervalMinutes} minutes apart.`);
      },
    },
  });
  const runContentSync = useRunDeveloperContentSync({
    mutation: {
      onSuccess: async result => {
        client.setQueryData(getGetDeveloperContentSyncQueryKey(), result);
        await Promise.all([
          client.invalidateQueries({ queryKey: getGetGiftStudioLibraryQueryKey() }),
          client.invalidateQueries({ queryKey: getGetSocialMeQueryKey() }),
        ]);
      },
    },
  });
  const setActive = useSetGiftStudioVersionActive();
  const assignVersion = useAssignGiftStudioVersionToGift();
  const updateCatalog = useUpdateGiftStudioCatalogItem();
  const renameSavedVersion = useRenameGiftStudioVersion();
  const deleteSavedVersion = useDeleteGiftStudioVersion();
  const [file, setFile] = useState<File | null>(null);
  const [originalUrl, setOriginalUrl] = useState('');
  const [processedUrl, setProcessedUrl] = useState('');
  const [processedBlob, setProcessedBlob] = useState<Blob | null>(null);
  const [processingSession, setProcessingSession] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [frameRatio, setFrameRatio] = useState<number | null>(null);
  const [giftMode, setGiftMode] = useState<GiftSetupMode>('replace');
  const [productType, setProductType] = useState<GiftStudioProductType>('gift');
  const [giftId, setGiftId] = useState<GiftStudioGiftId | ''>('');
  const [giftPrice, setGiftPrice] = useState('');
  const [draftName, setDraftName] = useState('');
  const [reviewMode, setReviewMode] = useState<'checker' | 'sample'>('checker');
  const [previewConfirmed, setPreviewConfirmed] = useState(false);
  const [activeProductionStep, setActiveProductionStep] = useState(1);
  const [keyPreset, setKeyPreset] = useState<KeyColor>('green');
  const [backgroundMode, setBackgroundMode] = useState<ClipSettings['backgroundMode']>('see-through');
  const [preserveSourceAlpha, setPreserveSourceAlpha] = useState(false);
  const [backgroundModeNote, setBackgroundModeNote] = useState('');
  const [backgroundWarning, setBackgroundWarning] = useState('');
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
  const [status, setStatus] = useState<ReactNode>('');
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [savingVersion, setSavingVersion] = useState(false);
  const [savedVersionId, setSavedVersionId] = useState<string | null>(null);
  const [savedVersionPreview, setSavedVersionPreview] = useState<GiftStudioVersion | null>(null);
  const [selectedPreview, setSelectedPreview] = useState<GiftStudioVersion | null>(null);
  const [playingPreview, setPlayingPreview] = useState<GiftStudioVersion | null>(null);
  const [playingSample, setPlayingSample] = useState<GiftStudioVersion | null>(null);
  const [playingCatalogGift, setPlayingCatalogGift] = useState<GiftStudioGiftId | null>(null);
  const [libraryActionId, setLibraryActionId] = useState<string | null>(null);
  const [catalogActionId, setCatalogActionId] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  const serverAbortRef = useRef<AbortController | null>(null);
  const originalVideoRef = useRef<HTMLVideoElement>(null);
  const processedVideoRef = useRef<HTMLVideoElement>(null);
  const livePreviewCanvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<import('@ffmpeg/ffmpeg').FFmpeg | null>(null);
  const isSeekingRef = useRef(false);
  const keyWasChangedRef = useRef(false);
  const nameWasEditedRef = useRef(false);
  const catalogPriceEditedRef = useRef(false);
  const backgroundModeEditedGiftIdRef = useRef<GiftStudioGiftId | ''>('');
  const manualBackgroundChoiceRef = useRef(false);
  const metadataHandledUrlRef = useRef<string | null>(null);
  const processedSettingsRef = useRef<string | null>(null);
  const productionStepRefs = useRef<Array<HTMLElement | null>>([]);
  const [playhead, setPlayhead] = useState(0);

  const settings = useMemo<ClipSettings>(() => ({
    backgroundMode, preserveSourceAlpha, preset: keyPreset, keyColor, tolerance, softness, spill, maxDimension,
  }), [backgroundMode, preserveSourceAlpha, keyPreset, keyColor, tolerance, softness, spill, maxDimension]);
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
    || library.data?.catalog.find((gift) => gift.id === giftId)?.name
    || GIFTS.find((gift) => gift.id === giftId)?.label
    || '';
  const selectedCatalogGift = library.data?.catalog.find((gift) => gift.id === giftId);

  useEffect(() => {
    if (giftMode !== 'replace' || !giftId) {
      backgroundModeEditedGiftIdRef.current = '';
      setBackgroundMode('see-through');
      return;
    }
    if (file) return;
    if (activeGiftQuery.data && backgroundModeEditedGiftIdRef.current !== giftId) {
      setBackgroundMode(activeGiftQuery.data.media?.backgroundMode ?? 'see-through');
    }
  }, [giftMode, giftId, file, activeGiftQuery.data?.media?.versionId, activeGiftQuery.data?.media?.backgroundMode]);

  useEffect(() => {
    if (giftMode !== 'replace' || !giftId || catalogPriceEditedRef.current || !selectedCatalogGift) return;
    setGiftPrice(String(selectedCatalogGift.cost));
  }, [giftMode, giftId, selectedCatalogGift?.cost]);

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
    const manualChoiceBeforeUpload = !file && manualBackgroundChoiceRef.current;
    if (file) manualBackgroundChoiceRef.current = false;
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
    setPreserveSourceAlpha(false);
    setBackgroundWarning('');
    setBackgroundModeNote(manualChoiceBeforeUpload ? 'Manual choice' : '');
    if (!manualChoiceBeforeUpload) setBackgroundMode('see-through');
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
    const sourceUrl = originalUrl;
    setStatus('Checking transparency and background color…');
    setKeyDetecting(true);
    void detectVideoBackground(video).then((analysis) => {
      if (metadataHandledUrlRef.current !== sourceUrl || originalVideoRef.current !== video) return;
      const manualChoice = manualBackgroundChoiceRef.current;
      const detectedMode = analysis.hasTransparency || !analysis.mostlyBlack ? 'see-through' : 'black';
      const selectedMode = manualChoice ? settingsRef.current.backgroundMode : detectedMode;
      const detectedSettings: ClipSettings = {
        ...settingsRef.current,
        backgroundMode: selectedMode,
        preserveSourceAlpha: analysis.hasTransparency,
      };
      if (!manualChoice) setBackgroundMode(detectedMode);
      setPreserveSourceAlpha(analysis.hasTransparency);
      setBackgroundModeNote(manualChoice
        ? 'Manual choice'
        : `Auto-detected: ${detectedMode === 'black' ? 'Black background' : 'See-through video'}`);
      const warning = !analysis.hasTransparency && !analysis.mostlyBlack
        ? 'This video has a background that may not drop out in the selected mode. Try a black-backed clip or remove the background first. Upload is still allowed.'
        : !analysis.hasTransparency && selectedMode === 'see-through'
          ? 'This video has no transparency, so its black background will stay visible in See-through mode. Switch to Black background or remove the background first. Upload is still allowed.'
          : '';
      setBackgroundWarning(warning);
      if (selectedMode === 'black') {
        setDetectedKeyColor(null);
        setStatus('Black background detected. Preparing the normal video…');
        void process(detectedSettings);
        return;
      }
      if (analysis.hasTransparency) {
        setDetectedKeyColor(null);
        setStatus('Transparency detected. Preparing the clip without applying a color key…');
        void process(detectedSettings);
        return;
      }
      if (!analysis.edgeColor) {
        setDetectedKeyColor(null);
        setStatus('No solid edge color was detected. You can continue, but the video background may remain visible.');
        return;
      }
      const family = classifyKeyColor(analysis.edgeColor);
      const keyedSettings: ClipSettings = {
        ...detectedSettings,
        preset: family === 'green' || family === 'magenta' ? family : 'custom',
        keyColor: analysis.edgeColor,
        tolerance: .12,
        softness: .08,
        spill: .72,
      };
      setDetectedKeyColor(analysis.edgeColor);
      setKeyColor(analysis.edgeColor);
      setKeyPreset(keyedSettings.preset);
      setTolerance(.12);
      setSoftness(.08);
      setSpill(.72);
      setStatus(`Background detected (${analysis.edgeColor.toUpperCase()}). Removing it now…`);
      void process(keyedSettings);
    }).catch((cause) => {
      if (metadataHandledUrlRef.current !== sourceUrl || originalVideoRef.current !== video) return;
      const manualChoice = manualBackgroundChoiceRef.current;
      if (!manualChoice) setBackgroundMode('see-through');
      setPreserveSourceAlpha(false);
      setBackgroundModeNote(manualChoice ? 'Manual choice' : 'Auto-detection unavailable');
      setBackgroundWarning('Automatic detection could not inspect this clip. Choose a mode manually; the upload is still allowed.');
      if (manualChoice && settingsRef.current.backgroundMode === 'black') {
        setStatus('Using your manual Black background choice…');
        void process({ ...settingsRef.current, preserveSourceAlpha: false });
      } else {
        setStatus(cause instanceof Error ? cause.message : 'Choose a background mode manually, then continue.');
      }
    }).finally(() => {
      if (metadataHandledUrlRef.current === sourceUrl) setKeyDetecting(false);
    });
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
        setStatus('Using Deux Wild’s Android-safe processor (480 px, 24 fps)…');
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
          setStatus('Phone encoding could not finish. Retrying with Deux Wild’s low-memory processor (480 px, 24 fps)…');
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
        ? processSettings.backgroundMode === 'black'
          ? 'Finished with low-memory server processing. Black-background video is ready; the transparency check was skipped.'
          : 'Finished with low-memory server processing. The transparent WebM passed the alpha check.'
        : processSettings.backgroundMode === 'black'
          ? 'Finished. Black-background video is ready; the transparency check was skipped.'
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

  const chooseBackgroundMode = (nextMode: ClipSettings['backgroundMode']) => {
    if (nextMode === backgroundMode || processing) return;
    backgroundModeEditedGiftIdRef.current = giftMode === 'replace' ? giftId : '';
    manualBackgroundChoiceRef.current = true;
    keyWasChangedRef.current = nextMode === 'black';
    setBackgroundMode(nextMode);
    setBackgroundModeNote('Manual choice');
    setDetectedKeyColor(null);
    resetOutput();
    if (!file || duration <= 0) {
      setKeyDetecting(false);
      setStatus('');
      setBackgroundWarning('');
      return;
    }
    if (keyDetecting) {
      if (nextMode === 'see-through' && !preserveSourceAlpha) {
        setBackgroundWarning('This video has no transparency, so its background may remain visible in See-through mode. You can still continue.');
      }
      return;
    }
    if (nextMode === 'black') {
      setKeyDetecting(false);
      setStatus('Keeping the black background and preparing the video…');
      void process({ ...settingsRef.current, backgroundMode: 'black' });
      return;
    }
    if (preserveSourceAlpha) {
      setKeyDetecting(false);
      setStatus('Keeping the source transparency and preparing the video…');
      void process({ ...settingsRef.current, backgroundMode: 'see-through', preserveSourceAlpha: true });
      return;
    }
    const source = originalVideoRef.current;
    if (!source) return;
    keyWasChangedRef.current = false;
    setKeyDetecting(true);
    setStatus('Detecting the background color…');
    void detectVideoEdgeColor(source).then((color) => {
      if (keyWasChangedRef.current) return;
      if (!color) {
        setStatus('No solid edge color was detected. Tap the background in the video to choose it.');
        return;
      }
      const family = classifyKeyColor(color);
      const detectedSettings: ClipSettings = {
        ...settingsRef.current,
        backgroundMode: 'see-through',
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
    const replacementPrice = Number(giftPrice);
    const validReplacementPrice = Number.isSafeInteger(replacementPrice) && replacementPrice > 0;
    if (!file || !processedBlob || !trimmedName || savingVersion || !previewConfirmed ||
      (replacing && (!giftId || !validReplacementPrice))) return;
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
        productType,
        ...(replacing ? { catalogCost: replacementPrice } : {}),
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
        ? <>{catalogGifts.find((gift) => gift.id === giftId)?.name ?? 'The catalog item'} is now “{trimmedName}”, costs <CoinAmount>{replacementPrice.toLocaleString()} coins</CoinAmount>, and its new animation is active. The previous version is kept in Saved versions as a backup.</>
        : <>Saved “{trimmedName}” as a new {productType === 'gift' ? 'gift' : 'entrance effect'} draft. Set a coin price in the library before activating it.</>);
      setSavedVersionPreview(saved);
      setSaveError('');
      setActiveProductionStep(5);
    } catch (cause) {
      setSaveError(ownerErrorText(cause));
    } finally {
      setSavingVersion(false);
    }
  };
  const activateStandalone = async () => {
    const cost = Number(giftPrice);
    if (!savedVersionPreview || !Number.isSafeInteger(cost) || cost <= 0 || setActive.isPending) return;
    setError('');
    try {
      const updated = await setActive.mutateAsync({
        versionId: savedVersionPreview.id,
        data: { active: true, productType, cost },
      });
      await Promise.all([
        client.invalidateQueries({ queryKey: getGetGiftStudioLibraryQueryKey() }),
        client.invalidateQueries({ queryKey: getGetSocialMeQueryKey() }),
      ]);
      setSavedVersionPreview(updated);
      setStatus(<>“{versionName(updated)}” is active as an {productType === 'gift' ? 'gift' : 'entrance effect'} at <CoinAmount>{cost.toLocaleString()} coins</CoinAmount>.</>);
    } catch (cause) {
      setError(ownerErrorText(cause));
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
        setStatus(active ? `${catalogGifts.find((gift) => gift.id === updated.giftId)?.name ?? 'Catalog item'} version ${updated.version} is now active.` : `Version ${updated.version} returned to draft.`);
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
      const updated = await renameSavedVersion.mutateAsync({ versionId: version.id, data: { name: trimmed } });
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
      await deleteSavedVersion.mutateAsync({ versionId: version.id });
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
      setGiftPrice('');
      catalogPriceEditedRef.current = false;
      nameWasEditedRef.current = false;
      setDraftName('');
    } else {
      setGiftId('');
      setGiftPrice('');
      catalogPriceEditedRef.current = false;
      nameWasEditedRef.current = false;
      setDraftName('');
    }
  };
  const changeGiftTarget = (nextGiftId: GiftStudioGiftId) => {
    if (savedVersionId) return;
    setGiftId(nextGiftId);
    const catalogGift = library.data?.catalog.find((gift) => gift.id === nextGiftId);
    setGiftPrice(catalogGift ? String(catalogGift.cost) : '');
    catalogPriceEditedRef.current = false;
    nameWasEditedRef.current = false;
    setDraftName(catalogGift?.name ?? GIFTS.find((gift) => gift.id === nextGiftId)?.label ?? '');
    setPreviewConfirmed(false);
  };
  const beginReplacement = (gift: GiftStudioCatalogGift) => {
    if (savedVersionId) return;
    setProductType(gift.productType);
    setGiftMode('replace');
    setGiftId(gift.id);
    setDraftName(gift.name);
    nameWasEditedRef.current = true;
    setGiftPrice(String(gift.cost));
    catalogPriceEditedRef.current = true;
    setPreviewConfirmed(false);
    advanceToStep(1);
  };
  const saveCatalogGift = async (
    targetId: SocialGiftCatalogId,
    name: string | undefined,
    cost: number | undefined,
    status?: GiftStudioCatalogGift['status'],
    nextType?: GiftStudioProductType,
  ) => {
    setCatalogActionId(targetId);
    setError('');
    try {
      const updated = await updateCatalog.mutateAsync({
        giftId: targetId,
        data: {
          ...(name !== undefined ? { name: name.trim() } : {}),
          ...(cost !== undefined ? { cost } : {}),
          ...(status ? { status } : {}),
          ...(nextType ? { productType: nextType } : {}),
        },
      });
      await Promise.all([
        client.invalidateQueries({ queryKey: getGetGiftStudioLibraryQueryKey() }),
        client.invalidateQueries({ queryKey: getGetSocialMeQueryKey() }),
      ]);
      if (cost !== undefined) setStatus(<>{updated.name} now costs <CoinAmount>{updated.cost.toLocaleString()} coins</CoinAmount>.</>);
      else if (status) setStatus(`${updated.name} is ${status === 'active' ? 'active in' : 'hidden from'} the ${updated.productType === 'gift' ? 'gift picker' : 'entrance effects shop'}.`);
      else setStatus(`Saved ${updated.name}.`);
    } catch (cause) {
      setError(ownerErrorText(cause));
      throw cause;
    } finally {
      setCatalogActionId(null);
    }
  };
  const updateCatalogIcon = async (gift: GiftStudioCatalogGift, action: 'regenerate' | 'override', image?: File) => {
    setCatalogActionId(gift.id);
    setError('');
    try {
      const token = await getToken();
      const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
      const body = action === 'override' ? (() => {
        const form = new FormData();
        if (image) form.append('icon', image, image.name || 'gift-icon.png');
        return form;
      })() : undefined;
      const response = await fetch(`/api/social/admin/gift-studio/catalog/${encodeURIComponent(gift.id)}/icon`, {
        method: action === 'regenerate' ? 'POST' : 'PUT',
        credentials: 'include',
        headers,
        body,
      });
      if (!response.ok) throw await responseError(response, `Gift icon update failed (server error ${response.status}).`);
      const result = await response.json() as { iconStatus: string };
      await Promise.all([
        client.invalidateQueries({ queryKey: getGetGiftStudioLibraryQueryKey() }),
        client.invalidateQueries({ queryKey: getGetSocialMeQueryKey() }),
      ]);
      const label = result.iconStatus.includes('transparent') ? 'transparent PNG' : 'fallback snapshot';
      setStatus(`${gift.name} icon updated (${label}).`);
    } catch (cause) {
      setError(ownerErrorText(cause));
    } finally {
      setCatalogActionId(null);
    }
  };
  const changeCatalogStatus = async (gift: GiftStudioCatalogGift, status: GiftStudioCatalogGift['status']) => {
    if (status === 'deleted' && !window.confirm(`Delete ${gift.name} from the ${gift.productType === 'gift' ? 'gift picker' : 'entrance effect shop'}? It will be hidden, and saved clips and past history will remain.`)) return;
    try {
      await saveCatalogGift(gift.id, undefined, undefined, status);
    } catch { /* the error is shown in Gift Studio */ }
  };
  const changeCatalogType = async (gift: GiftStudioCatalogGift) => {
    const nextType: GiftStudioProductType = gift.productType === 'gift' ? 'entrance-effect' : 'gift';
    if (gift.status === 'active' && !window.confirm(`Switch “${gift.name}” from ${gift.productType === 'gift' ? 'Gift' : 'Entrance effect'} to ${nextType === 'gift' ? 'Gift' : 'Entrance effect'}? This changes where it is sold and played.`)) return;
    try {
      await saveCatalogGift(gift.id, undefined, undefined, undefined, nextType);
    } catch { /* the error is shown in Gift Studio */ }
  };
  const saveVersionGiftPrice = async (targetGiftId: GiftStudioGiftId, cost: number) => {
    try {
      await saveCatalogGift(targetGiftId, undefined, cost);
    } catch { /* the error is shown in Gift Studio */ }
  };
  const advanceToStep = (step: number) => {
    setActiveProductionStep(step);
    window.setTimeout(() => productionStepRefs.current[step - 1]?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };

  if (library.isError && isDenied(library.error)) {
    return <main className="gs"><div className="gs-shell"><section className="gs-error-panel" role="alert" data-testid="state-owner-denied"><ShieldCheck size={23} /><h1 className="gs-panel-title">Gift Studio is for owners</h1><p>Your account does not have permission to manage gift animation versions. Sign in with the owner account, then try again.</p><button className="gs-button" type="button" onClick={() => void library.refetch()} data-testid="button-retry-access"><RefreshCw size={15} /> Check access again</button></section></div></main>;
  }

  const libraryItems = library.data?.items ?? [];
  const catalogGifts = library.data?.catalog ?? [];
  const filteredItems = selectedPreview ? [selectedPreview, ...libraryItems.filter((item) => item.id !== selectedPreview.id)] : libraryItems;
  const replacementPrice = Number(giftPrice);
  const validReplacementPrice = Number.isSafeInteger(replacementPrice) && replacementPrice > 0;
  const previewStageStyle = frameRatio && Number.isFinite(frameRatio)
    ? { width: `min(100%, ${52 * frameRatio}dvh)`, maxHeight: '52dvh', aspectRatio: String(frameRatio), marginInline: 'auto' }
    : undefined;
  return (
    <main className="gs">
      <div className="gs-shell">
        <div className="gs-topline"><span className="gs-topline-mark" /> DEUX WILD · GIFT STUDIO</div>
        <header className="gs-production-intro">
          <h1>Gift production</h1>
          <p>Name it, remove the screen, check the transparent animation, then activate it in Deux Wild.</p>
          <div className="gs-private"><LockKeyhole size={13} /> Owner-only workspace</div>
        </header>

        <section className="gs-content-sync" aria-labelledby="gs-content-sync-title" data-testid="developer-content-sync">
          <div className="gs-content-sync-head">
            <div>
              <h2 id="gs-content-sync-title">Daily content sync</h2>
              <p>Refreshes the existing room video sources and checks the live Gift Studio catalog. Saved effects are registered when approved; drafts stay out of live lists.</p>
            </div>
            <button
              className="gs-button primary gs-content-sync-button"
              type="button"
              onClick={() => runContentSync.mutate()}
              disabled={runContentSync.isPending || contentSync.data?.isRunning}
              data-testid="button-content-sync-now"
            >
              <RefreshCw size={15} className={runContentSync.isPending ? 'gs-sync-spinning' : undefined} />
              {runContentSync.isPending ? 'Syncing…' : 'Sync now'}
            </button>
          </div>
          <div className="gs-content-sync-meta">
            <span>Scheduled for 3:00 AM Eastern when the server is awake</span>
            <span>
              Last synced: {contentSync.data?.lastSyncedAt
                ? new Date(contentSync.data.lastSyncedAt).toLocaleString()
                : 'Not yet'}
            </span>
          </div>
          {runContentSync.error && <p className="gs-content-sync-error" role="alert">{ownerErrorText(runContentSync.error)}</p>}
          {contentSync.data?.summary && <div className="gs-content-sync-summary" aria-live="polite">
            <strong>
              Added {contentSync.data.summary.added} · Updated {contentSync.data.summary.updated}
              {' '}· Skipped {contentSync.data.summary.skipped}
            </strong>
            <span>
              Gift effects: {contentSync.data.summary.giftEffects.active} active, {contentSync.data.summary.giftEffects.drafts} drafts.
              {' '}Entrance effects: {contentSync.data.summary.entranceEffects.active} active, {contentSync.data.summary.entranceEffects.drafts} drafts.
            </span>
            <ul>
              {contentSync.data.summary.videoPools.map(pool => <li key={pool.roomId}>
                <b>{pool.roomId}</b>: +{pool.added} new, {pool.savedCount} saved
                {pool.skipped > 0 ? ` · skipped: ${pool.message ?? 'refresh unavailable'}` : ''}
              </li>)}
            </ul>
          </div>}
        </section>

        <section className="gs-content-sync" aria-labelledby="gs-hangout-rewards-title" data-testid="developer-hangout-rewards">
          <div className="gs-content-sync-head">
            <div>
              <h2 id="gs-hangout-rewards-title">Hangout coin drops</h2>
              <p>Random drops go to one or two rooms with seated speakers. Only people seated for 15 minutes qualify.</p>
            </div>
          </div>
          <form className="gs-content-sync-meta gs-hangout-settings-form" onSubmit={event => {
            event.preventDefault();
            setHangoutNotice('');
            saveHangoutInterval.mutate({ data: { averageIntervalMinutes: Number(hangoutIntervalDraft) } });
          }}>
            <label className="gs-hangout-interval">
              <span>Average interval (15–360 minutes)</span>
              <input
                type="number"
                min={15}
                max={360}
                step={1}
                value={hangoutIntervalDraft}
                onChange={event => setHangoutIntervalDraft(event.target.value)}
                data-testid="input-hangout-drop-interval"
              />
            </label>
            <button className="gs-button primary" type="submit" disabled={saveHangoutInterval.isPending}
              data-testid="button-save-hangout-interval">
              {saveHangoutInterval.isPending ? 'Saving…' : 'Save interval'}
            </button>
          </form>
          <div className="gs-content-sync-meta">
            <span>Default: 60 minutes; each gap varies randomly from half to one-and-a-half times the average.</span>
            <span>
              Next: {hangoutSettings.data?.nextDropAt
                ? new Date(hangoutSettings.data.nextDropAt).toLocaleString()
                : 'Loading…'}
              {' · '}Last: {hangoutSettings.data?.lastDropAt
                ? new Date(hangoutSettings.data.lastDropAt).toLocaleString()
                : 'Not yet'}
            </span>
          </div>
          {hangoutNotice && <p className="gs-content-sync-summary" role="status">{hangoutNotice}</p>}
          {hangoutSettings.isError && <p className="gs-content-sync-error" role="alert">{ownerErrorText(hangoutSettings.error)}</p>}
          {saveHangoutInterval.error && <p className="gs-content-sync-error" role="alert">{ownerErrorText(saveHangoutInterval.error)}</p>}
        </section>

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
              <fieldset className="gs-gift-mode gs-product-type" aria-label="Product type" disabled={Boolean(savedVersionId)}>
                <legend>What are you producing?</legend>
                <label className="gs-gift-mode-choice">
                  <input type="radio" name="production-product-type" checked={productType === 'gift'} onChange={() => { setProductType('gift'); setGiftId(''); setGiftMode('new'); setGiftPrice(''); setPreviewConfirmed(false); }} data-testid="radio-product-gift" />
                  <span><strong>Gift</strong><small>A room or catalog gift animation.</small></span>
                </label>
                <label className="gs-gift-mode-choice">
                  <input type="radio" name="production-product-type" checked={productType === 'entrance-effect'} onChange={() => { setProductType('entrance-effect'); setGiftId(''); setGiftMode('new'); setGiftPrice(''); setPreviewConfirmed(false); }} data-testid="radio-product-entrance-effect" />
                  <span><strong>Entrance effect</strong><small>Plays when its owner arrives in a room.</small></span>
                </label>
              </fieldset>
              <div className="gs-gift-mode" role="radiogroup" aria-label="New item or replacement">
                <label className="gs-gift-mode-choice">
                  <input type="radio" name="gift-setup-mode" checked={giftMode === 'new'} onChange={() => changeGiftMode('new')} disabled={Boolean(savedVersionId)} data-testid="radio-new-gift" />
                  <span><strong>New {productType === 'gift' ? 'gift' : 'effect'}</strong><small>Save as a new draft. Set its coin price before activation.</small></span>
                </label>
                <label className="gs-gift-mode-choice">
                  <input type="radio" name="gift-setup-mode" checked={giftMode === 'replace'} onChange={() => changeGiftMode('replace')} disabled={Boolean(savedVersionId) || !catalogGifts.some((entry) => entry.productType === productType && entry.status !== 'deleted')} data-testid="radio-replace-gift" />
                  <span><strong>Replace existing {productType === 'gift' ? 'gift' : 'effect'}</strong><small>Activate the new animation and keep the previous version as a backup.</small></span>
                </label>
              </div>
              {giftMode === 'replace' && <label className="gs-name-field gs-gift-mode-control">
                <span>{productType === 'gift' ? 'Gift to replace' : 'Effect to replace'}</span>
                <select value={giftId} onChange={(event) => changeGiftTarget(event.target.value as GiftStudioGiftId)} disabled={Boolean(savedVersionId)} data-testid="select-gift-target">
                  <option value="">Choose a catalog item…</option>
                  {catalogGifts.filter((item) => item.productType === productType && item.status !== 'deleted').map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
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
              <div className="gs-background-mode">
                <div className="gs-background-toggle" role="group" aria-label="Gift animation background mode">
                  <button
                    className="gs-choice"
                    type="button"
                    aria-pressed={backgroundMode === 'see-through'}
                    disabled={processing}
                    onClick={() => chooseBackgroundMode('see-through')}
                    data-testid="button-background-see-through"
                  >See-through video</button>
                  <button
                    className="gs-choice"
                    type="button"
                    aria-pressed={backgroundMode === 'black'}
                    disabled={processing}
                    onClick={() => chooseBackgroundMode('black')}
                    data-testid="button-background-black"
                  >Black background</button>
                </div>
                {backgroundModeNote && <span className="gs-background-mode-note" role="status" data-testid="text-background-auto-detection">{backgroundModeNote}</span>}
                <p className="gs-background-hint">Black background: best for glows, fire, sparkles and fireworks. Dark parts of the video will turn see-through.</p>
                {backgroundWarning && <p className="gs-background-warning" role="note" data-testid="warning-background-mode">{backgroundWarning}</p>}
              </div>
              <label className="gs-upload gs-production-upload" htmlFor="gs-file-input" data-testid="upload-video-dropzone">
                {file ? <><div className="gs-file-row"><span className="gs-file-name">{file.name}</span><span className="gs-file-meta">{formatBytes(file.size)}</span></div><small>{duration ? `${duration.toFixed(1)} seconds` : 'Checking clip length'} · tap to replace</small></> :
                  <><span className="gs-upload-icon"><FileVideo2 size={23} /></span><strong>Choose a gift video</strong><small>MP4, WebM or MOV. Maximum 15 seconds and 100 MB.</small><span className="gs-upload-cta"><Upload size={17} /> Browse phone</span></>}
                <input id="gs-file-input" type="file" accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov" disabled={processing || Boolean(savedVersionId)} onChange={(event) => { loadFile(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} data-testid="input-source-video" aria-label="Choose a video clip" />
              </label>
              {originalUrl && <div className="gs-upload-summary"><strong>Source clip ready</strong> · {file?.name} · {duration ? `${duration.toFixed(1)} sec` : 'Reading duration'} · {formatBytes(file?.size ?? 0)}</div>}
              {originalUrl && <div className="gs-preview">
                <div className="gs-preview-label">Original clip <span>Source video</span></div>
                <div className={`gs-preview-stage ${backdrop}${backgroundMode === 'black' ? ' is-black-background' : ''}`} style={previewStageStyle} onClick={backgroundMode === 'see-through' ? pickVideoKeyColor : undefined} data-testid="preview-original" title={backgroundMode === 'see-through' ? 'Tap the background to sample its color' : undefined}>
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
              <div><h2 id="gs-step-remove-title">{backgroundMode === 'black' ? 'Black background' : 'Remove background'}</h2><p>{backgroundMode === 'black' ? 'Keep the normal video and blend its black background away during playback.' : 'Deux Wild detects the screen color and starts processing automatically.'}</p></div>
            </div>
            <div className="gs-production-step-body">
              {backgroundMode === 'black' && <p className="gs-caption" data-testid="black-mode-processing-note">The black background stays in the video; it is blended away when the animation plays.</p>}
              {backgroundMode === 'see-through' && <>
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
              </>}
              {processing && <div className="gs-progress" role="status" aria-live="polite" data-testid="state-processing"><div className="gs-progress-track"><div className={`gs-progress-fill${serverProcessing ? ' is-indeterminate' : ''}`} style={serverProcessing ? undefined : { width: `${Math.round(progress * 100)}%` }} /></div><div className="gs-progress-copy"><span>{status}</span><span>{serverProcessing ? 'Working' : `${Math.round(progress * 100)}%`}</span></div><button className="gs-button quiet" type="button" onClick={cancelProcessing} data-testid="button-cancel-processing"><X size={15} /> Cancel</button></div>}
              {!processing && file && !processedUrl && <button className="gs-button primary gs-auto-process" type="button" onClick={() => void process(settingsRef.current)} disabled={keyDetecting || duration <= 0 || duration > MAX_SECONDS} data-testid="button-process">{backgroundMode === 'black' ? error ? 'Try black-background video again' : 'Prepare black-background video' : error ? 'Try background removal again' : detectedKeyColor ? 'Remove background again' : 'Process with current key'} <ChevronRight size={16} /></button>}
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
              <div><h2 id="gs-step-review-title">{backgroundMode === 'black' ? 'Review the black-background result' : 'Review the transparent result'}</h2><p>{backgroundMode === 'black' ? 'Preview the effect over the checkerboard and sample stream.' : 'Fit the whole frame. Check transparency before activation.'}</p></div>
            </div>
            <div className="gs-production-step-body">
              <div className="gs-result-toggle" role="group" aria-label="Result preview mode">
                <button type="button" aria-pressed={reviewMode === 'checker'} onClick={() => setReviewMode('checker')} data-testid="button-review-checker">Checkerboard</button>
                <button type="button" aria-pressed={reviewMode === 'sample'} onClick={() => setReviewMode('sample')} data-testid="button-review-sample">Sample stream</button>
              </div>
              <div className={`gs-result-preview${reviewMode === 'sample' ? ' is-sample' : ''}${backgroundMode === 'black' ? ' is-black-background' : ''}`} style={previewStageStyle} data-testid="preview-final-result">
                {reviewMode === 'sample' && <><div className="gs-stream-mock-top"><span className="gs-live-dot" /> LIVE · DEUX WILD</div><div className="gs-stream-mock-chat">Chat stays visible under the gift.</div><div className="gs-stream-mock-name">{draftName || 'Gift preview'}</div></>}
                {processedUrl
                  ? <video key={processedUrl} ref={processedVideoRef} src={processedUrl} muted playsInline loop autoPlay preload="metadata" onLoadedMetadata={onProcessedMetadata} onTimeUpdate={syncTime} aria-label={backgroundMode === 'black' ? 'Processed black-background gift animation' : 'Processed transparent gift animation'} data-testid="video-final-result" />
                  : originalUrl
                    ? <canvas ref={livePreviewCanvasRef} onClick={backgroundMode === 'see-through' ? pickVideoKeyColor : undefined} aria-label={backgroundMode === 'black' ? 'Live black-background blend preview while processing' : 'Live transparent cutout preview while processing'} data-testid="canvas-live-cutout" />
                    : <div className="gs-empty-preview">Upload a clip to preview the final animation here.</div>}
                {livePreviewError && !processedUrl && <div className="gs-preview-note" role="status">{livePreviewError}</div>}
              </div>
              {processedUrl && backgroundMode === 'see-through' ? <div className="gs-auto-key-status gs-transparency-passed" role="status" data-testid="status-alpha-check"><Check size={17} /><strong>Transparency check passed</strong><span>The exported animation is playing with its verified alpha channel.</span></div> :
                processedUrl && backgroundMode === 'black' ? <div className="gs-auto-key-status" role="status" data-testid="status-black-background"><Check size={17} /><strong>Black-background video ready</strong><span>Black blends away during playback; the uploaded video was not required to have alpha.</span></div> :
                error ? <div className="gs-error" role="alert">{error}{backgroundMode === 'see-through' ? ' Open Adjust to refine the key and try again.' : ''}</div> :
                  <div className="gs-upload-summary">The live cutout appears here while the finished transparent export is processing.</div>}
              <div className="gs-controls">
                <button className="gs-icon-button" type="button" onClick={() => void synchronizePlay()} disabled={!file} aria-label={originalVideoRef.current?.paused ? 'Play both previews' : 'Pause both previews'} data-testid="button-play-pause">{originalVideoRef.current?.paused ? <Play size={16} /> : <Pause size={16} />}</button>
                <input className="gs-range" type="range" min="0" max={duration || 1} step=".05" value={Math.min(playhead, duration || 0)} onChange={(event) => seek(Number(event.target.value))} disabled={!file} aria-label="Scrub both previews" data-testid="input-preview-scrubber" />
                <span className="gs-file-meta" data-testid="text-preview-time">{timeLabel(playhead)} / {timeLabel(duration)}</span>
              </div>
              {processedUrl && <div className="gs-after-downloads">
                 <button className="gs-button quiet" type="button" onClick={() => processedBlob && downloadBlob(processedBlob, `${safeGiftFilePrefix()}-${backgroundMode === 'black' ? 'black-background' : 'transparent'}.webm`)} disabled={!processedBlob} data-testid="button-download-webm"><Download size={14} /> Download WebM</button>
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
              <div><h2 id="gs-step-activate-title">Activate in Deux Wild</h2><p>Save the finished clip to the real gift library.</p></div>
            </div>
            <div className="gs-production-step-body">
              <div className="gs-activation-summary">
                {giftMode === 'replace'
                  ? <><strong>Replacing {catalogGifts.find((item) => item.id === giftId)?.name ?? 'a catalog item'}</strong><br />Current name: {activeGiftName || 'Loading current name…'}<br />New name: {draftName || 'Enter a name above.'}</>
                  : <><strong>New {productType === 'gift' ? 'gift' : 'entrance effect'}: {draftName || 'Enter a name above.'}</strong><br />It will be saved as a draft, then activated into the live catalog.</>}
              </div>
              {(giftMode === 'replace' || giftMode === 'new') && <label className="gs-name-field gs-catalog-price-field">
                <span><CoinAmount size={13}>{productType === 'gift' ? 'Gift' : 'Effect'} price · coins</CoinAmount></span>
                <input type="number" min="1" step="1" inputMode="numeric" value={giftPrice}
                  onChange={(event) => { catalogPriceEditedRef.current = true; setGiftPrice(event.target.value); }}
                  aria-label={`${productType === 'gift' ? 'Gift' : 'Effect'} price in coins`} data-testid="input-activate-gift-price" />
                <small>Whole positive numbers only. This changes the price for future purchases; past history and balances stay unchanged.</small>
              </label>}
              {!previewConfirmed && <p className="gs-caption">Review the processed result in step 4 before activating.</p>}
              <div className="gs-activation-actions">
                <button className="gs-button" type="button" onClick={() => goToProductionStep(4)} data-testid="button-back-activate">Back to result</button>
                <button className="gs-button primary" type="button" onClick={() => void approve()} disabled={!file || !processedBlob || !draftName.trim() || (giftMode === 'replace' && (!giftId || !validReplacementPrice)) || !previewConfirmed || savingVersion || Boolean(savedVersionId)} data-testid="button-save-as-gift">
                  {savingVersion ? 'Saving…' : savedVersionId ? 'Saved' : giftMode === 'replace' ? `Activate ${productType === 'gift' ? 'gift' : 'effect'} replacement` : `Save new ${productType === 'gift' ? 'gift' : 'effect'} draft`} <Check size={15} />
                </button>
                {savedVersionPreview && !savedVersionPreview.giftId && savedVersionPreview.status !== 'active' && <button className="gs-button primary" type="button" onClick={() => void activateStandalone()} disabled={!validReplacementPrice || setActive.isPending} data-testid="button-activate-new-item">
                  {setActive.isPending ? 'Activating…' : <>Activate at <CoinAmount>{validReplacementPrice ? `${replacementPrice.toLocaleString()} coins` : '—'}</CoinAmount></>} <Check size={15} />
                </button>}
              </div>
              {saveError && <div className="gs-error" role="alert" data-testid="state-upload-error">{saveError}</div>}
              {savedVersionPreview && <div className="gs-save-confirmation" data-testid={savedVersionPreview.giftId ? 'panel-active-gift-confirmation' : 'panel-new-gift-draft-confirmation'}>
                <strong>{savedVersionPreview.giftId
                  ? `${catalogGifts.find((gift) => gift.id === savedVersionPreview.giftId)?.name ?? versionName(savedVersionPreview)} is now “${versionName(savedVersionPreview)}” in the catalog.`
                  : savedVersionPreview.status === 'active'
                    ? `“${versionName(savedVersionPreview)}” is active as an ${productType === 'gift' ? 'gift' : 'entrance effect'}.`
                    : `“${versionName(savedVersionPreview)}” is saved as a draft.`}</strong>
                <div className="gs-library-preview checker">
                  <video src={giftStudioMediaUrl(savedVersionPreview.webmUrl)} muted playsInline loop autoPlay preload="metadata" aria-label={`Preview of ${versionName(savedVersionPreview)}`} data-testid="video-confirmed-active-gift" />
                </div>
                <p className="gs-caption">{savedVersionPreview.giftId ? `The previous animation is saved as a backup. The new price applies only to future purchases; past records and wallet balances are unchanged.` : savedVersionPreview.status === 'active' ? 'This entrance effect is available to users in the effect shop.' : 'This draft is stored in the library and is not available until it is activated with a coin price.'}</p>
              </div>}
              {error && <div className="gs-error" role="alert" data-testid="state-error">{error}</div>}
              {status && !processing && <p className="gs-caption" role="status" aria-live="polite" data-testid="state-status">{status}</p>}
              {downloadingFrames && <p className="gs-caption" role="status" aria-live="polite">Preparing transparent PNG frames…</p>}
            </div>
          </section>

          <section className="gs-production-step gs-saved-gifts" aria-labelledby="gs-library-title" data-testid="section-saved-gifts">
            <div className="gs-production-step-head">
              <span className="gs-production-step-number"><Archive size={15} /></span>
              <div><h2 id="gs-library-title">Saved gifts</h2><p>Every catalog gift, its current price and status, plus restorable animation backups.</p></div>
              <span className="gs-status">{catalogGifts.length} gifts · {libraryItems.length} versions</span>
            </div>
            {library.isLoading ? <div className="gs-library-list" aria-label="Loading gift versions" data-testid="state-library-loading">{[1, 2, 3].map((i) => <div className="gs-library-card" key={i}><div className="gs-version-mark" /><div className="gs-version-info"><strong>Loading saved version</strong><small>Fetching your library…</small></div></div>)}</div> :
              library.isError ? <div className="gs-error-panel" role="alert" data-testid="state-library-error"><p>{errorText(library.error)}</p><button className="gs-button" type="button" onClick={() => void library.refetch()} data-testid="button-retry-library"><RefreshCw size={14} /> Try again</button></div> :
                <>
                  <h3 className="gs-library-subheading">Gifts</h3>
                  <div className="gs-catalog-list" data-testid="list-gift-catalog">
                    {catalogGifts.filter((gift) => gift.productType === 'gift').length === 0
                      ? <div className="gs-empty-library">No gift catalog items are available.</div>
                      : catalogGifts.filter((gift) => gift.productType === 'gift').map((gift) => <CatalogGiftCard
                      key={gift.id}
                      gift={gift}
                      activeVersion={libraryItems.find((version) => version.giftId === gift.id && version.status === 'active')}
                      pending={catalogActionId === gift.id}
                      onSave={(name, cost) => saveCatalogGift(gift.id, name, cost)}
                      onStatus={(status) => void changeCatalogStatus(gift, status)}
                      onType={() => void changeCatalogType(gift)}
                      onReplace={() => beginReplacement(gift)}
                      onPlay={() => gift.animationAvailable ? setPlayingCatalogGift(gift.id as GiftStudioGiftId) : undefined}
                      onRegenerateIcon={() => void updateCatalogIcon(gift, 'regenerate')}
                      onOverrideIcon={(image) => void updateCatalogIcon(gift, 'override', image)}
                    />)}
                  </div>
                  <h3 className="gs-library-subheading">Entrance effects</h3>
                  <div className="gs-catalog-list" data-testid="list-entrance-effect-catalog">
                    {catalogGifts.filter((gift) => gift.productType === 'entrance-effect').length === 0
                      ? <div className="gs-empty-library">No entrance effects yet. Produce the first effect above.</div>
                      : catalogGifts.filter((gift) => gift.productType === 'entrance-effect').map((gift) => <CatalogGiftCard
                      key={gift.id}
                      gift={gift}
                      activeVersion={libraryItems.find((version) => version.giftId === gift.id && version.status === 'active')}
                      pending={catalogActionId === gift.id}
                      onSave={(name, cost) => saveCatalogGift(gift.id, name, cost)}
                      onStatus={(status) => void changeCatalogStatus(gift, status)}
                      onType={() => void changeCatalogType(gift)}
                      onReplace={() => beginReplacement(gift)}
                      onPlay={() => {
                        const version = libraryItems.find((item) => item.giftId === gift.id && item.status === 'active');
                        if (version) setSelectedPreview(version);
                      }}
                      onRegenerateIcon={() => void updateCatalogIcon(gift, 'regenerate')}
                      onOverrideIcon={(image) => void updateCatalogIcon(gift, 'override', image)}
                    />)}
                  </div>
                  <h3 className="gs-library-subheading">Saved versions and backups</h3>
                  {libraryItems.length === 0
                    ? <div className="gs-empty-library" data-testid="state-library-empty">No animation versions have been saved yet. Your catalog gifts above remain available.</div>
                    : <div className="gs-library-list" data-testid="list-gift-versions">{filteredItems.map((version) => <LibraryVersion
                      key={version.id}
                      version={version}
                      catalogPrice={version.giftId ? catalogGifts.find((gift) => gift.id === version.giftId)?.cost : undefined}
                      onPreview={previewVersion}
                      onToggle={toggleVersion}
                      onAssign={attachVersion}
                      onRename={renameVersion}
                      onSavePrice={saveVersionGiftPrice}
                      onDelete={removeVersion}
                      pending={setActive.isPending || assignVersion.isPending || libraryActionId === version.id || Boolean(version.giftId && catalogActionId === version.giftId)}
                    />)}</div>}
                </>}
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
          backgroundMode: playingPreview.settings.backgroundMode ?? 'see-through',
        }}
        onFinish={() => setPlayingPreview(null)}
      />}
      {playingCatalogGift && <GiftAnimationPlayer
        key={`gift-studio-catalog-preview-${playingCatalogGift}`}
        giftId={playingCatalogGift}
        senderName="Gift Studio preview"
        onFinish={() => setPlayingCatalogGift(null)}
      />}
      {playingSample && <GiftStudioSamplePreview version={playingSample} onClose={() => setPlayingSample(null)} />}
    </main>
  );
}

export default GiftStudioPage;

function CatalogGiftCard({
  gift, activeVersion, pending, onSave, onStatus, onType, onReplace, onPlay, onRegenerateIcon, onOverrideIcon,
}: {
  gift: GiftStudioCatalogGift;
  activeVersion?: GiftStudioVersion;
  pending: boolean;
  onSave: (name: string, cost: number) => Promise<unknown>;
  onStatus: (status: GiftStudioCatalogGift['status']) => void;
  onType: () => void;
  onReplace: () => void;
  onPlay: () => void;
  onRegenerateIcon: () => void;
  onOverrideIcon: (image: File) => void;
}) {
  const [name, setName] = useState(gift.name);
  const [price, setPrice] = useState(String(gift.cost));
  useEffect(() => {
    setName(gift.name);
    setPrice(String(gift.cost));
  }, [gift.name, gift.cost]);
  const amount = Number(price);
  const validPrice = /^\d+$/.test(price) && Number.isSafeInteger(amount) && amount > 0;
  const changed = name.trim() !== gift.name || amount !== gift.cost;
  const canPlay = gift.animationAvailable && (gift.productType === 'gift' || !gift.id.startsWith('studio-') || Boolean(activeVersion));
  const iconLabels: Record<GiftStudioIconStatus, string> = {
    transparent: 'Automatically generated · transparent',
    fallback: 'Automatic fallback · plain snapshot',
    'manual-transparent': 'Manual override · transparent',
    'manual-fallback': 'Manual override · opaque fallback',
    builtin: 'Built-in icon',
  };
  return <article className="gs-catalog-card" data-testid={`card-catalog-gift-${gift.id}`}>
    <div className="gs-catalog-card-head">
      <div className="gs-catalog-preview checker">
        {activeVersion
          ? <video src={giftStudioMediaUrl(activeVersion.webmUrl)} muted playsInline loop autoPlay preload="metadata" aria-label={`${gift.name} active transparent animation`} data-testid={`video-active-catalog-${gift.id}`} />
          : gift.roomGift
            ? <RoomGiftIcon giftId={gift.id as RoomGiftId} />
            : <GiftIcon id={gift.id} size={40} />}
      </div>
      <div className="gs-catalog-summary">
        <strong>{gift.name}</strong>
        <small><CoinAmount>{gift.cost.toLocaleString()} coins</CoinAmount> · {gift.productType === 'gift' ? (gift.roomGift ? 'Room gift' : 'Catalog gift') : 'Entrance effect'}</small>
        {activeVersion && <small>Custom animation · version {activeVersion.version}</small>}
        <span className={`gs-status ${gift.status === 'active' ? 'active' : ''}`} data-testid={`status-catalog-${gift.id}`}>{gift.status}</span>
      </div>
    </div>
    <div className="gs-catalog-icon-meta" data-testid={`gift-icon-status-${gift.id}`}>
      {gift.iconUrl
        ? <img src={giftStudioMediaUrl(gift.iconUrl)} alt={`${gift.name} gift picker icon`} />
        : <span className="gs-catalog-icon-empty" aria-hidden="true"><GiftIcon id={gift.id} size={18} /></span>}
      <span>{iconLabels[gift.iconStatus]}</span>
      {activeVersion && <div className="gs-catalog-icon-actions">
        <button className="gs-chip-button" type="button" onClick={onRegenerateIcon} disabled={pending} data-testid={`button-regenerate-icon-${gift.id}`}><RefreshCw size={13} /> Regenerate</button>
        <label className="gs-chip-button" data-testid={`button-override-icon-${gift.id}`}>
          <Upload size={13} /> Override PNG
          <input type="file" accept="image/png,.png" aria-label={`Override icon for ${gift.name}`}
            onChange={(event) => {
              const selected = event.currentTarget.files?.[0];
              if (selected) onOverrideIcon(selected);
              event.currentTarget.value = '';
            }} />
        </label>
      </div>}
    </div>
    <form className="gs-catalog-edit" onSubmit={(event) => { event.preventDefault(); if (validPrice && name.trim()) void onSave(name.trim(), amount); }}>
      <label>
        <span>{gift.productType === 'gift' ? 'Gift name' : 'Effect name'}</span>
        <input value={name} maxLength={MAX_DRAFT_NAME} onChange={(event) => setName(event.target.value)} aria-label={`${gift.productType === 'gift' ? 'Gift' : 'Effect'} name for ${gift.name}`} data-testid={`input-catalog-name-${gift.id}`} />
      </label>
      <label>
        <span><CoinAmount size={13}>Price · coins</CoinAmount></span>
        <input type="number" min="1" step="1" inputMode="numeric" value={price} onChange={(event) => setPrice(event.target.value)} aria-label={`Price in coins for ${gift.name}`} data-testid={`input-catalog-price-${gift.id}`} />
      </label>
      <button className="gs-chip-button" type="submit" disabled={pending || !changed || !validPrice || !name.trim()} data-testid={`button-save-catalog-${gift.id}`}><Save size={14} /> Save name & price</button>
    </form>
    <div className="gs-catalog-actions">
      <button className="gs-chip-button" type="button" onClick={onPlay} disabled={!canPlay} data-testid={`button-play-catalog-${gift.id}`}><Play size={14} /> {canPlay ? 'Play animation' : 'No active animation'}</button>
      <button className="gs-chip-button" type="button" onClick={onReplace} data-testid={`button-replace-catalog-${gift.id}`}><Scissors size={14} /> Replace clip</button>
      <button className="gs-chip-button" type="button" onClick={() => onStatus(gift.status === 'active' ? 'inactive' : 'active')} disabled={pending} data-testid={`button-toggle-catalog-${gift.id}`}>{gift.status === 'active' ? 'Deactivate' : 'Activate'}</button>
      <button className="gs-chip-button" type="button" onClick={onType} disabled={pending} data-testid={`button-switch-type-${gift.id}`}>Switch to {gift.productType === 'gift' ? 'Entrance effect' : 'Gift'}</button>
      {gift.status === 'deleted'
        ? <span className="gs-catalog-deleted-note">Hidden from gift picker</span>
        : <button className="gs-chip-button danger" type="button" onClick={() => onStatus('deleted')} disabled={pending} data-testid={`button-delete-catalog-${gift.id}`}><Trash2 size={14} /> Delete</button>}
    </div>
  </article>;
}

function LibraryVersion({ version, catalogPrice, onPreview, onToggle, onAssign, onRename, onSavePrice, onDelete, pending }: {
  version: GiftStudioVersion;
  catalogPrice?: number;
  onPreview: (version: GiftStudioVersion) => void;
  onToggle: (version: GiftStudioVersion, active: boolean) => void;
  onAssign: (version: GiftStudioVersion, giftId: GiftStudioGiftId) => void;
  onRename: (version: GiftStudioVersion, name: string) => void;
  onSavePrice: (giftId: GiftStudioGiftId, cost: number) => void;
  onDelete: (version: GiftStudioVersion) => void;
  pending: boolean;
}) {
  const [giftTarget, setGiftTarget] = useState<GiftStudioGiftId | ''>('');
  const label = versionName(version);
  const [name, setName] = useState(label);
  useEffect(() => setName(label), [label]);
  const [price, setPrice] = useState(catalogPrice === undefined ? '' : String(catalogPrice));
  useEffect(() => setPrice(catalogPrice === undefined ? '' : String(catalogPrice)), [catalogPrice]);
  const amount = Number(price);
  const validPrice = /^\d+$/.test(price) && Number.isSafeInteger(amount) && amount > 0;
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
      <label htmlFor={`gift-name-${version.id}`}>Rename saved item</label>
      <input id={`gift-name-${version.id}`} value={name} maxLength={MAX_DRAFT_NAME} onChange={(event) => setName(event.target.value)} aria-label={`Name for ${label}`} data-testid={`input-rename-version-${version.id}`} />
      <button className="gs-chip-button" type="submit" disabled={pending || !name.trim() || name.trim() === label}><Save size={14} /> Save name</button>
    </form>
    {version.giftId && catalogPrice !== undefined && <form className="gs-library-pricing" onSubmit={(event) => { event.preventDefault(); if (validPrice) onSavePrice(version.giftId!, amount); }}>
      <label htmlFor={`gift-price-${version.id}`}><CoinAmount size={13}>Catalog price · coins</CoinAmount></label>
      <input id={`gift-price-${version.id}`} type="number" min="1" step="1" inputMode="numeric" value={price} onChange={(event) => setPrice(event.target.value)} aria-label={`Gift price in coins for ${label}`} data-testid={`input-version-price-${version.id}`} />
      <button className="gs-chip-button" type="submit" disabled={pending || !validPrice || amount === catalogPrice}><Save size={14} /> Save price</button>
    </form>}
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
