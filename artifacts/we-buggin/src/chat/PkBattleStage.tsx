import { useEffect, useMemo, useRef, useState } from "react";
import {
  LocalAudioTrack, LocalVideoTrack, Room, RoomEvent, Track,
  type LocalTrack, type RemoteTrack,
} from "livekit-client";
import type { PkBattle } from "@workspace/api-client-react";
import { joinPkBattleMedia } from "@workspace/api-client-react";

type TrackMap = Record<string, { video?: RemoteTrack; audio?: RemoteTrack }>;

function BattleVideo({ stream, track }: { stream?: MediaStream | null; track?: RemoteTrack }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    let video: HTMLVideoElement | null = null;
    if (stream) {
      video = document.createElement("video");
      video.className = "st-pk-camera";
      video.autoplay = true;
      video.playsInline = true;
      video.muted = true;
      video.srcObject = stream;
      container.replaceChildren(video);
      void video.play().catch(() => undefined);
    } else if (track) {
      video = track.attach() as HTMLVideoElement;
      video.className = "st-pk-camera";
      video.autoplay = true;
      video.playsInline = true;
      video.muted = true;
      container.replaceChildren(video);
    }
    return () => {
      if (stream && video?.srcObject === stream) video.srcObject = null;
      if (track && video) track.detach(video);
      video?.remove();
    };
  }, [stream, track]);
  return <div ref={ref} className="st-pk-video-slot" />;
}

function BattleAudio({ track }: { track?: RemoteTrack }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const container = ref.current;
    if (!container || !track) return;
    const audio = track.attach();
    audio.autoplay = true;
    container.replaceChildren(audio);
    return () => { track.detach(audio); audio.remove(); };
  }, [track]);
  return <div ref={ref} className="st-pk-audio" />;
}

