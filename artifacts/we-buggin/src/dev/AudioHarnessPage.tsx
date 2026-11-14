import { useCallback, useEffect, useRef, useState } from "react";
import { UniversityAudioClient, type AudioState, type UniversityAudioPeerStats } from "@workspace/room-audio";
import "./audio-harness.css";

const API = `${import.meta.env.BASE_URL}api/__dev/audio-harness`;
const ROOM_ID = "DEV-AUDIO-LAB";
const HANDOFF_DELAY_MS = 1_500;
type BeamSlot = {
  slotNumber: number;
  participantId: string | null;
  micEnabled: boolean;
  mutedByHost: boolean;
};
type UniversityAudioState = {
  roomId: string;
  beamActive: boolean;
  hostParticipantId: string | null;
  slots: BeamSlot[];
};
const EMPTY_BEAM: UniversityAudioState = {
  roomId: ROOM_ID,
  beamActive: false,
  hostParticipantId: null,
  slots: [1, 2, 3, 4].map(slotNumber => ({
    slotNumber,
    participantId: null,
    micEnabled: false,
    mutedByHost: false,
  })),
};

type TestAccount = { username: string; displayName: string };
type TestPerson = TestAccount & { participantId: string };
type PeerStat = UniversityAudioPeerStats;

type ActorController = {
  username: string;
  displayName: string;
  participantId: string;
  token: string;
  client: UniversityAudioClient | null;
  role: "listener" | "speaker";
  state: AudioState | "starting";
  error: string | null;
  busy: boolean;
  micEnabled: boolean;
  mutedByHost: boolean;
  context: AudioContext | null;
  stream: MediaStream | null;
  peerStats: PeerStat[];
};

type ActorView = Omit<ActorController, "token" | "client" | "context" | "stream"> & {
  syntheticTrackEnabled: boolean;
  peerCount: number;
  receivedTracks: number;
  playbackActive: number;
};

async function readJson<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(options.headers);
  if (token) headers.set("X-Room-Session", token);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(`${API}${path}`, { ...options, headers, cache: "no-store" });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json() as { error?: string };
      if (body.error) message = body.error;
    } catch { /* keep status text */ }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function syntheticAudio(username: string) {
  const context = new AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const destination = context.createMediaStreamDestination();
  const frequency = 330 + [...username].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 180;
  oscillator.type = "sine";
  oscillator.frequency.value = frequency;
  gain.gain.value = 0.012;
  oscillator.connect(gain);
  gain.connect(destination);
  oscillator.start();
  destination.stream.getAudioTracks().forEach(track => { track.enabled = false; });
  return { context, oscillator, stream: destination.stream };
}

