import type { ReactNode } from 'react';
import { Link, useSearch } from 'wouter';
import { ArrowLeft } from 'lucide-react';
import { ROOM_CHANNELS, channelBySlug, channelForDirectoryRoom, roomChannelHref } from './room-channels';
import './room-channels.css';
import { HomepageCauldron } from './HomepageCauldron';

export type DirectoryChannelRoom = {
  roomId: string;
  label: string;
  headcount: number;
  headcountSince?: number;
  nowPlayingVideoId?: string | null;
  nowPlayingTitle?: string | null;
};

export type RoomChannelsProps<R extends DirectoryChannelRoom> = {
  rooms: R[];
  loading: boolean;
  renderRoom: (room: R) => ReactNode;
  goLive: ReactNode;
  baseHref?: string;
};

/** Square "Back to [channel]" link; renders nothing for rooms outside the 8 topic rooms. */
export function RoomChannelBack({ roomId }: { roomId: string }) {
  const channel = channelForDirectoryRoom(roomId);
  const href = roomChannelHref(roomId);
  if (!channel || !href) return null;
  return <Link href={href} className="ur-channel-back" data-testid="link-back-to-channel">Back to {channel.title}</Link>;
}

export function RoomChannels<R extends DirectoryChannelRoom>({ rooms, loading, renderRoom, goLive, baseHref = '/home' }: RoomChannelsProps<R>) {
  const search = useSearch();
  const selected = channelBySlug(new URLSearchParams(search).get('channel'));
  const roomsIn = (slug: string) => {
    const ch = channelBySlug(slug)!;
    const order = ch.rooms.map((r) => r.roomId);
    return rooms
      .filter((r) => channelForDirectoryRoom(r.roomId)?.slug === slug)
      .map((r, i) => ({ r, i, base: order.findIndex((id) => r.roomId.toUpperCase().startsWith(id)) }))
      .sort((a, b) => a.base - b.base || a.i - b.i)
      .map((x) => x.r);
  };
  const others = rooms.filter((r) => !channelForDirectoryRoom(r.roomId));

  if (selected) {
    const list = roomsIn(selected.slug);
    return (
      <div className="rc" data-testid={`section-channel-${selected.slug}`}>
        <div className="rc-head">
          <Link href={baseHref} className="rc-back" data-testid="link-back-to-channels"><ArrowLeft size={15} aria-hidden="true" />Back to channels</Link>
          <h2 className="rc-title" data-testid="text-channel-title">{selected.title}</h2>
        </div>
        <ul className="rc-grid">
          <li className="st-home-go-live">{goLive}</li>
          {loading
            ? [0, 1, 2].map((n) => <li className="st-dir-skeleton" key={n}><span /><div><i /><i /></div></li>)
            : list.map((room) => <li key={room.roomId}>{renderRoom(room)}</li>)}
        </ul>
        {!loading && list.length === 0 && <p className="rc-empty">No rooms open in this channel right now.</p>}
      </div>
    );
  }

  return (
    <div className="rc" data-testid="section-room-channels">
      <ul className="rc-tiles">
        {ROOM_CHANNELS.map((ch) => {
          const count = rooms.filter((r) => channelForDirectoryRoom(r.roomId)?.slug === ch.slug).reduce((n, r) => n + r.headcount, 0);
          return (
            <li key={ch.slug}>
              <Link href={`${baseHref}?channel=${ch.slug}`} className="rc-tile" data-testid={`link-channel-${ch.slug}`}>
                <span className="rc-tile-title">{ch.title}</span>
                <span className="rc-tile-rooms">{ch.rooms.map((r) => r.label).join(' · ')}</span>
                <span className="rc-tile-count">{loading ? '…' : `${count} here`}</span>
              </Link>
            </li>
          );
        })}
        <li className="hp-cauldron-slot"><HomepageCauldron /></li>
        <li className="st-home-go-live">{goLive}</li>
      </ul>
      {!loading && others.length > 0 && (
        <>
          <h2 className="rc-title rc-other-title">Other rooms</h2>
          <ul className="rc-grid">{others.map((room) => <li key={room.roomId}>{renderRoom(room)}</li>)}</ul>
        </>
      )}
    </div>
  );
}
