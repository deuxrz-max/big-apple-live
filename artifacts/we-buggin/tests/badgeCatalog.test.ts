import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRODUCTS } from '../../api-server/src/lib/social/catalog';

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
