import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const roomCss = readFileSync('src/chat/university-room.css', 'utf8');
const roomComponent = readFileSync('src/chat/UniversityRoom.tsx', 'utf8');

test('Video Beam always keeps four equal grid cells at one, two, three, or four speakers', () => {
  const slotsRule = roomCss.match(/\.ur-slots\s*\{([^}]*)\}/)?.[1] ?? '';
  assert.match(slotsRule, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(slotsRule, /grid-template-rows:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.doesNotMatch(roomCss, /\.ur-slots\[data-count=/);
  assert.match(roomComponent, /beamSlots\.map/);
});

test('the beam takes half the room height and self controls sit outside speaker tiles', () => {
  assert.match(roomCss, /\.ur-beam\s*\{[^}]*flex:0 0 50%/);
  assert.match(roomComponent, /className="ur-beam-self-controls"/);
  assert.match(roomComponent, /aria-label="Your beam controls"/);
  assert.doesNotMatch(roomComponent, /{mine && \(\s*<>/);
});

test('empty slots remain full tiles that viewers can join by tapping or keyboard', () => {
  assert.match(roomComponent, /className="ur-slot-media"[\s\S]*?role={joinAvailable && !videoBeam\.busy \? 'button' : undefined}/);
  assert.match(roomComponent, /Join open speaker spot \$\{slot\.slotNumber\}/);
  assert.match(roomComponent, /ur-empty-name">Open spot</);
});

test('all slot frames share the continuous neon cycle and reduce-motion fallback', () => {
  assert.match(roomCss, /\.ur-slot::before[^}]*animation:ur-frame-flow 32s linear infinite/);
  assert.match(roomCss, /#ff3c9d[^}]*#aa45ff[^}]*#397bff[^}]*#40e8ee/);
  assert.match(roomCss, /@keyframes ur-frame-flow/);
  assert.match(roomCss, /@media\(prefers-reduced-motion:reduce\)[\s\S]*?\.ur-slot::before\{animation:none/);
});
