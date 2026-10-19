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
  assert.match(themeCss, /#root \.ur-slots,[\s\S]*?aspect-ratio:\s*2\s*\/\s*1/);
  assert.match(themeCss, /#root \.ur-slot\s*\{[^}]*aspect-ratio:\s*1\s*\/\s*1/);
  assert.doesNotMatch(roomCss, /\.ur-slots\[data-count=/);
  assert.match(roomComponent, /beamSlots\.map/);
  assert.match(beamHook, /slots:\s*\[1,\s*2,\s*3,\s*4,\s*5,\s*6,\s*7,\s*8\]/);
});

test('the square beam sizes to its grid and self controls stay outside speaker tiles', () => {
  assert.match(themeCss, /#root \.ur-beam,[\s\S]*?flex:\s*0 0 auto/);
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
  assert.match(beamTv, /cc_load_policy:\s*0/);
  assert.match(beamTv, /unloadModule\("captions"\)/);
  assert.match(roomCss, /\.ur-tv-player iframe\{[^}]*pointer-events:none!important/);
  assert.doesNotMatch(roomComponent, /Tap to hear/);
});

test('the own seat mic toggles only local video sound and gates seat-conversation audio', () => {
  assert.match(roomComponent, /data-testid={mine \? `beam-seat-\$\{slot\.slotNumber\}` : undefined}/);
  assert.match(roomComponent, /toggleOwnMic\(!ownMicEnabled\)/);
  assert.match(roomComponent, /microphoneEnabled={ownMicEnabled}/);
  assert.match(beamTv, /setMicrophoneAudioMode/);
  assert.match(beamTv, /setBeamTvSoundMuted\(instance, enabled\)/);
  assert.match(beamTv, /microphoneEnabledRef\.current = enabled;\s*soundUnlockedRef\.current = !enabled/);
  assert.match(beamTv, /if \(!instance\) return true/);
  assert.match(beamHook, /autoSubscribe:\s*false/);
  assert.match(beamHook, /shouldSubscribeToBeamAudio/);
  assert.match(beamHook, /setSubscribed\(shouldSubscribe\)/);
  assert.doesNotMatch(beamHook, /snapshot\[args\.participantId\]/);
  assert.match(roomComponent, /onClick=\{leaveOwnSeat\}/);
});

test('empty slots remain full tiles that viewers can join by tapping or keyboard', () => {
  assert.match(roomComponent, /className="ur-slot-media"[\s\S]*?role={\(mine \|\| joinAvailable \|\| moveAvailable\) && !videoBeam\.busy \? 'button' : undefined}/);
  assert.match(roomComponent, /\$\{moveAvailable \? 'Move to' : 'Join'\} speaker spot \$\{slot\.slotNumber\}/);
  assert.match(roomComponent, /moveAvailable \? 'Move here' : joinAvailable \? 'Tap to join' : 'Open spot'/);
  assert.match(roomComponent, /className="ur-slot-empty-copy">[\s\S]*?className="ur-empty-number"[\s\S]*?className="ur-slot-name ur-empty-name"/);
  assert.match(themeCss, /#root \.ur-slot \.ur-slot-empty-copy\s*\{[^}]*align-content:\s*center/);
  assert.doesNotMatch(roomComponent, /Camera and mic start only after you join/);
});

test('beam seats ask for microphone only and show an avatar instead of camera video', () => {
  assert.match(beamHook, /createLocalTracks\(\{\s*audio:\s*\{/);
  assert.match(beamHook, /video:\s*false/);
  assert.doesNotMatch(beamHook, /facingMode|LocalVideoTrack/);
  assert.match(roomComponent, /<BeamAudioTrack track={media\?\.audio}/);
  assert.doesNotMatch(roomComponent, /VideoBeamMedia|Camera off|Cam off|Flip camera/);
  assert.match(roomComponent, /src={photoSrc\(person\.photoUrl\)}/);
  assert.match(roomComponent, /<IdentityAvatar identity={person\.identity}/);
  assert.match(roomComponent, /ur-slot-initial/);
});

test('speaker names stay in a compact footer and mic status is isolated in a corner', () => {
  assert.match(roomCss, /\.ur-slot-copy\{[^}]*position:absolute[^}]*bottom:0/);
  assert.match(themeCss, /#root \.ur-slot\.is-occupied \.ur-slot-copy\s*\{[^}]*background:\s*rgba\(5,\s*6,\s*12,\s*\.78\)/);
  assert.match(themeCss, /#root \.ur-slot\.is-occupied \.ur-slot-name-line\s*\{[^}]*justify-content:\s*flex-start/);
  assert.match(themeCss, /#root \.ur-slot\.is-occupied \.ur-slot-mic-icon\s*\{[^}]*position:\s*absolute/);
  assert.doesNotMatch(roomComponent, /ur-slot-mood/);
  assert.doesNotMatch(roomComponent, /context={`speaker-\$\{slot\.slotNumber\}`}/);
  assert.match(roomComponent, /<BadgeMark id={person\.badgeId/);
  assert.match(roomComponent, /person\.displayNameColor/);
  assert.match(roomComponent, /ur-slot-mic-icon/);
});

test('room title stays on one line and ellipsizes visually without changing its accessible name', () => {
  assert.match(themeCss, /#root \.ch\.ur \.ur-title\s*\{[^}]*white-space:\s*nowrap[^}]*text-overflow:\s*ellipsis/);
  assert.match(roomComponent, /aria-label={r\.room\?\.name \?\? 'University'}/);
});

test('all slot frames share the continuous neon cycle and reduce-motion fallback', () => {
  assert.match(roomCss, /\.ur-slot::before[^}]*animation:ur-frame-flow 32s linear infinite/);
  assert.match(roomCss, /#ff3c9d[^}]*#aa45ff[^}]*#397bff[^}]*#40e8ee/);
  assert.match(roomCss, /@keyframes ur-frame-flow/);
  assert.match(roomCss, /@media\(prefers-reduced-motion:reduce\)[\s\S]*?\.ur-slot::before\{animation:none/);
});
