import { Assets, type AssetsManifest, type UnresolvedAsset } from 'pixi.js';

/** Bundle names referenced by the app. */
export const BUNDLE = {
  atlas: 'atlas',
  backgrounds: 'backgrounds',
} as const;

export type BundleName = (typeof BUNDLE)[keyof typeof BUNDLE];

/** Sprite frames packed into orbit.json. Keep in sync with the atlas. */
export const SPRITE = {
  rocket: 'rocket',
  rocketFlame: 'rocket_flame',
  explosion01: 'explosion_01',
  explosion02: 'explosion_02',
  explosion03: 'explosion_03',
  particleSpark: 'particle_spark',
  particleSmoke: 'particle_smoke',
  particleStar: 'particle_star',
  particleDebris: 'particle_debris',
  btnPrimary: 'btn_primary',
  panelWide: 'panel_wide',
  panelMedium: 'panel_medium',
  panelSmall: 'panel_small',
} as const;

export type SpriteName = (typeof SPRITE)[keyof typeof SPRITE];

/**
 * Transparent star field, tiled across the whole backdrop.
 *
 * The only backdrop art there is. Painted altitude scenery was tried and
 * dropped — see the note in the crash app's backdrop for why — so the
 * climb is conveyed entirely by scrolling this texture over a flat ground
 * colour. It tiles, so the climb never runs out and there is no join.
 */
export const STAR_FIELD = 'orbit_stars';

const backgroundAssets: UnresolvedAsset[] = [
  // PNG rather than webp: this one needs a real alpha channel.
  { alias: STAR_FIELD, src: '/assets/backgrounds/orbit-stars.png' },
];

export const gameManifest: AssetsManifest = {
  bundles: [
    {
      name: BUNDLE.atlas,
      assets: [{ alias: BUNDLE.atlas, src: '/assets/atlas/orbit.json' }],
    },
    {
      name: BUNDLE.backgrounds,
      assets: backgroundAssets,
    },
  ],
};

let initialised = false;

/** Initialise Assets with the manifest exactly once per page load. */
export async function initAssets(manifest: AssetsManifest = gameManifest): Promise<void> {
  if (initialised) return;
  initialised = true;
  await Assets.init({ manifest });
}

/** Load one bundle; Pixi caches, so repeat calls are cheap. */
export async function loadBundle(name: BundleName): Promise<void> {
  await Assets.loadBundle(name);
}

// TODO(stage-2): add progress reporting (Assets.loadBundle accepts an
// onProgress callback) to drive a real loading screen, and lazy-load the
// deeper background layers only as the rocket climbs.
