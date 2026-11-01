---
name: Designated test coins
description: Owner-designated testers have isolated, non-redeemable coin testing, never inferred admin privileges.
---

Only accounts explicitly designated by the owner may use unlimited test coins, including through the phone website. Never infer tester status from a name, an existing fixture marker, ownership, or Android installation. No initial tester accounts were chosen by the user.

**Why:** The user has not chosen their testers and explicitly prohibited enabling everyone or guessing accounts.

**How to apply:** Keep designation and revocation owner-controlled, separate from moderator/admin access, and never seed grants during startup or publishing.

Test sends must animate without minting recipient coins, transferable inventory, cash-out value, XP, house revenue or PK points. Keep test purchases/inventory separate from paid funds and inventory, including after revocation. A stale test send must fail rather than fall back to charging real coins.

**Why:** Free test coins must not be convertible to real value, directly or through bag resending, and must not affect real paid balances.

**How to apply:** Use the isolated test economy for every coin-spending path; retain idempotency across tester status changes. Never restore the former implicit owner-only development allowance that credited recipients.

At paid launch, retire unlimited tester access and clear test-only balances, gifts and effects through an explicit owner-controlled launch reset, not automatically during testing, restart or publishing. Preserve legitimate paid coins and purchase records. Testers KEEP their earned account levels, XP and progression at launch. Do not run the launch reset merely because its implementation is requested.

**Why:** The user said to strip the free test coins “when we do go live with it” and coin purchases are enabled, while explicitly protecting legitimate purchases and prohibiting a reset now.

**How to apply:** Require preview and deliberate confirmation, block new unlimited grants after retirement, and keep test artifacts outside cash-out accounting. A zero test allowance does not mean a zero real wallet: paid and legitimate earned balances remain. Never guess the provenance of older untagged balances.

**Why levels remain:** The user amended the launch requirement: “I'll probably let them keep their level.” Preserving progress must never convert test coins or rewards into withdrawable money.
