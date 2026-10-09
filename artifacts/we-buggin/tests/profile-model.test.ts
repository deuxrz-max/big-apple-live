import test from 'node:test';
import assert from 'node:assert/strict';
import { approvedPhotos } from '../src/profile/profile-model';

test('own header excludes pending, rejected and flagged photos', () => {
  const urls = ['approved', 'pending', 'rejected', 'flagged'];
  const p = { photoUrl: 'pending', photoUrls: urls, photoReviews: urls.map(photoUrl => ({ photoUrl, status: photoUrl })) };
  assert.deepEqual(approvedPhotos(p, true), ['approved']);
});
test('other-member URLs remain usable when server omits private review metadata', () => {
  assert.deepEqual(approvedPhotos({ photoUrl: 'approved2', photoUrls: ['approved1', 'approved2'] }), ['approved2', 'approved1']);
});
test('missing own approval metadata never exposes a photo', () => {
  assert.deepEqual(approvedPhotos({ photoUrl: 'unknown' }, true), []);
});
test('empty and explicit rejected collections use initials; duplicate photos are removed', () => {
  assert.deepEqual(approvedPhotos({}), []);
  assert.deepEqual(approvedPhotos({ photoUrl: 'rejected', photoReviews: [{ photoUrl: 'rejected', status: 'rejected' }] }), []);
  assert.deepEqual(approvedPhotos({ photoUrls: ['approved', 'approved'] }), ['approved']);
});
