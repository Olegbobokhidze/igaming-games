import type { Application } from 'pixi.js';

/**
 * Dev-only performance overlay: FPS plus a draw-call estimate.
 *
 * Rendered as a plain DOM node rather than Pixi text so it costs nothing
 * in the scene graph and cannot itself perturb the draw-call count.
 */

export interface OverlayHandle {
  readonly element: HTMLElement;
  destroy: () => void;
}

/**
 * Pixi v8 does not expose a stable public draw-call counter. The WebGL
 * renderer keeps one internally, so we probe for it and degrade to `null`
 * rather than pretending a number we cannot verify.
 */
function readDrawCalls(app: Application): number | null {
  const gl = (app.renderer as unknown as { gl?: unknown }).gl;
  if (gl === undefined) return null;
  const tracked = (gl as { drawCalls?: unknown }).drawCalls;
  return typeof tracked === 'number' ? tracked : null;
}

export function createStatsOverlay(app: Application): OverlayHandle {
  const element = document.createElement('div');
  element.dataset['engineOverlay'] = 'true';
  Object.assign(element.style, {
    position: 'absolute',
    top: '8px',
    // Right-aligned: the left corner belongs to the app's own chrome (the
    // panel toggle on narrow screens), and a debug readout should never
    // sit on top of a control the player needs.
    right: '8px',
    padding: '4px 8px',
    font: '11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace',
    color: '#7dffb2',
    background: 'rgba(0, 0, 0, 0.55)',
    border: '1px solid rgba(125, 255, 178, 0.25)',
    borderRadius: '4px',
    pointerEvents: 'none',
    zIndex: '10',
    whiteSpace: 'pre',
  } satisfies Partial<CSSStyleDeclaration>);

  let frames = 0;
  let lastSampleAt = performance.now();
  let fps = 0;

  const tick = (): void => {
    frames += 1;
    const now = performance.now();
    const elapsed = now - lastSampleAt;
    // Sample about twice a second: frequent enough to be useful, slow
    // enough that the number stays readable.
    if (elapsed < 500) return;
    fps = Math.round((frames * 1000) / elapsed);
    frames = 0;
    lastSampleAt = now;

    const drawCalls = readDrawCalls(app);
    element.textContent =
      `FPS ${String(fps).padStart(3, ' ')}\n` +
      `DC  ${drawCalls === null ? ' n/a' : String(drawCalls).padStart(3, ' ')}`;
  };

  app.ticker.add(tick);

  return {
    element,
    destroy: () => {
      app.ticker.remove(tick);
      element.remove();
    },
  };
}
