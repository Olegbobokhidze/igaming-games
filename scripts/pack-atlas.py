import json, os
from PIL import Image

SRC = "/home/user/Documents/Programming/igaming-games/assets"
OUT = "/home/user/Documents/Programming/igaming-games/apps/crash/public/assets/atlas"

# frame name -> source file
FRAMES = [
    ("rocket", "rocket.png"),
    ("rocket_flame", "rocket_flame.png"),
    ("explosion_01", "explosion_01.png"),
    ("explosion_02", "explosion_02.png"),
    ("explosion_03", "explosion_03.png"),
    ("particle_spark", "particle_spark.png"),
    ("particle_smoke", "particle_smoke.png"),
    ("particle_star", "particle_star.png"),
    ("particle_debris", "particle_debris.png"),
    ("btn_primary", "btn_primary.png"),
    ("panel_wide", "panel_wide.png"),
    ("panel_medium", "panel_medium.png"),
    ("panel_small", "panel_small.png"),
]

PAD = 2
MAX_W = 2048

def key_out_flat_background(im):
    """Turn an explosion frame's flat backdrop into real transparency.

    The explosion PNGs are not cleanly cut out: behind the fire sits a flat
    rgb(21,21,21) at alpha ~94, covering the entire frame. Drawn additively
    that grey adds roughly 8/255 of light across a large square, which the
    eye reads as a lit box floating behind the fireball.

    Cropping alone cannot fix it — the backdrop extends behind the fire, not
    just around it. Instead each pixel's alpha is rescaled by how far its
    colour rises above the backdrop level: pixels at the backdrop become
    fully transparent, bright fire keeps its alpha, and the soft edges of
    the blast fall off smoothly instead of being hard-clipped.
    """
    px = im.load()
    w, h = im.size
    # Sample the corners to learn the backdrop rather than assuming 21.
    corners = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]
    base = sum(sum(c[:3]) / 3 for c in corners) / len(corners)
    # Anything within this margin of the backdrop is treated as background.
    span = max(1.0, base * 1.6)

    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            lum = (r + g + b) / 3
            if lum <= base:
                px[x, y] = (r, g, b, 0)
                continue
            if lum < base + span:
                # Ramp the alpha across the transition band so the blast
                # keeps soft edges instead of a cut-out silhouette.
                factor = (lum - base) / span
                px[x, y] = (r, g, b, int(a * factor))
    return im


def trim_transparent(im):
    """Crop away the fully transparent margin left by the keying pass."""
    bbox = im.getbbox()
    return im if bbox is None else im.crop(bbox)


imgs = []
for name, fn in FRAMES:
    im = Image.open(os.path.join(SRC, fn)).convert("RGBA")
    if name.startswith("explosion_"):
        im = trim_transparent(key_out_flat_background(im))
    imgs.append((name, im))

# Shelf packing, tallest first — good enough for a fixed sprite set and
# keeps the atlas deterministic across rebuilds.
order = sorted(imgs, key=lambda p: -p[1].height)

placements = {}
x = y = shelf_h = 0
for name, im in order:
    w, h = im.size
    if x + w + PAD > MAX_W:
        x = 0
        y += shelf_h + PAD
        shelf_h = 0
    placements[name] = (x, y, w, h)
    x += w + PAD
    shelf_h = max(shelf_h, h)

total_h = y + shelf_h
used_w = max(px + pw for px, _, pw, _ in placements.values())

def pow2(v):
    p = 1
    while p < v:
        p *= 2
    return p

atlas_w, atlas_h = pow2(used_w), pow2(total_h)
sheet = Image.new("RGBA", (atlas_w, atlas_h), (0, 0, 0, 0))
lookup = dict(imgs)
for name, (px, py, pw, ph) in placements.items():
    sheet.paste(lookup[name], (px, py))

os.makedirs(OUT, exist_ok=True)
sheet.save(os.path.join(OUT, "orbit.png"), optimize=True)

frames = {}
for name, _ in FRAMES:
    px, py, pw, ph = placements[name]
    frames[name] = {
        "frame": {"x": px, "y": py, "w": pw, "h": ph},
        "rotated": False,
        "trimmed": False,
        "spriteSourceSize": {"x": 0, "y": 0, "w": pw, "h": ph},
        "sourceSize": {"w": pw, "h": ph},
    }

data = {
    "frames": frames,
    "meta": {
        "app": "igaming-games/scripts/pack-atlas",
        "version": "1.0",
        "image": "orbit.png",
        "format": "RGBA8888",
        "size": {"w": atlas_w, "h": atlas_h},
        "scale": "1",
    },
}
with open(os.path.join(OUT, "orbit.json"), "w") as f:
    json.dump(data, f, indent=2)

print(f"atlas {atlas_w}x{atlas_h}, {len(frames)} frames")
