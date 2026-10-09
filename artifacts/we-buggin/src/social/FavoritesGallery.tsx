import type { SocialPerson } from '@workspace/api-client-react';
import { UserPhoto } from '@/components/user-photo';
import './favorites-gallery.css';

export type FavoriteEntry = {
  person: SocialPerson;
  room: { roomId: string; label: string } | null;
};

export function FavoritesGallery({ entries, onSelect, busyUsername }: {
  entries: FavoriteEntry[];
  onSelect: (entry: FavoriteEntry) => void;
  busyUsername: string | null;
}) {
  return (
    <ul className="fg-grid">
      {entries.map((entry) => {
        const { person, room } = entry;
        const name = person.displayName?.trim() || person.username;
        const busy = busyUsername === person.username;
        return (
          <li key={person.username} className="fg-item">
            <button
              type="button"
              className="fg-tile"
              aria-label={name}
              aria-busy={busy || undefined}
              disabled={busy}
              onClick={() => onSelect(entry)}
            >
              <span className="fg-photo">
                <UserPhoto username={person.username} displayName={person.displayName} photoUrl={person.photoUrl} size={160} />
              </span>
              {room && <span className="fg-room">{room.label}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
