# Retiring free tester coins for paid launch

This control is deliberately separate from publishing and from payment activation.
It does not run on startup, on publishing, when a page opens, or when someone signs in.
Creating this control does not run a reset.

## Owner steps when ready

1. Take a fresh backup of the live environment before retiring testing.
2. Open **Following → three-dot menu → Coin testers → Launch reset**.
3. Select **Preview launch reset** and review the number of active testers,
   test gifts and test entrance effects. A preview lasts ten minutes.
4. Only when testing is over, acknowledge preparation for paid launch and type
   **END FREE TEST COINS** exactly, then select **Confirm launch reset**.
5. Verify retirement before separately configuring/enabling approved real payments.
   The reset does not enable checkout or approve bonus economics.

Cancellation or simply leaving the page does not execute the reset. Changes to
tester designation or test inventory invalidate the preview and require another review.

## What it does

- Permanently retires unlimited test access and rejects new tester grants.
- Clears the separate test My Bag and test-only entrance-effect ownership.
- Unequips a test-only entrance effect but preserves one also legitimately owned.
- Leaves the free test allowance at zero.
- Keeps earned account levels, gifting XP, level badges and partial progress to
  the next level unchanged. This is coin-testing retirement, not an account reset.
- Retains zero-value test animation receipts and retry receipts for audit and
  idempotency. They are not financial credits or redeemable inventory.
- Coordinates with in-flight wallet actions so retirement cannot interleave
  halfway through a test send/purchase.

## What it does not do

- Never overwrites real wallet balances, including legitimate purchased or earned funds.
- Never deletes purchase records, real financial ledgers, paid gifts or paid effects.
- Never turns a retained level, free test coins or test-only rewards into earned
  or withdrawable funds. Keeping progression does not change test-gift XP rules.
- Never reconstructs a balance by summing purchases; that would incorrectly
  restore already-spent coins.
- Never guesses whether an older unlabelled balance was a test grant.
- Never grants free rewards, XP, PK points or cash-out value from test gifts.
- Never enables payments, card games, publishes or republishes the site.

Unlimited test coins are virtual, not deposits into the real wallet. An account
with no legitimate funds shows zero after retirement. One with legitimate paid
or earned funds still shows those funds. Historical untagged test funding would
need a separate provenance review, not a blanket balance wipe.

There is no ordinary UI switch to reopen testing after retirement. Treat the final
confirmation as a launch operation and preserve a fresh backup first.
