import { Link, useLocation } from 'wouter';
import { RoomChannels, RoomChannelBack } from '../../src/chat/RoomChannels';
import { ROOM_CHANNELS } from '../../src/chat/room-channels';
import { DirectoryRoomCard } from '../../src/chat/ChatApp';

/** Exercises production navigation components without joining rooms or publishing media. */
export function RoomChannelsFixture() {
  const [location] = useLocation();
  const roomId = location.match(/^\/rooms\/([^/]+)$/)?.[1];
  if (roomId) return <section data-testid="fixture-room-destination">
    <RoomChannelBack roomId={roomId} />
    <h1>{ROOM_CHANNELS.flatMap(channel => channel.rooms).find(room => room.roomId === roomId)?.label}</h1>
    <p>Isolated navigation destination — no live session or media.</p>
  </section>;
  const rooms = ROOM_CHANNELS.flatMap(channel => channel.rooms).map(room => ({
    ...room, headcount: 0, headcountSince: 0,
  }));
  return <div className="st-directory st-home"><RoomChannels
    rooms={rooms} loading={false}
    renderRoom={room => <DirectoryRoomCard room={room} topic={room.label} isFeatured={false} />}
    goLive={<Link className="st-home-go-live-button" href="/live">Go Live</Link>}
  /></div>;
}
