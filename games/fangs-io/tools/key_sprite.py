#!/usr/bin/env python3
"""Fangs.io — turn a generated image into a game-ready transparent sprite.

Usage:
  python3 tools/key_sprite.py <input_image> <sprite_name> [--size 96] [--green|--white|--rembg]

- <sprite_name> should match a `maps_to` value from sprite-prompts.json
  (e.g. head_0, item_blaster, proj_cannon, fx_shield) to auto-replace the
  built-in procedural sprite. Any other name is fine too (expansion art).
- Default keying is --green (flat chroma #00FF00). Use --white for UI art on
  white, or --rembg for AI background removal on any messy background.
- Writes assets/<sprite_name>.png and registers it in assets/manifest.json.
"""
import sys, os, json
from PIL import Image
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ASSETS = os.path.join(ROOT, 'assets')
MANIFEST = os.path.join(ASSETS, 'manifest.json')


def key_color(img, target, tol=70):
    """Make pixels near `target` (r,g,b) transparent."""
    img = img.convert('RGBA')
    a = np.array(img).astype(np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    tr, tg, tb = target
    dist = np.sqrt((r - tr) ** 2 + (g - tg) ** 2 + (b - tb) ** 2)
    mask = dist < tol
    # also kill green-dominant spill for green key
    if target == (0, 255, 0):
        spill = (g > r + 40) & (g > b + 40)
        mask = mask | spill
    a[..., 3] = np.where(mask, 0, a[..., 3])
    return Image.fromarray(a.astype(np.uint8), 'RGBA')


def rembg_key(path):
    from rembg import remove
    with open(path, 'rb') as f:
        out = remove(f.read())
    import io
    return Image.open(io.BytesIO(out)).convert('RGBA')


def autocrop(img):
    a = np.array(img)
    alpha = a[..., 3]
    ys, xs = np.where(alpha > 8)
    if len(xs) == 0:
        return img
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    return img.crop((x0, y0, x1 + 1, y1 + 1))


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    src, name = sys.argv[1], sys.argv[2]
    size = 96
    mode = 'green'
    for i, arg in enumerate(sys.argv[3:]):
        if arg == '--size':
            size = int(sys.argv[3 + i + 1])
        elif arg == '--white':
            mode = 'white'
        elif arg == '--green':
            mode = 'green'
        elif arg == '--rembg':
            mode = 'rembg'

    if mode == 'rembg':
        img = rembg_key(src)
    else:
        img = Image.open(src).convert('RGBA')
        img = key_color(img, (0, 255, 0) if mode == 'green' else (255, 255, 255))

    img = autocrop(img)
    # fit into size x size preserving aspect, crisp
    img.thumbnail((size, size), Image.NEAREST)
    os.makedirs(ASSETS, exist_ok=True)
    out = os.path.join(ASSETS, name + '.png')
    img.save(out)

    # register in manifest (array form the game already understands)
    manifest = []
    if os.path.exists(MANIFEST):
        try:
            manifest = json.load(open(MANIFEST))
        except Exception:
            manifest = []
    if not isinstance(manifest, list):
        manifest = list(manifest.keys()) if isinstance(manifest, dict) else []
    if name not in manifest:
        manifest.append(name)
    json.dump(manifest, open(MANIFEST, 'w'), indent=0)
    print(f'wrote {out}  ({img.width}x{img.height})  registered "{name}" in manifest.json')


if __name__ == '__main__':
    main()
