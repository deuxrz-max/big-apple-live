import { useEffect, useRef, type ReactNode } from 'react';

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
  const roomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const app = roomRef.current?.closest<HTMLElement>('.beam-app');
    if (!app) return;
    const viewport = window.visualViewport;
    const resize = () => {
      const height = Math.min(window.innerHeight, viewport?.height ?? window.innerHeight);
      app.style.setProperty('--bm-viewport-height', `${height}px`);
      app.toggleAttribute('data-bm-compact', height < 500);
    };
    resize();
    window.addEventListener('resize', resize);
    viewport?.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      viewport?.removeEventListener('resize', resize);
      app.style.removeProperty('--bm-viewport-height');
      app.removeAttribute('data-bm-compact');
    };
  }, []);
  return (
    <div className="bm-room" ref={roomRef}>
      <header className="bm-room-head">
        <div>
          <h1 className="bm-room-name" title={name} data-testid="text-room-name">
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
