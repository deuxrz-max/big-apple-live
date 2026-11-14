import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { LogOut, Mic, MicOff, X } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { RoomChannelBack } from './RoomChannels';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetUniversitySessionQueryKey, useAcknowledgeUniversityRules, useGetUniversitySession,
  useSetSocialRelationship, useSetUniversityIgnore,
} from '@workspace/api-client-react';
import { photoSrc, UserPhoto } from '@/components/user-photo';
import { useQuickProfile } from '@/profile/QuickProfile';
import { ShinyName } from '@/components/ShinyName';
import { errMessage } from '@/lib/errors';
import { IdentityAvatar } from '@/lib/identity';
import { useTextRoom } from './useTextRoom';
import { BeamAudioTrack, useUniversityVideoBeam } from './useUniversityVideoBeam';
import { isRoomMicEnabled } from './room-audio-policy';
import { arrangeAudioSeats } from './audio-seat-layout';
import { BotShield } from './BotShield';
import { SafetyReportDialog } from '@/safety/SafetyReportDialog';
import './university-room.css';
import { RoomPerimeter } from './RoomPerimeter';
import './bot-moderation.css';

const RULES = "Stick to the room's topic. Be kind — no harassment or hate. Nothing sexual or explicit in room conversation, names or photos. Don't share real names, phone numbers, addresses or other contact details. Use Ignore on anyone bothering you, or Block and Report for anything serious. Help keep the room welcoming for everyone.";

type Target = {
  username: string;
  displayName: string;
  participantId?: string;
  botId?: string | null;
  displayNameColor?: string;
  displayNameTierIndex?: number;
  photoUrl?: string | null;
  isHost?: boolean;
};
type ReportTarget = {
  targetType: 'user';
  targetUsername: string;
  roomId: string;
};

