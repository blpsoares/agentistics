#!/usr/bin/env python3
"""
Generate the CENTRAL variant of the app icons from the machine (amber) originals.

A central and a machine are the same app, so an installed PWA of each showed the
identical icon in the dock with no way to tell them apart. At dock size (~32-48px) a
corner badge is invisible — hue is the only difference that survives, so the central
variant is the same artwork rotated to teal.

Dev-only tool, NOT part of the build: the outputs are committed. Re-run it only when
the source artwork changes.

    pip install Pillow
    python3 packages/web/scripts/gen-central-icons.py
"""
import colorsys
from pathlib import Path

from PIL import Image

ICONS = Path(__file__).resolve().parents[1] / "public" / "icons"
PUBLIC = ICONS.parent

# ~#06B6D4. Chosen over green (already means "member online" in the members panel) and
# over violet (too dark against the black plate at 32px).
CENTRAL_HUE = 0.52


def to_central(img: Image.Image) -> Image.Image:
    """Rotate the glyph's hue, leaving the near-black plate and its glow untouched."""
    img = img.convert("RGBA")
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            _, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            if s > 0.15 and v > 0.10:  # coloured glyph pixels only
                nr, ng, nb = colorsys.hsv_to_rgb(CENTRAL_HUE, s, v)
                px[x, y] = (int(nr * 255), int(ng * 255), int(nb * 255), a)
    return img


def main() -> None:
    for size in (192, 512):
        src = Image.open(ICONS / f"icon-{size}.png")
        out = ICONS / f"icon-central-{size}.png"
        to_central(src).save(out)
        print(f"wrote {out.relative_to(PUBLIC.parent)}")

    # Browser-tab favicon: built from the 512 so it matches the installed icon exactly.
    ico = PUBLIC / "favicon-central.ico"
    to_central(Image.open(ICONS / "icon-512.png")).save(
        ico, sizes=[(16, 16), (32, 32), (48, 48), (64, 64)]
    )
    print(f"wrote {ico.relative_to(PUBLIC.parent)}")


if __name__ == "__main__":
    main()
