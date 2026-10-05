import type { ReactNode } from 'react';

interface Props {
  name: string;
  actions: ReactNode;
  notice?: ReactNode;
  roster: ReactNode;
  stream: ReactNode;
  composer: ReactNode;
  demo?: ReactNode;
}

export function BeamRoomLayout({ name, actions, notice, roster, stream, composer, demo }: Props) {
  return (
    <div className="bm-room">
      <header className="bm-room-head">
        <div>
          <h1 className="bm-room-name" data-testid="text-room-name">
            {name}
          </h1>
        </div>
        <div className="bm-room-actions">{actions}</div>
      </header>
      {notice}
      <div className="bm-room-body">
        <section className="bm-roster-col" aria-label="Participants">
          {roster}
          {demo}
        </section>
        <section className="bm-stream-col" aria-label="Conversation">
          <div className="bm-stream">{stream}</div>
          {composer}
        </section>
      </div>
    </div>
  );
}
