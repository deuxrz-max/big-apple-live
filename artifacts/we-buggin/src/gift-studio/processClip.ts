import { FFmpeg } from '@ffmpeg/ffmpeg';
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';
import workerURL from '@ffmpeg/ffmpeg/worker?url';

export type KeyColor = 'green' | 'magenta' | 'black' | 'custom';

export interface ClipSettings {
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

const escapeFilterColor = (color: string) => color.replace('#', '0x');

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
  const outputName = 'gift-alpha.webm';
  const verifyName = 'verify-alpha.rgba';
  let engineLoaded = false;
  let loadTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    onStage('Loading the local video engine…');
    await Promise.race([
      engine.load({ coreURL, wasmURL, workerURL }).then(() => {
        engineLoaded = true;
      }),
      new Promise<never>((_, reject) => {
        loadTimer = setTimeout(
          () => reject(new Error('The local video processor did not start. Try again in Chrome or Brave, or reload this page.')),
          90_000,
        );
      }),
    ]);
    if (loadTimer) clearTimeout(loadTimer);
    onStage('Preparing the source clip…');
    await engine.writeFile(inputName, new Uint8Array(await file.arrayBuffer()));
    const filterParts: string[] = [];
    if (settings.maxDimension) {
      filterParts.push(`scale='if(gte(iw,ih),min(iw,${settings.maxDimension}),-2)':'if(gte(iw,ih),-2,min(ih,${settings.maxDimension}))':flags=lanczos`);
    }
    const similarity = Math.max(0.02, Math.min(0.65, settings.tolerance));
    const blend = Math.max(0, Math.min(0.5, settings.softness));
    filterParts.push(`format=yuva420p,chromakey=${escapeFilterColor(settings.keyColor)}:${similarity.toFixed(3)}:${blend.toFixed(3)}`);
    if (settings.spill > 0.01 && settings.preset !== 'black') {
      const despillChannel = settings.preset === 'green' || settings.keyColor.toLowerCase() === '#00ff00' ? 'green' : 'blue';
      filterParts.push(`despill=type=${despillChannel}:mix=${settings.spill.toFixed(2)}:expand=0`);
    }
    onStage('Removing the background and encoding transparent video…');
    const result = await engine.exec([
      '-i', inputName,
      '-vf', filterParts.join(','),
      '-an',
      '-c:v', 'libvpx-vp9',
      '-pix_fmt', 'yuva420p',
      '-auto-alt-ref', '0',
      '-b:v', '0',
      '-crf', '32',
      '-deadline', 'good',
      '-cpu-used', '4',
      '-y', outputName,
    ]);
    if (result !== 0) throw new Error('The clip could not be processed. Try a smaller output size or a different source file.');
    const output = await engine.readFile(outputName);
    if (typeof output === 'string') throw new Error('The processed clip could not be read.');
    const bytes = new Uint8Array(output);
    onStage('Verifying transparency frame by frame…');
    const verification = await engine.exec([
      '-c:v', 'libvpx-vp9',
      '-i', outputName,
      '-vf', 'fps=3,scale=128:128,format=rgba',
      '-frames:v', '45',
      '-f', 'rawvideo',
      '-pix_fmt', 'rgba',
      '-y', verifyName,
    ]);
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
      if (transparent / framePixels >= 0.01) framesWithTransparency++;
      if (visible / framePixels >= 0.03) framesWithArtwork++;
    }
    const requiredFrames = Math.max(2, Math.ceil(frameCount * 0.2));
    if (framesWithTransparency < requiredFrames || framesWithArtwork < requiredFrames) {
      throw new Error('The processed clip did not contain both transparent background and visible artwork. Adjust the key settings and process again.');
    }
    onProgress(1);
    return { blob: new Blob([bytes], { type: 'video/webm' }), bytes };
  } finally {
    if (loadTimer) clearTimeout(loadTimer);
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
