import { Storage } from '@google-cloud/storage';
import type { Request, Response } from 'express';
import { RoomError } from './room-store';

const types: Record<string, string> = {
  'icon.png': 'image/png', 'icon-small.png': 'image/png', 'fallback.webp': 'image/webp',
  'animation.webm': 'video/webm', 'animation.webp': 'image/webp', 'animation.png': 'image/png',
  'animation.mp4': 'video/mp4',
};
const productPaths = {
  'spirit-pup': 'gift-media/spirit-pup/v1',
  moonfox: 'gift-media/moonfox/v1',
  'cosmic-encore': 'gift-media/cosmic-encore/v1',
} as const;
type GiftMediaProduct = keyof typeof productPaths;
const storage = new Storage({
  credentials: {
    audience: 'replit', subject_token_type: 'access_token', type: 'external_account',
    token_url: 'http://127.0.0.1:1106/token',
    credential_source: { url: 'http://127.0.0.1:1106/credential', format: { type: 'json', subject_token_field_name: 'access_token' } },
    universe_domain: 'googleapis.com',
  }, projectId: '',
});
/** Public product artwork only. Never accepts arbitrary paths or serves profile photos. */
export function giftMediaFile(filename: string, product: GiftMediaProduct = 'spirit-pup') {
  if (!Object.hasOwn(types, filename)) throw new RoomError(404, 'Gift artwork not found');
  const match = /^\/([^/]+)\/(.+)$/.exec(process.env.PRIVATE_OBJECT_DIR ?? '');
  if (!match) throw new RoomError(503, 'Gift media storage is unavailable');
  return storage.bucket(match[1]!).file(`${match[2]!.replace(/\/$/, '')}/${productPaths[product]}/${filename}`);
}
function giftMediaHandler(product: GiftMediaProduct) {
  return async (req: Request, res: Response) => {
    const filename = String(req.params.filename);
    const file = giftMediaFile(filename, product);
    const [exists] = await file.exists();
    if (!exists) throw new RoomError(404, 'Gift artwork not found');
    const [meta] = await file.getMetadata();
    const size = Number(meta.size);
    res.set({ 'Content-Type': types[filename]!, 'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
    let start = 0, end = size - 1;
    const range = req.get('Range');
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) { res.set('Content-Range', `bytes */${size}`).status(416).end(); return; }
      start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
      end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
        res.set('Content-Range', `bytes */${size}`).status(416).end(); return;
      }
      res.status(206).set('Content-Range', `bytes ${start}-${end}/${size}`);
    }
    res.set('Content-Length', String(end - start + 1));
    if (req.method === 'HEAD') { res.end(); return; }
    const stream = file.createReadStream({ start, end });
    res.on('close', () => stream.destroy());
    stream.on('error', () => res.destroy()).pipe(res);
  };
}
export const serveGiftMedia = giftMediaHandler('spirit-pup');
export const serveMoonfoxGiftMedia = giftMediaHandler('moonfox');
export const serveCosmicEncoreGiftMedia = giftMediaHandler('cosmic-encore');
