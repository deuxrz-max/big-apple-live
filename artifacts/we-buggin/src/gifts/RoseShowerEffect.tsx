import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ShinyName } from '@/components/ShinyName';

type Petal = {
  angle: number;
  delay: number;
  direction: number;
  depth: number;
  drift: number;
  length: number;
  width: number;
  spin: number;
  hue: number;
};

type Spark = {
  angle: number;
  delay: number;
  distance: number;
  size: number;
  phase: number;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const easeOut = (value: number) => 1 - (1 - value) ** 3;

function makeParticles() {
  let seed = 0x51a7;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x1_0000_0000;
  };

  const petals: Petal[] = Array.from({ length: 34 }, (_, index) => {
    const depth = 0.25 + random() * 0.75;
    return {
      angle: random() * Math.PI * 2 + index * 2.399,
      delay: random() * 0.65 + (index % 4) * 0.055,
      direction: random() > 0.5 ? 1 : -1,
      depth,
      drift: (random() - 0.5) * 0.34,
      length: 1.16 + random() * 0.68,
      width: 0.48 + random() * 0.38,
      spin: (random() - 0.5) * 5.2,
      hue: random(),
    };
  });
  const sparks: Spark[] = Array.from({ length: 24 }, () => ({
    angle: random() * Math.PI * 2,
    delay: random() * 1.1,
    distance: 0.14 + random() * 0.48,
    size: 1.2 + random() * 2.4,
    phase: random() * Math.PI * 2,
  }));
  return { petals, sparks };
}

function drawPetal(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  rotation: number,
  alpha: number,
  hue: number,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.globalAlpha = alpha;

  const w = width;
  const h = height;
  const shade = Math.round(hue * 18);
  const fill = ctx.createLinearGradient(-w * 0.5, -h * 0.48, w * 0.34, h * 0.45);
  fill.addColorStop(0, `rgb(${107 + shade}, 5, 25)`);
  fill.addColorStop(0.34, `rgb(${171 + shade}, 13, 39)`);
  fill.addColorStop(0.7, `rgb(${194 + shade}, 31, 54)`);
  fill.addColorStop(1, 'rgb(77, 3, 19)');

  ctx.shadowColor = 'rgba(216, 25, 54, 0.28)';
  ctx.shadowBlur = Math.min(7, width * 0.1);
  ctx.beginPath();
  ctx.moveTo(0, -h * 0.5);
  ctx.bezierCurveTo(-w * 0.62, -h * 0.34, -w * 0.58, h * 0.18, -w * 0.08, h * 0.49);
  ctx.quadraticCurveTo(0, h * 0.55, w * 0.08, h * 0.49);
  ctx.bezierCurveTo(w * 0.58, h * 0.18, w * 0.62, -h * 0.34, 0, -h * 0.5);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.shadowBlur = 0;

  const rim = ctx.createLinearGradient(-w * 0.45, -h * 0.32, w * 0.4, h * 0.42);
  rim.addColorStop(0, 'rgba(255, 149, 157, 0.72)');
  rim.addColorStop(0.48, 'rgba(255, 107, 126, 0.24)');
  rim.addColorStop(1, 'rgba(255, 172, 173, 0.04)');
  ctx.strokeStyle = rim;
  ctx.lineWidth = Math.max(0.8, width * 0.025);
  ctx.beginPath();
  ctx.moveTo(-w * 0.27, -h * 0.22);
  ctx.bezierCurveTo(-w * 0.38, -h * 0.02, -w * 0.26, h * 0.24, 0, h * 0.47);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255, 182, 184, 0.36)';
  ctx.lineWidth = Math.max(0.55, width * 0.013);
  ctx.beginPath();
  ctx.moveTo(0, -h * 0.39);
  ctx.bezierCurveTo(w * 0.04, -h * 0.06, -w * 0.04, h * 0.2, 0, h * 0.43);
  ctx.stroke();
  ctx.restore();
}

function drawBloom(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, scale: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  const count = 7;
  for (let i = count - 1; i >= 0; i--) {
    const angle = (i / count) * Math.PI * 2;
    const radius = size * (i % 2 === 0 ? 0.2 : 0.15);
    drawPetal(
      ctx,
      Math.cos(angle) * radius,
      Math.sin(angle) * radius,
      size * (i % 2 === 0 ? 0.58 : 0.5),
      size * (i % 2 === 0 ? 0.72 : 0.66),
      angle + Math.PI,
      0.96,
      i / count,
    );
  }
  const heart = ctx.createRadialGradient(-size * 0.02, -size * 0.04, size * 0.01, 0, 0, size * 0.19);
  heart.addColorStop(0, '#f26670');
  heart.addColorStop(0.36, '#a30c25');
  heart.addColorStop(1, '#4d0315');
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.19, 0, Math.PI * 2);
  ctx.fillStyle = heart;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 176, 179, 0.72)';
  ctx.lineWidth = Math.max(1, size * 0.022);
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.13, -2.15, 1.55);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255, 123, 139, 0.6)';
  ctx.lineWidth = Math.max(0.8, size * 0.015);
  ctx.beginPath();
  ctx.moveTo(-size * 0.1, size * 0.02);
  ctx.bezierCurveTo(-size * 0.02, -size * 0.11, size * 0.13, -size * 0.08, size * 0.08, size * 0.01);
  ctx.bezierCurveTo(size * 0.04, size * 0.08, -size * 0.04, size * 0.08, -size * 0.02, size * 0.01);
  ctx.restore();
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.shadowColor = 'rgba(255, 54, 77, 0.48)';
  ctx.shadowBlur = size * 0.035;
  ctx.fillStyle = 'rgba(255, 66, 86, 0.08)';
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.51, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawSpark(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, opacity: number) {
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.translate(x, y);
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 3.5);
  glow.addColorStop(0, 'rgba(255, 203, 196, 0.8)');
  glow.addColorStop(1, 'rgba(255, 67, 87, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, size * 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 222, 214, 0.95)';
  ctx.beginPath();
  ctx.moveTo(0, -size * 1.7);
  ctx.quadraticCurveTo(size * 0.25, -size * 0.25, size * 1.6, 0);
  ctx.quadraticCurveTo(size * 0.2, size * 0.22, 0, size * 1.7);
  ctx.quadraticCurveTo(-size * 0.2, size * 0.2, -size * 1.6, 0);
  ctx.quadraticCurveTo(-size * 0.2, -size * 0.2, 0, -size * 1.7);
  ctx.fill();
  ctx.restore();
}

