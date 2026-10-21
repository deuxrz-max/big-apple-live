import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { BRAND_LOGO_PATH } from "@/components/brand";
import { getCardTestFace } from "./owner-card-game-test-card-policy";
import "./owner-card-game-test.css";

type TestCard = { dealNumber: number; code: string };
type WinnerMoment = { id: string; username: string; handName: string; startedAtMs: number };
export type OwnerCardTestState = {
  enabled: boolean;
  eligible: boolean;
  contextMessage: string | null;
  cards: TestCard[];
  cardsDealt: number;
  nextDealAtMs: number | null;
  winnerMoment: WinnerMoment | null;
  attempt: number;
  seatNumber: number | null;
};
type Props = {
  roomId: string;
  variant: "room";
  onStateChange?: (state: OwnerCardTestState) => void;
};

const base = import.meta.env.BASE_URL;
const endpoint = `${base}api/owner/card-games/test-mode`;

function contextQuery(roomId: string) {
  return new URLSearchParams({ type: "room", roomId });
}

function formatHandName(name: string) {
  return name.replace(/\b\w/g, letter => letter.toUpperCase());
}

export function OwnerCardGameTestMode({ roomId, variant, onStateChange }: Props) {
  const [state, setState] = useState<OwnerCardTestState | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const winnerVisibleRef = useRef<{ id: string; since: number } | null>(null);
  const ackBusyRef = useRef(false);
  const pollBusyRef = useRef(false);
  const poll = useCallback(async () => {
    if (pollBusyRef.current) return;
    pollBusyRef.current = true;
    try {
      const query = contextQuery(roomId);
      const response = await fetch(`${endpoint}?${query.toString()}`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) {
        if (response.status === 403 || response.status === 404) return;
        throw new Error("Could not load the private card test.");
      }
      const data = await response.json() as OwnerCardTestState;
      setState(data);
      onStateChange?.(data);
      setError("");
      if (data.winnerMoment && document.visibilityState === "visible") {
        if (winnerVisibleRef.current?.id !== data.winnerMoment.id) {
          winnerVisibleRef.current = { id: data.winnerMoment.id, since: Date.now() };
          setOpen(true);
        } else if (Date.now() - winnerVisibleRef.current.since >= 5_000 && !ackBusyRef.current) {
          ackBusyRef.current = true;
          const ack = await fetch(`${endpoint}/acknowledge`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "room", roomId, winnerId: data.winnerMoment.id }),
          });
          if (!ack.ok) {
            ackBusyRef.current = false;
            setError("The winner moment is still waiting to be confirmed.");
          } else {
            winnerVisibleRef.current = null;
            setError("");
            const freshQuery = contextQuery(roomId);
            const refreshed = await fetch(`${endpoint}?${freshQuery.toString()}`, {
              credentials: "include",
              cache: "no-store",
            });
            if (refreshed.ok) {
              const nextState = await refreshed.json() as OwnerCardTestState;
              setState(nextState);
              onStateChange?.(nextState);
            }
          }
        }
      } else if (!data.winnerMoment) {
        winnerVisibleRef.current = null;
        ackBusyRef.current = false;
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not load the private card test.");
    } finally {
      pollBusyRef.current = false;
    }
  }, [onStateChange, roomId]);

  useEffect(() => {
    void poll();
    const timer = window.setInterval(() => void poll(), 1_000);
    return () => window.clearInterval(timer);
  }, [poll]);

  const toggleMode = async () => {
    if (!state || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(endpoint, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !state.enabled }),
      });
      if (!response.ok) throw new Error("Could not change the private card-test setting.");
      await poll();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not change the private card-test setting.");
    } finally {
      setBusy(false);
    }
  };

  if (!state) return null;
  const countdown = state.nextDealAtMs === null
    ? null
    : Math.max(0, Math.ceil((state.nextDealAtMs - Date.now()) / 1_000));

  return (
    <div className={`dw-card-test-root dw-card-test-${variant}`} data-testid="owner-card-test-mode">
      <div className="dw-card-test-controls">
        <button type="button" className="dw-card-test-toggle" disabled={busy}
          aria-pressed={state.enabled} onClick={() => void toggleMode()}>
          {busy ? "Saving…" : state.enabled ? "Stop card test" : "Start 1-minute card test"}
        </button>
        {state.enabled && state.eligible && (
          <button type="button" className="dw-card-test-open" onClick={() => setOpen(value => !value)}>
            {open ? "Hide cards" : "My cards"}
          </button>
        )}
      </div>
      {state.enabled && !state.eligible && (
        <span className="dw-card-test-message" role="status">{state.contextMessage}</span>
      )}
      {state.enabled && state.eligible && open && (
        <section className="dw-card-test-hand" aria-label="Private owner card test">
          <header className="dw-card-test-header">
            <div>
              <strong>Private card test</strong>
              <span>{state.cardsDealt}/5 cards · no gold is awarded</span>
            </div>
            <button type="button" aria-label="Hide your test cards" onClick={() => setOpen(false)}>×</button>
          </header>
          <div className="dw-card-test-table" aria-live="polite">
            <div className="dw-card-test-deck" aria-label="Deux Wild card deck">
              <span className="dw-card-back dw-card-back-shadow" />
              <span className="dw-card-back">
                <img src={BRAND_LOGO_PATH} alt="Deux Wild" />
              </span>
              <small>DECK</small>
            </div>
            <div className="dw-card-test-cards" aria-label={`${state.cardsDealt} cards dealt`}>
              {state.cards.map(({ code, dealNumber }) => {
                const parts = getCardTestFace(code);
                if (!parts) return null;
                const wild = parts.isWild;
                return (
                  <article key={code} className={`dw-test-card${wild ? " is-wild" : ""}`}
                    aria-label={`${parts.rank} of ${parts.suitName}${wild ? ", wild" : ""}`}
                    data-testid={`owner-test-card-${dealNumber}`}>
                    <span className="dw-test-card-corner dw-test-card-top">
                      <b>{parts.rank}</b><i>{parts.symbol}</i>
                    </span>
                    {wild ? <span className="dw-test-card-wild-mark" aria-hidden="true">{parts.wildMark}</span>
                      : <span className="dw-test-card-center" aria-hidden="true">{parts.symbol}</span>}
                    {wild && <span className="dw-test-card-wild-label">WILD</span>}
                    <span className="dw-test-card-corner dw-test-card-bottom" aria-hidden="true">
                      <b>{parts.rank}</b><i>{parts.symbol}</i>
                    </span>
                  </article>
                );
              })}
              {Array.from({ length: Math.max(0, 5 - state.cards.length) }, (_, index) => (
                <span className="dw-test-card dw-test-card-empty" key={`empty-${index}`} aria-hidden="true" />
              ))}
            </div>
          </div>
          {state.winnerMoment ? (
            <div className="dw-card-test-winner" role="status" data-testid="owner-test-winner">
              <div className="dw-test-coin-burst" aria-hidden="true">
                {Array.from({ length: 14 }, (_, index) => {
                  const angle = (Math.PI * 2 * index) / 14;
                  return <i key={index} style={{
                    "--coin-x": `${Math.cos(angle) * 46}px`,
                    "--coin-y": `${Math.sin(angle) * 29}px`,
                  } as CSSProperties} />;
                })}
              </div>
              <img src={BRAND_LOGO_PATH} alt="" />
              <strong>{state.winnerMoment.username} is the winner</strong>
              <span>{formatHandName(state.winnerMoment.handName)}</span>
              <small>TEST ONLY · NO GOLD AWARDED</small>
            </div>
          ) : (
            <p className="dw-card-test-countdown" role="status">
              {countdown === null ? "Waiting for the next card…" : `Next card in ${Math.floor(countdown / 60)}:${String(countdown % 60).padStart(2, "0")}`}
            </p>
          )}
          {error && <p className="dw-card-test-error" role="alert">{error}</p>}
        </section>
      )}
    </div>
  );
}
