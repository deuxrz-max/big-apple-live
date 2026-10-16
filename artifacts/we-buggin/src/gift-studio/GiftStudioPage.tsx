import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Archive, Check, Download, Pipette, FileVideo2, LockKeyhole, Pause, Play, RefreshCw, Scissors, ShieldCheck, Upload, X } from 'lucide-react';
import {
  getGetActiveGiftStudioMediaQueryKey,
  getGetGiftStudioLibraryQueryKey,
  useAssignGiftStudioVersionToGift,
  useCreateGiftStudioVersion,
  useGetGiftStudioLibrary,
  useSetGiftStudioVersionActive,
} from '@workspace/api-client-react';
import type { GiftStudioGiftId, GiftStudioVersion, GiftStudioUploadInput } from '@workspace/api-client-react';
import type { ClipSettings, KeyColor } from './processClip';
import { GiftAnimationPlayer, giftStudioMediaUrl } from '@/gifts/GiftAnimationPlayer';
import { drawKeyedPreview } from './liveKeyPreview';
import { createTransparentPngFramesZip } from './downloadPngFramesZip';
import './gift-studio.css';

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

export function GiftStudioPage() {
  const client = useQueryClient();
  const library = useGetGiftStudioLibrary({ query: { queryKey: getGetGiftStudioLibraryQueryKey(), retry: false } });
  const createVersion = useCreateGiftStudioVersion();
  const setActive = useSetGiftStudioVersionActive();
  const assignVersion = useAssignGiftStudioVersionToGift();
  const [file, setFile] = useState<File | null>(null);
  const [originalUrl, setOriginalUrl] = useState('');
  const [processedUrl, setProcessedUrl] = useState('');
  const [processedBlob, setProcessedBlob] = useState<Blob | null>(null);
  const [duration, setDuration] = useState(0);
  const [addToGiftSelection, setAddToGiftSelection] = useState(false);
  const [giftId, setGiftId] = useState<GiftStudioGiftId | ''>('');
  const [draftName, setDraftName] = useState('');
  const [keyPreset, setKeyPreset] = useState<KeyColor>('green');
  const [keyColor, setKeyColor] = useState('#00ff00');
  const [tolerance, setTolerance] = useState(.24);
  const [softness, setSoftness] = useState(.08);
  const [spill, setSpill] = useState(.35);
  const [maxDimension, setMaxDimension] = useState<ClipSettings['maxDimension']>(720);
  const [backdrop, setBackdrop] = useState<'checker' | 'light' | 'dark'>('checker');
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [downloadingFrames, setDownloadingFrames] = useState(false);
  const [frameZipProgress, setFrameZipProgress] = useState(0);
  const [framesZipBlob, setFramesZipBlob] = useState<Blob | null>(null);
  const [livePreviewError, setLivePreviewError] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [selectedPreview, setSelectedPreview] = useState<GiftStudioVersion | null>(null);
  const [playingPreview, setPlayingPreview] = useState<GiftStudioVersion | null>(null);
  const cancelledRef = useRef(false);
  const originalVideoRef = useRef<HTMLVideoElement>(null);
  const processedVideoRef = useRef<HTMLVideoElement>(null);
  const livePreviewCanvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<import('@ffmpeg/ffmpeg').FFmpeg | null>(null);
  const isSeekingRef = useRef(false);
  const processedSettingsRef = useRef<string | null>(null);
  const [playhead, setPlayhead] = useState(0);

  const settings = useMemo<ClipSettings>(() => ({
    preset: keyPreset, keyColor, tolerance, softness, spill, maxDimension,
  }), [keyPreset, keyColor, tolerance, softness, spill, maxDimension]);

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
    setFramesZipBlob(null);
    processedSettingsRef.current = null;
    setStatus('');
    setError('');
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
    if (originalUrl) URL.revokeObjectURL(originalUrl);
    const nextUrl = URL.createObjectURL(candidate);
    setOriginalUrl(nextUrl);
    setFile(candidate);
    setDuration(0);
    setPlayhead(0);
    setStatus('Checking clip length…');
  };
  const onOriginalMetadata = () => {
    const video = originalVideoRef.current;
    if (!video) return;
    setDuration(video.duration);
    if (!Number.isFinite(video.duration) || video.duration > MAX_SECONDS) {
      setError('Clip must be 15 seconds or shorter.');
      setStatus('');
      setFile(null);
      return;
    }
    setStatus('Ready to process locally.');
    void video.play().catch(() => setStatus('Tap Play to start both previews.'));
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
    resetOutput();
    setProcessing(false);
    setProgress(0);
    setStatus('Processing cancelled. Temporary clip data was cleared.');
    setError('');
  };
  const process = async () => {
    if (!file) return;
    cancelledRef.current = false;
    resetOutput();
    setProcessing(true);
    setProgress(0);
    setError('');
    setStatus('Loading local video engine…');
    try {
      const { processClipLocally } = await import('./processClip');
      if (cancelledRef.current) return;
      const result = await processClipLocally(file, settings, (value) => setProgress(value), (engine) => {
        engineRef.current = engine;
        if (engine) setStatus('Processing clip on this device…');
      }, (stage) => setStatus(stage));
      if (cancelledRef.current) return;
      const url = URL.createObjectURL(result.blob);
      setProcessedUrl(url);
      setProcessedBlob(result.blob);
      processedSettingsRef.current = JSON.stringify(settings);
      setProgress(1);
      setStatus('Finished. The transparent WebM passed the local alpha check.');
    } catch (cause) {
      if (cancelledRef.current || String(cause).toLowerCase().includes('terminated')) {
        setStatus('Processing cancelled. Temporary clip data was cleared.');
      } else {
        setError(errorText(cause));
        setStatus('');
      }
    } finally {
      setProcessing(false);
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
      setStatus('PNG frames are ready. Tap Download PNG frames ZIP to save them.');
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setDownloadingFrames(false);
    }
  };

  const choosePreset = (preset: KeyColor) => {
    setKeyPreset(preset);
    const found = KEY_PRESETS.find((option) => option.id === preset);
    if (found) setKeyColor(found.value);
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
      setKeyPreset('custom');
      setKeyColor(result.sRGBHex.toLowerCase());
      setStatus(`Custom key color set to ${result.sRGBHex}.`);
    } catch {
      setStatus('Color selection cancelled.');
    }
  };

  const approve = () => {
    const trimmedName = draftName.trim();
    if (!file || !processedBlob || !trimmedName || createVersion.isPending || (addToGiftSelection && !giftId)) return;
    const data: GiftStudioUploadInput = {
      ...(addToGiftSelection && giftId ? { giftId } : {}),
      settings: JSON.stringify({ ...settings, draftName: trimmedName }),
      // Generated multipart typing says string; actual File/Blob values are intentionally passed through for FormData.append.
      sourceVideo: file as unknown as string,
      processedWebm: new File([processedBlob], `${file.name.replace(/\.[^.]+$/, '')}-alpha.webm`, { type: 'video/webm' }) as unknown as string,
    };
    createVersion.mutate({ data }, {
      onSuccess: () => {
        void client.invalidateQueries({ queryKey: getGetGiftStudioLibraryQueryKey() });
        setStatus(addToGiftSelection && giftId
          ? `Saved “${trimmedName}” as a ${GIFTS.find((gift) => gift.id === giftId)?.label} draft. Activate it from the library when you are ready.`
          : `Saved “${trimmedName}” as a standalone Gift Studio draft. You can add it to a gift selection from the library later.`);
      },
      onError: (cause) => setError(ownerErrorText(cause)),
    });
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
        if (updated.giftId) void client.invalidateQueries({ queryKey: getGetActiveGiftStudioMediaQueryKey(updated.giftId) });
        setSelectedPreview((current) => current?.id === updated.id ? updated : current);
        setStatus(active ? `${GIFTS.find((gift) => gift.id === updated.giftId)?.label} version ${updated.version} is now active.` : `Version ${updated.version} returned to draft.`);
      },
      onError: (cause) => setError(ownerErrorText(cause)),
    });
  };
  const previewVersion = (version: GiftStudioVersion) => setSelectedPreview(version);

  if (library.isError && isDenied(library.error)) {
    return <main className="gs"><div className="gs-shell"><section className="gs-error-panel" role="alert" data-testid="state-owner-denied"><ShieldCheck size={23} /><h1 className="gs-panel-title">Gift Studio is for owners</h1><p>Your account does not have permission to manage gift animation versions. Sign in with the owner account, then try again.</p><button className="gs-button" type="button" onClick={() => void library.refetch()} data-testid="button-retry-access"><RefreshCw size={15} /> Check access again</button></section></div></main>;
  }

  const libraryItems = library.data?.items ?? [];
  const filteredItems = selectedPreview ? [selectedPreview, ...libraryItems.filter((item) => item.id !== selectedPreview.id)] : libraryItems;
  return (
    <main className="gs">
      <div className="gs-shell">
        <div className="gs-topline"><span className="gs-topline-mark" /> STREAMTALK · GIFT STUDIO</div>
        <header className="gs-heading">
          <div><h1>Cut the screen.<br /><span>Keep the glow.</span></h1><p>Turn green, magenta or black-screen gift animations into real transparency. Processing runs in your browser, free.</p></div>
          <div className="gs-private"><LockKeyhole size={13} /> On-device processing</div>
        </header>

        <div className="gs-layout">
          <div className="gs-stack">
            <section className="gs-panel" aria-labelledby="gs-source-title">
              <div className="gs-panel-head"><div className="gs-step-number">01</div><div><div className="gs-kicker">Start with a clip</div><h2 className="gs-panel-title" id="gs-source-title">Choose your source</h2></div></div>
              <div className="gs-step">
                <div aria-hidden="true" />
                <div>
                  <label className="gs-upload" htmlFor="gs-file-input" data-testid="upload-video-dropzone">
                    {file ? <><div className="gs-file-row"><span className="gs-file-name">{file.name}</span><span className="gs-file-meta">{formatBytes(file.size)}</span></div><small>{duration ? `${duration.toFixed(1)} sec` : 'Checking clip length'} · select to replace</small></> :
                      <>
                        <span className="gs-upload-icon"><FileVideo2 size={23} /></span>
                        <strong>Upload a video</strong>
                        <small>Videos only: MP4, WebM or MOV. Up to 15 seconds and 100 MB.</small>
                        <span className="gs-upload-helper">Choose a video from your phone. Images are not accepted.</span>
                        <span className="gs-upload-cta"><Upload size={17} /> Choose video</span>
                        <span className="gs-upload-instruction">Play, pause and scrub your video before removing its background.</span>
                      </>}
                    <input id="gs-file-input" type="file" accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov" disabled={processing} onChange={(event) => { loadFile(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} data-testid="input-source-video" aria-label="Choose a video clip" />
                  </label>
                  <p className="gs-caption">Nothing uploads while you experiment. The original stays on your device until you approve the final version.</p>
                </div>
              </div>
            </section>

            <section className="gs-panel" aria-labelledby="gs-preview-title">
              <div className="gs-panel-head"><div className="gs-step-number">02</div><div><div className="gs-kicker">Dial in the cutout</div><h2 className="gs-panel-title" id="gs-preview-title">Compare your clip</h2></div></div>
              <div className="gs-toolbar">
                <label className="gs-name-field">
                  <span>Name this gift <small>Required to save</small></span>
                  <input
                    type="text"
                    value={draftName}
                    maxLength={MAX_DRAFT_NAME}
                    onChange={(event) => setDraftName(event.target.value)}
                    disabled={processing}
                    placeholder="For example, Rose Shower"
                    autoComplete="off"
                    aria-required="true"
                    data-testid="input-draft-name"
                  />
                </label>
                <div className="gs-backdrop-tabs" role="group" aria-label="Transparency preview backdrop">
                  {(['checker', 'light', 'dark'] as const).map((mode) => <button type="button" key={mode} aria-pressed={backdrop === mode} onClick={() => setBackdrop(mode)} data-testid={`button-backdrop-${mode}`}>{mode === 'checker' ? 'Grid' : mode}</button>)}
                </div>
              </div>
              <div className="gs-preview-grid">
                <div className="gs-preview">
                  <div className="gs-preview-label">Before <span>Original clip</span></div>
                  <div className={`gs-preview-stage ${backdrop}`} data-testid="preview-original">
                    {originalUrl ? <video ref={originalVideoRef} src={originalUrl} muted playsInline loop autoPlay preload="metadata" onLoadedMetadata={onOriginalMetadata} onTimeUpdate={syncTime} /> : <div className="gs-empty-preview">Your source preview will appear here.</div>}
                  </div>
                </div>
                <div className="gs-preview">
                  <div className="gs-preview-label">After <span>{processedUrl ? <span className="gs-ready-label"><Check size={12} /> Ready</span> : file ? 'Live cutout preview' : 'Background removed'}</span></div>
                  <div className={`gs-preview-stage ${backdrop}`} data-testid="preview-processed">
                    {processedUrl ? <video ref={processedVideoRef} src={processedUrl} muted playsInline loop autoPlay preload="metadata" onLoadedMetadata={onProcessedMetadata} onTimeUpdate={syncTime} /> :
                      originalUrl ? <><canvas ref={livePreviewCanvasRef} aria-label="Live background-removed preview" data-testid="canvas-live-cutout" />{livePreviewError && <div className="gs-preview-note" role="status">{livePreviewError}</div>}</> :
                        <div className="gs-empty-preview">Choose a source clip to see the cutout preview.</div>}
                  </div>
                  <div className="gs-after-actions">
                    {!processedUrl && (processing ?
                      <button className="gs-button quiet" type="button" onClick={cancelProcessing} data-testid="button-cancel-processing"><X size={15} /> Cancel processing</button> :
                      <button className="gs-button primary gs-remove-background" type="button" onClick={() => void process()} disabled={!file || duration > MAX_SECONDS || duration <= 0} data-testid="button-process"><Scissors size={17} /> Remove background</button>)}
                    {processing && <div className="gs-progress" role="status" aria-live="polite" data-testid="state-processing"><div className="gs-progress-track"><div className="gs-progress-fill" style={{ width: `${Math.round(progress * 100)}%` }} /></div><div className="gs-progress-copy"><span>{status}</span><span>{Math.round(progress * 100)}%</span></div></div>}
                    {processedUrl && <div className="gs-save-destination" data-testid="panel-save-destination">
                      <strong>What would you like to do with this clip?</strong>
                      <label><input type="radio" name="gift-destination" checked={!addToGiftSelection} onChange={() => setAddToGiftSelection(false)} data-testid="radio-standalone-draft" /> Save it as a named Gift Studio draft</label>
                      <label><input type="radio" name="gift-destination" checked={addToGiftSelection} onChange={() => setAddToGiftSelection(true)} data-testid="radio-add-to-gifts" /> Add it to the gift selection</label>
                      {addToGiftSelection && <label className="gs-name-field gs-target-field">
                        <span>Choose the existing gift</span>
                        <select value={giftId} onChange={(event) => setGiftId(event.target.value as GiftStudioGiftId | '')} data-testid="select-gift-target">
                          <option value="">Choose a gift…</option>
                          {GIFTS.map((gift) => <option key={gift.id} value={gift.id}>{gift.label}</option>)}
                        </select>
                      </label>}
                      <button className="gs-button primary" type="button" onClick={approve} disabled={!file || !processedBlob || !draftName.trim() || (addToGiftSelection && !giftId) || createVersion.isPending} data-testid="button-save-as-gift" aria-describedby="gs-save-target-note">
                        {createVersion.isPending ? 'Saving…' : addToGiftSelection ? 'Save gift draft' : 'Save standalone draft'} <Check size={15} />
                      </button>
                      {createVersion.isError && <div className="gs-error" role="alert" data-testid="state-upload-error">{ownerErrorText(createVersion.error)}</div>}
                      <p className="gs-caption gs-save-note" id="gs-save-target-note">Gift drafts stay inactive until you activate a version in the library. Standalone drafts do not appear in the gift picker.</p>
                    </div>}
                    {processedUrl && <div className="gs-after-downloads">
                      <button className="gs-button" type="button" onClick={() => processedBlob && downloadBlob(processedBlob, `${safeGiftFilePrefix()}-transparent.webm`)} disabled={!processedBlob} data-testid="button-download-webm"><Download size={14} /> Download WebM</button>
                      <button className="gs-button" type="button" onClick={() => framesZipBlob ? downloadBlob(framesZipBlob, `${safeGiftFilePrefix()}-png-frames.zip`) : void downloadFramesZip()} disabled={downloadingFrames} data-testid="button-download-png-zip"><Archive size={14} /> {downloadingFrames ? `Building ZIP ${Math.round(frameZipProgress * 100)}%` : framesZipBlob ? 'Download PNG frames ZIP' : 'Prepare PNG frames ZIP'}</button>
                    </div>}
                    {error && <div className="gs-error" role="alert" data-testid="state-error">{error}</div>}
                    {status && !processing && <p className="gs-caption" role="status" aria-live="polite" data-testid="state-status">{status}</p>}
                    {createVersion.isError && <div className="gs-error" role="alert" data-testid="state-upload-error">{ownerErrorText(createVersion.error)}</div>}
                    {downloadingFrames && <p className="gs-caption" role="status" aria-live="polite">Preparing transparent PNG frames for download…</p>}
                  </div>
                </div>
              </div>
              <div className="gs-controls">
                <button className="gs-icon-button" type="button" onClick={() => void synchronizePlay()} disabled={!file} aria-label={originalVideoRef.current?.paused ? 'Play both previews' : 'Pause both previews'} data-testid="button-play-pause">{originalVideoRef.current?.paused ? <Play size={16} /> : <Pause size={16} />}</button>
                <input className="gs-range" type="range" min="0" max={duration || 1} step=".05" value={Math.min(playhead, duration || 0)} onChange={(event) => seek(Number(event.target.value))} disabled={!file} aria-label="Scrub both previews" data-testid="input-preview-scrubber" />
                <span className="gs-file-meta" data-testid="text-preview-time">{timeLabel(playhead)} / {timeLabel(duration)}</span>
              </div>
            </section>

            <section className="gs-panel" aria-labelledby="gs-key-title">
              <div className="gs-panel-head"><div className="gs-step-number">03</div><div><div className="gs-kicker">Refine the edge</div><h2 className="gs-panel-title" id="gs-key-title">Key & output</h2></div></div>
              <fieldset className="gs-settings" disabled={processing}>
                <div>
                  <div className="gs-kicker" style={{ marginBottom: 8 }}>Key color</div>
                  <div className="gs-choice-row" role="group" aria-label="Key color preset">
                    {KEY_PRESETS.map((preset) => <button className="gs-choice" type="button" key={preset.id} aria-pressed={keyPreset === preset.id} onClick={() => choosePreset(preset.id)} data-testid={`button-key-${preset.id}`}><span className="gs-swatch" style={{ backgroundColor: preset.value }} />{preset.label}</button>)}
                    <button className="gs-choice" type="button" aria-pressed={keyPreset === 'custom'} onClick={() => void sampleColor()} data-testid="button-eyedropper"><Pipette size={14} /> Eyedropper</button>
                    <label className="gs-sr-only" htmlFor="gs-key-color">Custom key color</label>
                    <input className="gs-color-input" id="gs-key-color" type="color" value={keyColor} onChange={(event) => { setKeyPreset('custom'); setKeyColor(event.target.value); }} aria-label="Choose custom key color" data-testid="input-key-color" />
                  </div>
                  {keyPreset === 'black' && <p className="gs-warning" role="note" data-testid="warning-black-key"><AlertTriangle size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Black keying also removes black car bodies, tires, and shadows.</p>}
                </div>
                <div className="gs-field-row"><div><label htmlFor="gs-tolerance">Tolerance <output>{tolerance.toFixed(2)}</output></label><input className="gs-range" id="gs-tolerance" type="range" min=".02" max=".65" step=".01" value={tolerance} onChange={(event) => setTolerance(Number(event.target.value))} data-testid="input-tolerance" /></div><span className="gs-kicker">Key</span></div>
                <div className="gs-field-row"><div><label htmlFor="gs-softness">Softness / edge feather <output>{softness.toFixed(2)}</output></label><input className="gs-range" id="gs-softness" type="range" min="0" max=".5" step=".01" value={softness} onChange={(event) => setSoftness(Number(event.target.value))} data-testid="input-softness" /></div><span className="gs-kicker">Edge</span></div>
                <div className="gs-field-row"><div><label htmlFor="gs-spill">Spill reduction <output>{spill.toFixed(2)}</output></label><input className="gs-range" id="gs-spill" type="range" min="0" max="1" step=".01" value={spill} onChange={(event) => setSpill(Number(event.target.value))} disabled={keyPreset === 'black'} data-testid="input-spill" />{keyPreset === 'black' && <p className="gs-caption">Spill reduction is not used with a black key.</p>}</div><span className="gs-kicker">Color</span></div>
                <div><label className="gs-kicker" htmlFor="gs-max-size">Maximum output dimension</label><select className="gs-chip-button" id="gs-max-size" value={maxDimension ?? 'original'} onChange={(event) => setMaxDimension(event.target.value === 'original' ? null : Number(event.target.value) as 480 | 720 | 1080)} data-testid="select-max-dimension"><option value="original">Keep original size</option><option value="480">480 px · smallest</option><option value="720">720 px · balanced</option><option value="1080">1080 px · sharpest</option></select><p className="gs-caption">Downscaling lowers memory use and can finish faster, especially on phones.</p></div>
              </fieldset>
              <div className="gs-mobile-note"><FileVideo2 size={16} /><div><strong>Large clips use phone memory</strong>Processing happens locally and temporarily holds the source and output in memory. On mobile, choose 480 or 720 px for a lighter run.</div></div>
            </section>
          </div>

          <aside className="gs-stack">
            <section className="gs-panel" aria-labelledby="gs-library-title">
              <div className="gs-panel-head"><div><div className="gs-kicker">Saved for later</div><h2 className="gs-panel-title" id="gs-library-title">Version library</h2></div><span className="gs-status">{libraryItems.length} saved</span></div>
              {library.isLoading ? <div className="gs-library-list" aria-label="Loading gift versions" data-testid="state-library-loading">{[1, 2, 3].map((i) => <div className="gs-library-card" key={i}><div className="gs-version-mark" /><div className="gs-version-info"><strong>Loading saved version</strong><small>Fetching your library…</small></div></div>)}</div> :
                library.isError ? <div className="gs-error-panel" role="alert" data-testid="state-library-error"><p>{errorText(library.error)}</p><button className="gs-button" type="button" onClick={() => void library.refetch()} data-testid="button-retry-library"><RefreshCw size={14} /> Try again</button></div> :
                  libraryItems.length === 0 ? <div className="gs-empty-library" data-testid="state-library-empty">Your saved versions will live here. Save a finished cutout to add the first draft. Nothing is stored before you save.</div> :
                     <div className="gs-library-list" data-testid="list-gift-versions">{filteredItems.map((version) => <LibraryVersion key={version.id} version={version} onPreview={previewVersion} onToggle={toggleVersion} onAssign={attachVersion} pending={setActive.isPending || assignVersion.isPending} />)}</div>}
              <p className="gs-caption">Drafts never interrupt the animation currently playing in your rooms. You can switch versions or return one to draft at any time.</p>
            </section>
            <section className="gs-panel">
              <div className="gs-panel-head"><div><div className="gs-kicker">How it works</div><h2 className="gs-panel-title">Owner-controlled, always</h2></div></div>
              <div className="gs-stack" style={{ gap: 12 }}>
                <div className="gs-mobile-note"><span className="gs-step-number">A</span><div><strong>Preview stays private</strong>Keying and encoding run in your browser with the local FFmpeg engine.</div></div>
                <div className="gs-mobile-note"><span className="gs-step-number">B</span><div><strong>Save the exact export</strong>Both the original and the same transparent WebM are saved as a named draft.</div></div>
                <div className="gs-mobile-note"><span className="gs-step-number">C</span><div><strong>Activate only when ready</strong>Old versions stay saved, so you can safely switch back.</div></div>
              </div>
            </section>
          </aside>
        </div>
        <div className="gs-sr-only" aria-live="polite" data-testid="state-announcer">{status}</div>
      </div>

      {selectedPreview && <div role="dialog" aria-modal="true" aria-labelledby="gs-version-dialog-title" className="gs-modal-wrap" onClick={(event) => { if (event.target === event.currentTarget) setSelectedPreview(null); }} data-testid="dialog-version-preview">
        <section className="gs-panel gs-modal">
          <div className="gs-panel-head"><div><div className="gs-kicker">{selectedPreview.status} · version {selectedPreview.version}</div><h2 className="gs-panel-title" id="gs-version-dialog-title">{versionName(selectedPreview)} animation</h2></div><button type="button" className="gs-icon-button" onClick={() => setSelectedPreview(null)} aria-label="Close version preview" data-testid="button-close-version-preview"><X size={16} /></button></div>
          <div className="gs-preview-stage checker"><video src={giftStudioMediaUrl(selectedPreview.webmUrl)} controls muted playsInline preload="metadata" data-testid={`video-library-version-${selectedPreview.id}`} /></div>
          <div className="gs-controls">
            {selectedPreview.giftId ? <>
              <button type="button" className="gs-button" onClick={() => setPlayingPreview(selectedPreview)} data-testid={`button-play-version-overlay-${selectedPreview.id}`}>Play through gift overlay</button>
              <button type="button" className="gs-button" onClick={() => toggleVersion(selectedPreview, selectedPreview.status !== 'active')} disabled={setActive.isPending} data-testid={`button-toggle-version-${selectedPreview.id}`}>{selectedPreview.status === 'active' ? 'Return to draft' : 'Activate this version'}</button>
            </> : <p className="gs-caption">This is a standalone draft. Add it to an existing gift from its library card before testing it in the gift overlay or activating it.</p>}
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
          webmUrl: playingPreview.webmUrl,
          safariUrl: playingPreview.safariUrl,
          durationMs: playingPreview.durationMs,
        }}
        onFinish={() => setPlayingPreview(null)}
      />}
    </main>
  );
}

