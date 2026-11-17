import type { ReactNode } from 'react';
import { Link, Redirect, useLocation, useSearch } from 'wouter';
import { Shuffle } from 'lucide-react';
import { AETHELGARD_CITIES, randomAethelgardCity, battleHrefForCity } from '@/battle/aethelgard-cities';
import { channelBySlug, channelForDirectoryRoom, roomChannelHref } from './room-channels';
import './room-channels.css';

export type DirectoryChannelRoom = {
  roomId: string;
  label: string;
  headcount: number;
  headcountSince?: number;
};

export type RoomChannelsProps<R extends DirectoryChannelRoom> = {
  rooms: R[];
  loading: boolean;
  renderRoom: (room: R) => ReactNode;
  goLive: ReactNode;
  battle?: ReactNode;
  random?: ReactNode;
  baseHref?: string;
  showMap?: boolean;
};

export function RandomCityBattleButton({ testId }: { testId: string }) {
  const [, setLocation] = useLocation();
  const city = randomAethelgardCity;

  return (
    <button type="button"
      className="bm-btn bm-btn-primary rc-random-button"
      data-testid={testId}
      onClick={() => setLocation(battleHrefForCity(city()))}>
      <Shuffle size={17} aria-hidden="true" /> Random
    </button>
  );
}

/** Square "Back to [channel]" link; renders nothing for rooms outside the 8 topic rooms. */
export function RoomChannelBack({ roomId }: { roomId: string }) {
  const channel = channelForDirectoryRoom(roomId);
  const href = roomChannelHref(roomId);
  if (!channel || !href) return null;
  return <Link href={href} className="ur-channel-back" data-testid="link-back-to-channel">{href === '/home' ? 'Back to channels' : `Back to ${channel.title}`}</Link>;
}

export function RoomChannels<R extends DirectoryChannelRoom>({
  rooms,
  loading,
  renderRoom,
  goLive,
  battle,
  random,
  baseHref = '/home',
  showMap = true,
}: RoomChannelsProps<R>) {
  const search = useSearch();
  const selected = channelBySlug(new URLSearchParams(search).get('channel'));
  const others = rooms.filter((r) => !channelForDirectoryRoom(r.roomId));

  if (selected) {
    return <Redirect to={baseHref === '/' ? '/sign-in' : `/rooms/${selected.roomId}`} />;
  }

  return (
    <div className="rc" data-testid="section-room-channels">
      <ul className="rc-tiles">
        {showMap && (
          <li className="rc-map-item">
            <div className="rc-map-frame" role="group" aria-label="Aethelgard map with eight selectable cities">
              <div
                className="rc-map-tile"
                role="group"
                aria-label="Choose a city on the Aethelgard map"
                data-testid="image-home-map"
              >
                <video className="rc-map-video" autoPlay muted loop playsInline preload="metadata"
                  poster={`${import.meta.env.BASE_URL}battle-assets/screens/aethelgard-map-poster.jpg`}
                  aria-hidden="true">
                  <source src={`${import.meta.env.BASE_URL}battle-assets/screens/aethelgard-map-loop.mp4`} type="video/mp4" />
                </video>
                {AETHELGARD_CITIES.map(city => (
                  <Link key={city.slug} href={`/city/${city.slug}`}
                    className="rc-city-marker"
                    style={{ left: `${city.left}%`, top: `${city.top}%` }}
                    aria-label={`Open ${city.name}`}
                    data-testid={`link-city-${city.slug}`}>
                    {city.name}
                  </Link>
                ))}
                {battle && <div className="rc-map-battle">{battle}</div>}
              </div>
            </div>
            {random && <div className="rc-map-actions">{random}</div>}
          </li>
        )}
        {goLive != null && <li className="st-home-go-live">{goLive}</li>}
      </ul>
      {!loading && others.length > 0 && (
        <ul className="rc-grid">
          {others.map((room) => <li key={room.roomId}>{renderRoom(room)}</li>)}
        </ul>
      )}
    </div>
  );
}
