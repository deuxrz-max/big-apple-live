import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'wouter';
import { EmojiPicker } from '../components/EmojiPicker';
import { checkJoinable, createBeam, isValidCode, joinBeam, normalizeCode, loadAccountProfile, beamIdentity, legacyIdentity } from '../services/beamService';
import type { AccountProfile } from '@workspace/api-client-react';
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
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let mounted = true;
    loadAccountProfile().then(p => { if (mounted) setProfile(p); })
      .catch(e => { if (mounted) setError(e instanceof Error ? e.message : 'Could not load account.'); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);
  const create = mode === 'create';

  const next = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || loading) return;
    setError(null);
    if (create) {
      if (value.trim().length < 2) return setError('Name your beam with at least 2 characters.');
    } else {
      if (!isValidCode(value)) return setError('Enter a six-character Beam code.');
      try {
        await checkJoinable(value);
      } catch (err) {
        return setError(err instanceof Error ? err.message : 'Could not join.');
      }
    }
    if (profile) await confirm(profile.username, beamIdentity(profile.identity));
    else setPicking(true);
  };

  const confirm = async (handle: string, identity: Identity): Promise<string | null> => {
    setBusy(true);
    try {
      const code = await (create ? createBeam(value, handle, identity, capacity) : joinBeam(value, handle, identity));
      onEntered(`You are now ${handle} · ${getPortrait(identity).label}`);
      navigate(`/beams/${code}`);
      return null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not enter the beam.';
      if (profile) setError(msg);
      if (err instanceof BeamError && err.code !== 'INVALID_HANDLE' && err.code !== 'HANDLE_TAKEN') {
        setPicking(false);
        setError(msg);
        return null;
      }
      return msg;
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="bm-entry">
      <Link href="/beams" className="bm-back">
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
            setValue(create ? e.target.value : normalizeCode(e.target.value).slice(0, 12));
            setError(null);
          }}
          placeholder={create ? 'Late Night Buggin' : 'ABC123'}
          maxLength={create ? 32 : 12}
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
        <button type="submit" disabled={busy || loading} className="bm-btn bm-btn-primary bm-btn-lg" data-testid="button-continue">
          {busy ? 'Joining…' : loading ? 'Loading account…' : create ? 'Go live' : profile ? 'Join beam' : 'Choose your picture'}
        </button>
        <p className="bm-demo-note">{profile ? `Joining as ${profile.username}. Your current mood stays saved.` : 'Choose your dedicated account name and picture next.'}</p>
      </form>
      {picking && <EmojiPicker title="Pick your account picture" initialIdentity={legacyIdentity()} onConfirm={confirm} onCancel={() => setPicking(false)} confirmLabel={create ? `Confirm and start · ${capacity} per beam` : 'Confirm and join'} />}
    </main>
  );
}
