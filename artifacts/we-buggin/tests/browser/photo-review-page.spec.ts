import { expect, test } from '@playwright/test';

test('owner profile photo review shows pending photos and records approve/reject actions', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const photos = [
    { id: 'pending-photo-one', photoUrl: '/api/photos/pending-photo-one', status: 'pending',
      username: 'PhotoOne', displayName: 'Photo One', displayNameColor: '#FFFFFF', displayNameTierIndex: 0,
      createdAt: '2026-10-20T12:00:00.000Z' },
    { id: 'pending-photo-two', photoUrl: '/api/photos/pending-photo-two', status: 'pending',
      username: 'PhotoTwo', displayName: 'Photo Two', displayNameColor: '#FFFFFF', displayNameTierIndex: 0,
      createdAt: '2026-10-20T12:01:00.000Z' },
  ];
  const decisions: Array<{ id: string; action: string }> = [];
  await page.route('**/api/account/chat/access', route => route.fulfill({ json: {
    adultConfirmed: true, moderator: false, owner: true, suspended: false,
    chatMuted: false, reportsMuted: false, warning: null,
  } }));
  await page.route('**/api/account/chat/photo-reviews**', async route => {
    const request = route.request();
    if (request.method() === 'GET') {
      const reviewed = new Set(decisions.map(item => item.id));
      await route.fulfill({ json: photos.filter(photo => !reviewed.has(photo.id)) });
      return;
    }
    const id = request.url().split('/').at(-1)!;
    const body = request.postDataJSON() as { action: string };
    decisions.push({ id, action: body.action });
    await route.fulfill({ json: { id, status: body.action === 'approve' ? 'approved' : 'rejected' } });
  });
  await page.route('**/api/photos/**', route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#72627b"/></svg>',
  }));
  await page.goto('/tests/browser/harness.html?view=photo-review');
  await expect(page.getByRole('heading', { level: 1, name: 'Profile photo review' })).toBeVisible();
  await expect(page.getByText('Review each photo for sexually explicit or violent content before approving it.')).toBeVisible();

  const first = page.getByRole('listitem').filter({ hasText: 'Photo One' });
  await expect(first).toBeVisible();
  await first.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('Photo One')).toHaveCount(0);
  expect(decisions).toEqual([{ id: 'pending-photo-one', action: 'approve' }]);

  const second = page.getByRole('listitem').filter({ hasText: 'Photo Two' });
  await expect(second).toBeVisible();
  await second.getByRole('button', { name: 'Reject' }).click();
  await expect(page.getByText('No photos awaiting review.')).toBeVisible();
  expect(decisions).toEqual([
    { id: 'pending-photo-one', action: 'approve' },
    { id: 'pending-photo-two', action: 'reject' },
  ]);
});

test('non-owner non-moderator sees a restricted state', async ({ page }) => {
  await page.route('**/api/account/chat/access', route => route.fulfill({ json: {
    adultConfirmed: true, moderator: false, owner: false, suspended: false,
    chatMuted: false, reportsMuted: false, warning: null,
  } }));
  let queueRequested = false;
  await page.route('**/api/account/chat/photo-reviews**', route => {
    queueRequested = true;
    return route.fulfill({ status: 403, json: { error: 'Photo review access required' } });
  });
  await page.goto('/tests/browser/harness.html?view=photo-review');
  await expect(page.getByRole('heading', { name: 'Restricted' })).toBeVisible();
  expect(queueRequested).toBe(false);
});
