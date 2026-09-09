import { Assets, Container, Sprite, TilingSprite, type Texture } from 'pixi.js';
import { BACKGROUND, STAR_FIELD } from '@igaming/engine';

/**
 * Scrolling altitude backdrop.
 *
 * The five artworks are stacked vertically, lowest altitude at the bottom,
 * and the stack slides down past the viewport as progress rises. That is
 * deliberately not a plain crossfade between full-screen images: the rocket
 * is climbing, so the background should *travel*. A dissolve on its own
 * makes both layers semi-transparent at once, doubling the starfields into
 * fog.
 *
 * Butting the frames edge to edge is not enough either. Measured from the
 * source art, each layer is nearly uniform top to bottom (colour delta 4-71)
 * but sits at its own overall tone, so a hard join swaps the whole screen's
 * colour in one frame and reads as a visible boundary. Three things soften
 * it:
 *
 *  1. Layers OVERLAP and cross-dissolve through the overlap, so there is
 *     never a hard edge on screen — only a gradual handover.
 *  2. Layers move at DIFFERENT SPEEDS (parallax), so the eye reads depth
 *     rather than a flat sheet of images sliding past.
 *  3. Progress is SMOOTHED, so nothing snaps even if the caller jumps.
 *  4. A single tiling STAR FIELD is drawn over all of them. This is the one
 *     that does the heavy lifting: a dissolve between two differently toned
 *     artworks always leaves a soft horizontal region where neither is
 *     fully itself, and one unbroken detail track across the whole frame
 *     gives the eye something continuous to follow through it.
 *
 * Progress is a single normalised number, so the caller decides what drives
 * it — a demo ticker today, the round multiplier once the FSM exists.
 */

/** Bottom (launch) to top (apex). Index 0 is what the player sees at 0. */
const LAYERS = [
  BACKGROUND.surface,
  BACKGROUND.clouds,
  BACKGROUND.stratosphere,
  BACKGROUND.orbit,
  BACKGROUND.deepSpace,
] as const;

/**
 * How much of a viewport each neighbouring pair shares, 0..1.
 *
 * The overlap is where the cross-dissolve happens, so it doubles as the
 * transition length: larger means a longer, softer handover but less time
 * showing any single artwork undiluted.
 */
const OVERLAP = 0.42;

/**
 * Parallax depth per layer. The surface is nearest the camera and travels
 * fastest; deep space is furthest and barely moves. Values multiply the base
 * scroll distance, so 1 tracks progress exactly.
 *
 * This is what stops the stack reading as five flat images on one sheet:
 * near art sliding past far art is the strongest depth cue available without
 * an actual 3D camera.
 */
const PARALLAX = [1, 0.86, 0.72, 0.6, 0.5] as const;

/**
 * Extra scale on every layer so parallax drift never exposes an edge — the
 * layers move relative to each other, so each needs slack beyond the view.
 */
const OVERSCAN = 1.18;

/**
 * How quickly the shown progress chases the requested value, per frame at
 * 60fps. Low values glide; 1 would follow instantly. This keeps a jumpy
 * multiplier feed from stuttering the backdrop.
 */
const SMOOTHING = 0.055;

/**
 * Star-field tuning.
 *
 * `depth` is its parallax: slower than every artwork layer, because stars
 * are the furthest thing in the scene. `opacity` runs from the pad (where a
 * bright sky should wash them out) to space (where they carry the frame).
 */
const STARS = {
  depth: 0.34,
  /** Texture pixels per tile, before the viewport scale is applied. */
  tileSize: 1024,
  /**
   * Off completely on the pad. The surface artwork has solid ground, rigs
   * and rock in the lower half, and an additive star layer over those reads
   * as dirt on the lens rather than sky. The stars are only meant to bridge
   * the joins higher up, so they fade in once the climb is under way.
   */
  opacityAtPad: 0,
  opacityInSpace: 0.7,
  /**
   * Progress at which the stars reach full strength. Reaching it by the
   * first transition means they are already carrying detail across the
   * seam by the time the first handover happens.
   */
  fadeInBy: 0.3,
} as const;

export interface Backdrop {
  readonly root: Container;
  /**
   * Request an altitude, 0 (launch pad) to 1 (deep space). Clamped, and
   * approached gradually — call `update` each frame to advance the glide.
   */
  setProgress: (progress: number) => void;
  /** Jump straight to a progress with no glide (initial paint, resets). */
  snapProgress: (progress: number) => void;
  /** Advance the smoothing. `deltaMS` comes from the ticker. */
  update: (deltaMS: number) => void;
  /** Re-layout after a resize; preserves the current progress. */
  resize: (width: number, height: number) => void;
  /**
   * The progress actually on screen right now, after smoothing. Effects
   * that must stay in step with the visible altitude read this rather than
   * the requested target, which the backdrop may not have reached yet.
   */
  readonly shownProgress: () => number;
}

const clamp01 = (value: number): number => Math.min(Math.max(value, 0), 1);

