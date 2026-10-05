import { useRef, useState, type FormEvent } from 'react';
import { FACE_MOODS } from '../moodSync';

export const REACTIONS = ['🔥', '😂', '💀', '👀', '🫡', '❤️'];
const TRAY = [...Object.keys(FACE_MOODS), '😀', '😎', '🥲', '🤝', '🙏', '💯', '✨', '🎧', '🫠', '🤯', '🥶', '🍕', '🪩', '🛹', '🌙', '👑'];

interface Props {
  onSend: (text: string) => Promise<boolean>;
  onReact: (emoji: string) => Promise<unknown>;
  error?: string | null;
}

export function MessageInput({ onSend, onReact, error }: Props) {
  const [text, setText] = useState('');
  const [tray, setTray] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const empty = text.trim().length === 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (empty || busy) return;
    setBusy(true);
    try {
      if (!await onSend(text)) return;
      setText('');
      setTray(false);
    } finally { setBusy(false); }
  };

  return (
    <div className="bm-composer">
      <div className="bm-reacts" role="group" aria-label="Quick reactions">
        {REACTIONS.map((r) => (
          <button key={r} type="button" disabled={busy} className="bm-react-btn" onClick={async () => {
            setBusy(true);
            try { await onReact(r); } finally { setBusy(false); }
          }} aria-label={`React ${r}`} data-testid={`button-react-${r}`}>
            {r}
          </button>
        ))}
      </div>
      {tray && (
        <div className="bm-tray" role="group" aria-label="Insert emoji" onKeyDown={(e) => e.key === 'Escape' && (setTray(false), inputRef.current?.focus())}>
          {TRAY.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => {
                setText((t) => t + r);
                inputRef.current?.focus();
              }}
              aria-label={`Insert ${r}`}
            >
              {r}
            </button>
          ))}
        </div>
      )}
      <form className="bm-input-row" onSubmit={submit}>
        <button
          type="button"
          className={`bm-icon-btn ${tray ? 'is-on' : ''}`}
          onClick={() => setTray((v) => !v)}
          aria-expanded={tray}
          aria-label="Open emoji picker"
          data-testid="button-emoji-picker"
        >
          😀
        </button>
        <input
          ref={inputRef}
          className="bm-input"
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          placeholder="Say it…"
          maxLength={280}
          aria-label="Message"
          autoComplete="off"
          data-testid="input-message"
        />
        <button type="submit" className="bm-btn bm-btn-primary" disabled={empty || busy} data-testid="button-send">
          Send
        </button>
      </form>
      {error && (
        <p className="bm-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
