import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join } from 'node:path';
import { PRODUCTS } from '../../api-server/src/lib/social/catalog';

const BADGE_DIR = join(process.cwd(), 'public', 'badges');
const EXPECTED_BADGES = [
  'marathon-master.png',
  'night-owl.png',
  'peak-presenter.png',
];
const SIZE = 512;

function decodeBadgePng(filePath: string) {
  const png = readFileSync(filePath);
  assert.deepEqual(
    [...png.subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
    `${filePath} must be a PNG`,
  );

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const imageData: Buffer[] = [];

  for (let offset = 8; offset < png.length;) {
    assert.ok(offset + 12 <= png.length, `${filePath} has a truncated PNG chunk`);
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    assert.ok(dataEnd + 4 <= png.length, `${filePath} has a truncated ${type} chunk`);
    const data = png.subarray(dataStart, dataEnd);

    if (type === 'IHDR') {
      assert.equal(length, 13, `${filePath} has an invalid IHDR chunk`);
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      imageData.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4;
  }

  assert.equal(width, SIZE, `${filePath} must be ${SIZE}px wide`);
  assert.equal(height, SIZE, `${filePath} must be ${SIZE}px tall`);
  assert.equal(bitDepth, 8, `${filePath} must use 8-bit PNG channels`);
  assert.equal(colorType, 6, `${filePath} must contain an RGBA alpha channel`);
  assert.equal(interlace, 0, `${filePath} must use non-interlaced PNG encoding`);
  assert.ok(imageData.length > 0, `${filePath} is missing image data`);

  const stride = width * 4;
  const filtered = inflateSync(Buffer.concat(imageData));
  assert.equal(filtered.length, height * (stride + 1), `${filePath} has invalid RGBA image data`);
  const rgba = Buffer.alloc(height * stride);
  let sourceOffset = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = filtered[sourceOffset++];
    const rowOffset = y * stride;
    assert.ok(filter <= 4, `${filePath} uses an unsupported PNG filter`);

    for (let x = 0; x < stride; x += 1) {
      const raw = filtered[sourceOffset++];
      const left = x >= 4 ? rgba[rowOffset + x - 4] : 0;
      const above = y > 0 ? rgba[rowOffset - stride + x] : 0;
      const upperLeft = y > 0 && x >= 4 ? rgba[rowOffset - stride + x - 4] : 0;
      let predictor = 0;

      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = above;
      else if (filter === 3) predictor = Math.floor((left + above) / 2);
      else if (filter === 4) {
        const estimate = left + above - upperLeft;
        const distanceLeft = Math.abs(estimate - left);
        const distanceAbove = Math.abs(estimate - above);
        const distanceUpperLeft = Math.abs(estimate - upperLeft);
        predictor = distanceLeft <= distanceAbove && distanceLeft <= distanceUpperLeft
          ? left
          : distanceAbove <= distanceUpperLeft ? above : upperLeft;
      }

      rgba[rowOffset + x] = (raw + predictor) & 0xff;
    }
  }

  return { width, height, rgba };
}

test('Peak Presenter replaces the first listing without changing its saved ownership ID or price', () => {
  assert.equal(PRODUCTS[0].id, 'good-neighbor');
  assert.equal(PRODUCTS[0].name, 'Peak Presenter');
  assert.equal(PRODUCTS[0].cost, 40);
  assert.equal(PRODUCTS.some(p => String(p.name).toLowerCase() === 'good neighbor'), false);
  assert.deepEqual(PRODUCTS.slice(1).map(p => [p.id, p.name, p.cost]), [
    ['night-owl', 'Night Owl', 1000],
    ['marathon-master', 'Marathon Master', 200],
  ]);
});

test('badge artwork keeps its dimensions, transparency and circular framing', () => {
  const actualBadges = readdirSync(BADGE_DIR).filter(file => file.endsWith('.png')).sort();
  assert.deepEqual(actualBadges, EXPECTED_BADGES, 'update this check when the badge artwork set changes');

  for (const file of actualBadges) {
    const { width, height, rgba } = decodeBadgePng(join(BADGE_DIR, file));
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let transparentPixels = 0;
    let opaquePixels = 0;
    let opaquePixelsOutsideCircle = 0;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const alpha = rgba[(y * width + x) * 4 + 3];
        if (alpha === 0) transparentPixels += 1;
        if (alpha === 255) opaquePixels += 1;
        if (alpha > 0) {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }

        const distanceFromCenter = Math.hypot(x - (width - 1) / 2, y - (height - 1) / 2);
        if (alpha >= 128 && distanceFromCenter > 258) opaquePixelsOutsideCircle += 1;
      }
    }

    assert.ok(transparentPixels > 0, `${file} must contain transparent pixels`);
    assert.ok(opaquePixels > 0, `${file} must contain visible, fully opaque artwork`);

    for (let x = 0; x < width; x += 1) {
      assert.equal(rgba[(0 * width + x) * 4 + 3], 0, `${file} must have a transparent top edge`);
      assert.equal(rgba[((height - 1) * width + x) * 4 + 3], 0, `${file} must have a transparent bottom edge`);
    }
    for (let y = 0; y < height; y += 1) {
      assert.equal(rgba[(y * width) * 4 + 3], 0, `${file} must have a transparent left edge`);
      assert.equal(rgba[(y * width + width - 1) * 4 + 3], 0, `${file} must have a transparent right edge`);
    }

    const artworkCenterX = (minX + maxX) / 2;
    const artworkCenterY = (minY + maxY) / 2;
    assert.ok(Math.abs(artworkCenterX - (width - 1) / 2) <= 12, `${file} artwork is off-center horizontally`);
    assert.ok(Math.abs(artworkCenterY - (height - 1) / 2) <= 12, `${file} artwork is off-center vertically`);
    assert.ok(
      opaquePixelsOutsideCircle <= 512,
      `${file} has a large opaque region outside the circular badge, possibly a floor or reflection`,
    );
  }
});
