import { Gift } from "lucide-react";
import "./gifts.css";

export const OPEN_ROOM_GIFTS_EVENT = "streamtalk:open-room-gifts";

export function GiftControl({ onClick, label = "Send a gift" }: {
  onClick: () => void;
  label?: string;
}) {
  return <button type="button" className="gift-framework gift-control" onClick={onClick}
    aria-label={label} data-testid="button-open-gift-bag">
    <span className="gift-control-media" aria-hidden="true"><Gift size={27} /></span>
  </button>;
}
