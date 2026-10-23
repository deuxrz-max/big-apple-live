import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useUser } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Link2, Loader2, Mic, MicOff, RotateCcw, Flag } from "lucide-react";
import {
  actChessRoom, getGetChessRoomQueryKey, joinChessRoom, useGetChessRoom,
} from "@workspace/api-client-react";
import type { ChessActionInput, ChessPlayer, ChessRoomState } from "@workspace/api-client-react";
import { UserPhoto } from "@/components/user-photo";
import { ChessPiece } from "./ChessPiece";
import { FINISHED, boardCells, isLegal, movesFrom, needsPromotion, resultTitle, selectableSquares } from "./chess-logic";
import { useChessAudio } from "./useChessAudio";
import "./chess.css";

export function ChessRoute() {
  const { chessRoomId = "" } = useParams<{ chessRoomId: string }>();
  const { user } = useUser();
  const accountKey = user?.id ?? "";
  const qc = useQueryClient();
  // Private per-account game state: drop any cached copy when the identity or room changes.
  useEffect(() => () => { qc.removeQueries({ queryKey: getGetChessRoomQueryKey(chessRoomId) }); }, [qc, chessRoomId, accountKey]);
  return <ChessRoom key={`${accountKey}:${chessRoomId}`} roomId={chessRoomId} accountKey={accountKey} />;
}

function PlayerRow({ player, color, active, isMe, room, audio, onLeave, onShare, shareNote, position }: {
  player: ChessPlayer | null; color: "w" | "b"; active: boolean; isMe: boolean; room: ChessRoomState;
  audio: ReturnType<typeof useChessAudio>; onLeave: () => void; onShare: () => void; shareNote: string; position: "top" | "bottom";
}) {
  return <section className={`chess-player is-${position}${active ? " is-active" : ""}`} data-testid={`chess-player-${color}`}>
    <span className="chess-player-photo">
      {player ? <UserPhoto username={player.username} displayName={player.displayName} photoUrl={player.photoUrl} size={40} />
        : <span className="chess-player-empty" aria-hidden="true" />}
    </span>
    <span className="chess-player-copy">
      <strong>{player ? player.displayName || player.username : "Waiting for opponent"}{isMe && <em>You</em>}</strong>
      <small>{color === "w" ? "White" : "Black"}{active && room.status === "playing" ? (room.inCheck ? " · in check" : " · to move") : ""}{!player ? (shareNote ? ` · ${shareNote}` : " · share the link") : ""}</small>
    </span>
    <span className="chess-player-tools">
      {!player && <button type="button" onClick={onShare} aria-label="Share invite link" data-testid="button-chess-invite"><Link2 size={16} /></button>}
      {isMe && <button type="button" onClick={audio.toggle} aria-pressed={audio.state === "on"} data-testid="button-chess-mic"
        aria-label={audio.state === "on" ? "Turn microphone off" : "Turn microphone on"} className={audio.state === "on" ? "is-on" : ""}>
        {audio.state === "connecting" ? <Loader2 size={16} className="chess-spin" /> : audio.state === "on" ? <Mic size={16} /> : <MicOff size={16} />}
      </button>}
      {isMe && room.status === "playing" && <button type="button" onClick={() => document.dispatchEvent(new CustomEvent("chess:resign"))} aria-label="Resign" data-testid="button-chess-resign"><Flag size={16} /></button>}
      {isMe && <button type="button" onClick={onLeave} aria-label="Leave game" data-testid="button-chess-leave"><ArrowLeft size={16} /></button>}
    </span>
  </section>;
}

