import { useState, type FormEvent } from 'react';
import { Link, useLocation } from 'wouter';
import { EmojiPicker } from '../components/EmojiPicker';
import { checkJoinable, createBeam, isValidCode, joinBeam, normalizeCode } from '../services/beamService';
import { BeamError, type BeamCapacity, type Identity } from '../types';
import { getPortrait, portraitIdentity } from '../portraits';
import { BeamSizePicker } from '../components/BeamSizePicker';

interface Props {
  mode: 'create' | 'join';
  initialCode?: string;
  onEntered: (notice: string) => void;
}

export function EntryPage({ mode, initialCode = '', onEntered }: Props) {
  const [, navigate] = useLocation();
  const [value, setValue] = useState(initialCode);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [capacity, setCapacity] = useState<BeamCapacity>(4);
  const create = mode === 'create';

  const next = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (create) {
      if (value.trim().length < 2) return setError('Name your beam with at least 2 characters.');
    } else {
      if (!isValidCode(value)) return setError('Codes are 6 characters, letters and numbers.');
      try {
        checkJoinable(value);
      } catch (err) {
        return setError(err instanceof BeamError ? err.message : 'Could not join.');
      }
    }
    setPicking(true);
  };

  const confirm = (handle: string, identity: Identity): string | null => {
    try {
      const code = create ? createBeam(value, handle, identity, capacity) : joinBeam(value, handle, identity);
      onEntered(`You are now ${handle} · ${getPortrait(identity).label}`);
      navigate(`/beams/${code}`);
      return null;
    } catch (err) {
      const msg = err instanceof BeamError ? err.message : 'Could not enter the beam.';
      if (err instanceof BeamError && err.code !== 'INVALID_HANDLE' && err.code !== 'HANDLE_TAKEN') {
        setPicking(false);
        setError(msg);
        return null;
      }
      return msg;
    }
  };

  return (
    <main className="bm-entry">
      <Link href="/" className="bm-back">
        ← Back
      </Link>
      <h1 className="bm-h1">{create ? 'Start a beam' : 'Join a beam'}</h1>
      <p className="bm-lede">{create ? 'Set it up: pick the size, name it. You get a code to share.' : 'Enter the 6-character code.'}</p>
      <form onSubmit={next} className="bm-form" noValidate>
        {create && <BeamSizePicker value={capacity} onChange={setCapacity} host={portraitIdentity('kiss')} />}
        <label className="bm-label" htmlFor="bm-field">
          {create ? 'Beam name' : 'Beam code'}
        </label>
        <input
          id="bm-field"
          className={`bm-input bm-input-box bm-input-lg ${create ? '' : 'bm-code'}`}
          value={value}
          onChange={(e) => {
            setValue(create ? e.target.value : normalizeCode(e.target.value).slice(0, 6));
            setError(null);
          }}
          placeholder={create ? 'Late Night Buggin' : 'ABC123'}
          maxLength={create ? 32 : 6}
          autoFocus={!create}
          autoComplete="off"
          aria-invalid={!!error}
          data-testid="input-entry"
        />
        {error && (
          <p className="bm-error" role="alert" data-testid="text-entry-error">
            {error}
          </p>
        )}
        <button type="submit" className="bm-btn bm-btn-primary bm-btn-lg" data-testid="button-continue">
          {create ? 'Go live' : 'Choose your picture'}
        </button>
        {create && <p className="bm-demo-note">Next you pick your handle and picture. Demo only, nobody is streamed.</p>}
      </form>
      <p className="bm-demo-note">Frontend demo / simulated participants. Nothing leaves this browser.</p>
      {picking && <EmojiPicker title="Pick your profile picture" onConfirm={confirm} onCancel={() => setPicking(false)} confirmLabel={create ? `Confirm and start · ${capacity} per beam` : 'Confirm and join'} />}
    </main>
  );
}
