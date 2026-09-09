import { Container, Sprite, Texture, type Application } from 'pixi.js';
import { BUNDLE, SPRITE, initAssets, loadBundle } from '@igaming/engine';
import { multiplierToProgress } from '@igaming/core';
import { createBackdrop } from './backdrop.js';
import { createAmbient, createExhaust, type ExhaustOptions } from './particles.js';

/**
 * Idle scene: the altitude backdrop, the rocket holding position near the
 * centre with a small idle sway, and its exhaust burning behind it. The
 * rocket does not travel — the background moves beneath it, and real flight
 * timing arrives with the FSM in stage 2.
 */

export interface Scene {
  readonly root: Container;
  /** Re-layout after a renderer resize. */
  layout: (width: number, height: number) => void;
  /**
   * Altitude shown behind the rocket, 0 (launch pad) to 1 (deep space).
   * Stage 2 drives this from the round multiplier via
   * `multiplierToProgress`; until then a demo climb runs on the ticker.
   */
  setProgress: (progress: number) => void;
  /** Same, but expressed as a round multiplier (1x = pad, apex = space). */
  setMultiplier: (multiplier: number) => void;
  /** Detach the ticker callback. Safe to call more than once. */
  destroy: () => void;
}

/**
 * Sprite geometry, measured from the source art's opaque pixels rather than
 * assumed from the texture box — both frames carry transparent padding, so
 * naive half-texture maths leaves a visible gap between tail and exhaust.
 *
 * Rocket art is 256px wide with paint from x=33 to x=222, and is rotated
 * 90deg on screen, so its texture x-axis is the vertical one.
 */
/**
 * Rocket tail, as an offset down from the sprite's centre. Measured to the
 * end of the fuselage body (x=218), not the bbox edge — the last few pixels
 * are a thin antenna tip that the exhaust should not hang off.
 */
const ROCKET_TAIL_OFFSET_PX = 218 - 256 / 2;
/** Transparent padding above the first row of fire in the flame frame. */
const FLAME_TIP_PADDING_PX = 17;
/** Tuck the exhaust under the fuselage so no seam shows between them. */
const FLAME_OVERLAP_PX = 8;
/**
 * The flame frame is drawn 95px across while the fuselage is only ~90px
 * wide, so at 1:1 the exhaust reads wider than the rocket. Narrow it to sit
 * inside the engine bell.
 */
const FLAME_SCALE = 0.55;

/**
 * Idle exhaust flicker. Deliberately subtle: the rocket is parked, so this
 * only needs to stop the sprite reading as a frozen image. Two sine waves at
 * unrelated frequencies keep the loop from looking metronomic — a single
 * wave is short enough for the eye to lock onto and start counting.
 */
const FLAME_FLICKER = {
  /** Radians per ms for each wave. */
  fastHz: 0.011,
  slowHz: 0.0041,
  /** Stretch along the exhaust, as a fraction of FLAME_SCALE. */
  stretch: 0.06,
  /** Sideways breathing, kept smaller so the nozzle joint stays put. */
  waist: 0.025,
  /** Opacity swing around full brightness. */
  alpha: 0.07,
} as const;

/**
 * Seconds for the demo climb to run from the pad to deep space and stop.
 * Long on purpose: the whole point of the backdrop is a slow sense of
 * altitude, and a fast scroll turns the parallax into a distracting blur.
 * Placeholder only — stage 2 replaces this with the live multiplier.
 */
const DEMO_CLIMB_SECONDS = 75;

/** Climb progress at which ambient drift reaches full speed. */
const AMBIENT_FULL_AT = 0.25;

/**
 * Idle sway of the rocket itself.
 *
 * Everything else in the frame moves — backdrop, exhaust, ambient drift —
 * so a perfectly rigid rocket reads as a sticker pasted on top. This is not
 * flight: it is the small hunting motion of something holding position
 * under thrust, so the numbers are deliberately tiny and expressed as a
 * fraction of the rocket's own on-screen size rather than in pixels, so the
 * motion looks identical at every viewport.
 *
 * Each axis uses its own frequency, and none is a multiple of another. That
 * keeps the combined path from closing into a short loop the eye can learn
 * — the same reason the flame flicker mixes two waves.
 */
