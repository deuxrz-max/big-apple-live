import { FFmpeg } from '@ffmpeg/ffmpeg';
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';
import workerURL from '@ffmpeg/ffmpeg/worker?url';
import { buildHueChromaKeyFilter } from './liveKeyPreview';

export type KeyColor = 'green' | 'magenta' | 'black' | 'custom';

export interface ClipSettings {
  backgroundMode: 'see-through' | 'black';
  preserveSourceAlpha: boolean;
  retainOpaqueBackground: boolean;
  preset: KeyColor;
  keyColor: string;
  tolerance: number;
  softness: number;
  spill: number;
  maxDimension: 480 | 720 | 1080 | null;
}

export interface ProcessResult {
  blob: Blob;
  bytes: Uint8Array;
}

async function withWorkerTimeout<T>(operation: Promise<T>, engine: FFmpeg, milliseconds: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          try { engine.terminate(); } catch { /* worker already stopped */ }
          reject(new Error(message));
        }, milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function processClipLocally(
  file: File,
  settings: ClipSettings,
  onProgress: (progress: number) => void,
  onEngine: (engine: FFmpeg | null) => void,
  onStage: (stage: string) => void = () => undefined,
): Promise<ProcessResult> {
  const engine = new FFmpeg();
  onEngine(engine);
  engine.on('progress', ({ progress }) => onProgress(Math.max(0, Math.min(1, progress))));
  const inputName = `source-${Date.now()}.${file.name.split('.').pop()?.toLowerCase() || 'mp4'}`;
  const outputName = settings.backgroundMode === 'black' ? 'gift-black-background.webm' : 'gift-alpha.webm';
  const verifyName = 'verify-alpha.rgba';
  let engineLoaded = false;
  try {
    onStage('Loading the local video engine…');
    await withWorkerTimeout(
      engine.load({ coreURL, wasmURL, workerURL }).then(() => {
        engineLoaded = true;
      }),
      engine,
      45_000,
      'The phone video engine did not start in time. Switching to the low-memory server processor.',
    );
    onStage('Preparing the source clip…');
    await engine.writeFile(inputName, new Uint8Array(await file.arrayBuffer()));
    const filterParts: string[] = [];
    const blackBackground = settings.backgroundMode === 'black' || settings.retainOpaqueBackground;
    if (settings.maxDimension) {
      filterParts.push(`scale='if(gte(iw,ih),min(iw,${settings.maxDimension}),-2)':'if(gte(iw,ih),-2,min(ih,${settings.maxDimension}))':flags=lanczos`);
    }
    if (blackBackground) filterParts.push("crop=trunc(iw/2)*2:trunc(ih/2)*2");
    if (!blackBackground && !settings.preserveSourceAlpha) filterParts.push(buildHueChromaKeyFilter(settings));
    if (!blackBackground && !settings.preserveSourceAlpha && settings.spill > 0.01 && settings.preset !== 'black') {
      const despillChannel = settings.preset === 'green' || settings.keyColor.toLowerCase() === '#00ff00' ? 'green' : 'blue';
      filterParts.push(`despill=type=${despillChannel}:mix=${settings.spill.toFixed(2)}:expand=0`);
    }
    onStage(blackBackground
      ? 'Keeping the black background and encoding a normal video…'
      : settings.preserveSourceAlpha
        ? 'Keeping the source transparency and encoding…'
        : 'Removing the background and encoding transparent video…');
    const result = await withWorkerTimeout(engine.exec([
      ...(settings.preserveSourceAlpha && /webm/i.test(file.type || file.name) ? ['-c:v', 'libvpx-vp9'] : []),
      '-i', inputName,
      ...(filterParts.length ? ['-vf', filterParts.join(',')] : []),
      '-an',
      '-c:v', 'libvpx-vp9',
      '-pix_fmt', blackBackground ? 'yuv420p' : 'yuva420p',
      '-auto-alt-ref', '0',
      '-b:v', '0',
      '-crf', '32',
      '-deadline', 'good',
      '-cpu-used', '4',
      '-y', outputName,
    ]), engine, 90_000, 'The phone ran out of time or memory while encoding. Switching to the low-memory server processor.');
    if (result !== 0) throw new Error('The clip could not be processed. Try a smaller output size or a different source file.');
    const output = await engine.readFile(outputName);
    if (typeof output === 'string') throw new Error('The processed clip could not be read.');
    const bytes = new Uint8Array(output);
    if (blackBackground) {
      onProgress(1);
      return { blob: new Blob([bytes], { type: 'video/webm' }), bytes };
    }
    onStage('Verifying transparency frame by frame…');
    const verification = await withWorkerTimeout(engine.exec([
      '-c:v', 'libvpx-vp9',
      '-i', outputName,
      '-vf', 'fps=3,scale=128:128,format=rgba',
      '-frames:v', '45',
      '-f', 'rawvideo',
      '-pix_fmt', 'rgba',
      '-y', verifyName,
    ]), engine, 30_000, 'The phone could not verify the finished transparency. Switching to the server processor.');
    if (verification !== 0) {
      throw new Error('Transparency could not be verified on this device. Try processing again or use a supported browser.');
    }
    const pixels = await engine.readFile(verifyName);
    const framePixels = 128 * 128;
    const frameBytes = framePixels * 4;
    if (typeof pixels === 'string' || pixels.length < frameBytes) {
      throw new Error('Transparency could not be verified because the clip produced no decodable frames.');
    }
    let framesWithTransparency = 0;
    let framesWithArtwork = 0;
    let transparentPixels = 0;
    let sampledPixels = 0;
    const frameCount = Math.floor(pixels.length / frameBytes);
    for (let frame = 0; frame < frameCount; frame++) {
      let transparent = 0;
      let visible = 0;
      const start = frame * frameBytes;
      const end = start + frameBytes;
      for (let i = start + 3; i < end; i += 4) {
        if (pixels[i]! < 32) transparent++;
        if (pixels[i]! > 200) visible++;
      }
      transparentPixels += transparent;
      sampledPixels += framePixels;
      if (transparent / framePixels >= 0.01) framesWithTransparency++;
      if (visible / framePixels >= 0.03) framesWithArtwork++;
    }
    const requiredFrames = Math.max(2, Math.ceil(frameCount * 0.2));
    if (framesWithTransparency < requiredFrames) {
      const percent = sampledPixels ? Math.round((transparentPixels / sampledPixels) * 100) : 0;
      throw new Error(`Only ${percent}% of pixels became transparent. Tap the background in the preview to sample its color, then process again.`);
    }
    if (framesWithArtwork < requiredFrames) {
      throw new Error('The key removed nearly all visible artwork. Choose a cleaner background sample and try again.');
    }
    onProgress(1);
    return { blob: new Blob([bytes], { type: 'video/webm' }), bytes };
  } finally {
    if (engineLoaded) {
      try { await engine.deleteFile(inputName); } catch { /* worker may have been terminated */ }
      try { await engine.deleteFile(outputName); } catch { /* worker may have been terminated */ }
      try { await engine.deleteFile(verifyName); } catch { /* worker may have been terminated */ }
    }
    try { engine.terminate(); } catch { /* already terminated during cancellation */ }
    onEngine(null);
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
