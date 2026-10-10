import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ownedGiftItems } from '../src/gifts/gift-items';

const gifts = [{ id: 'rose', name: 'Rose', cost: 10 }, { id: 'crown', name: 'Crown', cost: 50 }];
const products = [{ id: 'crown', name: 'Badge', description: 'Cosmetic', cost: 20 }];
test('gift catalog without saved ownership is an empty bag', () => {
  assert.deepEqual(ownedGiftItems({ inventory: [], gifts, products }), []);
});
test('saved gift IDs render once, but badges and unknown items never become gifts', () => {
  const inventory = ['rose', 'rose', 'crown', 'unknown'];
  assert.deepEqual(ownedGiftItems({ inventory, gifts, products }), [{ id: 'rose', name: 'Rose' }]);
  assert.deepEqual(inventory, ['rose', 'rose', 'crown', 'unknown']);
});
