#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export ANDROID_HOME="${ANDROID_HOME:-$ROOT/.local/android-toolchain/sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$ROOT/.local/android-toolchain/gradle-home}"
export BIG_APPLE_SIGNING_DIR="${BIG_APPLE_SIGNING_DIR:-$ROOT/.local/private/android-signing}"
GRADLE="${GRADLE_BIN:-$ROOT/.local/android-toolchain/gradle-8.13/bin/gradle}"
if [[ ! -x "$GRADLE" && -x "$ROOT/android/gradlew" ]]; then
  GRADLE="$ROOT/android/gradlew"
fi
if [[ ! -x "$GRADLE" || ! -d "$ANDROID_HOME/platforms/android-36" ]]; then
  echo "Install JDK 17+, Gradle 8.13, Android SDK platform 36 and build-tools 36.0.0 first." >&2
  exit 1
fi
python3 "$ROOT/android/scripts/prepare.py"
mkdir -p "$ROOT/generated-artifacts/android"
# NixOS needs a patched aapt2 interpreter. Do not modify downloaded artifacts
# on other hosts; use the normal Maven-provided aapt2 there.
extra=()
if [[ -f /etc/NIXOS && -x "$ANDROID_HOME/build-tools/36.0.0/aapt2" ]]; then
  aapt="$ANDROID_HOME/build-tools/36.0.0/aapt2"
  loader="$(patchelf --print-interpreter "$(command -v java)")"
  libstd="$(find /nix/store -path '*gcc-*-lib/lib/libstdc++.so.6' -print -quit 2>/dev/null || true)"
  if [[ -z "$libstd" ]]; then
    libstd="$(find /nix/store -path '*/lib/libstdc++.so.6' -print -quit 2>/dev/null || true)"
  fi
  patchelf --set-interpreter "$loader" "$aapt"
  if [[ -n "$libstd" ]]; then patchelf --set-rpath "$(dirname "$libstd")" "$aapt"; fi
  extra+=("-Pandroid.aapt2FromMavenOverride=$aapt")
fi
"$GRADLE" -p "$ROOT/android" --no-daemon --max-workers=2 "${extra[@]}" assembleRelease bundleRelease lintRelease
cp "$ROOT/android/app/build/outputs/apk/release/app-release.apk" \
  "$ROOT/generated-artifacts/android/Big-Apple-Live-1.0.0.apk"
cp "$ROOT/android/app/build/outputs/bundle/release/app-release.aab" \
  "$ROOT/generated-artifacts/android/Big-Apple-Live-1.0.0.aab"
"$ANDROID_HOME/build-tools/36.0.0/apksigner" verify --verbose --print-certs \
  "$ROOT/generated-artifacts/android/Big-Apple-Live-1.0.0.apk"
jarsigner -verify "$ROOT/generated-artifacts/android/Big-Apple-Live-1.0.0.aab"
sha256sum "$ROOT/generated-artifacts/android/"*.apk "$ROOT/generated-artifacts/android/"*.aab \
  > "$ROOT/generated-artifacts/android/SHA256SUMS.txt"
echo "Signed APK and AAB are in generated-artifacts/android. Nothing was published."
