import { Application } from 'pixi.js';

/**
 * Cap the device pixel ratio. Retina phones report 3+, which triples the
 * fragment count for no perceptible gain on a canvas of this size.
 */
export const MAX_RESOLUTION = 2;

export const resolveResolution = (
  dpr: number = globalThis.devicePixelRatio || 1,
): number => Math.min(dpr, MAX_RESOLUTION);

export interface BootstrapOptions {
  /** Element the canvas is appended to; also the resize reference. */
  readonly container: HTMLElement;
  readonly backgroundColor?: number;
  readonly antialias?: boolean;
}

/**
 * A running Pixi app plus the teardown for everything bootstrap attached.
 */
export interface EngineHandle {
  readonly app: Application;
  /** Idempotent: safe to call twice (Strict Mode double-invokes effects). */
  destroy: () => void;
}

/**
 * Create and mount a Pixi Application.
 *
 * Initialisation is async, so the caller may unmount before it resolves.
 * That is the classic React 18 Strict Mode double-mount leak: the second
 * mount's cleanup runs while the first mount's `init` is still pending, and
 * an orphaned canvas is appended afterwards. We guard with a `cancelled`
 * flag and tear down immediately if that happens.
 */
export async function bootstrapEngine(options: BootstrapOptions): Promise<EngineHandle> {
  const { container, backgroundColor = 0x05070f, antialias = true } = options;

  const app = new Application();
  let cancelled = false;
  let destroyed = false;
  let resizeObserver: ResizeObserver | null = null;

  const handleResize = (): void => {
    if (destroyed) return;
    const { clientWidth, clientHeight } = container;
    if (clientWidth === 0 || clientHeight === 0) return;
    app.renderer.resize(clientWidth, clientHeight);
  };

  const destroy = (): void => {
    cancelled = true;
    if (destroyed) return;
    destroyed = true;
    window.removeEventListener('resize', handleResize);
    resizeObserver?.disconnect();
    // removeView:true drops the canvas from the DOM as well.
    app.destroy(true, { children: true });
  };

  await app.init({
    width: container.clientWidth || window.innerWidth,
    height: container.clientHeight || window.innerHeight,
    background: backgroundColor,
    antialias,
    resolution: resolveResolution(),
    autoDensity: true,
    powerPreference: 'high-performance',
  });

  if (cancelled) {
    // Unmounted while init was in flight — never touch the DOM.
    app.destroy(true, { children: true });
    destroyed = true;
    return { app, destroy: () => undefined };
  }

  container.appendChild(app.canvas);

  window.addEventListener('resize', handleResize);
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);
  }
  handleResize();

  return { app, destroy };
}
