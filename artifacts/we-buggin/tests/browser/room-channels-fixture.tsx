import { Link, useLocation } from 'wouter';
import { useState } from 'react';
import { HomepageCauldron } from '../../src/chat/HomepageCauldron';
import { RoomChannels, RoomChannelBack } from '../../src/chat/RoomChannels';
import { ROOM_CHANNELS } from '../../src/chat/room-channels';
import { DirectoryRoomCard } from '../../src/chat/ChatApp';

/** Supplied values exercise display only; these controls do not exist in the real app. */
export function CauldronHoldFixture() {
  const [progress, setProgress] = useState(0);
  return <section>
    {[0, 25, 50, 75, 100].map(level =>
      <button key={level} onClick={() => setProgress(level)}>{level}% fixture input</button>)}
    <HomepageCauldron progressPercent={progress} />
  </section>;
}

/** Exercises production navigation components without joining rooms or publishing media. */
export function RoomChannelsFixture() {
  const [location] = useLocation();
  const roomId = location.match(/^\/rooms\/([^/]+)$/)?.[1];
  if (roomId) return <section data-testid="fixture-room-destination">
    <RoomChannelBack roomId={roomId} />
    <h1>{ROOM_CHANNELS.find(channel => channel.roomId === roomId)?.title
      ?? ROOM_CHANNELS.flatMap(channel => channel.rooms).find(room => room.roomId === roomId)?.label}</h1>
    <p>Isolated navigation destination — no live session or media.</p>
  </section>;
  const now = Date.now();
  const previews = new URLSearchParams(window.location.search).get('previews') === '1';
  const rooms = ROOM_CHANNELS.map((channel, i) => ({
    roomId: channel.roomId, label: channel.title, headcount: 0, headcountSince: 0,
    // MOCK video ids for fixture only; real playback is verified separately.
    nowPlayingVideoId: previews && i < 2 ? `mockvid${i}` : null,
    nowPlayingTitle: previews && i < 2 ? `Mock ${channel.title}` : null,
    nowPlayingStartedAtMs: previews ? now - 30_000 : null,
    nowPlayingServerNowMs: now,
  }));
  return <div className="st-directory st-home"><RoomChannels
    rooms={rooms} loading={false}
    renderRoom={room => <DirectoryRoomCard room={room} topic={room.label} isFeatured={false} />}
    goLive={<Link className="st-home-go-live-button" href="/live">Go Live</Link>}
  /></div>;
}
