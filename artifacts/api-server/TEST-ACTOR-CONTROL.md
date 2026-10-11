# Development test-account control

The API Server starts a private local Unix-socket control only when `NODE_ENV=development`. There is no HTTP route, browser UI, test-account login, or password requirement. The published service runs with `NODE_ENV=production`, does not start the control, and refuses test accounts through normal account APIs.

Ask Replit Agent to run a test-account action, or from the workspace shell use:

```sh
pnpm --filter @workspace/api-server run test-actor -- accounts
pnpm --filter @workspace/api-server run test-actor -- cleanup
pnpm --filter @workspace/api-server run test-actor -- join --as TestBigo1 --room "LiveMe"
pnpm --filter @workspace/api-server run test-actor -- chat --as TestBigo1 --room "LiveMe" --text "Hello"
pnpm --filter @workspace/api-server run test-actor -- dm --as TestBigo1 --to Vampsquad --text "Hello"
pnpm --filter @workspace/api-server run test-actor -- leave --as TestBigo1 --room "LiveMe"
pnpm --filter @workspace/api-server run test-actor -- gift --as TestBigo1 --to TestBigo2 --room "LiveMe" --gift moonfox
```

`cleanup` is a read-only preview: it lists the exact marked profiles, related
application-record counts, retained historical gift receipts, and any real-account
messages or relationships that block deletion. If it is safe, the preview prints
a token bound to the exact account and related-record snapshot. Deletion requires
rerunning with `--confirm <token>` copied from the preview. Run a fresh preview if
any listed data changes. Cleanup is refused outside `NODE_ENV=development`,
and is disabled in production both in the command and the private server control.
It removes application profiles and test-only records; it does not delete external
Clerk sign-in identities. Generated profile-photo objects are removed from the
app's private photo namespace as part of cleanup.

Room names can be the visible university name, an overflow name such as `Bigo Live 2`, or its existing room ID. A chat message or room gift requires the sender to be joined through this control. Gift actions are restricted to two marked test accounts and use their development credit wallets and the existing gift flow; they cannot touch a real account or real-money payment. DMs can go only to another marked test account or the confirmed owner account. The existing block, age, room membership, capacity, message, wallet, and gift rules still apply.

The four Test Bigo profiles are marked from their existing test-account bios. The separate `University Tester` profile is also marked because its existing bio identifies it as a unique fixture. No other accounts are reclassified.
