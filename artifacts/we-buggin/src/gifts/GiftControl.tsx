import { Gift } from 'lucide-react';
import './gifts.css';

export function GiftControl({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="gift-framework gift-control" onClick={onClick} data-testid="button-open-gift-bag">
      <Gift size={16} aria-hidden /> Gift
    </button>
  );
}
