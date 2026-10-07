import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { ENABLE_ROOM_MOOD_VISUALS, ROOM_VISUALS_SOCKET_PATH, type EmojiParticleEvent, type RoomAtmosphere, type RoomMoodUpdate } from '@workspace/beam-identity';
import { getBeamAudioCredentials } from '../services/beamService';
import { drawAtmosphere, rng } from './roomAtmosphere';
import './roomMood.css';

interface P { x: number; y: number; vy: number; sway: number; amp: number; ph: number; size: number; life: number; emoji: string }
const MAX = 100;

export function RoomMoodCanvas({ code, selfId }: { code: string; selfId: string }) {
  if (!ENABLE_ROOM_MOOD_VISUALS) return null;
  return <Inner code={code} selfId={selfId} />;
}

function Inner({ code, selfId }: { code: string; selfId: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [mood, setMood] = useState<RoomMoodUpdate | null>(null);

  useEffect(() => {
    setMood(null);
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const vv = window.visualViewport;
    let parts: P[] = [];
    let w = 0, h = 0, dpr = 1, raf = 0, last = 0;
    let atmo: RoomAtmosphere | null = null;
    let prevAtmo: RoomAtmosphere | null = null;
    let offset: number | null = null;
    let energy = 0, glow = 'rgba(59,91,255,0.25)';
    const seen: string[] = [];

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = Math.round(vv?.width ?? window.innerWidth); h = Math.round(vv?.height ?? window.innerHeight);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
      if (!raf) paintStatic();
    };
    const synced = () => Date.now() + (offset ?? 0);

    const paint = (dt: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (atmo) {
        const target = atmo.energy;
        energy = reduce.matches ? target : energy + (target - energy) * Math.min(1, dt * 0.6);
        drawAtmosphere(ctx, w, h, atmo, prevAtmo, synced(), energy, glow, reduce.matches);
      }
    };
    function paintStatic() { if (!document.hidden) paint(1); }

    const frame = (t: number) => {
      raf = 0;
      if (document.hidden || reduce.matches) { last = 0; return; }
      // Keep the visual layer lightweight on phones and alongside live audio.
      if (last && t - last < 1000 / 30) { raf = requestAnimationFrame(frame); return; }
      const dt = Math.min((t - (last || t)) / 1000, 0.05);
      last = t;
      paint(dt);
      parts = parts.filter(p => p.y > -60 && p.x >= -60 && p.x <= w + 60 && p.life > 0);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const p of parts) {
        p.y -= p.vy * dt; p.ph += p.sway * dt; p.life -= dt * 0.22;
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life)) * 0.55;
        ctx.font = `${p.size}px sans-serif`;
        ctx.fillText(p.emoji, p.x + Math.sin(p.ph) * p.amp, p.y);
      }
      ctx.globalAlpha = 1;
      if (atmo || parts.length) raf = requestAnimationFrame(frame);
      else last = 0;
    };
    const kick = () => {
      if (document.hidden) return;
      if (reduce.matches) { paintStatic(); return; }
      if (!raf) raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0; last = 0;
    };
    const wipe = () => { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); };
    const onVis = () => {
      if (document.hidden) { stop(); parts = []; wipe(); } else kick();
    };
    const onMotion = () => { stop(); parts = []; wipe(); kick(); };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(document.documentElement);
    window.addEventListener('resize', resize);
    vv?.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVis);
    reduce.addEventListener('change', onMotion);

    const socket = io({
      path: ROOM_VISUALS_SOCKET_PATH,
      transports: ['polling'],
      auth: { roomId: code, participantSessionId: getBeamAudioCredentials(code, selfId).participantSessionId },
    });
    socket.on('connect_error', err => {
      if (!socket.active || /auth|unauthor|forbidden|join this beam/i.test(err.message)) socket.disconnect();
    });
    socket.on('emoji_particle', (e: EmojiParticleEvent) => {
      if (!e || e.roomId !== code || document.hidden || reduce.matches || seen.includes(e.eventId)) return;
      seen.push(e.eventId); if (seen.length > 64) seen.shift();
      const r = rng(e.seed);
      const n = Math.max(3, Math.min(8, Math.floor(e.burstSize) || 3));
      const originX = w * (0.1 + r() * 0.8);
      for (let i = 0; i < n && parts.length < MAX; i++) {
        parts.push({ x: Math.max(16, Math.min(w - 16, originX + (r() - 0.5) * 90)), y: h + 20 + r() * 40, vy: 90 + r() * 120, sway: 1 + r() * 2, amp: 10 + r() * 24, ph: r() * 6.28, size: 24 + r() * 28, life: 1.2, emoji: e.emoji });
      }
      kick();
    });
    socket.on('room_mood_update', (m: RoomMoodUpdate) => {
      if (!m || m.roomId !== code) return;
      glow = m.glowColor;
      const a = m.atmosphere;
      if (a) {
        // Least-latency clock estimate: rises immediately, falls slowly.
        const sample = a.serverTime - Date.now();
        offset = offset === null ? sample : sample > offset ? sample : offset + (sample - offset) * 0.1;
        if (!atmo || atmo.cycleId !== a.cycleId || atmo.startedAt !== a.startedAt) {
          prevAtmo = atmo && atmo.cycleId !== a.cycleId ? atmo : prevAtmo;
          if (!atmo) energy = a.energy;
        }
        atmo = a;
      }
      setMood(m);
      kick();
    });
    kick();

    return () => {
      socket.removeAllListeners(); socket.disconnect();
      ro.disconnect(); window.removeEventListener('resize', resize);
      vv?.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVis);
      reduce.removeEventListener('change', onMotion);
      stop();
    };
  }, [code, selfId]);

  const a = mood?.atmosphere;
  return (
    <>
      <div className="bm-mood-backdrop" aria-hidden="true" data-testid="backdrop-room-mood" data-mood-emoji={mood?.emoji ?? ''}
        data-scene-phase={a?.phase ?? ''} data-scene-cycle={a?.cycleId ?? ''} data-scene-energy={a ? a.energy.toFixed(3) : ''}
        style={{ backgroundColor: mood ? `${mood.moodColor}10` : 'transparent' }}>
        <div className="bm-mood-glow" style={{ backgroundColor: mood?.glowColor ?? 'transparent' }} />
      </div>
      <div className="bm-mood-dark" aria-hidden="true" />
      <canvas ref={ref} className="bm-mood-canvas" aria-hidden="true" data-testid="canvas-room-mood" />
    </>
  );
}
