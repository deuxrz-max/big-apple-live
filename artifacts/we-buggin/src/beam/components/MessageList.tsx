import { useEffect, useRef } from 'react';
import type { BeamMessage, Participant } from '../types';
import { ParticipantEmojiBadge } from './ParticipantEmojiBadge';

const time = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

interface Props {
  messages: BeamMessage[];
  participants: Participant[];
  selfId: string | null;
}

export function MessageList({ messages, participants, selfId }: Props) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="bm-empty" data-testid="empty-messages">
        <span className="bm-empty-emoji">🫥</span>
        <p>Quiet in here. Say something, or send a reaction.</p>
      </div>
    );
  }
  return (
    <ol className="bm-msgs" ref={ref} role="log" aria-live="polite" aria-label="Beam messages" data-testid="list-messages">
      {messages.map((m) => {
        if (m.kind === 'system') {
          return (
            <li key={m.id} className="bm-msg-sys">
              {m.text}
            </li>
          );
        }
        const live = participants.find((p) => p.id === m.authorId);
        const who = live ?? m.authorSnapshot;
        if (!who) return null;
        const mine = m.authorId === selfId;
        return (
          <li key={m.id} className={`bm-msg ${mine ? 'is-mine' : ''}`} data-testid={`message-${m.id}`}>
            <ParticipantEmojiBadge handle={who.handle} identity={who.identity} size="sm" />
            <div className="bm-msg-body">
              <div className="bm-msg-meta">
                <b>{who.handle}</b>
                <time>{time(m.ts)}</time>
              </div>
              {m.kind === 'reaction' ? <span className="bm-react">{m.text}</span> : <p>{m.text}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
