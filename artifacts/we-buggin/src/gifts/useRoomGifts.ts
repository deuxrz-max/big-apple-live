import { useEffect, useRef, useState } from 'react';
import { getRoomGiftEvents, type RoomGiftEvent } from '@workspace/api-client-react';
import { appendUniqueGiftEvents, finishGiftQueueItem } from './gift-combo-policy';

export function useRoomGifts(roomId: string, userId: string, sessionId: string, ignored: Set<string>) {
  const [events, setEvents] = useState<RoomGiftEvent[]>([]);
  const [queue, setQueue] = useState<RoomGiftEvent[]>([]);
  const ignoredRef = useRef(ignored);
  ignoredRef.current = ignored;
  useEffect(() => {
    setEvents([]);
    setQueue([]);
  }, [roomId, userId, sessionId]);
  useEffect(() => {
    if (!sessionId) return;
    let disposed = false;
    let polling = false;
    let cursor: string | null = null;
    let retryTimer: number | undefined;
    const firstSeenAt = new Date(Date.now() - 10_000).toISOString();
    const drainEvents = async () => {
      if (disposed || polling) return;
      polling = true;
      try {
        let more = true;
        while (!disposed && more) {
          const page = await getRoomGiftEvents(
            roomId,
            cursor ? { after: cursor } : { since: firstSeenAt },
            { headers: { 'X-Room-Session': sessionId } },
          );
          if (disposed) return;
          const fresh = page.events.filter(event => !ignoredRef.current.has(event.senderUsername));
          if (fresh.length) {
            setEvents(current => appendUniqueGiftEvents(current, fresh).slice(-60));
            setQueue(current => appendUniqueGiftEvents(current, fresh));
          }
          cursor = page.nextCursor ?? cursor;
          more = page.hasMore;
        }
      } catch (error) {
        console.warn('Room gifts could not be polled; the next poll will retry.', error);
      } finally {
        polling = false;
      }
    };
    void drainEvents();
    retryTimer = window.setInterval(() => void drainEvents(), 2000);
    return () => {
      disposed = true;
      if (retryTimer !== undefined) window.clearInterval(retryTimer);
    };
  }, [roomId, sessionId, userId]);
  const activeId = queue[0]?.id;
  const finish = () => {
    if (!activeId) return;
    setQueue(prev => finishGiftQueueItem(prev, activeId));
  };
  return { events, animation: queue[0], waitingCount: Math.max(0, queue.length - 1), finish };
}