export function PkBattleStage({ battle, streamId, hostMode, localStream, localTracks, microphoneEnabled, cameraFacing }: {
  battle: PkBattle;
  streamId: string;
  hostMode: boolean;
  localStream: MediaStream | null;
  localTracks: LocalTrack[];
  microphoneEnabled: boolean;
  cameraFacing: "user" | "environment";
}) {
  const [remoteTracks, setRemoteTracks] = useState<TrackMap>({});
  const [mediaError, setMediaError] = useState("");
  const [now, setNow] = useState(Date.now());
  const [localSide, setLocalSide] = useState<"A" | "B" | null>(hostMode
    ? battle.sideA.streamId === streamId ? "A" : battle.sideB.streamId === streamId ? "B" : null
    : null);
  const videoTrack = localTracks.find(track => track.kind === Track.Kind.Video);
  const audioTrack = localTracks.find(track => track.kind === Track.Kind.Audio);
  const clonedAudioRef = useRef<LocalAudioTrack | null>(null);

  useEffect(() => {
    let disposed = false;
    let room: Room | null = null;
    let clonedVideo: LocalVideoTrack | null = null;
    let clonedAudio: LocalAudioTrack | null = null;
    setRemoteTracks({});
    setMediaError("");
    setLocalSide(hostMode
      ? battle.sideA.streamId === streamId ? "A" : battle.sideB.streamId === streamId ? "B" : null
      : null);
    const updateTrack = (identity: string, kind: Track.Kind, track: RemoteTrack | null) => {
      setRemoteTracks(current => {
        const next = { ...current, [identity]: { ...current[identity] } };
        if (track) {
          if (kind === Track.Kind.Video) next[identity]!.video = track;
          if (kind === Track.Kind.Audio) next[identity]!.audio = track;
        } else {
          if (kind === Track.Kind.Video) delete next[identity]!.video;
          if (kind === Track.Kind.Audio) delete next[identity]!.audio;
        }
        return next;
      });
    };
    const connect = async () => {
      try {
        const session = await joinPkBattleMedia(streamId, { credentials: "include" });
        if (disposed) return;
        setLocalSide(session.role === "host"
          ? battle.sideA.streamId === streamId ? "A" : battle.sideB.streamId === streamId ? "B" : null
          : null);
        room = new Room({ adaptiveStream: true, dynacast: true });
        room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
          if (track.kind === Track.Kind.Video || track.kind === Track.Kind.Audio)
            updateTrack(participant.identity, track.kind, track as RemoteTrack);
        });
        room.on(RoomEvent.TrackUnsubscribed, (track, _publication, participant) => {
          updateTrack(participant.identity, track.kind, null);
        });
        room.on(RoomEvent.ParticipantDisconnected, participant => {
          setRemoteTracks(current => { const next = { ...current }; delete next[participant.identity]; return next; });
        });
        await room.connect(session.url, session.token);
        if (disposed) { await room.disconnect(); return; }
        if (session.role === "host") {
          if (videoTrack?.mediaStreamTrack.readyState === "live") {
            clonedVideo = new LocalVideoTrack(videoTrack.mediaStreamTrack.clone());
            await room.localParticipant.publishTrack(clonedVideo, {
              videoEncoding: { maxBitrate: 800_000, maxFramerate: 20 },
              simulcast: false,
            });
          }
          if (audioTrack?.mediaStreamTrack.readyState === "live") {
            const cloned = audioTrack.mediaStreamTrack.clone();
            cloned.enabled = microphoneEnabled;
            clonedAudio = new LocalAudioTrack(cloned);
            clonedAudioRef.current = clonedAudio;
            await room.localParticipant.publishTrack(clonedAudio);
          }
        }
        for (const participant of room.remoteParticipants.values()) {
          for (const publication of participant.trackPublications.values()) {
            if (publication.track && (publication.track.kind === Track.Kind.Video || publication.track.kind === Track.Kind.Audio)) {
              updateTrack(participant.identity, publication.track.kind, publication.track as RemoteTrack);
            }
          }
        }
      } catch {
        if (!disposed) setMediaError("The split-screen video is reconnecting. Your live broadcast is still running.");
      }
    };
    void connect();
    return () => {
      disposed = true;
      clonedAudioRef.current = null;
      clonedVideo?.stop();
      clonedAudio?.stop();
      if (room) void room.disconnect();
    };
  }, [battle.id, battle.sideA.streamId, battle.sideB.streamId, streamId, hostMode, videoTrack, audioTrack, cameraFacing]);

  useEffect(() => {
    const track = clonedAudioRef.current;
    if (!track) return;
    if (microphoneEnabled) void track.unmute().catch(() => undefined);
    else void track.mute().catch(() => undefined);
  }, [microphoneEnabled]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  const sideAIdentity = `host-${battle.sideA.streamId}`;
  const sideBIdentity = `host-${battle.sideB.streamId}`;
  const activeBonus = now >= battle.bonusStartAtMs && now < battle.bonusEndAtMs && battle.status !== "finished";
  const countdown = Math.max(0, Math.ceil((battle.startsAtMs - now) / 1000));
  const remaining = Math.max(0, Math.ceil((battle.endsAtMs - now) / 1000));
  const timeText = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;
  const total = battle.scoreA + battle.scoreB;
  const aPercent = total ? battle.scoreA / total * 100 : 50;
  const topGifters = useMemo(() => ({
    A: battle.topGiftersA, B: battle.topGiftersB,
  }), [battle.topGiftersA, battle.topGiftersB]);

  const renderSide = (side: "A" | "B") => {
    const player = side === "A" ? battle.sideA : battle.sideB;
    const identity = side === "A" ? sideAIdentity : sideBIdentity;
    const isLocal = localSide === side && hostMode;
    const remote = remoteTracks[identity];
    const media = isLocal ? <BattleVideo stream={localStream} /> : <BattleVideo track={remote?.video} />;
    return <section className={`st-pk-side is-${side.toLowerCase()}${isLocal ? " is-local" : ""}`}
      aria-label={`${player.displayName}, side ${side}`}>
      {media}
      {remote?.audio && <BattleAudio track={remote.audio} />}
      {!isLocal && !remote?.video && <div className="st-pk-video-waiting">Connecting camera…</div>}
      <div className="st-pk-player-label"><b>{player.displayName}</b><small>{side === "A" ? "Gold side" : "Pink side"}</small></div>
      <div className="st-pk-top-gifters" aria-label={`Top gifters for ${player.displayName}`}>
        <strong>Top gifters</strong>
        {topGifters[side].length ? topGifters[side].map((gifter, index) => (
          <span key={gifter.username}>{index + 1}. {gifter.displayName} · {gifter.coins.toLocaleString()}</span>
        )) : <span>Waiting for gifts</span>}
      </div>
    </section>;
  };

  return <section className={`st-pk-stage${activeBonus ? " is-bonus" : ""}`} aria-label="PK battle">
    <header className="st-pk-stage-header">
      <b>PK BATTLE</b>
      <span>{battle.status === "finished" ? "FINAL" : battle.status === "countdown" && countdown > 0 ? `Starting in ${countdown}` : timeText}</span>
    </header>
    <div className="st-pk-halves">{renderSide("A")}{renderSide("B")}</div>
    <div className="st-pk-scorebar" aria-live="polite">
      <div className="st-pk-score-labels"><b>{battle.scoreA.toLocaleString()}</b><b>{battle.scoreB.toLocaleString()}</b></div>
      <div className="st-pk-score-track"><i style={{ width: `${aPercent}%` }} /></div>
    </div>
    {activeBonus && <div className="st-pk-bonus-banner">2X BONUS · GIFTS SCORE DOUBLE</div>}
    {mediaError && <p className="st-pk-media-error" role="status">{mediaError}</p>}
    {battle.status === "finished" && <div className="st-pk-result" role="status">
      <strong>{battle.winnerUsername ? `${battle.winnerUsername} wins` : "PK draw"}</strong>
      <span>Final score · {battle.scoreA.toLocaleString()} – {battle.scoreB.toLocaleString()}</span>
    </div>}
  </section>;
}