export function RoseShowerEffect({ senderName, senderNameColor, senderNameTierIndex, onFinish }: {
  senderName: string;
  senderNameColor?: string;
  senderNameTierIndex?: number;
  onFinish: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const finishRef = useRef(onFinish);
  finishRef.current = onFinish;
  const finishedRef = useRef(false);
  const [fadingOut, setFadingOut] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d', { alpha: true });
    if (!canvas || !ctx) {
      const timer = window.setTimeout(() => finishRef.current(), 5000);
      return () => window.clearTimeout(timer);
    }

  const { petals, sparks } = makeParticles();
  petals.sort((a, b) => a.depth - b.depth);
    let frame = 0;
    let startTime = 0;
    let lastFrameTime = 0;
    let fadeStarted = false;
    let width = 0;
    let height = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize, { passive: true });

    const draw = (now: number) => {
      if (!startTime) startTime = now;
      if (now - lastFrameTime < 30) {
        frame = window.requestAnimationFrame(draw);
        return;
      }
      lastFrameTime = now;
      const elapsed = (now - startTime) / 1000;
      const fadeAt = 4.05;
      const finishAt = 4.6;
      ctx.clearRect(0, 0, width, height);

      const minSide = Math.min(width, height);
      const cx = width * 0.5;
      const cy = height * 0.42;

      const bloomIn = easeOut(clamp01(elapsed / 0.48));
      const bloomOut = 1 - clamp01((elapsed - 1.05) / 0.62);
      if (bloomOut > 0 && elapsed < 1.7) {
        const bloomScale = (0.3 + bloomIn * 0.78) * (0.94 + Math.sin(elapsed * 10) * 0.025);
        drawBloom(ctx, cx, cy, minSide * 0.34, bloomScale * bloomOut);
      }

      for (const petal of petals) {
        const progress = clamp01((elapsed - petal.delay) / 3.72);
        if (progress <= 0 || progress >= 1) continue;
        const eased = easeOut(progress);
        const angle = petal.angle + progress * petal.direction * (4.2 + petal.depth * 2.1);
        const radius = minSide * (0.03 + eased * (0.2 + petal.depth * 0.29));
        const x = cx + Math.cos(angle) * radius + petal.drift * minSide * eased;
        const y = cy + Math.sin(angle) * radius * 0.44 + eased * height * (0.12 + petal.depth * 0.26);
        const fadeIn = clamp01(progress / 0.08);
        const fadeLate = 1 - clamp01((progress - 0.74) / 0.26);
        const size = minSide * (0.075 + petal.depth * 0.064);
        const pulse = 0.96 + Math.sin(elapsed * 8 + petal.angle) * 0.04;
        const edgeDistance = Math.min(x, y, width - x, height - y);
        const edgeFade = clamp01(edgeDistance / (size * 0.96));
        drawPetal(
          ctx,
          x,
          y,
          size * petal.width * pulse,
          size * petal.length * pulse,
          angle * 0.62 + eased * petal.spin,
          fadeIn * fadeLate * edgeFade * (0.62 + petal.depth * 0.34),
          petal.hue,
        );
      }

      for (const spark of sparks) {
        const progress = clamp01((elapsed - spark.delay) / 3.3);
        if (progress <= 0 || progress >= 1) continue;
        const travel = easeOut(progress);
        const angle = spark.angle + progress * 2.6;
        const radius = minSide * (0.04 + travel * spark.distance);
        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius * 0.45 + travel * height * 0.18;
        const twinkle = Math.max(0, Math.sin(elapsed * 13 + spark.phase));
        drawSpark(ctx, x, y, spark.size * (0.55 + twinkle * 0.55), (1 - progress) * twinkle * 0.82);
      }

      if (!fadeStarted && elapsed >= fadeAt) {
        fadeStarted = true;
        setFadingOut(true);
      }
      if (elapsed >= finishAt) {
        ctx.clearRect(0, 0, width, height);
        if (!finishedRef.current) {
          finishedRef.current = true;
          finishRef.current();
        }
        return;
      }
      frame = window.requestAnimationFrame(draw);
    };

    frame = window.requestAnimationFrame(draw);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return createPortal(<div
    className={`big-tier-gift-overlay big-tier-gift-overlay--full${fadingOut ? ' is-fading-out' : ''}`}
    role="status"
    aria-live="polite"
    data-testid="big-tier-rose-shower-animation"
  >
    <canvas ref={canvasRef} className="rose-shower-canvas" aria-hidden="true" />
    <span className="big-tier-gift-banner"><ShinyName displayNameColor={senderNameColor} displayNameTierIndex={senderNameTierIndex}>{senderName}</ShinyName> sent Rose Shower 🌹</span>
  </div>, document.body);
}
