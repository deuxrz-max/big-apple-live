import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RoomAtmosphere } from '@workspace/beam-identity';
import { drawAtmosphere } from '../src/beam/components/roomAtmosphere';

/** Record all drawing commands, including gradient stops, without a browser. */
function render(phase: RoomAtmosphere['phase'], energy: number, now: number, reduced: boolean) {
  const commands: unknown[] = [];
  const ctx = new Proxy({}, {
    get(_target, key) {
      if (key === 'createRadialGradient' || key === 'createLinearGradient') {
        return (...coordinates: number[]) => {
          const stops: unknown[] = [];
          commands.push([key, coordinates, stops]);
          return { addColorStop: (offset: number, color: string) => stops.push([offset, color]) };
        };
      }
      return (...args: unknown[]) => commands.push([key, ...args]);
    },
    set(_target, key, value) {
      commands.push([key, typeof value === 'object' ? 'gradient' : value]);
      return true;
    },
  }) as CanvasRenderingContext2D;
  const scene: RoomAtmosphere = {
    phase, energy, seed: 42, cycleId: 2, startedAt: 90_000,
    durationMs: 45_000, serverTime: now,
  };
  drawAtmosphere(ctx, 390, 844, scene, null, now, energy, 'rgba(59,91,255,0.35)', reduced);
  return commands;
}

test('reduced-motion scenes stay static across clock and energy updates', () => {
  for (const phase of ['drift', 'bloom', 'aurora'] as const)
    assert.deepEqual(render(phase, .038, 120_000, true), render(phase, .034, 120_600, true));
});

test('normal scenes animate and identical seeds and times produce identical drawing', () => {
  for (const phase of ['drift', 'bloom', 'aurora'] as const) {
    assert.deepEqual(render(phase, .3, 120_000, false), render(phase, .3, 120_000, false));
    assert.notDeepEqual(render(phase, .3, 120_000, false), render(phase, .3, 120_600, false));
  }
});

test('visual intensity remains bounded', () => {
  assert.deepEqual(render('drift', -10, 120_000, false), render('drift', 0, 120_000, false));
  assert.deepEqual(render('drift', 10, 120_000, false), render('drift', 1, 120_000, false));
});
