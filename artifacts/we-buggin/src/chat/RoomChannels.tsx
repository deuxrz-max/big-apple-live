import type { ReactNode } from 'react';
import { Link, Redirect, useSearch } from 'wouter';
import { ROOM_CHANNELS, channelBySlug, channelForDirectoryRoom, roomChannelHref } from './room-channels';
import './room-channels.css';
import { PinkCardRewardTile } from './PinkCardRewardTile';
import { WeatheredStreetSign } from './WeatheredStreetSign';

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
  baseHref?: string;
  showOtherRoomSigns?: boolean;
};

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
  baseHref = '/home',
  showOtherRoomSigns = false,
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
        {ROOM_CHANNELS.map((ch) => {
          return (
            <li key={ch.slug} className="rc-channel-item">
              <WeatheredStreetSign label={ch.title} slug={ch.slug} />
              <Link href={baseHref === '/' ? '/sign-in' : `/rooms/${ch.roomId}`} className={`rc-tile rc-channel-${ch.slug}`} data-testid={`link-channel-${ch.slug}`} aria-label={`Enter ${ch.title} room`}>
                <span className="rc-audio-room-art" aria-hidden="true" />
              </Link>
            </li>
          );
        })}
        <li className="pc-slot">
          <PinkCardRewardTile signedIn={baseHref !== '/'} />
        </li>
        <li className="st-home-go-live">{goLive}</li>
      </ul>
      {!loading && others.length > 0 && (
        <>
          <h2 className="rc-title rc-other-title">Other rooms</h2>
          <ul className={`rc-grid${showOtherRoomSigns ? ' rc-grid-signed-in-home' : ''}`}>
            {others.map((room) => (
              <li key={room.roomId} className={showOtherRoomSigns ? 'rc-other-room-item' : undefined}>
                {showOtherRoomSigns && <WeatheredStreetSign
                  label={room.label}
                  slug={`room-${room.roomId}`}
                  testId={`label-room-${room.roomId.toLowerCase()}`}
                />}
                {renderRoom(room)}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
