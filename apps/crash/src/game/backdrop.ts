import { Assets, Container, Graphics, TilingSprite, type Texture } from 'pixi.js';
import { STAR_FIELD } from '@igaming/engine';

/**
 * Scrolling altitude backdrop: a star field over open space.
 *
 * The rocket holds position in the middle of the screen, so the backdrop
 * scrolling is what conveys the climb. There is deliberately no artwork
 * behind the stars.
 *
 * Painted scenery was tried twice and dropped both times. Five stacked
 * altitude images cross-dissolved into each other left a washed-out
 * horizontal band at every handover — a dissolve holds both frames at half
 * opacity in the middle, so wherever two neighbours sat at different overall
 * tones the midpoint read as a seam, and lengthening the overlap only made
 * the band wider. One tall continuous strip removed the seams but could not
 * be generated long enough to give a phone-shaped viewport more than a
 * screenful of travel, and upscaling a short strip to fit cost more than the
 * scenery was worth.
 *
 * Stars alone have neither problem. A tiling texture repeats for ever, so
 * the climb never runs out however long the round lasts, and there is no
 * join to hide. The gradient that scenery used to provide is now a flat
 * ground colour with the stars brightening as altitude rises.
 */

/**
 * Backdrop ground colour, matching the --orbit-shell-surface token.
 *
 * The game sits in a card alongside the panel and the controls, so it takes
 * the same face they do. Painting the page's --orbit-bg here instead made
 * the card invisible: it matched the background showing through the gaps,
 * so the game read as a hole in the layout rather than a panel in it.
 */
const GROUND_COLOR = 0x0b0f1c;

/**
 * How quickly the shown progress chases the requested value, per frame at
 * 60fps. Low values glide; 1 would follow instantly. This keeps a jumpy
 * multiplier feed from stuttering the backdrop.
 */
const SMOOTHING = 0.055;

/**
 * Star-field tuning.
 *
 * With the artwork gone the stars are the entire backdrop, so they scroll
 * at full rate rather than the fractional parallax depth they used when
 * they sat over moving scenery.
 *
 * `travelScreens` is what replaces the old strip's finite height: the climb
 * scrolls this many viewports' worth of stars between the pad and the apex.
 */
const STARS = {
  travelScreens: 6,
  /** Texture pixels per tile, before the viewport scale is applied. */
  tileSize: 1024,
  /**
   * Dim but present on the pad, full strength in space. Never zero now —
   * with no artwork behind them, stars at zero opacity would leave the
   * canvas a flat empty rectangle before launch.
   */
  opacityAtPad: 0.35,
  opacityInSpace: 1,
  /** Progress at which the stars reach full strength. */
  fadeInBy: 0.55,
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

  // A painted ground rather than a transparent canvas: the stars blend
  // additively, which needs something underneath to add light to.
  const ground = new Graphics();
  ground.label = 'ground';
  root.addChild(ground);

  /**
   * The star field. It tiles vertically, so it never runs out however far
   * the climb goes and however long the round lasts.
   */
  const stars = new TilingSprite({
    texture: Assets.get<Texture>(STAR_FIELD),
    width: 1,
    height: 1,
  });
  stars.label = 'stars';
  // Additive keeps the stars as light over the ground colour instead of
  // pasting a dark square on top, so the transparent gaps cost nothing.
  stars.blendMode = 'add';
  root.addChild(stars);

  let viewWidth = 0;
  let viewHeight = 0;
  /** Where the caller wants to be. */
  let targetProgress = 0;
  /** Where the backdrop actually is, chasing the target. */
  let shownProgress = 0;

  const apply = (): void => {
    if (viewHeight === 0) return;

    // Scroll by offsetting the tile rather than moving the sprite, so it
    // stays pinned over the viewport and repeats for ever. Positive y moves
    // the pattern down the screen, which reads as the camera rising.
    stars.tilePosition.y = shownProgress * viewHeight * STARS.travelScreens;

    const ramp = clamp01(shownProgress / STARS.fadeInBy);
    stars.alpha =
      STARS.opacityAtPad + (STARS.opacityInSpace - STARS.opacityAtPad) * ramp * ramp;
  };

  const resize = (width: number, height: number): void => {
    viewWidth = width;
    viewHeight = height;

    ground.clear();
    ground.rect(0, 0, width, height).fill(GROUND_COLOR);

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
