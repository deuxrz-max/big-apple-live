import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { ENABLE_ROOM_MOOD_VISUALS, ROOM_MOOD_WINDOW_MS, ROOM_VISUALS_SOCKET_PATH } from '@workspace/beam-identity';
import { roomStore, type RoomStore } from './room-store';

/** Read-only effects transport. Chat still uses its original authenticated API. */
export function attachRoomMoodSocket(server: HttpServer, store: RoomStore = roomStore) {
  if (!ENABLE_ROOM_MOOD_VISUALS) return null;
  const io = new Server(server, {
    path: ROOM_VISUALS_SOCKET_PATH,
    // HTTP polling works through the existing /api proxy without a new WS route.
    transports: ['polling'],
    serveClient: false,
    maxHttpBufferSize: 1024,
    allowRequest(req, done) {
      const origin = req.headers.origin;
      const forwarded = req.headers['x-forwarded-host'];
      const host = (Array.isArray(forwarded) ? forwarded[0] : forwarded ?? req.headers.host)?.split(',')[0]?.trim();
      let allowed = !origin;
      try { if (origin) allowed = new URL(origin).host === host; } catch { allowed = false; }
      done(null, allowed);
    },
  });
  io.use((socket, next) => {
    const { roomId, participantSessionId } = socket.handshake.auth;
    try {
      if (typeof roomId !== 'string' || !/^[A-Z0-9]{6}$/.test(roomId) ||
          typeof participantSessionId !== 'string' || participantSessionId.length > 128)
        throw new Error('Invalid visual session');
      const participant = store.getSessionParticipant(roomId, participantSessionId);
      if (!participant.isRegistered) throw new Error('An account Beam session is required');
      socket.data.roomId = roomId;
      socket.data.credential = participantSessionId;
      socket.data.historyId = store.getHistoryId(roomId);
      next();
    } catch {
      next(new Error('Join this Beam before connecting room visuals.'));
    }
  });
  io.on('connection', socket => {
    const { roomId, credential, historyId } = socket.data;
    try {
      const unsubscribe = store.subscribe(roomId, event => {
        // A leave, expiry, or reused code revokes access immediately.
        try {
          store.getSessionParticipant(roomId, credential);
          if (store.getHistoryId(roomId) !== historyId) throw new Error('Expired room');
        } catch { socket.disconnect(true); return; }
        if (event.type === 'emoji_particle' || event.type === 'room_mood_update') {
          socket.emit(event.type, event.data);
        }
      });
      socket.once('disconnect', unsubscribe);
      socket.emit('room_mood_update', store.getRoomMood(roomId));
    } catch { socket.disconnect(true); }
    // Deliberately no inbound effect handlers: clients cannot spoof broadcasts.
  });
  const interval = setInterval(() => store.tickRoomMoods(), ROOM_MOOD_WINDOW_MS);
  interval.unref();
  server.once('close', () => { clearInterval(interval); void io.close(); });
  return io;
}