function delay(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

export default function AudioHarnessPage() {
  const actorsRef = useRef(new Map<string, ActorController>());
  const [accounts, setAccounts] = useState<TestAccount[]>([]);
  const [actors, setActors] = useState<ActorView[]>([]);
  const [people, setPeople] = useState<TestPerson[]>([]);
  const [beam, setBeam] = useState<UniversityAudioState>(EMPTY_BEAM);
  const [selected, setSelected] = useState("");
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const addLog = useCallback((message: string) => {
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setLog(previous => [`${time} ${message}`, ...previous].slice(0, 20));
  }, []);

  const publishActors = useCallback(() => {
    setActors([...actorsRef.current.values()].map(actor => {
      const diagnostics = actor.client?.getDiagnostics() ?? [];
      return {
        username: actor.username,
        displayName: actor.displayName,
        participantId: actor.participantId,
        role: actor.role,
        state: actor.state,
        error: actor.error,
        busy: actor.busy,
        micEnabled: actor.micEnabled,
        mutedByHost: actor.mutedByHost,
        peerStats: actor.peerStats,
        syntheticTrackEnabled: actor.stream?.getAudioTracks().some(track => track.enabled) ?? false,
        peerCount: diagnostics.length,
        receivedTracks: diagnostics.filter(peer => peer.remoteAudioTracks > 0).length,
        playbackActive: diagnostics.filter(peer => peer.playbackActive && !peer.playbackMuted).length,
      };
    }));
  }, []);

  const patchActor = useCallback((username: string, patch: Partial<ActorController>) => {
    const actor = actorsRef.current.get(username);
    if (!actor) return;
    Object.assign(actor, patch);
    publishActors();
  }, [publishActors]);

  const getActor = (username: string) => actorsRef.current.get(username);

  const apiAction = useCallback(async (
    actor: ActorController,
    action: string,
    targetParticipantId?: string,
  ): Promise<UniversityAudioState> => {
    const data = await readJson<UniversityAudioState>(
      `/account/rooms/${ROOM_ID}/audio/actions`,
      { method: "POST", body: JSON.stringify({ action, ...(targetParticipantId ? { targetParticipantId } : {}) }) },
      actor.token,
    );
    setBeam(data);
    return data;
  }, []);

  const newClient = useCallback((actor: ActorController, role: "listener" | "speaker", stream?: MediaStream) => (
    new UniversityAudioClient({
      roomId: ROOM_ID,
      roomSessionId: actor.token,
      baseUrl: API,
      role,
      ...(stream ? { microphoneStream: stream } : {}),
      onState: state => patchActor(actor.username, { state }),
      onBeam: state => {
        setBeam(state);
        const ownSlot = state.slots.find(slot => slot.participantId === actor.participantId);
        actor.mutedByHost = !!ownSlot?.mutedByHost;
        actor.micEnabled = !!ownSlot?.micEnabled && !actor.mutedByHost;
        publishActors();
      },
      onPeerState: () => publishActors(),
      onSpeaking: () => publishActors(),
      onError: error => {
        patchActor(actor.username, { error: error.message });
        addLog(`${actor.displayName}: ${error.message}`);
      },
    })
  ), [addLog, patchActor, publishActors]);

  const startListener = useCallback(async (actor: ActorController) => {
    const client = newClient(actor, "listener");
    actor.client = client;
    actor.role = "listener";
    actor.micEnabled = false;
    actor.state = "starting";
    actor.error = null;
    publishActors();
    await client.start();
  }, [newClient, publishActors]);

  const connectAccount = useCallback(async (account: TestAccount) => {
    if (actorsRef.current.has(account.username)) return;
    setWorking(true);
    setNotice("");
    try {
      const created = await readJson<{
        sessionToken: string; participantId: string; username: string; displayName: string;
      }>("/session", { method: "POST", body: JSON.stringify({ username: account.username }) });
      const actor: ActorController = {
        username: created.username,
        displayName: created.displayName,
        participantId: created.participantId,
        token: created.sessionToken,
        client: null,
        role: "listener",
        state: "starting",
        error: null,
        busy: false,
        micEnabled: false,
        mutedByHost: false,
        context: null,
        stream: null,
        peerStats: [],
      };
      actorsRef.current.set(actor.username, actor);
      publishActors();
      await startListener(actor);
      setSelected("");
      setNotice(`${actor.displayName} is connected as an audience listener.`);
      addLog(`${actor.displayName} connected to the isolated test room.`);
      await refreshState(actor.token);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not connect this test account";
      setNotice(message);
      addLog(message);
    } finally {
      setWorking(false);
    }
  }, [addLog, publishActors, startListener]);

  const refreshState = useCallback(async (preferredToken?: string): Promise<{ people: TestPerson[]; beam: UniversityAudioState } | null> => {
    const tokens = [
      ...(preferredToken ? [preferredToken] : []),
      ...[...actorsRef.current.values()].map(actor => actor.token).filter(token => token !== preferredToken),
    ];
    for (const token of tokens) {
      try {
        const data = await readJson<{
          people: TestPerson[];
          beam: UniversityAudioState;
        }>("/state", {}, token);
        setPeople(data.people);
        setBeam(data.beam);
        return data;
      } catch { /* try another connected test account */ }
    }
    setPeople([]);
    setBeam(EMPTY_BEAM);
    return null;
  }, []);

  const makeSpeaker = useCallback(async (actor: ActorController): Promise<boolean> => {
    if (actor.busy || actor.role === "speaker") return false;
    actor.busy = true;
    actor.error = null;
    publishActors();
    let synthetic: ReturnType<typeof syntheticAudio> | null = null;
    let reservationSucceeded = false;
    try {
      // The generated MediaStream is audio-only and never asks for device access.
      synthetic = syntheticAudio(actor.username);
      await synthetic.context.resume();
      const reserved = await apiAction(actor, "join-slot");
      reservationSucceeded = reserved.slots.some(slot => slot.participantId === actor.participantId);
      if (!reservationSucceeded) throw new Error("The server did not reserve a speaker spot.");
      setNotice(`${actor.displayName} reserved a spot. Holding the listener connection during the handoff check…`);
      addLog(`${actor.displayName} reserved a speaker slot; simulating a permission-prompt delay.`);
      // Mirrors the wait for a permission prompt while the listener transport remains alive.
      await delay(HANDOFF_DELAY_MS);
      await actor.client?.stop();
      actor.client = null;
      actor.context = synthetic.context;
      actor.stream = synthetic.stream;
      actor.role = "speaker";
      actor.state = "connecting";
      publishActors();
      const speaker = newClient(actor, "speaker", synthetic.stream);
      actor.client = speaker;
      await speaker.start();
      const enabled = await apiAction(actor, "unmute-self");
      const ownSlot = enabled.slots.find(slot => slot.participantId === actor.participantId);
      speaker.setMicrophoneEnabled(!!ownSlot?.micEnabled && !ownSlot.mutedByHost);
      actor.micEnabled = !!ownSlot?.micEnabled;
      actor.mutedByHost = !!ownSlot?.mutedByHost;
      actor.error = null;
      setNotice(`${actor.displayName} joined a speaker spot with synthetic audio.`);
      addLog(`${actor.displayName} joined a speaker slot.`);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not join a speaker spot";
      if (reservationSucceeded) {
        try { await apiAction(actor, "leave-slot"); } catch { /* slot may already have been released */ }
      }
      try { await actor.client?.stop(); } catch { /* local shutdown continues */ }
      actor.client = null;
      if (synthetic) {
        synthetic.stream.getTracks().forEach(track => track.stop());
        synthetic.oscillator.stop();
        await synthetic.context.close().catch(() => {});
      }
      actor.context = null;
      actor.stream = null;
      actor.role = "listener";
      actor.micEnabled = false;
      actor.error = message;
      try { await startListener(actor); } catch { /* the status explains if listener reconnect also failed */ }
      setNotice(message);
      addLog(`${actor.displayName}: ${message}`);
      return false;
    } finally {
      actor.busy = false;
      publishActors();
    }
  }, [addLog, apiAction, newClient, publishActors, startListener]);

  const stopSynthetic = useCallback(async (actor: ActorController) => {
    try { await actor.client?.stop(); } catch { /* best-effort local cleanup */ }
    actor.client = null;
    if (actor.stream) actor.stream.getTracks().forEach(track => track.stop());
    actor.stream = null;
    if (actor.context) await actor.context.close().catch(() => {});
    actor.context = null;
    actor.micEnabled = false;
  }, []);

  const leaveSlot = useCallback(async (actor: ActorController) => {
    if (actor.busy || actor.role !== "speaker") return;
    actor.busy = true;
    publishActors();
    try {
      await apiAction(actor, "leave-slot");
      await stopSynthetic(actor);
      actor.role = "listener";
      await startListener(actor);
      setNotice(`${actor.displayName} left the speaker spot and is listening.`);
      addLog(`${actor.displayName} left the speaker spot.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not leave the speaker spot";
      actor.error = message;
      setNotice(message);
    } finally {
      actor.busy = false;
      publishActors();
    }
  }, [addLog, apiAction, publishActors, startListener, stopSynthetic]);

  const toggleMic = useCallback(async (actor: ActorController) => {
    if (actor.role !== "speaker" || actor.busy || actor.mutedByHost) return;
    actor.busy = true;
    publishActors();
    try {
      const state = await apiAction(actor, actor.micEnabled ? "mute-self" : "unmute-self");
      const ownSlot = state.slots.find(slot => slot.participantId === actor.participantId);
      actor.micEnabled = !!ownSlot?.micEnabled && !ownSlot.mutedByHost;
      actor.client?.setMicrophoneEnabled(actor.micEnabled);
      actor.error = null;
      addLog(`${actor.displayName} ${actor.micEnabled ? "unmuted" : "muted"} synthetic audio.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not change microphone state";
      actor.error = message;
      setNotice(message);
    } finally {
      actor.busy = false;
      publishActors();
    }
  }, [addLog, apiAction, publishActors]);

  const disconnectActor = useCallback(async (username: string) => {
    const actor = getActor(username);
    if (!actor) return;
    actor.busy = true;
    publishActors();
    await stopSynthetic(actor);
    try { await readJson<void>("/session", { method: "DELETE" }, actor.token); } catch { /* can already be kicked or expired */ }
    actorsRef.current.delete(username);
    publishActors();
    await refreshState();
    addLog(`${actor.displayName} disconnected from the test room.`);
  }, [addLog, publishActors, refreshState, stopSynthetic]);

  const disconnectAll = useCallback(async () => {
    const usernames = [...actorsRef.current.keys()];
    for (const username of usernames) await disconnectActor(username);
  }, [disconnectActor]);

  const hostAction = useCallback(async (
    actor: ActorController,
    target: TestPerson,
    action: "host-mute" | "host-unmute" | "kick",
  ) => {
    if (actor.busy) return;
    actor.busy = true;
    publishActors();
    try {
      await apiAction(actor, action, target.participantId);
      const affected = getActor(target.username);
      if (action === "kick" && affected) {
        await stopSynthetic(affected);
        actorsRef.current.delete(target.username);
        publishActors();
      }
      addLog(action === "kick"
        ? `${target.displayName} was kicked from the test room.`
        : `${actor.displayName} ${action === "host-mute" ? "muted" : "released the mute on"} ${target.displayName}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Host action failed";
      actor.error = message;
      setNotice(message);
    } finally {
      actor.busy = false;
      publishActors();
      await refreshState();
    }
  }, [addLog, apiAction, publishActors, refreshState, stopSynthetic]);

  const runJoinRace = useCallback(async () => {
    const connected = [...actorsRef.current.values()];
    if (connected.length < 5 || working) return;
    setWorking(true);
    setNotice("Starting five simultaneous speaker joins; the server should admit exactly four.");
    addLog("Started the five-account speaker-slot race.");
    try {
      const results = await Promise.all(connected.map(actor => makeSpeaker(actor)));
      await delay(2_000);
      const latest = await refreshState();
      const filled = latest?.beam.slots.filter(slot => slot.participantId !== null).length ?? 0;
      const succeeded = results.filter(Boolean).length;
      setNotice(`Slot race complete: ${succeeded} joined, ${filled} of 4 spots are occupied. Any rejected account stays in the audience.`);
      addLog(`Slot race result: ${succeeded} joined; server beam capacity is ${filled}/4.`);
    } finally {
      setWorking(false);
    }
  }, [addLog, makeSpeaker, refreshState, working]);

  useEffect(() => {
    let cancelled = false;
    void readJson<{ accounts: TestAccount[] }>("/accounts")
      .then(data => {
        if (cancelled) return;
        setAccounts(data.accounts);
        setSelected(data.accounts[0]?.username ?? "");
        setLoadingAccounts(false);
      })
      .catch(error => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : "The development audio harness is unavailable");
        setLoadingAccounts(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const poll = setInterval(() => {
      void refreshState();
      for (const actor of actorsRef.current.values()) {
        if (actor.client) {
          void actor.client.getPeerStats().then(peerStats => {
            actor.peerStats = peerStats;
            publishActors();
          }).catch(() => {});
        }
      }
    }, 1_500);
    const heartbeat = setInterval(() => {
      for (const actor of actorsRef.current.values()) {
        void readJson<void>("/heartbeat", { method: "POST" }, actor.token)
          .catch(error => patchActor(actor.username, {
            error: error instanceof Error ? error.message : "Test session heartbeat failed",
          }));
      }
    }, 25_000);
    return () => { clearInterval(poll); clearInterval(heartbeat); };
  }, [patchActor, publishActors, refreshState]);

  useEffect(() => {
    const onPageHide = () => {
      for (const actor of actorsRef.current.values()) {
        try {
          void actor.client?.stop();
          void fetch(`${API}/session`, {
            method: "DELETE",
            headers: { "X-Room-Session": actor.token, "Content-Type": "application/json" },
            keepalive: true,
          });
        } catch { /* server session expires automatically if the page closes abruptly */ }
      }
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      void disconnectAll();
    };
  }, [disconnectAll]);

  const personById = new Map(people.map(person => [person.participantId, person]));
  const host = beam.hostParticipantId;
  const connected = actors.length;
  const canRunRace = connected >= 5 && actors.every(actor => actor.role === "listener");

  return (
    <main className="dev-audio-harness" data-testid="dev-audio-harness">
      <div className="dev-audio-harness__shell">
        <header className="dev-audio-harness__header">
          <p className="dev-audio-harness__eyebrow">PREVIEW TOOL · NOT A PUBLIC ROOM</p>
          <h1>Audio Test Lab</h1>
          <p className="dev-audio-harness__summary">
            Connect marked test accounts to an isolated, memory-only room and exercise the real four-slot P2P signaling.
          </p>
        </header>

        <section className="dev-audio-harness__warning" aria-label="Test boundaries">
          <strong>Safe test mode</strong>
          <span>Synthetic audio only. No microphone or camera permission is requested. No messages or account data are changed.</span>
          <span>Audio uses direct browser-to-browser WebRTC with free STUN only. Some restrictive networks may need a TURN relay to connect.</span>
        </section>

        {loadError && <p className="dev-audio-harness__error" role="alert">{loadError}</p>}
        {notice && <p className="dev-audio-harness__notice" role="status">{notice}</p>}

        <section className="dev-audio-harness__connect" aria-labelledby="connect-test-account">
          <div>
            <h2 id="connect-test-account">Test accounts</h2>
            <p>Only accounts explicitly marked as test accounts can be selected.</p>
          </div>
          <div className="dev-audio-harness__connect-controls">
            <label className="sr-only" htmlFor="test-audio-account">Choose a test account</label>
            <select id="test-audio-account" value={selected} onChange={event => setSelected(event.target.value)} disabled={loadingAccounts || working}>
              {accounts.map(account => <option key={account.username} value={account.username}>{account.displayName} (@{account.username})</option>)}
            </select>
            <button
              type="button"
              className="dev-audio-harness__button dev-audio-harness__button--primary"
              disabled={!selected || working || actors.some(actor => actor.username === selected)}
              onClick={() => {
                const account = accounts.find(item => item.username === selected);
                if (account) void connectAccount(account);
              }}
            >
              {loadingAccounts ? "Loading…" : "Connect as listener"}
            </button>
          </div>
          {accounts.length === 0 && !loadingAccounts && !loadError && <p>No marked test accounts are available.</p>}
        </section>

        <section className="dev-audio-harness__beam" aria-labelledby="speaker-slots-heading">
          <div className="dev-audio-harness__section-title">
            <div>
              <h2 id="speaker-slots-heading">Speaker slots <span>{beam.slots.filter(slot => slot.participantId).length}/4</span></h2>
              <p>First test account to start speaking becomes the beam host.</p>
            </div>
            <button
              type="button"
              className="dev-audio-harness__button"
              disabled={!canRunRace || working}
              onClick={() => void runJoinRace()}
              title="Connect five test accounts first"
            >
              Run 5-way slot race
            </button>
          </div>

          <div className="dev-audio-harness__slots">
            {beam.slots.map(slot => {
              const person = slot.participantId ? personById.get(slot.participantId) : undefined;
              const isHost = slot.participantId === host;
              return (
                <article key={slot.slotNumber} className={`dev-audio-harness__slot ${person ? "is-occupied" : "is-empty"}`} data-testid={`audio-slot-${slot.slotNumber}`}>
                  <span className="dev-audio-harness__slot-number">SPOT {slot.slotNumber}</span>
                  {person ? (
                    <>
                      <strong>{person.displayName}</strong>
                      <span className="dev-audio-harness__slot-username">@{person.username}</span>
                      <span className="dev-audio-harness__slot-status">
                        {isHost ? "Host · " : ""}{slot.mutedByHost ? "Host-muted" : slot.micEnabled ? "Mic active" : "Mic off"}
                      </span>
                    </>
                  ) : (
                    <span className="dev-audio-harness__empty-label">Open spot</span>
                  )}
                </article>
              );
            })}
          </div>
        </section>

        <section className="dev-audio-harness__actors" aria-labelledby="connected-accounts-heading">
          <div className="dev-audio-harness__section-title">
            <div>
              <h2 id="connected-accounts-heading">Connected accounts <span>{connected}</span></h2>
              <p>Audience listeners do not transmit audio.</p>
            </div>
            <button type="button" className="dev-audio-harness__button" disabled={!connected || working} onClick={() => void disconnectAll()}>
              Disconnect all
            </button>
          </div>

          {actors.length === 0 ? (
            <p className="dev-audio-harness__empty">Connect test accounts above to start the browser audio checks.</p>
          ) : (
            <div className="dev-audio-harness__actor-list">
              {actors.map(view => {
                const controller = getActor(view.username);
                const slot = beam.slots.find(item => item.participantId === view.participantId);
                const controlsHost = host === view.participantId;
                const statsReceived = view.peerStats.reduce((sum, peer) => sum + peer.bytesReceived, 0);
                const statsSent = view.peerStats.reduce((sum, peer) => sum + peer.bytesSent, 0);
                return (
                  <article className="dev-audio-harness__actor" key={view.username} data-testid={`test-actor-${view.username}`}>
                    <div className="dev-audio-harness__actor-heading">
                      <div>
                        <h3>{view.displayName}</h3>
                        <p>@{view.username} · {view.role === "speaker" ? "Speaker" : "Audience listener"}</p>
                      </div>
                      <span className={`dev-audio-harness__state state-${view.state}`}>{view.state}</span>
                    </div>
                    {view.error && <p className="dev-audio-harness__error" role="status">{view.error}</p>}
                    <div className="dev-audio-harness__metrics">
                      <span>Peers {view.peerCount}</span>
                      <span>P2P connected {view.peerStats.filter(peer => peer.state === "connected").length}</span>
                      <span>ICE {view.peerStats.map(peer => peer.iceConnectionState).join("/") || "—"}</span>
                      <span>Gather {view.peerStats.map(peer => peer.iceGatheringState).join("/") || "—"}</span>
                      <span>Audio tracks {view.receivedTracks}</span>
                      <span>Synthetic track enabled {String(view.syntheticTrackEnabled)}</span>
                      <span>Playback {view.playbackActive}</span>
                      <span>RTP sent {statsSent.toLocaleString()} B</span>
                      <span>RTP received {statsReceived.toLocaleString()} B</span>
                    </div>
                    <div className="dev-audio-harness__actions">
                      {view.role === "listener" ? (
                        <button
                          type="button"
                          className="dev-audio-harness__button dev-audio-harness__button--primary"
                          disabled={view.busy || !controller}
                          onClick={() => { if (controller) void makeSpeaker(controller); }}
                        >
                          Join speaker slot
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="dev-audio-harness__button"
                            disabled={view.busy || view.mutedByHost}
                            onClick={() => { if (controller) void toggleMic(controller); }}
                          >
                            {view.micEnabled ? "Mute synthetic mic" : "Unmute synthetic mic"}
                          </button>
                          <button
                            type="button"
                            className="dev-audio-harness__button"
                            disabled={view.busy}
                            onClick={() => { if (controller) void leaveSlot(controller); }}
                          >
                            Leave speaker spot
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        className="dev-audio-harness__button dev-audio-harness__button--quiet"
                        disabled={view.busy || working}
                        onClick={() => void disconnectActor(view.username)}
                      >
                        Disconnect
                      </button>
                    </div>

                    {controlsHost && beam.slots.some(item => item.participantId && item.participantId !== view.participantId) && (
                      <div className="dev-audio-harness__host-controls">
                        <strong>Host controls</strong>
                        {beam.slots.filter(item => item.participantId && item.participantId !== view.participantId).map(item => {
                          const target = personById.get(item.participantId!);
                          if (!target) return null;
                          return (
                            <div className="dev-audio-harness__target" key={item.participantId} data-username={target.username}>
                              <span>{target.displayName}</span>
                              <button type="button" className="dev-audio-harness__button" disabled={view.busy}
                                onClick={() => controller && void hostAction(controller, target, item.mutedByHost ? "host-unmute" : "host-mute")}>
                                {item.mutedByHost ? "Allow self-unmute" : "Mute"}
                              </button>
                              <button type="button" className="dev-audio-harness__button dev-audio-harness__button--danger" disabled={view.busy}
                                onClick={() => controller && void hostAction(controller, target, "kick")}>
                                Kick
                              </button>
                            </div>
                          );
                        })}
                        <small>“Allow self-unmute” never turns a mic on; the speaker must unmute their own track.</small>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="dev-audio-harness__log" aria-labelledby="test-log-heading">
          <h2 id="test-log-heading">Recent test activity</h2>
          {log.length ? <ol aria-live="polite">{log.map((entry, index) => <li key={`${entry}-${index}`}>{entry}</li>)}</ol>
            : <p>Actions and connection errors will appear here.</p>}
        </section>

        <footer className="dev-audio-harness__footer">
          <span>Room: {DEV_AUDIO_LABEL}</span>
          <span>In-memory only · P2P audio · no paid media service</span>
        </footer>
      </div>
    </main>
  );
}

const DEV_AUDIO_LABEL = "Preview Audio Test Lab";