export function createBackdrop(): Backdrop {
  const root = new Container();
  root.label = 'backdrop';

  const sprites = LAYERS.map((name, index) => {
    const sprite = new Sprite(Assets.get<Texture>(name));
    sprite.label = `bg_${String(index)}`;
    // Centre anchor keeps scaling and parallax symmetric about the middle.
    sprite.anchor.set(0.5);
    root.addChild(sprite);
    return sprite;
  });

  /**
   * Continuous star field over the top of every layer.
   *
   * This is the piece that actually kills the transition band. The layers
   * beneath still cross-dissolve, and a dissolve between two differently
   * toned artworks always leaves a soft horizontal region where neither is
   * fully itself. Laying one unbroken, tiling texture across the whole
   * backdrop gives the eye a continuous detail track to follow, so the
   * handover underneath stops reading as a boundary.
   *
   * It tiles vertically, so it never runs out however far the climb goes.
   */
  const stars = new TilingSprite({
    texture: Assets.get<Texture>(STAR_FIELD),
    width: 1,
    height: 1,
  });
  stars.label = 'stars';
  // Additive keeps the stars as light on top of the art instead of pasting a
  // dark square over it, and means the transparent gaps cost nothing.
  stars.blendMode = 'add';
  root.addChild(stars);

  let viewWidth = 0;
  let viewHeight = 0;
  /** Where the caller wants to be. */
  let targetProgress = 0;
  /** Where the backdrop actually is, chasing the target. */
  let shownProgress = 0;

  /**
   * Travel between neighbouring layers, in viewports. Less than 1 because
   * the layers overlap; this is the span the cross-dissolve works over.
   */
  const layerSpacing = 1 - OVERLAP;

  const apply = (): void => {
    if (viewHeight === 0) return;

    // How far up the stack we are, measured in layer steps.
    const step = shownProgress * (LAYERS.length - 1);

    sprites.forEach((sprite, index) => {
      // Distance from this layer's centred position, in steps. 0 means the
      // layer fills the screen; +/-1 means a neighbour does.
      const distance = step - index;

      // Parallax: scale the travel so far layers lag behind near ones.
      const depth = PARALLAX[index] ?? 1;
      sprite.y = viewHeight / 2 + distance * viewHeight * layerSpacing * depth;

      // Cross-dissolve across the overlap. A layer is solid while it is the
      // nearest one and fades as the next takes over, so at any moment at
      // most two contribute.
      // Divide by 1, not 1+OVERLAP: a layer must be fully gone by the time
      // its neighbour is centred, otherwise the layer two steps away is
      // still faintly visible and the pad shows clouds before launch.
      const fade = clamp01(1 - Math.abs(distance));
      // Smoothstep the ramp: a linear alpha ramp has visible corners where
      // the blend starts and ends, which is the hard edge we are removing.
      sprite.alpha = fade * fade * (3 - 2 * fade);

      // Keep fully transparent layers out of the render batch.
      sprite.renderable = sprite.alpha > 0.004;
    });

    // Scroll the star field by offsetting the tile rather than moving the
    // sprite, so it stays pinned over the viewport and repeats for ever.
    stars.tilePosition.y = step * viewHeight * layerSpacing * STARS.depth;
    // Hold the stars off the ground artwork, then ramp them in over the
    // first stretch of the climb and hold them at full strength after.
    const starRamp = clamp01(shownProgress / STARS.fadeInBy);
    stars.alpha =
      STARS.opacityAtPad +
      (STARS.opacityInSpace - STARS.opacityAtPad) * starRamp * starRamp;
    stars.renderable = stars.alpha > 0.004;
  };

  const resize = (width: number, height: number): void => {
    viewWidth = width;
    viewHeight = height;

    for (const sprite of sprites) {
      const texture = sprite.texture;
      if (texture.width === 0 || texture.height === 0) continue;
      // Cover the viewport, then overscan so drift never reveals an edge.
      const scale = Math.max(width / texture.width, height / texture.height) * OVERSCAN;
      sprite.scale.set(scale);
      sprite.x = viewWidth / 2;
    }

    // The tiling sprite covers the viewport exactly; its texture repeats
    // inside that box, so no overscan is needed here.
    stars.width = viewWidth;
    stars.height = viewHeight;
    // Scale the tile with the viewport so star density stays constant
    // instead of turning into dense noise on small screens.
    const tileScale = Math.max(viewWidth, viewHeight) / STARS.tileSize;
    stars.tileScale.set(tileScale);

    apply();
  };

  const setProgress = (progress: number): void => {
    targetProgress = clamp01(progress);
  };

  const snapProgress = (progress: number): void => {
    targetProgress = clamp01(progress);
    shownProgress = targetProgress;
    apply();
  };

  const update = (deltaMS: number): void => {
    const difference = targetProgress - shownProgress;
    // Close enough: settle exactly so the glide cannot creep forever.
    if (Math.abs(difference) < 0.00005) {
      if (shownProgress !== targetProgress) {
        shownProgress = targetProgress;
        apply();
      }
      return;
    }
    // Frame-rate independent exponential approach, normalised to 60fps so
    // the feel is identical on a 144Hz display.
    const rate = 1 - (1 - SMOOTHING) ** (deltaMS / (1000 / 60));
    shownProgress += difference * rate;
    apply();
  };

  return {
    root,
    setProgress,
    snapProgress,
    update,
    resize,
    shownProgress: () => shownProgress,
  };
}
