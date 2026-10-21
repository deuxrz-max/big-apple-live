import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { arrangeVideoBeamSeats } from '../src/chat/video-beam-seat-layout';

const roomCss = readFileSync('src/chat/university-room.css', 'utf8');
const roomComponent = readFileSync('src/chat/UniversityRoom.tsx', 'utf8');
const beamTv = readFileSync('src/chat/BeamTv.tsx', 'utf8');
const themeCss = readFileSync('src/theme.css', 'utf8');
const beamHook = readFileSync('src/chat/useUniversityVideoBeam.ts', 'utf8');

test('Video Beam centers the host with four guest seats on each side', () => {
  const slotsRule = roomCss.match(/\.ur-slots\s*\{([^}]*)\}/)?.[1] ?? '';
  assert.match(slotsRule, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)\s+minmax\(0,\s*1\.55fr\)\s+repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(slotsRule, /grid-template-rows:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(themeCss, /#root \.ur-slots,[\s\S]*?aspect-ratio:\s*2\s*\/\s*1/);
  assert.match(themeCss, /#root \.ur-slot\s*\{[^}]*aspect-ratio:\s*auto/);
  assert.doesNotMatch(roomCss, /\.ur-slots\[data-count=/);
  assert.match(roomComponent, /beamSeatLayout\.map/);
  assert.match(roomComponent, /data-seat-position={area}/);
  assert.match(beamHook, /slots:\s*\[1,\s*2,\s*3,\s*4,\s*5,\s*6,\s*7,\s*8,\s*9\]/);
});

test('seat layout gives the host the center tile and exactly four spaces per side', () => {
  const slots = Array.from({ length: 9 }, (_, index) => ({
    slotNumber: index + 1,
    participantId: index === 4 ? 'host' : null,
  }));
  const layout = arrangeVideoBeamSeats(slots, 'host');
  assert.equal(layout.length, 9);
  assert.deepEqual(layout.filter(item => item.area === 'left').map(item => item.slot.slotNumber), [1, 2, 3, 4]);
  assert.deepEqual(layout.filter(item => item.area === 'host').map(item => item.slot.slotNumber), [5]);
  assert.deepEqual(layout.filter(item => item.area === 'right').map(item => item.slot.slotNumber), [6, 7, 8, 9]);
  assert.deepEqual(layout.find(item => item.area === 'host'), {
    slot: { slotNumber: 5, participantId: 'host' },
    area: 'host',
    gridColumn: 3,
    gridRow: 1,
  });
});

test('ownerless rooms keep the first seat centered when no beam host exists', () => {
  const slots = Array.from({ length: 9 }, (_, index) => ({
    slotNumber: index + 1,
    participantId: index < 2 ? `speaker-${index + 1}` : null,
  }));
  const layout = arrangeVideoBeamSeats(slots, null);
  assert.equal(layout.find(item => item.area === 'host')?.slot.slotNumber, 1);
});

test('user-created social rooms hide TV and enlarge the same nine-seat grid around the room host', () => {
  assert.match(roomComponent, /const isSocialRoom = r\.room\?\.roomType === 'social'/);
  assert.match(roomComponent, /!isSocialRoom && <BeamTv/);
  assert.match(roomComponent, /roomHostParticipantId = isSocialRoom[\s\S]*r\.room\?\.hostParticipantId/);
  assert.match(roomComponent, /data-tv={!isSocialRoom && videoBeam\.beam\.tv\.enabled \? 'on' : 'off'}/);
  assert.match(roomCss, /\.ch\.ur \.ur-social-room \.ur-beam\.is-social-room\{flex:0 0 66%/);
  assert.match(roomCss, /\.ch\.ur \.ur-social-room \.ur-slots\{gap:7px\}/);
  assert.match(roomComponent, /beamSeatLayout\.map/);
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
  assert.match(roomComponent, /const seatInteractive = profileTap \|\| mine \|\| joinAvailable \|\| moveAvailable/);
  assert.match(roomComponent, /className="ur-slot-media"[\s\S]*?role={seatInteractive && !videoBeam\.busy \? 'button' : undefined}/);
  assert.match(roomComponent, /\$\{moveAvailable \? 'Move to' : 'Join'\} speaker spot \$\{slot\.slotNumber\}/);
  assert.match(roomComponent, /moveAvailable \? 'Move here' : joinAvailable \? 'Tap to join' : 'Open spot'/);
  assert.match(roomComponent, /className="ur-slot-empty-copy">[\s\S]*?className="ur-empty-number"[\s\S]*?className="ur-slot-name ur-empty-name"/);
  assert.match(themeCss, /#root \.ur-slot \.ur-slot-empty-copy\s*\{[^}]*align-content:\s*center/);
  assert.doesNotMatch(roomComponent, /Camera and mic start only after you join/);
});

test('created-room seat taps open profile cards while themed-room self taps still toggle the mic', () => {
  assert.match(roomComponent, /const profileTap = isSocialRoom && !!person/);
  assert.match(roomComponent, /if \(profileTap && person\)[\s\S]*?openMenu\(person\.username/);
  assert.match(roomComponent, /else if \(mine\) handleOwnSeatTap\(\)/);
  assert.match(roomComponent, /const handleOwnSeatTap = \(\) => toggleOwnMic\(!ownMicEnabled\)/);
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
  assert.match(roomComponent, /aria-label={r\.room\?\.name \?\? 'Room'}/);
});

test('all slot frames share the continuous neon cycle and reduce-motion fallback', () => {
  assert.match(roomCss, /\.ur-slot::before[^}]*animation:ur-frame-flow 32s linear infinite/);
  assert.match(roomCss, /#ff3c9d[^}]*#aa45ff[^}]*#397bff[^}]*#40e8ee/);
  assert.match(roomCss, /@keyframes ur-frame-flow/);
  assert.match(roomCss, /@media\(prefers-reduced-motion:reduce\)[\s\S]*?\.ur-slot::before\{animation:none/);
});
