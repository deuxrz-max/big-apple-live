# Deux Wild logo

Replace `deux-wild-logo.png` in this folder with the official 1700 × 1700 PNG.
That file is the single source for the in-app logo and the generated browser,
Apple and PWA icons.

After replacing it, regenerate the size-specific icons from the web-app folder:

```sh
pnpm --filter @workspace/we-buggin brand:icons
```

The script requires ImageMagick (`magick`). It writes favicon, Apple touch,
192px, 512px and maskable 512px PNGs into this folder. The current logo file is
a temporary black-square / white-wordmark placeholder; overwrite it with the
real logo using the same filename.