export function TextChatRoom({ roomId, userId }: { roomId: string; userId: string }) {
  const qc = useQueryClient();
  const [, nav] = useLocation();
  const r = useTextRoom(roomId, userId);
  const sessionId = r.creds?.participantSessionId ?? '';
  const participantId = r.creds?.participantId ?? '';
  const sessionKey = [...getGetUniversitySessionQueryKey(roomId), 'user', userId] as const;
  const headers = { 'X-Room-Session': sessionId };
  const uni = useGetUniversitySession(roomId, {
    request: { headers },
    query: { enabled: !!sessionId, refetchInterval: 3000, queryKey: sessionKey },
  });
  const session = uni.data;
  const videoBeam = useUniversityVideoBeam(roomId, sessionId, participantId);
  const ownMicEnabled = isRoomMicEnabled(videoBeam.ownSlot);
  const toggleOwnMic = useCallback((enabled: boolean) => {
    void videoBeam.toggleMic(enabled);
  }, [videoBeam.toggleMic]);
  const leaveOwnSeat = useCallback(() => {
    void videoBeam.leaveSlot();
  }, [videoBeam.leaveSlot]);
  const ignoreMut = useSetUniversityIgnore({ request: { headers } });
  const ack = useAcknowledgeUniversityRules();
  const block = useSetSocialRelationship();
  const quickProfile = useQuickProfile();

  const [note, setNote] = useState<string | null>(null);
  const [reporting, setReporting] = useState<ReportTarget | null>(null);
  const [menu, setMenu] = useState<Target | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [ignored, setIgnored] = useState<Set<string>>(new Set());
  const ignoreBusy = useRef(0);
  const autoRules = useRef(false);
  const ignoreVersion = useRef<string | null>(null);
  const peopleBtn = useRef<HTMLButtonElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const drawerBox = useRef<HTMLElement>(null);
  const menuBox = useRef<HTMLDivElement>(null);
  const rulesBox = useRef<HTMLDivElement>(null);
  const isSocialRoom = r.room?.roomType === 'social';

  useEffect(() => {
    setMenu(null); setDrawer(false); setRulesOpen(false);
    setIgnored(new Set()); setNote(null);
    autoRules.current = false; ignoreVersion.current = null;
  }, [roomId, userId]);
  useEffect(() => {
    if (r.roomUnavailable) nav('/community');
  }, [r.roomUnavailable, nav]);
  useEffect(() => {
    if (session && ignoreBusy.current === 0) {
      setIgnored(new Set(session.ignoredUsernames));
      const version = [...session.ignoredUsernames].sort().join('|');
      if (ignoreVersion.current !== null && ignoreVersion.current !== version) void r.refresh();
      ignoreVersion.current = version;
    }
  }, [session]);
  useEffect(() => {
    if (session && !session.rulesSeen && !autoRules.current) { autoRules.current = true; setRulesOpen(true); }
  }, [session]);
  useEffect(() => {
    if (!drawer && !menu && !rulesOpen) return;
    const dialog = menu ? menuBox.current : rulesOpen ? rulesBox.current : drawerBox.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    const focusable = () => [...(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),[tabindex="0"]') ?? [])]
      .filter(el => el.offsetParent !== null);
    focusable()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        const elements = focusable();
        const first = elements[0], last = elements.at(-1);
        if (first && (e.shiftKey ? document.activeElement === first : document.activeElement === last)) {
          e.preventDefault(); (e.shiftKey ? last : first)?.focus();
        }
      }
      if (e.key !== 'Escape') return;
      if (menu) setMenu(null); else if (rulesOpen) dismissRules(); else closeDrawer();
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); previousFocus?.focus(); };
  }, [drawer, menu, rulesOpen]);
  useEffect(() => { if (drawer) closeBtn.current?.focus(); }, [drawer]);
  const closeDrawer = () => { setDrawer(false); peopleBtn.current?.focus(); };
  function dismissRules() {
    if (ack.isPending) return;
    ack.mutate(undefined, { onSuccess: () => {
      setRulesOpen(false);
      qc.invalidateQueries({ queryKey: getGetUniversitySessionQueryKey(roomId) });
    } });
  }

  const people = session?.people ?? [];
  const me = people.find((p) => p.self);
  const beamSlots = [...videoBeam.beam.slots].sort((a, b) => a.slotNumber - b.slotNumber);
  const roomHostParticipantId = isSocialRoom
    ? r.room?.hostParticipantId ?? videoBeam.beam.hostParticipantId
    : videoBeam.beam.hostParticipantId;
  const canModerateRoom = !!me?.moderator
    || (isSocialRoom && !!participantId && roomHostParticipantId === participantId);
  const handleOwnSeatTap = () => toggleOwnMic(!ownMicEnabled);
  const menuIsSelf = !!me && menu?.username.toLowerCase() === me.username.toLowerCase();
  const beamSeatLayout = isSocialRoom
    ? beamSlots.slice(0, 4).map((slot, i) => ({ slot, area: 'grid' as const, gridColumn: (i % 2) + 1, gridRow: Math.floor(i / 2) + 1 }))
    : arrangeAudioSeats(beamSlots, roomHostParticipantId);
  const speakerCount = beamSlots.filter(slot => slot.participantId).length;
  const isSelf = (username: string, authorId?: string) => (!!authorId && authorId === r.creds?.participantId) || me?.username === username;
  const nameColorOf = (username: string, fallback?: string) => people.find((p) => p.username === username)?.displayNameColor ?? fallback ?? '#FFFFFF';

  const toggleIgnore = (t: Target) => {
    const next = !ignored.has(t.username);
    ignoreBusy.current++;
    setIgnored((prev) => { const s = new Set(prev); if (next) s.add(t.username); else s.delete(t.username); return s; });
    setMenu(null); setNote(null);
    ignoreMut.mutate({ username: t.username, data: { active: next } }, {
      onSuccess: () => {
        ignoreBusy.current--;
        setNote(next ? `Ignoring ${t.displayName}.` : `Stopped ignoring ${t.displayName}.`);
        qc.invalidateQueries({ queryKey: getGetUniversitySessionQueryKey(roomId) });
        r.refresh();
      },
      onError: (e) => {
        ignoreBusy.current--;
        setIgnored((prev) => { const s = new Set(prev); if (next) s.delete(t.username); else s.add(t.username); return s; });
        setNote(errMessage(e));
      },
    });
  };
  const openMenu = (username: string, displayName: string, authorId?: string, displayNameColor?: string, displayNameTierIndex?: number) => {
    const person = people.find(candidate => candidate.username.toLowerCase() === username.toLowerCase());
    if (!isSelf(username, authorId) || isSocialRoom) setMenu({
      username, displayName,
      participantId: person?.participantId,
      botId: person?.botId,
      photoUrl: person?.photoUrl ?? null,
      displayNameColor: displayNameColor ?? nameColorOf(username),
      displayNameTierIndex: displayNameTierIndex ?? person?.displayNameTierIndex ?? 0,
    });
  };

  const peopleList = (
    <>
      <div className="ur-people-head">
        <h2 id="ur-people-title">People · {people.length}</h2>
        <button type="button" ref={closeBtn} className="bm-btn bm-btn-sm ur-close" onClick={closeDrawer}>Close</button>
      </div>
      {uni.isLoading && <p role="status" className="ch-note">Loading people...</p>}
      {uni.isError && <div className="ch-err" role="alert">Could not load people. <button type="button" className="bm-btn bm-btn-sm" onClick={() => uni.refetch()}>Retry</button></div>}
      {session && people.length === 0 && <p className="ch-note">Nobody else is here yet.</p>}
      <ul className="ur-people">
        {people.map((p) => {
          if (p.botId) return (
            <li key={p.participantId}><div className="ur-prow" data-testid={`row-bot-${p.botId}`}>
              <UserPhoto username={p.username} displayName={p.displayName} photoUrl={p.photoUrl} size={36} />
              <Link href={`/community/bots/${p.botId}`} className="ur-pname ur-bot-name" data-testid={`link-bot-${p.botId}`}><span>{p.displayName}</span><BotShield botId={p.botId} /></Link>
            </div></li>
          );
          const ign = ignored.has(p.username);
          return (
            <li key={p.participantId}>
              <div className="ur-prow">
                {<button type="button" className="ur-person-avatar" aria-label={`Open profile for ${p.displayName}`}
                    aria-haspopup="dialog"
                    onClick={() => isSocialRoom
                      ? openMenu(p.username, p.displayName, p.participantId, p.displayNameColor, p.displayNameTierIndex)
                      : quickProfile?.open(p.username)}
                    data-testid={`button-person-avatar-${p.username}`}><UserPhoto username={p.username} displayName={p.displayName} photoUrl={p.photoUrl} size={36} reviewStatus={p.photoStatus ?? undefined} /></button>}
                <span className="ur-pname">
                  {p.self
                    ? isSocialRoom
                      ? <button type="button" className="ur-pname-text ur-person-name-action" aria-haspopup="dialog"
                          onClick={() => openMenu(p.username, p.displayName, p.participantId, p.displayNameColor, p.displayNameTierIndex)}>
                          <ShinyName displayNameColor={p.displayNameColor} displayNameTierIndex={p.displayNameTierIndex}>{p.displayName}</ShinyName><em> (you)</em>
                        </button>
                      : <span className="ur-pname-text"><ShinyName displayNameColor={p.displayNameColor} displayNameTierIndex={p.displayNameTierIndex}>{p.displayName}</ShinyName><em> (you)</em></span>
                    : <button type="button" className="ur-pname-text ur-person-name-action"
                        aria-haspopup={isSocialRoom ? 'dialog' : 'menu'}
                        onClick={() => openMenu(p.username, p.displayName, p.participantId, p.displayNameColor, p.displayNameTierIndex)}
                        data-testid={`button-person-${p.username}`}><ShinyName displayNameColor={p.displayNameColor} displayNameTierIndex={p.displayNameTierIndex}>{p.displayName}</ShinyName></button>}
                  {p.moderator && <span className="ur-badge">Moderator</span>}
                  {ign && <span className="ur-ign">Ignored</span>}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );

  if (r.roomUnavailable) {
    return <main className="ch ch-university ur" role="status">
      <p>This room is no longer available. Returning to the Directory.</p>
      <Link className="bm-btn bm-btn-primary" href="/community">Go to Directory</Link>
    </main>;
  }

  return (
    <div className="ch ch-university ur">
      <RoomPerimeter />
      <div className="ch-in ur-in">
        <RoomChannelBack roomId={roomId} />
        <div className="ur-head">
          <button type="button" ref={peopleBtn} className="bm-btn bm-btn-sm ur-people-btn" aria-haspopup="dialog" aria-expanded={drawer} onClick={() => setDrawer(true)} data-testid="button-people">People · {people.length}</button>
          {!isSocialRoom && <div className="ur-titlebox">
            <h1 className="ch-title ur-title" aria-label={r.room?.name ?? 'Room'} data-testid="text-university-name">
              {(r.room?.name ?? 'Room').split(/\s+/).map((w, i) => (
                <span className="ch-word" key={`${w}-${i}`} style={{ animationDelay: `${i * 140}ms` }}>{w}</span>
              ))}
            </h1>
            {session?.topic && <p className="ur-topic" title={session.topic} data-testid="text-topic">{session.topic}</p>}
          </div>}
          <button type="button" className="bm-btn bm-btn-sm ur-rules-btn" onClick={() => setRulesOpen(true)} data-testid="button-rules">Rules</button>
        </div>
        {r.error && <div className="ch-err" role="alert">{r.error} <Link href="/user-portal" className="bm-link">Profile</Link></div>}
        {r.overflow && <p><Link className="bm-btn bm-btn-primary" href={`/rooms/${encodeURIComponent(r.overflow.roomId)}`}>Enter {r.overflow.label}</Link></p>}
        <div className="ur-body">
          <aside ref={drawerBox} className={`ur-side${drawer ? ' is-open' : ''}`} role={drawer ? 'dialog' : undefined} aria-modal={drawer ? true : undefined} aria-labelledby="ur-people-title">
            {peopleList}
          </aside>
          {drawer && <div className="ur-backdrop" onClick={closeDrawer} aria-hidden="true" />}
          <div className={`ch-room${isSocialRoom ? ' ur-social-room' : ''}`}>
            <section className={`ur-beam${isSocialRoom ? ' is-social-room' : ''}`}
              aria-label={isSocialRoom ? 'Four audio-only seats' : 'Nine audio-only seats'}>
              <div className="ur-audio-status-row">
                <span className={`ur-audio-status ur-audio-${videoBeam.connection}`} role="status">
                  <span className="ur-status-dot" aria-hidden="true" />
                  {videoBeam.connection === 'connected' ? 'Audio ready'
                    : videoBeam.connection === 'connecting' ? 'Connecting'
                      : videoBeam.connection === 'error' ? 'Connection issue'
                        : videoBeam.beam.beamActive ? 'Joining room audio' : 'Join room audio'}
                </span>
              </div>
              {videoBeam.error && <p className="ur-beam-error" role="alert">{videoBeam.error}</p>}
              {videoBeam.beam.beamActive && !videoBeam.ownSlot && beamSlots.every(slot => slot.participantId)
                && <p className="ur-beam-full" role="status">All audio seats are occupied. You can still listen; an open seat can be joined when someone leaves.</p>}
                  <div className="ur-slots" data-count={speakerCount}>
                {beamSeatLayout.map(({ slot, area, gridColumn, gridRow }) => {
                  const person = slot.participantId
                    ? people.find((p) => p.participantId === slot.participantId)
                    : undefined;
                  const mine = slot.participantId === participantId;
                  const isBeamHost = !!slot.participantId && slot.participantId === roomHostParticipantId;
                  const canSelectOpenSlot = !slot.participantId && !!sessionId && !!participantId
                    && (!videoBeam.ownSlot || videoBeam.ownSlot.slotNumber !== slot.slotNumber);
                  const moveAvailable = canSelectOpenSlot && !!videoBeam.ownSlot;
                  const joinAvailable = canSelectOpenSlot && !videoBeam.ownSlot;
                  const isSpeaking = !!slot.participantId && videoBeam.speaking.has(slot.participantId);
                  const profileTap = isSocialRoom && !!person;
                  // Non-social occupied seats: the photo is the only control (opens the quick profile);
                  // the seat area is not a button, so there are no nested interactive roles.
                  // Own mic stays on the explicit "Your beam controls" mic button.
                  const photoTrigger = !!person && !isSocialRoom && !person.botId;
                  const seatInteractive = !photoTrigger && (profileTap || mine || joinAvailable || moveAvailable);
                  const media = slot.participantId ? videoBeam.media[slot.participantId] : undefined;
                  const fallbackName = person ? (person.displayName?.trim() || person.username) : '';
                  const initials = Array.from(fallbackName).slice(0, 2).join('').toUpperCase() || '?';
                  const portrait = person ? (
                    <div className="ur-slot-portrait" aria-hidden="true">
                      {person.identity ? (
                        <span className="ur-slot-identity-fallback">
                          <IdentityAvatar identity={person.identity} name={fallbackName} size="100%" fill />
                        </span>
                      ) : (
                        <span className="ur-slot-initial-fallback">{initials}</span>
                      )}
                      {person.photoUrl && (
                        <img className="ur-slot-photo-fill" src={photoSrc(person.photoUrl)} alt=""
                          onError={event => { event.currentTarget.style.display = 'none'; }} />
                      )}
                    </div>
                  ) : null;
                  return (
                    <article className={`ur-slot${isSpeaking ? ' is-speaking' : ''}${slot.participantId ? ' is-occupied' : ''}${person ? ' has-person' : ''}${isBeamHost ? ' is-beam-host' : ''}`}
                      key={slot.slotNumber}
                      data-seat-position={area}
                      style={{ gridColumn, gridRow: area === 'host' ? '1 / span 2' : gridRow }}
                      aria-label={`Speaker slot ${slot.slotNumber}${slot.participantId ? `, ${person?.displayName ?? 'occupied'}` : ', empty'}`}>
                      <div className="ur-slot-media"
                        role={seatInteractive && !videoBeam.busy ? 'button' : undefined}
                        tabIndex={seatInteractive && !videoBeam.busy ? 0 : undefined}
                        aria-pressed={mine && !isSocialRoom ? ownMicEnabled : undefined}
                        aria-disabled={seatInteractive ? videoBeam.busy : undefined}
                        aria-label={profileTap
                          ? `View ${person?.displayName ?? 'speaker'}'s profile`
                          : mine
                            ? `Your speaker spot ${slot.slotNumber}, microphone ${ownMicEnabled ? 'on' : 'off'}. Tap to toggle.`
                          : (joinAvailable || moveAvailable) && !videoBeam.busy
                            ? `${moveAvailable ? 'Move to' : 'Join'} speaker spot ${slot.slotNumber}` : undefined}
                        data-testid={mine ? `beam-seat-${slot.slotNumber}` : undefined}
                        onClick={seatInteractive && !videoBeam.busy
                          ? () => profileTap && person
                            ? openMenu(person.username, person.displayName, person.participantId, person.displayNameColor, person.displayNameTierIndex)
                            : mine
                              ? handleOwnSeatTap()
                              : void (moveAvailable ? videoBeam.moveToSlot(slot.slotNumber) : videoBeam.joinSpeaker(slot.slotNumber))
                          : undefined}
                        onKeyDown={seatInteractive && !videoBeam.busy ? (event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            if (profileTap && person)
                              openMenu(person.username, person.displayName, person.participantId, person.displayNameColor, person.displayNameTierIndex);
                            else if (mine) handleOwnSeatTap();
                            else void (moveAvailable ? videoBeam.moveToSlot(slot.slotNumber) : videoBeam.joinSpeaker(slot.slotNumber));
                          }
                        } : undefined}>
                        {person && <BeamAudioTrack track={media?.audio} />}
                        {isSocialRoom ? (
                          <div className="ur-social-card" data-testid={`social-seat-card-${slot.slotNumber}`}>
                            {person && (slot.micMuted || slot.mutedByHost) && (
                              <span className="ur-slot-mic-icon" role="img"
                                aria-label="Microphone muted"
                                title="Microphone muted">
                                <MicOff size={13} aria-hidden="true" />
                              </span>
                            )}
                            {person ? (
                              <>
                                <div className="ur-social-card-portrait">
                                  {person.photoUrl
                                    ? <img src={photoSrc(person.photoUrl)} alt="" onError={event => { event.currentTarget.style.display = 'none'; }} />
                                    : <span>{initials}</span>}
                                </div>
                                <img className="ur-slot-starter-card"
                                  src={`${import.meta.env.BASE_URL}battle-assets/cards/card_frame_${(person.frameId ?? 'grey-starter').replace(/[^a-z-]/g, '')}.png`}
                                  onError={event => {
                                    const starter = `${import.meta.env.BASE_URL}battle-assets/cards/card_frame_grey_starter.png`;
                                    if (!event.currentTarget.src.endsWith('/card_frame_grey_starter.png')) event.currentTarget.src = starter;
                                  }}
                                  alt="" aria-hidden="true" />
                                <div className="ur-social-card-info" aria-label={`${person.displayName}, ${person.race ?? 'Human'}, ${person.job ?? 'No job yet'}`}>
                                  <ShinyName className="ur-social-card-name" fitOneLine displayNameColor={person.displayNameColor} displayNameTierIndex={person.displayNameTierIndex}>{person.displayName}</ShinyName>
                                  <span>{person.race ?? 'Human'}</span>
                                  <span>{person.job ?? 'No job yet'}</span>
                                </div>
                              </>
                            ) : slot.participantId ? (
                              <>
                                <div className="ur-social-card-empty"><span>Loading player</span></div>
                                <img className="ur-slot-starter-card"
                                  src={`${import.meta.env.BASE_URL}battle-assets/cards/card_frame_grey_starter.png`}
                                  alt="" aria-hidden="true" />
                              </>
                            ) : (
                              <>
                                <div className="ur-social-card-empty"><span>Tap to sit</span></div>
                                <img className="ur-slot-starter-card"
                                  src={`${import.meta.env.BASE_URL}battle-assets/cards/card_frame_grey_starter.png`}
                                  alt="" aria-hidden="true" />
                              </>
                            )}
                          </div>
                        ) : (
                          <>
                            {person && (!photoTrigger ? (
                              <div className="ur-slot-portrait-layer">{portrait}</div>
                            ) : (
                              <button type="button" className="ur-slot-avatar-button ur-slot-photo-action"
                                aria-label={`Open profile for ${person.displayName}`} aria-haspopup="dialog"
                                data-testid={`button-seat-photo-${person.username}`}
                                onClick={() => quickProfile?.open(person.username)}>
                                {portrait}
                              </button>
                            ))}
                            {person ? (
                              <div className="ur-slot-copy">
                                <span className="ur-slot-name-line">
                                  <button type="button" className="ur-name ur-slot-name"
                                    aria-label={`Actions for ${person.displayName}`}
                                    aria-haspopup="menu"
                                    onClick={event => { event.stopPropagation(); openMenu(person.username, person.displayName, person.participantId, person.displayNameColor, person.displayNameTierIndex); }}>
                                    <ShinyName className="ur-seat-name-text" displayNameColor={person.displayNameColor} displayNameTierIndex={person.displayNameTierIndex}>{person.displayName}</ShinyName>
                                  </button>
                                </span>
                              </div>
                            ) : slot.participantId ? (
                              <div className="ur-slot-copy">
                                <span className="ur-slot-name">Speaker details loading</span>
                                <span className="ur-slot-caption">Syncing room roster</span>
                              </div>
                            ) : (
                              <div className="ur-slot-empty-copy">
                                <span className="ur-empty-number" aria-hidden="true">{slot.slotNumber}</span>
                                <span className="ur-slot-name ur-empty-name">{moveAvailable ? 'Move here' : joinAvailable ? 'Tap to join' : 'Open spot'}</span>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                      {person && !mine && canModerateRoom ? (
                        <div className="ur-slot-actions">
                          <button type="button" className="ur-slot-action"
                            disabled={videoBeam.busy || slot.micMuted}
                            aria-label={`Mute ${person.displayName}'s microphone`}
                            title={`Mute ${person.displayName}'s microphone`}
                            onClick={() => void videoBeam.hostMuteMic(slot.participantId!)}>
                            <MicOff size={16} />
                          </button>
                          <button type="button" className="ur-slot-action ur-slot-leave" disabled={videoBeam.busy}
                            aria-label={`Remove ${person.displayName} from the beam`} title={`Remove ${person.displayName} from the beam`}
                            onClick={() => void videoBeam.kick(slot.participantId!)}><X size={16} /></button>
                        </div>
                      ) : !person && slot.participantId ? <span className="ur-slot-caption">Syncing room roster</span> : null}
                    </article>
                  );
                })}
              </div>
              {videoBeam.ownSlot && (
                <div className="ur-beam-self-controls" role="group" aria-label="Your beam controls">
                  <button type="button" className="ur-slot-action"
                    disabled={videoBeam.busy}
                    aria-pressed={ownMicEnabled}
                    aria-label={ownMicEnabled ? 'Mute microphone' : 'Turn microphone on'}
                    title={ownMicEnabled ? 'Mute microphone' : 'Turn microphone on'}
                    onClick={() => toggleOwnMic(!ownMicEnabled)}>
                    {ownMicEnabled ? <Mic size={16} /> : <MicOff size={16} />}
                    {ownMicEnabled ? 'Mute' : 'Unmute'}
                  </button>
                  <button type="button" className="ur-slot-action ur-slot-leave"
                    disabled={videoBeam.busy} onClick={leaveOwnSeat}
                    aria-label="Leave beam" title="Leave beam">
                    <LogOut size={16} /> Leave
                  </button>
                </div>
              )}
            </section>
            {reporting && <SafetyReportDialog {...reporting} roomSessionId={sessionId}
              onClose={() => setReporting(null)} onSubmitted={() => setNote(null)} />}
            {note && <p className="ur-room-note" role="status">{note} <Link href="/community/blocks" className="bm-link">Blocked list</Link></p>}
          </div>
        </div>
      </div>

      {menu && (
        <div className={`ur-modal${isSocialRoom ? ' ur-social-profile-scrim' : ''}`} onClick={() => setMenu(null)}>
          <div ref={menuBox} className={`ur-menu${isSocialRoom ? ' ur-social-profile-popup' : ''}`}
            role={isSocialRoom ? 'dialog' : 'menu'} aria-modal={isSocialRoom || undefined}
            aria-label={isSocialRoom ? `Profile for ${menu.username}` : `Actions for ${menu.displayName}`}
            aria-labelledby={isSocialRoom ? 'ur-profile-popup-title' : undefined}
            onClick={(e) => e.stopPropagation()}>
            {isSocialRoom && (
              <>
                <header className="ur-profile-popup-head">
                  <UserPhoto username={menu.username} displayName={menu.displayName} photoUrl={menu.photoUrl} size={40} />
                  <div>
                    <strong id="ur-profile-popup-title"><ShinyName displayNameColor={menu.displayNameColor} displayNameTierIndex={menu.displayNameTierIndex}>{menu.displayName}</ShinyName></strong>
                    <span>@{menu.username}</span>
                  </div>
                  <button type="button" className="ur-profile-popup-x" aria-label="Close profile" data-testid="button-close-profile" onClick={() => setMenu(null)}>×</button>
                </header>
              </>
            )}
            {!isSocialRoom && <strong><ShinyName displayNameColor={menu.displayNameColor} displayNameTierIndex={menu.displayNameTierIndex}>{menu.displayName}</ShinyName></strong>}
            {!menuIsSelf && (
              <>
                <button type="button" role={isSocialRoom ? undefined : 'menuitem'} onClick={() => { const u = menu.username; setMenu(null); nav(`/community/messages/${encodeURIComponent(u)}`); }}>Message</button>
                <button type="button" role={isSocialRoom ? undefined : 'menuitem'} onClick={() => {
                  setReporting({ targetType: 'user', targetUsername: menu.username, roomId });
                  setMenu(null); setDrawer(false);
                }}>Report user</button>
                <button type="button" role={isSocialRoom ? undefined : 'menuitem'} disabled={block.isPending} onClick={() => {
                  const target = menu;
                  setMenu(null);
                  block.mutate({ username: target.username, data: { kind: 'block', active: true } }, {
                    onSuccess: () => {
                      setNote(`Blocked ${target.displayName}.`);
                      qc.invalidateQueries({ predicate: q => String(q.queryKey[0]).startsWith('/api/social') });
                      qc.invalidateQueries({ queryKey: getGetUniversitySessionQueryKey(roomId) });
                      r.refresh();
                    },
                    onError: e => setNote(errMessage(e)),
                  });
                }}>Block</button>
                {canModerateRoom && menu.participantId && !menu.botId && menu.participantId !== me?.participantId && (
                  <button type="button" role={isSocialRoom ? undefined : 'menuitem'} disabled={videoBeam.busy} onClick={() => {
                    const targetParticipantId = menu.participantId!;
                    setMenu(null);
                    void videoBeam.kick(targetParticipantId);
                  }}>Remove from this room</button>
                )}
                <button type="button" role={isSocialRoom ? undefined : 'menuitem'} onClick={() => { const u = menu.username; setMenu(null); nav(`/community/people/${encodeURIComponent(u)}`); }}>View profile</button>
                <button type="button" role={isSocialRoom ? undefined : 'menuitem'} disabled={ignoreMut.isPending} onClick={() => toggleIgnore(menu)}>{ignored.has(menu.username) ? 'Unignore' : 'Ignore'}</button>
              </>
            )}
            <button type="button" role={isSocialRoom ? undefined : 'menuitem'} onClick={() => setMenu(null)}>{menuIsSelf ? 'Close' : 'Cancel'}</button>
          </div>
        </div>
      )}

      {rulesOpen && (
        <div className="ur-modal" onClick={dismissRules}>
          <div ref={rulesBox} className="ur-rules" role="dialog" aria-modal="true" aria-labelledby="ur-rules-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="ur-rules-title">House rules</h2>
            <p>{RULES}</p>
            {ack.isError && <div className="ch-err" role="alert">{errMessage(ack.error)}</div>}
            <div className="ur-rules-act">
              <button type="button" className="bm-btn" disabled={ack.isPending} onClick={dismissRules}>Close</button>
              <button type="button" className="bm-btn bm-btn-primary" autoFocus disabled={ack.isPending} data-testid="button-rules-ack"
                onClick={dismissRules}>{ack.isPending ? 'Saving...' : 'Got it'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
