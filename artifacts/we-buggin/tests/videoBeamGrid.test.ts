import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const roomCss = readFileSync('src/chat/university-room.css', 'utf8');
const roomComponent = readFileSync('src/chat/UniversityRoom.tsx', 'utf8');
const beamTv = readFileSync('src/chat/BeamTv.tsx', 'utf8');
const themeCss = readFileSync('src/theme.css', 'utf8');
const beamHook = readFileSync('src/chat/useUniversityVideoBeam.ts', 'utf8');

test('Video Beam always keeps eight equal grid cells in two rows of four', () => {
  const slotsRule = roomCss.match(/\.ur-slots\s*\{([^}]*)\}/)?.[1] ?? '';
  assert.match(slotsRule, /grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(slotsRule, /grid-template-rows:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.doesNotMatch(roomCss, /\.ur-slots\[data-count=/);
  assert.match(roomComponent, /beamSlots\.map/);
  assert.match(beamHook, /slots:\s*\[1,\s*2,\s*3,\s*4,\s*5,\s*6,\s*7,\s*8\]/);
});

test('the beam takes half the room height and self controls sit outside speaker tiles', () => {
  assert.match(roomCss, /\.ur-beam\s*\{[^}]*flex:0 0 50%/);
  assert.match(roomComponent, /className="ur-beam-self-controls"/);
  assert.match(roomComponent, /aria-label="Your beam controls"/);
  assert.doesNotMatch(roomComponent, /{mine && \(\s*<>/);
});

test('TV-on speaker controls and room chat stay compact on phones', () => {
  assert.match(themeCss, /#root \.ur-slots\[data-tv="on"\] \.ur-slot\.is-occupied \.ur-slot-action\s*\{[^}]*width:\s*18px/);
  assert.match(themeCss, /#root \.ch\.ur \.ch-msgs\s*\{[^}]*gap:\s*3px/);
  assert.match(themeCss, /#root \.ch\.ur \.ch-msg\s*\{[^}]*font-size:\s*12px/);
  assert.match(themeCss, /#root \.ch\.ur \.ch-comp input\[type="text"\]\s*\{[^}]*height:\s*30px/);
  assert.match(themeCss, /#root \.ch\.ur \.ch-comp button\s*\{[^}]*min-height:\s*30px/);
});

test('YouTube sound unlocks from the first room gesture without adding a player control', () => {
  assert.match(roomComponent, /onPointerDownCapture={activateRoomAudio}/);
  assert.match(roomComponent, /onKeyDownCapture={activateRoomAudio}/);
  assert.match(roomComponent, /onWheelCapture={activateRoomAudio}/);
  assert.match(beamTv, /activateSoundFromUserGesture/);
  assert.match(beamTv, /\.unMute\(\)/);
  assert.match(beamTv, /setVolume\(100\)/);
  assert.match(beamTv, /Tap anywhere for sound/);
  assert.match(beamTv, /controls:\s*0/);
  assert.match(beamTv, /disablekb:\s*1/);
  assert.match(roomCss, /\.ur-tv-player iframe\{[^}]*pointer-events:none!important/);
  assert.doesNotMatch(roomComponent, /Tap to hear/);
});

test('empty slots remain full tiles that viewers can join by tapping or keyboard', () => {
  assert.match(roomComponent, /className="ur-slot-media"[\s\S]*?role={joinAvailable && !videoBeam\.busy \? 'button' : undefined}/);
  assert.match(roomComponent, /Join open speaker spot \$\{slot\.slotNumber\}/);
  assert.match(roomComponent, /joinAvailable \? 'Tap to join' : 'Open spot'/);
  assert.doesNotMatch(roomComponent, /Camera and mic start only after you join/);
});

test('live video is forced to fill and crop inside every camera tile', () => {
  assert.match(roomCss, /\.ur-live-video\{[^}]*position:absolute[^}]*inset:0[^}]*width:100%[^}]*height:100%[^}]*object-fit:cover/);
  assert.match(beamHook, /objectFit:\s*"cover"/);
  assert.match(beamHook, /minWidth:\s*"100%"/);
  assert.match(beamHook, /minHeight:\s*"100%"/);
  assert.match(roomComponent, /className="ur-video-fill"[\s\S]*?<VideoBeamMedia/);
  assert.match(themeCss, /#root \.ur-slot\.is-occupied \.ur-slot-media\s*\{[^}]*flex:\s*1 1 0%/);
  assert.match(themeCss, /#root \.ur-slot-media \.ur-video-fill > \.ur-live-video\s*\{[^}]*height:\s*100% !important[^}]*object-fit:\s*cover !important/);
  assert.match(themeCss, /#root \.ur-slot\.is-occupied \.ur-slot-actions\s*\{[^}]*position:\s*absolute/);
});

test('speaker name, mood emoji, and badges stay in a compact bottom bar', () => {
  assert.match(roomCss, /\.ur-slot-copy\{[^}]*position:absolute[^}]*bottom:0/);
  assert.match(themeCss, /#root \.ur-slot\.is-occupied \.ur-slot-copy\s*\{[^}]*background:\s*rgba\(5,\s*6,\s*12,\s*\.78\)/);
  assert.match(themeCss, /#root \.ur-slot\.is-occupied \.ur-slot-name-line\s*\{[^}]*justify-content:\s*flex-start/);
  assert.match(roomComponent, /ur-slot-mood/);
  assert.match(roomComponent, /ur-slot-marks/);
});

test('all slot frames share the continuous neon cycle and reduce-motion fallback', () => {
  assert.match(roomCss, /\.ur-slot::before[^}]*animation:ur-frame-flow 32s linear infinite/);
  assert.match(roomCss, /#ff3c9d[^}]*#aa45ff[^}]*#397bff[^}]*#40e8ee/);
  assert.match(roomCss, /@keyframes ur-frame-flow/);
  assert.match(roomCss, /@media\(prefers-reduced-motion:reduce\)[\s\S]*?\.ur-slot::before\{animation:none/);
});
