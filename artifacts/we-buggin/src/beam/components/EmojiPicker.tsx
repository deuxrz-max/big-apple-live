import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { Identity } from '../types';
import { validateHandle } from '../services/beamService';
import { IdentityGlyph } from './IdentityGlyph';
import { AVATAR_CHOICES, getPortrait, portraitIdentity, selectAvatarType } from '../portraits';

interface Props {
  title?: string;
  initialHandle?: string;
  initialIdentity?: Identity;
  confirmLabel?: string;
  /** Return an error string to keep the picker open. */
  onConfirm: (handle: string, identity: Identity) => string | null | void;
  onCancel: () => void;
}

export function EmojiPicker({ title = 'Pick your profile picture', initialHandle = '', initialIdentity, confirmLabel = 'Confirm picture', onConfirm, onCancel }: Props) {
  const [handle, setHandle] = useState(initialHandle);
  const [identity, setIdentity] = useState<Identity>(initialIdentity ?? portraitIdentity('ponytail-neutral'));
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    handleRef.current?.focus();
    handleRef.current?.select();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
      prev?.focus?.();
    };
  }, []);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCancel();
      return;
    }
    if (e.key !== 'Tab' || !dialogRef.current) return;
    const f = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled),input'));
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = validateHandle(handle);
    if (v) {
      setError(v);
      handleRef.current?.focus();
      return;
    }
    const res = onConfirm(handle.trim(), identity);
    if (typeof res === 'string') setError(res);
  };

  return (
    <div className="bm-modal-back" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div ref={dialogRef} className="bm-modal" role="dialog" aria-modal="true" aria-labelledby="bm-picker-title" onKeyDown={onKey} data-testid="dialog-identity">
        <form onSubmit={submit}>
          <header className="bm-modal-head">
            <h2 id="bm-picker-title">{title}</h2>
            <button type="button" className="bm-icon-btn" onClick={onCancel} aria-label="Close (Escape)" data-testid="button-picker-close">
              ✕
            </button>
          </header>

          <div className="bm-picker-top">
            <div className="bm-preview">
              <IdentityGlyph identity={identity} size={112} />
            </div>
            <div className="bm-picker-fields">
              <label className="bm-label" htmlFor="bm-handle">
                Handle
              </label>
              <input
                id="bm-handle"
                ref={handleRef}
                className="bm-input bm-input-box"
                value={handle}
                maxLength={12}
                onChange={(e) => {
                  setHandle(e.target.value);
                  setError(null);
                }}
                placeholder="2–12 characters"
                autoComplete="off"
                aria-invalid={!!error}
                data-testid="input-handle"
              />
              <p className="bm-you-are" aria-live="polite">
                You are now {handle.trim() || '…'} · {getPortrait(identity).label}
              </p>
            </div>
          </div>

          <div className="bm-label">Choose your avatar type</div>
          <p className="bm-you-are">Your expressions change through Mood Sync in chat.</p>
          <div className="bm-portrait-grid bm-avatar-types" role="radiogroup" aria-label="Avatar type">
            {AVATAR_CHOICES.map((choice) => (
              <button
                key={choice.style}
                type="button"
                role="radio"
                aria-checked={getPortrait(identity).style === choice.style}
                aria-label={choice.label}
                className={getPortrait(identity).style === choice.style ? 'is-on' : ''}
                onClick={() => setIdentity(selectAvatarType(identity, choice.style))}
                data-testid={`button-avatar-${choice.style}`}
              >
                <IdentityGlyph identity={portraitIdentity(choice.portraitId)} size={96} />
                <span>{choice.label}</span>
              </button>
            ))}
          </div>

          {error && (
            <p className="bm-error" role="alert" data-testid="text-picker-error">
              {error}
            </p>
          )}
          <footer className="bm-modal-foot">
            <button type="button" className="bm-btn" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="bm-btn bm-btn-primary" data-testid="button-confirm-identity">
              {confirmLabel}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
