import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { selectFeaturedRoom } from '../src/chat/directory-utils';

type Room = { roomId: string; headcount: number };

test('no room is featured when every live headcount is zero', () => {
  const rooms: Room[] = [
    { roomId: 'MUSIC1', headcount: 0 },
    { roomId: 'MOVIES', headcount: 0 },
  ];
  assert.equal(selectFeaturedRoom(rooms), undefined);
});

test('the most occupied room is featured using its real count', () => {
  const rooms: Room[] = [
    { roomId: 'MUSIC1', headcount: 2 },
    { roomId: 'MOVIES', headcount: 7 },
    { roomId: 'SPORTS', headcount: 1 },
  ];
  assert.deepEqual(selectFeaturedRoom(rooms), { roomId: 'MOVIES', headcount: 7 });
});

test('featured room selection reacts to new presence data without stored page state', () => {
  const before: Room[] = [{ roomId: 'MUSIC1', headcount: 1 }];
  const after: Room[] = [
    { roomId: 'MUSIC1', headcount: 0 },
    { roomId: 'MOVIES', headcount: 3 },
  ];
  assert.equal(selectFeaturedRoom(before)?.roomId, 'MUSIC1');
  assert.equal(selectFeaturedRoom(after)?.roomId, 'MOVIES');

  const source = readFileSync('src/chat/ChatApp.tsx', 'utf8');
  assert.match(source, /getGetChatDirectoryQueryKey\(\), refetchInterval: 5_000/);
});