const ROCKET_SWAY = {
  /** Horizontal drift, as a fraction of rocket height. */
  swayX: 0.035,
  swayXHz: 0.00046,
  /** Vertical bob — smaller, since the eye is more sensitive to it. */
  swayY: 0.022,
  swayYHz: 0.00071,
  /** Tilt in radians. About 1.7 degrees at the extremes. */
  tilt: 0.03,
  tiltHz: 0.00039,
} as const;

export async function createScene(app: Application): Promise<Scene> {
  await initAssets();
  // Backgrounds and atlas are independent bundles; load them together.
  await Promise.all([loadBundle(BUNDLE.backgrounds), loadBundle(BUNDLE.atlas)]);

  const root = new Container();
  root.label = 'scene';

  const backdrop = createBackdrop();

  // The rocket and its exhaust travel together, so they share a container:
  // stage 2 tilts this one node along the flight curve and the flame follows
  // for free, instead of needing its own position and angle every frame.
  const rocketRig = new Container();
  rocketRig.label = 'rocketRig';

  const rocket = new Sprite(Texture.from(SPRITE.rocket));
  rocket.label = 'rocket';
  rocket.anchor.set(0.5);
  // Source art is drawn nose-left; rotate so the nose points up the screen.
  rocket.rotation = Math.PI / 2;

  const flame = new Sprite(Texture.from(SPRITE.rocketFlame));
  flame.label = 'flame';
  // Anchor at the top-centre: the flame hangs from the tail, so growing it
  // stretches downward only and never back up through the fuselage.
  flame.anchor.set(0.5, 0);

  // Flame first so the fuselage draws over the top of the exhaust.
  rocketRig.addChild(flame, rocket);

  // Exhaust particles live in world space, not on the rig: once emitted
  // they must drift on their own rather than being dragged by the rocket.
  const exhaustOptions: ExhaustOptions = { nozzleX: 0, nozzleY: 0, size: 1, speed: 1 };
  const exhaust = createExhaust(exhaustOptions);

  // Ambient drift sits in front of everything, closest to the camera.
  const ambient = createAmbient();

  root.addChild(backdrop.root, exhaust.root, rocketRig, ambient.root);
  app.stage.addChild(root);

  /** Rig rest position and scale, recomputed on resize. */
  let restX = 0;
  let restY = 0;
  let rigScale = 1;
  /** Clock for the idle sway, advanced by the ticker. */
  let swayMs = 0;

  /**
   * Offset the rig from its rest position and keep the particle emitter
   * pinned to the nozzle.
   *
   * The emitter has to be updated here rather than in `layout`, because the
   * nozzle now moves every frame: leaving it at the rest position would let
   * the rocket drift away from its own exhaust.
   */
  const applySway = (): void => {
    const height = rocket.texture.width * rigScale;

    const offsetX = Math.sin(swayMs * ROCKET_SWAY.swayXHz) * ROCKET_SWAY.swayX * height;
    const offsetY = Math.sin(swayMs * ROCKET_SWAY.swayYHz) * ROCKET_SWAY.swayY * height;
    const tilt = Math.sin(swayMs * ROCKET_SWAY.tiltHz) * ROCKET_SWAY.tilt;

    rocketRig.position.set(restX + offsetX, restY + offsetY);
    rocketRig.rotation = tilt;

    // Follow the nozzle: rotate the tail offset by the same tilt so the
    // plume leaves the engine bell rather than the rocket's old centre.
    const tailLength = ROCKET_TAIL_OFFSET_PX * rigScale;
    exhaustOptions.nozzleX = restX + offsetX - Math.sin(tilt) * tailLength;
    exhaustOptions.nozzleY = restY + offsetY + Math.cos(tilt) * tailLength;
  };

  const layout = (width: number, height: number): void => {
    backdrop.resize(width, height);

    // Keep the rocket a stable fraction of the shorter axis across sizes.
    // Rotating by 90 deg swaps the axes, so the on-screen height of the
    // rocket comes from the texture's width.
    const target = Math.min(width, height) * 0.22;
    const scale = target / Math.max(rocket.texture.width, 1);

    // The rig's rest position. The idle sway below offsets from here every
    // frame, so this is stored rather than written straight to the rig.
    restX = width / 2;
    restY = height / 2;
    rigScale = scale;
    rocketRig.scale.set(scale);

    // Local coordinates, in unscaled texture pixels. The rocket is centred
    // on the rig; the flame hangs from its tail.
    rocket.position.set(0, 0);
    // The tip padding is inside the flame texture, so it shrinks with the
    // sprite — subtract it at the scaled size or the gap creeps back.
    flame.position.set(
      0,
      ROCKET_TAIL_OFFSET_PX - FLAME_TIP_PADDING_PX * FLAME_SCALE - FLAME_OVERLAP_PX,
    );
    // flame.scale is owned by the flicker below, so it is not set here.

    // `size` is the rocket's on-screen height; `speed` is tied to the
    // viewport so the plume trails the same way at any resolution.
    exhaustOptions.size = target;
    exhaustOptions.speed = height * 0.55;
    ambient.resize(width, height);

    // Place the rig and its emitter once now; the ticker keeps them in
    // step from here on.
    applySway();
  };

  // While nothing drives the scene, run a one-way demo climb so the layer
  // transitions are visible. Any explicit setProgress call takes over for
  // good — that is what stage 2 will do on its first multiplier tick.
  let demoDriven = true;
  let climbMs = 0;

  let elapsedMs = 0;
  const flicker = (): void => {
    // Drive from the ticker's own delta rather than performance.now() so the
    // motion pauses with the ticker instead of jumping ahead when it resumes.
    elapsedMs += app.ticker.deltaMS;

    const fast = Math.sin(elapsedMs * FLAME_FLICKER.fastHz);
    const slow = Math.sin(elapsedMs * FLAME_FLICKER.slowHz);
    // Average the two waves so the combined swing stays within +/-1.
    const wave = (fast + slow) / 2;

    flame.scale.set(
      FLAME_SCALE * (1 - wave * FLAME_FLICKER.waist),
      FLAME_SCALE * (1 + wave * FLAME_FLICKER.stretch),
    );
    flame.alpha = 1 - FLAME_FLICKER.alpha * (1 - wave) * 0.5;

    if (demoDriven) {
      climbMs += app.ticker.deltaMS;
      // Ease out so the ascent slows as it approaches deep space instead of
      // slamming into the clamp at full speed.
      const t = Math.min(climbMs / (DEMO_CLIMB_SECONDS * 1000), 1);
      backdrop.setProgress(1 - (1 - t) ** 3);
    }

    // Advance the backdrop's own glide toward whatever target is set. This
    // runs whether the demo or a real caller owns the target.
    backdrop.update(app.ticker.deltaMS);

    // Drift the rocket before the exhaust runs, so particles emitted this
    // frame start from the nozzle's new position.
    swayMs += app.ticker.deltaMS;
    applySway();

    exhaust.update(app.ticker.deltaMS);
    // Ambient drift ramps in with altitude: on the pad there is nothing to
    // stream past, and it should not compete with the launch scenery.
    ambient.setIntensity(Math.min(backdrop.shownProgress() / AMBIENT_FULL_AT, 1));
    ambient.update(app.ticker.deltaMS);
  };

  app.ticker.add(flicker);
  flicker(); // Paint one frame's worth so the flame is never scale 0.

  layout(app.renderer.width, app.renderer.height);
  // Start parked on the pad rather than gliding in from nowhere.
  backdrop.snapProgress(0);

  let destroyed = false;
  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    app.ticker.remove(flicker);
    exhaust.destroy();
    ambient.destroy();
  };

  const setProgress = (progress: number): void => {
    // First real caller wins; the demo climb steps aside permanently.
    demoDriven = false;
    backdrop.setProgress(progress);
  };

  /**
   * Convenience for stage 2: feed the live multiplier straight in and let
   * `multiplierToProgress` handle the log curve and the clamp at the apex.
   */
  const setMultiplier = (multiplier: number): void => {
    setProgress(multiplierToProgress(multiplier));
  };

  return { root, layout, setProgress, setMultiplier, destroy };
}
