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
      const age = Date.now() - new Date(event.createdAt).getTime();
      const supportedGift = (
        event.giftId === 'heart' || event.giftId === 'spirit-pup' || event.giftId === 'moonfox'
        || event.giftId === 'cosmic-encore' || event.giftId === 'fireworks'
        || event.giftId === 'rose-shower' || event.giftId === 'whip'
      );
      if (!supportedGift || age < -5000 || age > 10000) {
        seen.current.add(event.id);
        continue;
      }
      if (document.hidden) continue;
      seen.current.add(event.id);
      fresh.push(event);
    }
    if (fresh.length) {
      fresh.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id.localeCompare(b.id));
      setQueue(prev => [...prev, ...fresh]);
    }
  }, [events]);
  const activeId = queue[0]?.id;
  const finish = () => {
    if (!activeId) return;
    setQueue(prev => prev[0]?.id === activeId ? prev.slice(1) : prev);
  };
  return { events, animation: queue[0], finish };
}
