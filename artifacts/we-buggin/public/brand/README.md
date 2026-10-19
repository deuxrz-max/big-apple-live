# Deux Wild logo

`deux-wild-logo.png` is the single source for the in-app logo and the generated
browser, Apple and PWA icons. The uploaded portrait logo was fitted onto a
1700 × 1700 black canvas without cropping and saved here as a PNG.

The in-app logo uses a clipped CSS glass highlight and a slow diagonal glint.
The browser and installed-app icons receive a static highlight during icon
generation. Reduced-motion preferences disable the moving in-app glint.

After replacing it, regenerate the size-specific icons from the web-app folder:

```sh
pnpm --filter @workspace/we-buggin brand:icons
```

The script requires ImageMagick (`magick`). It writes favicon, Apple touch,
192px, 512px and maskable 512px PNGs into this folder. The icons regenerate
before dev/build, and the dev server watches this source file for replacements.
Keep the source image square, or the script will fit it on a black square
canvas without cropping.
