import { useEffect, useRef } from 'react';

export function HeartAnimation({ onFinish }: { onFinish: () => void }) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finished = useRef(false);
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    onFinishRef.current();
  };

  useEffect(() => {
    const timer = window.setTimeout(finish, 2000);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="spirit-overlay heart-gift-overlay" aria-hidden="true" data-testid="heart-animation">
      <span
        className={`heart-gift-animation${reducedMotion ? ' is-reduced-motion' : ''}`}
        onAnimationEnd={finish}
      >
        ❤️
      </span>
    </div>
  );
}
