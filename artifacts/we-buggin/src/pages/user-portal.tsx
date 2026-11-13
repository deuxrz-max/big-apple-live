import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useClerk } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetMyProfileQueryKey,
  getGetRoomQueryKey,
  useCreateAccountRoom,
  useGetMyProfile,
  useJoinAccountRoom,
  useSaveMyProfile,
  type RoomSession,
} from '@workspace/api-client-react';
import { Attribution, Wordmark } from '@/components/brand';
import { IdentityEditor } from '@/components/identity-editor';
import { IdentityAvatar, errMessage, errStatus, type Identity } from '@/lib/identity';
import { saveCreds } from '@/lib/room-creds';

const USERNAME_RE = /^[A-Za-z0-9_]{3,24}$/;
const START: Identity = { emojiId: '1F600', gender: 'Female', color: '#F7C531', hairColor: '#E8187F' };

export default function UserPortal({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const { signOut } = useClerk();
  const [, setLocation] = useLocation();
  const profileQ = useGetMyProfile();
  const profile = profileQ.data?.profile ?? null;
  const [username, setUsername] = useState('');
  const [identity, setIdentity] = useState<Identity>(START);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [code, setCode] = useState('');
  const [roomTitle, setRoomTitle] = useState('');
  const save = useSaveMyProfile();
  const create = useCreateAccountRoom();
  const join = useJoinAccountRoom();

  useEffect(() => {
    if (profile) setIdentity(profile.identity);
  }, [profile?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const showForm = !profile || editing;
  const nameOk = profile ? true : USERNAME_RE.test(username);

  const onSave = () => {
    setSaved(false);
    save.mutate(
      { data: { username: profile?.username ?? username, identity } },
      {
        onSuccess: (p) => {
          qc.setQueryData(getGetMyProfileQueryKey(), { profile: p });
          setEditing(false);
          setSaved(true);
          if (!profile) setLocation('/home');
        },
      },
    );
  };

  const enter = (s: RoomSession) => {
    saveCreds(userId, s.room.roomId, { participantSessionId: s.participantSessionId, participantId: s.participantId });
    qc.setQueryData(getGetRoomQueryKey(s.room.roomId), s.room);
    setLocation(`/rooms/${encodeURIComponent(s.room.roomId)}`);
  };

  const saveErr = save.error
    ? errStatus(save.error) === 409
      ? 'That username is taken, or your username cannot be changed once claimed.'
      : errMessage(save.error)
    : null;
  const roomErr = create.error ?? join.error;
  const trimmedRoomTitle = roomTitle.trim();
  const roomTitleHasWhitespace = /\s/u.test(trimmedRoomTitle);
  const roomTitleIsTooLong = trimmedRoomTitle.length > 32;
  const roomTitleIsValid = trimmedRoomTitle.length > 0 && !roomTitleHasWhitespace && !roomTitleIsTooLong;

  return (
    <div className="min-h-[100dvh]">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-5 py-5">
        <Wordmark href="/user-portal" />
        <button type="button" className="btn" onClick={() => setLocation('/home')} data-testid="button-discovery-home">Home</button>
        <button type="button" className="btn" onClick={() => signOut({ redirectUrl: import.meta.env.BASE_URL || '/' })} data-testid="button-sign-out">Sign out</button>
      </header>

      <main className="mx-auto max-w-5xl space-y-8 px-5">
        {profileQ.isLoading && <div className="sticker h-64 animate-pulse bg-muted" data-testid="status-loading" />}
        {profileQ.isError && (
          <div className="sticker p-6" role="alert">
            <p className="font-bold">Could not load your account.</p>
            <button type="button" className="btn mt-3" onClick={() => profileQ.refetch()} data-testid="button-retry-profile">Retry</button>
          </div>
        )}

        {profileQ.data && (
          <>
            {profile && !editing && (
              <section className="sticker rise flex flex-wrap items-center gap-5 bg-secondary/50 p-5">
                <IdentityAvatar identity={profile.identity} size={120} />
                <div className="flex-1">
                  <p className="label-mono">You are</p>
                  <h1 className="font-display text-4xl font-extrabold" data-testid="text-username">{profile.username}</h1>
                  {saved && <p className="mt-1 text-sm font-bold" role="status">Saved. Active rooms see your new look.</p>}
                </div>
                <button type="button" className="btn" onClick={() => { setEditing(true); setSaved(false); }} data-testid="button-edit-identity">Edit identity</button>
              </section>
            )}

            {showForm && (
              <section className="sticker rise p-5 sm:p-7">
                <h1 className="font-display text-4xl font-extrabold">{profile ? 'Edit your identity' : 'Make your identity'}</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {profile ? 'Choose Male / Spiky hair or Female / Ponytail. Your username stays the same.' : 'Pick a username and one of the two avatar types. Once claimed your username cannot be renamed.'}
                </p>
                <div className="mt-5 max-w-sm">
                  <label htmlFor="username" className="label-mono">Username</label>
                  <input
                    id="username"
                    className="field mt-1 font-mono"
                    value={profile ? profile.username : username}
                    readOnly={!!profile}
                    maxLength={24}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(e) => setUsername(e.target.value)}
                    aria-invalid={!nameOk && username.length > 0}
                    data-testid="input-username"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">3 to 24 letters, digits or underscores. Not case sensitive when checking for duplicates.</p>
                </div>
                <div className="mt-6"><IdentityEditor value={identity} onChange={setIdentity} /></div>
                {saveErr && <p className="mt-4 font-bold text-destructive" role="alert" data-testid="text-save-error">{saveErr}</p>}
                <div className="mt-6 flex gap-3">
                  <button type="button" className="btn btn-pink" disabled={!nameOk || save.isPending} onClick={onSave} data-testid="button-save-identity">
                    {save.isPending ? 'Saving...' : profile ? 'Save changes' : 'Claim name and save'}
                  </button>
                  {profile && <button type="button" className="btn" onClick={() => { setEditing(false); setIdentity(profile.identity); save.reset(); }} data-testid="button-cancel-edit">Cancel</button>}
                </div>
              </section>
            )}

            <section className="grid gap-5 md:grid-cols-2" aria-label="Rooms">
              <form className="sticker bg-primary/15 p-5" onSubmit={(event) => {
                event.preventDefault();
                if (roomTitleIsValid) {
                  create.mutate({ data: { name: trimmedRoomTitle, capacity: 9 } }, { onSuccess: enter });
                }
              }}>
                <h2 className="font-display text-3xl font-extrabold">Start a room</h2>
                <p className="mt-1 text-sm">Choose a one-word room name.</p>
                <label htmlFor="portal-room-title" className="label-mono mt-3 block">Room name</label>
                <input id="portal-room-title" className="field mt-1" value={roomTitle}
                  onChange={event => setRoomTitle(event.target.value)} maxLength={64}
                  autoComplete="off" spellCheck={false} placeholder="For example, Gold"
                  aria-invalid={roomTitleHasWhitespace || roomTitleIsTooLong} data-testid="input-portal-room-title" />
                {roomTitleHasWhitespace && <p className="mt-1 text-sm font-bold text-destructive" role="alert">Use one word only.</p>}
                {roomTitleIsTooLong && <p className="mt-1 text-sm font-bold text-destructive" role="alert">Room names must be 32 characters or fewer.</p>}
                <button type="submit" className="btn btn-pink mt-4" disabled={!profile || !roomTitleIsValid || create.isPending} data-testid="button-create-room">
                  {create.isPending ? 'Opening...' : 'Create room'}
                </button>
              </form>
              <form
                className="sticker bg-accent/25 p-5"
                onSubmit={(e) => { e.preventDefault(); if (code.trim()) join.mutate({ roomId: code.trim() }, { onSuccess: enter }); }}
              >
                <h2 className="font-display text-3xl font-extrabold">Join a room</h2>
                <label htmlFor="room-code" className="label-mono mt-1 block">Room code</label>
                <div className="mt-1 flex gap-2">
                  <input id="room-code" className="field font-mono" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" spellCheck={false} data-testid="input-room-code" />
                  <button type="submit" className="btn btn-blue" disabled={!profile || !code.trim() || join.isPending} data-testid="button-join-room">{join.isPending ? '...' : 'Join'}</button>
                </div>
              </form>
              {!profile && <p className="text-sm font-bold md:col-span-2" data-testid="text-need-identity">Claim your name above to create or join rooms.</p>}
              {roomErr && <p className="font-bold text-destructive md:col-span-2" role="alert" data-testid="text-room-error">{errStatus(roomErr) === 404 ? 'No active room with that code.' : errMessage(roomErr)}</p>}
            </section>
          </>
        )}
      </main>
      <Attribution />
    </div>
  );
}
