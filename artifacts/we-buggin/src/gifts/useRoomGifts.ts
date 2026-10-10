import { useEffect, useMemo, useRef, useState } from 'react';
import { useGetRoomGiftEvents, getGetRoomGiftEventsQueryKey, type RoomGiftEvent } from '@workspace/api-client-react';

const EMPTY: RoomGiftEvent[] = [];
export function useRoomGifts(roomId: string, userId: string, sessionId: string, ignored: Set<string>) {
  const query = useGetRoomGiftEvents(roomId, {
    request: { headers: { 'X-Room-Session': sessionId } },
    query: {
      enabled: !!sessionId, refetchInterval: 2000, refetchOnWindowFocus: 'always',
      queryKey: [...getGetRoomGiftEventsQueryKey(roomId), 'user', userId, 'session', sessionId],
    },
  });
  const events = useMemo(() => (query.data?.events ?? EMPTY).filter(e => !ignored.has(e.senderUsername)), [query.data?.events, ignored]);
  const [queue, setQueue] = useState<RoomGiftEvent[]>([]);
  const seen = useRef(new Set<string>());
  useEffect(() => { seen.current = new Set(); setQueue([]); }, [roomId, userId]);
  useEffect(() => {
    const fresh: RoomGiftEvent[] = [];
    for (const event of events) {
      if (seen.current.has(event.id)) continue;
      seen.current.add(event.id);
      const age = Date.now() - new Date(event.createdAt).getTime();
      if (!document.hidden && event.giftId === 'spirit-pup' && age >= -5000 && age <= 10000) fresh.push(event);
    }
    if (fresh.length) setQueue(prev => [...prev, ...fresh]);
  }, [events]);
  return { events, animation: queue[0], finish: () => setQueue(prev => prev.slice(1)) };
}