export function ChessRoom({ roomId, accountKey, onExit }: { roomId: string; accountKey: string; onExit?: () => void }) {
  const [, navigate] = useLocation();
  const exit = useCallback(() => { if (onExit) onExit(); else navigate("/home"); }, [onExit, navigate]);
  const [joined, setJoined] = useState(false);
  const [joinError, setJoinError] = useState("");
  const [joinAttempt, setJoinAttempt] = useState(0);
  const busyRef = useRef(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [promo, setPromo] = useState<{ from: string; to: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [shareNote, setShareNote] = useState("");
  const [confirmResign, setConfirmResign] = useState(false);
  const audio = useChessAudio(roomId, accountKey);

  useEffect(() => {
    let live = true;
    setJoinError("");
    joinChessRoom(roomId).then(() => { if (live) setJoined(true); })
      .catch(() => { if (live) setJoinError("Could not join this chess room. It may be full or closed."); });
    return () => { live = false; };
  }, [roomId, joinAttempt]);

  const query = useGetChessRoom(roomId, { query: {
    queryKey: [...getGetChessRoomQueryKey(roomId), accountKey], enabled: joined,
    refetchInterval: 1000, refetchIntervalInBackground: false, refetchOnWindowFocus: true,
  } });
  const room = query.data;

  useEffect(() => {
    const onResign = () => setConfirmResign(true);
    document.addEventListener("chess:resign", onResign);
    return () => document.removeEventListener("chess:resign", onResign);
  }, []);

  const cells = useMemo(() => boardCells(room?.fen ?? ""), [room?.fen]);
  const stale = query.isError;
  const myTurn = !stale && !!room && room.status === "playing" && room.turn === room.yourColor;
  const moves = useMemo(() => (myTurn ? room?.legalMoves ?? [] : []), [myTurn, room?.legalMoves]);
  const selectable = useMemo(() => selectableSquares(moves), [moves]);
  const targets = useMemo(() => new Set(selected ? movesFrom(moves, selected).map(m => m.to) : []), [moves, selected]);
  const refetchRef = useRef(query.refetch); refetchRef.current = query.refetch;

  useEffect(() => { setSelected(null); setPromo(null); }, [room?.revision]);
  const stopAudio = audio.stop;
  useEffect(() => { if (room?.status === "closed") stopAudio(); }, [room?.status, stopAudio]);

  const act = useCallback(async (input: Omit<ChessActionInput, "revision">) => {
    if (!room || busyRef.current) return false;
    busyRef.current = true;
    setBusy(true); setError("");
    try {
      await actChessRoom(roomId, { ...input, revision: room.revision });
      await refetchRef.current();
      return true;
    } catch {
      setError(input.action === "move" ? "That move was not accepted. The board has been refreshed." : "That action could not be completed. Try again.");
      await refetchRef.current();
      return false;
    } finally { busyRef.current = false; setBusy(false); }
  }, [room, roomId]);

  const tap = (square: string) => {
    if (!myTurn || busyRef.current) return;
    if (selected && targets.has(square)) {
      if (needsPromotion(moves, selected, square)) { setPromo({ from: selected, to: square }); return; }
      if (isLegal(moves, selected, square)) void act({ action: "move", from: selected, to: square });
      setSelected(null); return;
    }
    setSelected(selectable.has(square) && square !== selected ? square : null);
  };

  const leave = async () => {
    audio.stop();
    if (room) { try { await actChessRoom(roomId, { action: "leave", revision: room.revision }); } catch { /* leaving anyway */ } }
    exit();
  };
  const share = async () => {
    const base = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
    const url = new URL(`${base}community/chess/${encodeURIComponent(roomId)}`, window.location.origin).toString();
    try {
      if (navigator.share) await navigator.share({ title: "Play chess on Deux Wild", url });
      else { await navigator.clipboard.writeText(url); setShareNote("link copied"); window.setTimeout(() => setShareNote(""), 2400); }
    } catch (e) { if (!(e instanceof DOMException && e.name === "AbortError")) setError("Could not share the link."); }
  };

  if (!room) {
    return <main className="chess-room" data-testid="chess-room">
      {joinError || query.isError
        ? <div className="chess-state" role="alert"><strong>{joinError || "Could not load this game."}</strong>
          <button type="button" onClick={() => { if (joinError || !joined) setJoinAttempt(n => n + 1); else void query.refetch(); }} data-testid="button-chess-retry">Retry</button>
          <button type="button" onClick={exit}>Back</button></div>
        : <div className="chess-skeleton" aria-label="Loading game"><i /><b /><i /></div>}
    </main>;
  }

  const me = room.players[room.yourColor === "w" ? "white" : "black"];
  const finished = FINISHED.has(room.status);
  const iAskedRematch = !!me && room.rematchRequestedBy === me.accountId;
  const theyAskedRematch = !!room.rematchRequestedBy && !iAskedRematch;
  const rowProps = { room, audio, onLeave: () => void leave(), onShare: () => void share(), shareNote };

  return <main className="chess-room" data-testid="chess-room">
    <PlayerRow position="top" player={room.players.white} color="w" active={room.status === "playing" && room.turn === "w"}
      isMe={room.yourColor === "w"} {...rowProps} />
    <div className="chess-frame">
      <div className={`chess-board${room.inCheck ? " is-check" : ""}`} role="grid" aria-label="Chess board" data-testid="chess-board">
        {cells.map(cell => {
          const isSel = selected === cell.square, isTarget = targets.has(cell.square);
          return <button key={cell.square} type="button" role="gridcell" data-square={cell.square} aria-selected={isSel}
            className={`chess-sq${cell.dark ? " is-dark" : ""}${isSel ? " is-selected" : ""}${isTarget ? (cell.piece ? " is-capture" : " is-target") : ""}${selectable.has(cell.square) ? " is-movable" : ""}`}
            onClick={() => tap(cell.square)} aria-label={`${cell.square}${cell.piece ? ` ${cell.piece.color === "w" ? "white" : "black"} ${cell.piece.type}` : ""}`}>
            {cell.piece && <ChessPiece piece={cell.piece} />}
          </button>;
        })}
      </div>
      {stale && <p className="chess-error" role="status" data-testid="chess-connection">Connection lost. Reconnecting; moves are paused.</p>}
      {error && <p className="chess-error" role="alert" onClick={() => setError("")}>{error}</p>}
      {room.status === "waiting" && <p className="chess-note" role="status">Waiting for a second player to join.</p>}
      {room.status === "closed" && <p className="chess-note" role="status">This room has closed.</p>}
    </div>
    <PlayerRow position="bottom" player={room.players.black} color="b" active={room.status === "playing" && room.turn === "b"}
      isMe={room.yourColor === "b"} {...rowProps} />
    <div ref={audio.sinkRef} hidden />
    {audio.error && <p className="chess-error is-floating" role="alert">{audio.error}</p>}

    {promo && <div className="chess-sheet-scrim" onClick={() => setPromo(null)}>
      <div className="chess-sheet" role="dialog" aria-label="Choose promotion" onClick={e => e.stopPropagation()} data-testid="chess-promotion">
        <strong>Promote to</strong>
        <div>{(["q", "r", "b", "n"] as const).map(p => <button key={p} type="button" aria-label={`Promote to ${p}`}
          onClick={() => { const m = promo; setPromo(null); setSelected(null); void act({ action: "move", from: m.from, to: m.to, promotion: p }); }}>
          <ChessPiece piece={{ type: p, color: room.yourColor }} />
        </button>)}</div>
      </div>
    </div>}

    {confirmResign && <div className="chess-sheet-scrim" onClick={() => setConfirmResign(false)}>
      <div className="chess-sheet" role="dialog" aria-label="Confirm resignation" onClick={e => e.stopPropagation()}>
        <strong>Resign this game?</strong>
        <div className="chess-sheet-actions">
          <button type="button" onClick={() => setConfirmResign(false)}>Keep playing</button>
          <button type="button" className="is-gold" onClick={() => { setConfirmResign(false); void act({ action: "resign" }); }}>Resign</button>
        </div>
      </div>
    </div>}

    {finished && <div className="chess-result" role="dialog" aria-label="Game result" data-testid="chess-result">
      <div className="chess-result-card">
        <small>{room.status === "checkmate" ? "Checkmate" : room.status === "resigned" ? "Resignation" : room.status === "stalemate" ? "Stalemate" : "Final"}</small>
        <h2>{resultTitle(room.status, room.result, room.yourColor)}</h2>
        {room.result && <p className="chess-result-text" data-testid="chess-result-text">{room.result}</p>}
        <div className="chess-sheet-actions">
          <button type="button" onClick={() => void leave()}>Leave</button>
          <button type="button" className="is-gold" disabled={iAskedRematch || busy || !room.players.black}
            onClick={() => void act({ action: "rematch" })} data-testid="button-chess-rematch">
            <RotateCcw size={15} />{iAskedRematch ? "Waiting for opponent" : theyAskedRematch ? "Accept rematch" : "Rematch"}
          </button>
        </div>
        {theyAskedRematch && <p>Your opponent wants a rematch.</p>}
      </div>
    </div>}
  </main>;
}
