import { Router, type IRouter } from 'express';
import { z } from 'zod';
import { accountId, sameOrigin } from './identity';
import { RoomError } from '../lib/room-store';
import { accessFor, requireAdult } from '../lib/community';
import { blocks, getMe, getPerson, listPeople, relationship, saveSocialProfile } from '../lib/social/people';
import { clearThread, inbox, sendMessage, thread } from '../lib/social/messages';
import { favoritesGallery, favoriteRoom } from '../lib/social/favorites';
import { equipProfileCosmetic, getProfileCosmeticStore } from '../lib/social/profile-cosmetics';

const router: IRouter = Router();
const username = z.string().regex(/^[A-Za-z0-9_]{3,24}$/);

router.get('/social/me', async (req, res): Promise<void> => {
  res.set('Cache-Control', 'no-store');
  res.json(await getMe(accountId(req)));
});

router.put('/social/me', async (req, res): Promise<void> => {
  sameOrigin(req);
  const input = z.object({
    race: z.literal('Human').optional(),
    job: z.enum(['Apprentice', 'Squire', 'Initiate', 'Trapper', 'Novice', 'Acolyte', 'Scoundrel', 'Tinker']).nullable().optional(),
  }).strict().safeParse(req.body);
  if (!input.success || !Object.keys(input.data).length) throw new RoomError(400, 'Choose a race or starter job.');
  res.json(await saveSocialProfile(accountId(req), input.data));
});

router.get('/social/cosmetics/store', async (req, res): Promise<void> => {
  res.set('Cache-Control', 'no-store');
  res.json(await getProfileCosmeticStore(accountId(req)));
});

router.put('/social/cosmetics/equip', async (req, res): Promise<void> => {
  sameOrigin(req);
  const input = z.object({
    kind: z.enum(['frame', 'nameColor', 'specialName']),
    itemId: z.string().min(1).max(40),
  }).strict().safeParse(req.body);
  if (!input.success) throw new RoomError(400, 'Choose a valid item.');
  res.json(await equipProfileCosmetic(accountId(req), input.data.kind, input.data.itemId));
});

router.get('/social/people', async (req, res): Promise<void> => {
  const input = z.object({
    search: z.string().max(80).optional(),
    gender: z.enum(['Male', 'Female']).optional(),
    country: z.string().max(2).optional(),
    favorites: z.enum(['true', 'false']).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  }).safeParse(req.query);
  if (!input.success) throw new RoomError(400, 'Invalid search filters');
  const result = await listPeople(accountId(req), {
    ...input.data,
    favorites: input.data.favorites === 'true',
  });
  res.json(result);
});

router.get('/social/people/:username', async (req, res): Promise<void> => {
  const parsed = username.safeParse(req.params.username);
  if (!parsed.success) throw new RoomError(400, 'Invalid username');
  res.json(await getPerson(accountId(req), parsed.data));
});

router.put('/social/people/:username/relationship', async (req, res): Promise<void> => {
  const name = username.safeParse(req.params.username);
  const input = z.object({ kind: z.enum(['favorite', 'block']), active: z.boolean() }).strict().safeParse(req.body);
  if (!name.success || !input.success) throw new RoomError(400, 'Choose follow or block and an active status.');
  res.json(await relationship(accountId(req), name.data, input.data.kind, input.data.active));
});

router.get('/social/blocks', async (req, res): Promise<void> => {
  res.json(await blocks(accountId(req)));
});

router.get('/social/favorites/gallery', async (req, res): Promise<void> => {
  res.json(await favoritesGallery(accountId(req)));
});
router.get('/social/favorites/:username/room', async (req, res): Promise<void> => {
  const parsed = username.safeParse(req.params.username);
  if (!parsed.success) throw new RoomError(400, 'Invalid username');
  res.json(await favoriteRoom(accountId(req), parsed.data));
});

router.get('/social/messages', async (req, res): Promise<void> => {
  res.json(await inbox(accountId(req)));
});
router.get('/social/messages/:username', async (req, res): Promise<void> => {
  const name = username.safeParse(req.params.username);
  const cursor = z.string().uuid().optional().safeParse(req.query.cursor);
  if (!name.success || !cursor.success) throw new RoomError(400, 'Invalid message history cursor');
  res.json(await thread(accountId(req), name.data, cursor.data));
});
router.post('/social/messages/:username', async (req, res): Promise<void> => {
  const name = username.safeParse(req.params.username);
  const input = z.object({
    body: z.string().trim().min(1).max(1000),
    idempotencyKey: z.string().uuid(),
  }).strict().safeParse(req.body);
  if (!name.success || !input.success) throw new RoomError(400, 'Write a message up to 1000 characters.');
  const senderId = accountId(req);
  await requireAdult(senderId);
  const chatAccess = await accessFor(senderId);
  if (chatAccess.chatMuted || chatAccess.reportsMuted)
    throw new RoomError(403, 'Chat is temporarily muted while a moderator reviews reports');
  res.json(await sendMessage(senderId, name.data, input.data.body, input.data.idempotencyKey));
});
router.delete('/social/messages/:username', async (req, res): Promise<void> => {
  const name = username.safeParse(req.params.username);
  if (!name.success) throw new RoomError(400, 'Invalid username');
  res.json(await clearThread(accountId(req), name.data));
});

export default router;
