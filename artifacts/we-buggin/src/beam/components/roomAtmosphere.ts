import type { RoomAtmosphere } from '@workspace/beam-identity';

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const PALETTE: Record<RoomAtmosphere['phase'], string[]> = {
  drift: ['150,160,255', '180,140,255', '120,180,255'],
  bloom: ['210,120,255', '255,130,190', '160,120,255'],
  aurora: ['90,220,220', '120,150,255', '170,120,255'],
};
const MAX_MOTES = 60;
const mod1 = (v: number) => ((v % 1) + 1) % 1;

function drawPhase(ctx: CanvasRenderingContext2D, w: number, h: number, a: RoomAtmosphere, now: number, k: number, intensity: number, reduced: boolean) {
  if (k <= 0.01) return;
  const col = PALETTE[a.phase];
  const t = reduced ? 0 : Math.max(0, now - a.startedAt) / 1000;
  const r = rng(a.seed ^ (a.cycleId * 2654435761));
  const n = Math.round((16 + intensity * 44));
  const count = Math.min(MAX_MOTES, n);
  const m = Math.min(w, h);

  if (a.phase === 'aurora') {
    for (let b = 0; b < 3; b++) {
      const base = h * (0.22 + b * 0.17), ph = r() * 6.28, amp = h * (0.05 + r() * 0.05);
      const g = ctx.createLinearGradient(0, base - amp * 2, 0, base + amp * 3);
      g.addColorStop(0, `rgba(${col[b]},0)`);
      g.addColorStop(0.5, `rgba(${col[b]},${0.1 * k * (0.4 + intensity)})`);
      g.addColorStop(1, `rgba(${col[b]},0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(0, h);
      for (let x = 0; x <= w + 20; x += 20) {
        const y = base + Math.sin(x / (w * 0.22) + t * 0.35 + ph) * amp + Math.sin(x / (w * 0.09) - t * 0.6 + ph) * amp * 0.4;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h); ctx.closePath();
      ctx.globalAlpha = 1; ctx.fill();
    }
  }

  for (let i = 0; i < count; i++) {
    const x0 = r(), y0 = r(), sz = 1.2 + r() * 2.6, sp = 0.012 + r() * 0.03, ph = r() * 6.28, c = col[i % 3];
    let x: number, y: number, al: number;
    if (a.phase === 'drift') {
      y = mod1(y0 - t * sp) * (h + 40) - 20;
      x = x0 * w + Math.sin(t * 0.4 + ph) * 26;
      al = 0.5 + 0.5 * Math.sin(t * 0.8 + ph);
    } else if (a.phase === 'bloom') {
      const p = mod1(t / 11 + y0);
      const ang = x0 * 6.283 + t * 0.05;
      const rad = p * m * 0.75;
      x = w / 2 + Math.cos(ang) * rad * (w / m) * 0.8; y = h * 0.5 + Math.sin(ang) * rad * 0.9;
      al = Math.sin(p * Math.PI);
    } else {
      x = mod1(x0 + Math.sin(t * 0.05 + ph) * 0.03 + t * sp * 0.5) * w;
      y = h * (0.12 + y0 * 0.6) + Math.sin(t * 0.5 + ph) * 18;
      al = 0.4 + 0.6 * Math.sin(t * 1.1 + ph) ** 2;
    }
    const rr = sz * (a.phase === 'bloom' ? 1.6 : 1) * (0.8 + intensity * 0.6);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rr * 4);
    const o = Math.max(0, al) * k * (0.25 + intensity * 0.45);
    g.addColorStop(0, `rgba(${c},${o})`); g.addColorStop(1, `rgba(${c},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rr * 4, 0, 6.283); ctx.fill();
  }
}

export function drawAtmosphere(ctx: CanvasRenderingContext2D, w: number, h: number, a: RoomAtmosphere | null, prev: RoomAtmosphere | null, now: number, energy: number, glow: string, reduced: boolean) {
  if (!a) return;
  // Reduced motion must stay still even when a server energy tick arrives.
  const intensity = reduced ? 0.2 : 0.2 + 0.8 * Math.max(0, Math.min(1, energy));
  // breathing glow, phase from absolute synced time
  const breath = reduced ? 0.5 : 0.5 + 0.5 * Math.sin((now / 7000) * 6.283);
  const gr = Math.max(w, h) * (0.45 + 0.08 * breath + 0.15 * intensity);
  const g = ctx.createRadialGradient(w / 2, h * 1.05, 0, w / 2, h * 1.05, gr);
  g.addColorStop(0, glow); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = (0.1 + 0.18 * intensity) * (0.75 + 0.25 * breath);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 1;
  const fade = reduced ? 1 : Math.min(1, Math.max(0, now - a.startedAt) / 3000);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  if (prev && fade < 1 && prev.cycleId !== a.cycleId) drawPhase(ctx, w, h, prev, now, 1 - fade, intensity, reduced);
  drawPhase(ctx, w, h, a, now, fade, intensity, reduced);
  ctx.restore();
}
