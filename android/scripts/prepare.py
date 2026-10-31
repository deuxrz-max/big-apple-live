#!/usr/bin/env python3
"""Prepare icons, a private upload key, and public Digital Asset Links.

Never prints key material or passwords. Reuses an existing key; refuses to
overwrite incomplete signing material. The private directory is excluded from
both Git and deployment by the project's existing .local exclusions.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[2]
PRIVATE = Path(os.environ.get(
    "BIG_APPLE_SIGNING_DIR", str(ROOT / ".local/private/android-signing"))).resolve()
RES = ROOT / "android/app/src/main/res"
KEY = PRIVATE / "upload-keystore.p12"
PASSWORD = PRIVATE / "password.txt"
CERT = PRIVATE / "upload-certificate.der"
os.umask(0o077)
PRIVATE.mkdir(parents=True, exist_ok=True)
PRIVATE.chmod(0o700)

def run(*args):
    return subprocess.run(args, check=True, capture_output=True)

if KEY.exists() != PASSWORD.exists():
    raise SystemExit("Incomplete signing material. Restore the backup; do not replace the upload key.")
if not KEY.exists():
    with PASSWORD.open("x") as out:
        out.write(secrets.token_urlsafe(48) + "\n")
    try:
        run("keytool", "-genkeypair", "-keystore", str(KEY),
            "-storetype", "PKCS12", "-storepass:file", str(PASSWORD),
            "-keypass:file", str(PASSWORD), "-alias", "bigapplelive-upload",
            "-keyalg", "RSA", "-keysize", "3072", "-sigalg", "SHA256withRSA",
            "-validity", "10000", "-dname", "CN=Big Apple Live", "-noprompt")
    except BaseException:
        PASSWORD.unlink(missing_ok=True)
        KEY.unlink(missing_ok=True)
        raise
    KEY.chmod(0o600)
run("keytool", "-exportcert", "-keystore", str(KEY),
    "-storepass:file", str(PASSWORD), "-alias", "bigapplelive-upload",
    "-file", str(CERT))
fingerprint = ":".join(re.findall("..", hashlib.sha256(CERT.read_bytes()).hexdigest().upper()))
links_file = ROOT / "artifacts/we-buggin/public/.well-known/assetlinks.json"
fingerprints = [fingerprint]
if links_file.exists():
    # Preserve any Play App Signing certificate added on later releases.
    for link in json.loads(links_file.read_text()):
        target = link.get("target", {})
        if target.get("package_name") == "com.bigapplelive.app":
            fingerprints.extend(target.get("sha256_cert_fingerprints", []))
links = [{
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
        "namespace": "android_app",
        "package_name": "com.bigapplelive.app",
        "sha256_cert_fingerprints": list(dict.fromkeys(fingerprints)),
    },
}]
links_file.parent.mkdir(parents=True, exist_ok=True)
links_file.parent.chmod(0o755)
links_file.write_text(json.dumps(links, indent=2) + "\n")
links_file.chmod(0o644)

source = ROOT / "artifacts/we-buggin/public/brand/deux-wild-icon-512.png"
if not source.exists():
    raise SystemExit("Approved neon apple icon is missing. No substitute generated.")
for folder, size in [("mipmap-mdpi", 48), ("mipmap-hdpi", 72),
                     ("mipmap-xhdpi", 96), ("mipmap-xxhdpi", 144),
                     ("mipmap-xxxhdpi", 192)]:
    path = RES / folder
    path.mkdir(parents=True, exist_ok=True)
    run("magick", str(source), "-resize", f"{size}x{size}",
        str(path / "ic_launcher.png"))
    (path / "ic_launcher.png").chmod(0o644)
drawable = RES / "drawable-nodpi"
drawable.mkdir(parents=True, exist_ok=True)
for name in ["icon_foreground.png", "splash_logo.png"]:
    (RES / "drawable" / name).unlink(missing_ok=True)
# Keep the complete neon logo inside Android adaptive icon masks.
run("magick", str(source), "-resize", "288x288", "-background", "black",
    "-gravity", "center", "-extent", "432x432",
    str(drawable / "icon_foreground.png"))
run("magick", str(source), "-resize", "256x256", str(drawable / "splash_logo.png"))
for image in drawable.glob("*.png"):
    image.chmod(0o644)

backup = PRIVATE.parent / "big-apple-live-upload-key-backup.zip"
with zipfile.ZipFile(backup, "w", compression=zipfile.ZIP_DEFLATED) as out:
    for path in [KEY, PASSWORD, CERT]:
        out.write(path, path.name)
    out.writestr("READ-ME.txt", (
        "CONFIDENTIAL: contains the upload key AND its password.\n"
        "Keep offline in two secure places; do not upload to Git, chat or Library.\n"
        "Package: com.bigapplelive.app\nAlias: bigapplelive-upload\n"
        "Store type: PKCS12\nStore/key password: password.txt\n"
        "For Google Play App Signing, this is the UPLOAD key, not Google's app-signing key.\n"
    ))
backup.chmod(0o600)
print("Signing material created or reused privately; private backup refreshed.")
print("Public certificate SHA-256:", fingerprint)
print("Digital Asset Links and approved black-background icons prepared.")
