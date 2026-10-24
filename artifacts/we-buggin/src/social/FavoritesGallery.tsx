import type { SocialPerson } from '@workspace/api-client-react';
import { UserPhoto } from '@/components/user-photo';
import { ProfileTap } from '@/profile/QuickProfile';
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
            <div className="fg-tile fg-tile-split" aria-busy={busy || undefined} data-testid={`tile-following-${person.username}`}>
              <ProfileTap username={person.username} className="fg-photo-tap" label={`Open profile for ${name}`}>
                <span className="fg-photo">
                  <UserPhoto username={person.username} displayName={person.displayName} photoUrl={person.photoUrl} size={160} />
                </span>
              </ProfileTap>
              {room && <button type="button" className="fg-room fg-join" disabled={busy}
                aria-label={`${name}, ${room.label}. Join room`} onClick={() => onSelect(entry)}
                data-testid={`button-join-following-${person.username}`}>{room.label}</button>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