export default GiftStudioPage;

function LibraryVersion({ version, onPreview, onToggle, onAssign, pending }: {
  version: GiftStudioVersion;
  onPreview: (version: GiftStudioVersion) => void;
  onToggle: (version: GiftStudioVersion, active: boolean) => void;
  onAssign: (version: GiftStudioVersion, giftId: GiftStudioGiftId) => void;
  pending: boolean;
}) {
  const [giftTarget, setGiftTarget] = useState<GiftStudioGiftId | ''>('');
  const label = versionName(version);
  return <article className="gs-library-card" data-testid={`card-gift-version-${version.id}`}>
    <div className="gs-version-mark">V{version.version}</div>
    <div className="gs-version-info"><strong>{label}</strong><small>{version.giftId ? `${GIFTS.find((gift) => gift.id === version.giftId)?.label} · ` : 'Standalone draft · not in gift selection · '}{new Date(version.createdAt).toLocaleDateString()} · {formatBytes(version.webmBytes)} WebM · {version.durationMs / 1000}s</small><span className={`gs-status ${version.status === 'active' ? 'active' : ''}`} data-testid={`status-version-${version.id}`}>{version.status}</span></div>
    <div className="gs-card-actions">
      <button className="gs-icon-button" type="button" onClick={() => onPreview(version)} aria-label={`Preview ${label} version ${version.version}`} data-testid={`button-preview-version-${version.id}`}><Play size={14} /></button>
      {version.giftId ? <button className="gs-chip-button" type="button" onClick={() => onToggle(version, version.status !== 'active')} disabled={pending} data-testid={`button-activate-version-${version.id}`}>{version.status === 'active' ? 'Return to draft' : 'Activate'}</button> :
        <div className="gs-assign-row">
          <select className="gs-chip-button" value={giftTarget} onChange={(event) => setGiftTarget(event.target.value as GiftStudioGiftId | '')} aria-label={`Choose a gift for ${label}`} data-testid={`select-assign-gift-${version.id}`}>
            <option value="">Choose gift…</option>
            {GIFTS.map((gift) => <option key={gift.id} value={gift.id}>{gift.label}</option>)}
          </select>
          <button className="gs-chip-button" type="button" onClick={() => giftTarget && onAssign(version, giftTarget)} disabled={pending || !giftTarget} data-testid={`button-assign-gift-${version.id}`}>Add to gift</button>
        </div>}
    </div>
  </article>;
}

function versionName(version: GiftStudioVersion) {
  return version.settings.draftName?.trim()
    || `${GIFTS.find((gift) => gift.id === version.giftId)?.label ?? 'Gift Studio'} · ${version.originalName}`;
}
