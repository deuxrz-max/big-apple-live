# Big Apple Live Android

This is a **Trusted Web Activity**, not a WebView and not a separate copy of the web app. It loads `https://big-apple-live.replit.app/` through an installed supporting browser such as current Google Chrome. Web changes reach this wrapper after the owner publishes them; changes to native metadata, the icon, or package configuration require a new Android build.

- Application ID: **`com.bigapplelive.app`**. Keep it for all future updates.
- Name: Big Apple Live.
- Version: 1.0.0, version code 1.
- Android 7.0/API 24 or later; targets Android 16/API 36.
- Google Android Browser Helper 2.7.4; AGP 8.13.2; Gradle 8.13.
- Approved neon apple icon, padded rather than cropped, on black; black splash.
- Android launchers control their own outer icon masks. This does not change in-app square frames.
- No native camera capture, permission prompts at startup, billing SDK, or bundled copy of the site's features.

## Files to download

From the workspace Files tree, download:

1. `generated-artifacts/android/Big-Apple-Live-1.0.0.apk` — signed release APK for direct tester installation.
2. `generated-artifacts/android/Big-Apple-Live-1.0.0.aab` — signed release bundle for Play Console, not directly installable.
3. `generated-artifacts/android/SHA256SUMS.txt` — file checksums.

On a tester's phone: install/update Chrome, download the APK, allow installation from that download source when Android asks, then open Big Apple Live. Revoke the install-from-unknown-sources permission afterward if desired.

No release has been uploaded to Google Play by this work.

## Required website verification — OWNER must republish

Prepared web file:

`artifacts/we-buggin/public/.well-known/assetlinks.json`

It contains only the public SHA-256 certificate fingerprint. It is included in the web production build and served as JSON in the development preview.

The owner must republish the website, then check:

`https://big-apple-live.replit.app/.well-known/assetlinks.json`

It must return the JSON directly, publicly, without a sign-in page, redirect or HTML fallback. At the time of this build, production still returned the site's HTML fallback here. Until that changes and Android/Chrome verifies the relationship, the APK may open with a Custom Tab/browser bar. We do **not** suppress that security fallback.

The native manifest also declares the reverse app-to-website relationship and the matching HTTPS deep link. The launch mode requests immersive display once trusted.

### Google Play App Signing certificate

The APK downloaded directly is signed with our upload key, whose fingerprint is already in `assetlinks.json`.

When enrolling in **Google Play App Signing**, choose Google's managed app-signing key. Play will re-sign delivered APKs with a **different app-signing certificate**. Copy the public **App signing key certificate SHA-256** from Play Console > App integrity, add it to the existing `sha256_cert_fingerprints` array without removing the direct-install/upload certificate, then republish the website again. A Play-installed app will not pass verification with only the upload certificate.

Do not substitute an arbitrary fingerprint, expose private keys, or disable verification.

## Signing key — back it up yourself now

Private workspace files, excluded from both Git and web deployment:

- `.local/private/android-signing/upload-keystore.p12`
- `.local/private/android-signing/password.txt`
- `.local/private/android-signing/upload-certificate.der` — public certificate
- `.local/private/big-apple-live-upload-key-backup.zip`

Alias: `bigapplelive-upload`. Store type: PKCS12. The password file contains the store/key password; do not paste it into chat, source code, a screenshot, or Library.

**Download instructions:** open the workspace Files tree; use its three-dot menu > Show hidden files; navigate to `.local/private`; download `big-apple-live-upload-key-backup.zip`. The ZIP contains the keystore **and its password**, so treat the entire ZIP as a secret. Keep two protected offline copies, preferably in an encrypted backup/password manager. The keystore itself is encrypted, but the ZIP is not separately encrypted. Do not share it with testers or publish it.

The ZIP is a second copy **inside the same workspace**, not an independent off-site backup. Filesystem permissions protect it from other OS users, not from collaborators with equivalent workspace access. If the workspace is deleted before you download it, this is not a durable external backup.

