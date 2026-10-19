import { useEffect, useState } from "react";
import { LogoImage } from "@/components/brand";
import type { RoomCoinDropEvent } from "./useTextRoom";

export function RoomCoinDropOverlay({
  event,
  onFinish,
}: {
  event: RoomCoinDropEvent | null;
  onFinish: (eventId: string) => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    setRevealed(false);
    setFading(false);
    if (!event) return;
    const reveal = window.setTimeout(() => setRevealed(true), 1500);
    const fade = window.setTimeout(() => setFading(true), 5000);
    const finish = window.setTimeout(() => onFinish(event.eventId), 5600);
    return () => {
      window.clearTimeout(reveal);
      window.clearTimeout(fade);
      window.clearTimeout(finish);
    };
  }, [event?.eventId, onFinish]);

  if (!event) return null;
  return (
    <div className={`ur-coin-drop${fading ? " is-fading" : ""}`} aria-live="polite" data-testid="room-coin-drop">
      <div className="ur-coin-drop-logo" aria-hidden="true">
        <LogoImage size={92} animated={false} />
      </div>
      <strong className={`ur-coin-drop-amount${revealed ? " is-revealed" : ""}`}>
        {revealed ? `${event.amount} COINS` : "…"}
      </strong>
      <span className="ur-coin-drop-message">
        {revealed
          ? event.qualified
            ? `You caught ${event.amount} coins!`
            : "Sit in a seat for 15 min to catch the next drop."
          : "A Deux Wild coin drop is here"}
      </span>
    </div>
  );
}
