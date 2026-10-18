import { useLayoutEffect, useRef } from 'react';
import type { BeamMessage, Participant } from '../types';
import { ParticipantEmojiBadge } from './ParticipantEmojiBadge';
import { ShinyName } from '@/components/ShinyName';

const time = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

interface Props {
  messages: BeamMessage[];
  participants: Participant[];
  selfId: string | null;
}

export function MessageList({ messages, participants, selfId }: Props) {
  const ref = useRef<HTMLOListElement>(null);
  const following = useRef(true);
  const lastMessageId = messages.at(-1)?.id;
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && following.current) el.scrollTop = el.scrollHeight;
  }, [lastMessageId]);

  if (messages.length === 0) {
    return (
      <div className="bm-empty" data-testid="empty-messages">
        <span className="bm-empty-emoji">🫥</span>
        <p>Quiet in here. Say something, or send a reaction.</p>
      </div>
    );
  }
  return (
    <ol className="bm-msgs" ref={ref} role="log" aria-live="polite" aria-label="Beam messages" tabIndex={0}
      onScroll={event => {
        const el = event.currentTarget;
        following.current = el.scrollHeight - el.clientHeight - el.scrollTop <= 32;
      }}
      data-testid="list-messages">
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
            <ParticipantEmojiBadge handle={who.handle} displayNameColor={who.displayNameColor} displayNameTierIndex={who.displayNameTierIndex} identity={who.identity} size="sm" />
            <div className="bm-msg-body">
              <div className="bm-msg-meta">
               <b><ShinyName displayNameColor={who.displayNameColor} displayNameTierIndex={who.displayNameTierIndex}>{who.handle}</ShinyName></b>
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