Restore all three files into the same private directory before rebuilding elsewhere. The build refuses to silently replace incomplete signing material.

With Play App Signing, losing the upload key can generally be handled through Google's upload-key-reset procedure; it is not the same as losing a self-managed app-signing key. For directly installed APKs, retaining the signing key is essential to update the existing installation without uninstalling it.

## Permissions, sign-in, playback and Back

- This uses the real browser engine and its HTTPS-origin permission/cookie model, avoiding embedded-WebView Google OAuth restrictions.
- The website's existing user actions invoke camera/microphone access. The wrapper does not request permissions on launch or grant anything automatically. The supporting browser and Android ask for any missing permissions.
- Existing Go Live, PK, camera flip, mute, audio and gift rendering code is unchanged.
- Google/social sign-in may temporarily show browser UI on the external identity-provider origin. That is expected and must not be bypassed. Return to the app's verified origin restores trusted display.
- Android Back is handled by the trusted browser's navigation history. It should go through page history first; at the root, Back exits. No custom handler clears history or intercepts the site's controls.
- Whether every existing SPA route creates the right history entry, media permission behavior on individual phones, interruptions/backgrounding, OAuth return and live PK playback still need actual device tests.
- If the browser is missing/outdated or website verification fails, the library falls back to a visible Custom Tab rather than an untrusted WebView.

## Build again

Tools installed in this workspace: JDK 17, Android SDK platform 36, build-tools 36.0.0 (AGP also installed its default 35.0.0), platform-tools, and Gradle 8.13. Downloaded tools/caches are under `.local/android-toolchain/` and excluded from Git and deployment. The standard Gradle wrapper is included with its distribution checksum.

Run from the workspace root:

```sh
bash android/scripts/build.sh
```

For another machine, install JDK 17+, ImageMagick, Python 3 and Android command-line tools; accept the SDK licenses; install platform 36 and build-tools 36.0.0; set `ANDROID_HOME`. The script can use the included Gradle wrapper if the workspace-local Gradle installation is absent.

The script reuses the private key, refreshes icons/Digital Asset Links without deleting any later Play signing certificate, runs release assembly, bundle assembly and lint, verifies signatures, and copies outputs to `generated-artifacts/android/`. Do not run it with Gradle's verbose signing/debug options or share private Gradle process dumps.

## What was verified

- Release APK and AAB built successfully.
- APK signature verified with `apksigner`; signing certificate matches Digital Asset Links.
- AAB signature verified with `jarsigner`; bundle structure validated with official bundletool 1.18.3.
- Android lint: **0 errors, 8 warnings** (non-blocking version, backup-rule and icon-style guidance).
- Compiled manifest checked: correct production host, package, min/target SDK, immutable browser-helper launch path; no native camera/mic permission prompts or billing implementation.
- Website build succeeds; verification JSON is included and preview serves it as `application/json`.
- Checkout remains disabled in the existing web policy. No payment, game switch, feature, room, gift, price, balance or screen code was changed.

**Not verified:** installation/launch on Android hardware, live camera/microphone/PK flows, OAuth return, hardware Back behavior, video/audio interruptions, or production Digital Asset Links after the owner's republish. There was no connected phone or usable Android emulator in this environment. A successful build does not prove those runtime behaviors.

## Rollback preserved before changes

- Reference: `refs/rollbacks/before-android-twa-20261031T175930Z`
- Code/project snapshot commit: `2015054999559f766bd864bba44e33a6ac64ec5b`
- Code time: October 31, 2026, 17:59:30 UTC.
- Development database custom-format backup: `.local/private/backups/before-android-twa-20261031T175930Z.development.dump`, completed separately shortly afterward. Its archive contents list was validated; a restore was not attempted.

These are not a synchronized whole-platform image. The code snapshot captures tracked and unignored project files, not ignored uploads, secret values, external LFS bytes or cloud/App Storage media. The database dump covers development data only, **not production**. Neither backup captures deployed infrastructure or the live site's database/files. The live deployment was not changed. The database dump may contain private data; keep it out of Git and Library.
