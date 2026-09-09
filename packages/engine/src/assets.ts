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

/** Background layers, surface -> deep space. */
export const BACKGROUND = {
  surface: 'bg_01_surface',
  clouds: 'bg_02_clouds',
  stratosphere: 'bg_03_stratosphere',
  orbit: 'bg_04_orbit',
  deepSpace: 'bg_05_deep_space',
} as const;

export type BackgroundName = (typeof BACKGROUND)[keyof typeof BACKGROUND];

/**
 * Transparent star field, tiled over the whole backdrop. It belongs to no
 * single altitude: it scrolls continuously across every layer boundary, so
 * the eye follows the stars rather than the join beneath them.
 */
export const STAR_FIELD = 'orbit_stars';

const backgroundAssets: UnresolvedAsset[] = [
  ...Object.values(BACKGROUND).map((name) => ({
    alias: name,
    src: `/assets/backgrounds/${name}.webp`,
  })),
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
