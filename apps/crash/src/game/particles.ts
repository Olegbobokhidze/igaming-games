import { Container, Sprite, Texture } from 'pixi.js';
import { ObjectPool, SPRITE } from '@igaming/engine';

/**
 * Particle systems for the crash scene.
 *
 * Every particle sprite is recycled through an {@link ObjectPool}: a round
 * spawns hundreds of short-lived sprites, and allocating them per frame is
 * what produces GC sawtooth and dropped frames mid-flight. Pooling keeps
 * steady-state allocation at zero.
 *
 * Two systems live here:
 *  - `createExhaust` — sparks and smoke pinned to the rocket's nozzle, so
 *    the engine reads as burning rather than as a static sprite.
 *  - `createAmbient` — stars and debris drifting down the whole viewport,
 *    which gives the climb a sense of speed that a scrolling backdrop alone
 *    cannot: the backdrop is far away, and these pass close to the camera.
 */

/** One live particle. Plain mutable state — this is the hot path. */
interface Particle {
  readonly sprite: Sprite;
  /** Seconds lived so far, and total lifetime. */
  age: number;
  life: number;
  velocityX: number;
  velocityY: number;
  spin: number;
  baseScale: number;
  /** Peak alpha, reached mid-life and faded from there. */
  peakAlpha: number;
}

export interface ParticleSystem {
  readonly root: Container;
  /** Advance the simulation. `deltaMS` comes from the ticker. */
  update: (deltaMS: number) => void;
  /** Called on resize so emitters know the viewport. */
  resize: (width: number, height: number) => void;
  /** Return every live particle and release pooled sprites. */
  destroy: () => void;
}

const random = (min: number, max: number): number => min + Math.random() * (max - min);

/**
 * Build a pool for one texture. `blendMode: 'add'` makes the bright sprites
 * read as light rather than as pasted cut-outs; smoke keeps normal blending
 * so it can actually darken and occlude.
 */
function createSpritePool(
  textureName: string,
  container: Container,
  additive: boolean,
  initialSize: number,
): ObjectPool<Sprite> {
  return new ObjectPool<Sprite>({
    create: () => {
      const sprite = new Sprite(Texture.from(textureName));
      sprite.anchor.set(0.5);
      sprite.visible = false;
      if (additive) sprite.blendMode = 'add';
      container.addChild(sprite);
      return sprite;
    },
    reset: (sprite) => {
      sprite.visible = false;
      sprite.alpha = 0;
      sprite.rotation = 0;
    },
    dispose: (sprite) => {
      sprite.destroy();
    },
    initialSize,
    // Bound the pool so a long session cannot grow it without limit.
    maxSize: initialSize * 3,
  });
}

/**
 * Step one particle. Returns false once it has outlived its lifetime, at
 * which point the caller recycles it.
 */
function stepParticle(particle: Particle, deltaSeconds: number): boolean {
  particle.age += deltaSeconds;
  if (particle.age >= particle.life) return false;

  const { sprite } = particle;
  sprite.x += particle.velocityX * deltaSeconds;
  sprite.y += particle.velocityY * deltaSeconds;
  sprite.rotation += particle.spin * deltaSeconds;

  // 0 at birth, 1 at death.
  const t = particle.age / particle.life;
  // Fade in fast, out slow: a linear fade makes particles pop into
  // existence at full brightness, which reads as flicker.
  const envelope = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
  sprite.alpha = particle.peakAlpha * envelope;
  return true;
}

// --------------------------------------------------------------------------
// Exhaust: sparks and smoke from the rocket nozzle
// --------------------------------------------------------------------------

/** Sparks per second while the engine burns. */
const SPARK_RATE = 30;
/** Smoke puffs per second — far fewer, they are large and long-lived. */
const SMOKE_RATE = 6;

/**
 * Mutable emitter placement — the scene rewrites this on every resize.
 *
 * `size` and `speed` are separate on purpose. Particle sprites are sized
 * relative to the rocket, but they travel in screen pixels per second, and
 * tying both to one number makes one of them wrong at every viewport.
 */
export interface ExhaustOptions {
  /** Nozzle position in the exhaust container's own coordinates. */
  nozzleX: number;
  nozzleY: number;
  /** On-screen height of the rocket, in pixels — sets particle size. */
  size: number;
  /** Screen pixels per second multiplier for particle travel. */
  speed: number;
}

/**
 * Sparks and smoke trailing from the engine.
 *
 * The emitter is deliberately placed by the caller rather than parented to
 * the rocket: particles must keep travelling in world space after they are
 * born, so they cannot inherit the rocket's transform or they would hang
 * off it rigidly.
 */
export function createExhaust(options: ExhaustOptions): ParticleSystem {
  const root = new Container();
  root.label = 'exhaust';

  // Smoke behind sparks: the bright sparks should read in front.
  const smokeLayer = new Container();
  const sparkLayer = new Container();
  root.addChild(smokeLayer, sparkLayer);

  const smokePool = createSpritePool(SPRITE.particleSmoke, smokeLayer, false, 24);
  const sparkPool = createSpritePool(SPRITE.particleSpark, sparkLayer, true, 60);

  const sparks: Particle[] = [];
  const smoke: Particle[] = [];
  let sparkDebt = 0;
  let smokeDebt = 0;

  const spawnSpark = (): void => {
    const sprite = sparkPool.acquire();
    sprite.visible = true;
    sprite.x = options.nozzleX + random(-0.03, 0.03) * options.size;
    sprite.y = options.nozzleY;
    const baseScale = random(0.055, 0.11) * (options.size / 256);
    sprite.scale.set(baseScale);
    sprite.rotation = random(0, Math.PI * 2);
    sparks.push({
      sprite,
      age: 0,
      life: random(0.3, 0.55),
      // Mostly downward, with enough spread to look like a plume.
      velocityX: random(-0.14, 0.14) * options.speed,
      velocityY: random(0.85, 1.7) * options.speed,
      spin: random(-6, 6),
      baseScale,
      peakAlpha: random(0.4, 0.75),
    });
  };

  const spawnSmoke = (): void => {
    const sprite = smokePool.acquire();
    sprite.visible = true;
    sprite.x = options.nozzleX + random(-0.05, 0.05) * options.size;
    sprite.y = options.nozzleY + random(0, 0.06) * options.size;
    const baseScale = random(0.11, 0.2) * (options.size / 256);
    sprite.scale.set(baseScale);
    sprite.rotation = random(0, Math.PI * 2);
    smoke.push({
      sprite,
      age: 0,
      life: random(0.7, 1.3),
      velocityX: random(-0.1, 0.1) * options.speed,
      velocityY: random(0.4, 0.75) * options.speed,
      spin: random(-1.4, 1.4),
      baseScale,
      // Smoke must stay faint or it turns the exhaust into a grey smear.
      peakAlpha: random(0.07, 0.16),
    });
  };

  const advance = (
    list: Particle[],
    pool: ObjectPool<Sprite>,
    deltaSeconds: number,
    growth: number,
  ): void => {
    // Iterate backwards so swap-removal cannot skip an entry.
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const particle = list[i];
      if (particle === undefined) continue;
      if (stepParticle(particle, deltaSeconds)) {
        // Puffs expand as they dissipate; sparks barely change.
        const t = particle.age / particle.life;
        particle.sprite.scale.set(particle.baseScale * (1 + t * growth));
        continue;
      }
      pool.release(particle.sprite);
      const last = list.pop();
      if (last !== undefined && i < list.length) list[i] = last;
    }
  };

  const update = (deltaMS: number): void => {
    // Clamp: a backgrounded tab returns one enormous delta, which would
    // spawn thousands of particles in a single frame.
    const deltaSeconds = Math.min(deltaMS, 100) / 1000;

    sparkDebt += SPARK_RATE * deltaSeconds;
    while (sparkDebt >= 1) {
      spawnSpark();
      sparkDebt -= 1;
    }
    smokeDebt += SMOKE_RATE * deltaSeconds;
    while (smokeDebt >= 1) {
      spawnSmoke();
      smokeDebt -= 1;
    }

    advance(sparks, sparkPool, deltaSeconds, 0.6);
    advance(smoke, smokePool, deltaSeconds, 2.2);
  };

  const destroy = (): void => {
    for (const particle of sparks) sparkPool.release(particle.sprite);
    for (const particle of smoke) smokePool.release(particle.sprite);
    sparks.length = 0;
    smoke.length = 0;
    sparkPool.clear();
    smokePool.clear();
  };

  return { root, update, resize: () => undefined, destroy };
}

// --------------------------------------------------------------------------
// Ambient: stars and debris streaming past the camera
// --------------------------------------------------------------------------

/** Ambient particles alive at once, at full intensity. */
const AMBIENT_STARS = 16;
const AMBIENT_DEBRIS = 7;

/**
 * Drifting foreground detail.
 *
 * These stream downward past the viewport to sell the climb. Unlike the
 * backdrop, which is far away and moves slowly, this passes close to the
 * camera — the speed difference between the two is what actually reads as
 * altitude gained.
 */
export interface AmbientSystem extends ParticleSystem {
  /** How busy the drift is, 0 (parked) to 1 (full climb). */
  setIntensity: (value: number) => void;
}

export function createAmbient(): AmbientSystem {
  const root = new Container();
  root.label = 'ambient';

  const starPool = createSpritePool(SPRITE.particleStar, root, true, AMBIENT_STARS);
  const debrisPool = createSpritePool(SPRITE.particleDebris, root, true, AMBIENT_DEBRIS);

  const stars: Particle[] = [];
  const debris: Particle[] = [];
  let width = 0;
  let height = 0;
  /** 0 parks the drift, 1 is full speed. Driven by climb progress. */
  let intensity = 0;

  const spawnStar = (atTop: boolean): void => {
    const sprite = starPool.acquire();
    sprite.visible = true;
    sprite.x = random(0, width);
    sprite.y = atTop ? random(-60, -10) : random(0, height);
    const baseScale = random(0.02, 0.055);
    sprite.scale.set(baseScale);
    sprite.rotation = random(0, Math.PI * 2);
    stars.push({
      sprite,
      age: 0,
      life: random(2.4, 5),
      velocityX: random(-6, 6),
      // Nearer stars are bigger and faster — a cheap depth cue.
      velocityY: random(40, 120) * (baseScale / 0.055),
      spin: random(-0.5, 0.5),
      baseScale,
      peakAlpha: random(0.2, 0.55),
    });
  };

  const spawnDebris = (atTop: boolean): void => {
    const sprite = debrisPool.acquire();
    sprite.visible = true;
    sprite.x = random(0, width);
    sprite.y = atTop ? random(-80, -20) : random(0, height);
    const baseScale = random(0.015, 0.04);
    sprite.scale.set(baseScale);
    sprite.rotation = random(0, Math.PI * 2);
    debris.push({
      sprite,
      age: 0,
      life: random(3, 6),
      velocityX: random(-14, 14),
      velocityY: random(30, 90),
      spin: random(-1.8, 1.8),
      baseScale,
      peakAlpha: random(0.12, 0.3),
    });
  };

  const advance = (
    list: Particle[],
    pool: ObjectPool<Sprite>,
    deltaSeconds: number,
    respawn: (atTop: boolean) => void,
    target: number,
  ): void => {
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const particle = list[i];
      if (particle === undefined) continue;
      // Scale travel by intensity so the field settles when parked.
      particle.sprite.y += particle.velocityY * intensity * deltaSeconds;
      particle.sprite.x += particle.velocityX * intensity * deltaSeconds;
      particle.sprite.rotation += particle.spin * deltaSeconds;
      particle.age += deltaSeconds;

      const offScreen = particle.sprite.y > height + 80;
      if (particle.age < particle.life && !offScreen) {
        const t = particle.age / particle.life;
        const envelope = t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8;
        particle.sprite.alpha = particle.peakAlpha * envelope * intensity;
        continue;
      }
      pool.release(particle.sprite);
      const last = list.pop();
      if (last !== undefined && i < list.length) list[i] = last;
    }

    // Top the field back up, entering from above.
    while (list.length < Math.round(target * intensity)) respawn(true);
  };

  const update = (deltaMS: number): void => {
    if (width === 0) return;
    const deltaSeconds = Math.min(deltaMS, 100) / 1000;
    advance(stars, starPool, deltaSeconds, spawnStar, AMBIENT_STARS);
    advance(debris, debrisPool, deltaSeconds, spawnDebris, AMBIENT_DEBRIS);
  };

  const resize = (nextWidth: number, nextHeight: number): void => {
    width = nextWidth;
    height = nextHeight;
  };

  /** How busy the ambient field is, 0..1. */
  const setIntensity = (value: number): void => {
    intensity = Math.min(Math.max(value, 0), 1);
  };

  const destroy = (): void => {
    for (const particle of stars) starPool.release(particle.sprite);
    for (const particle of debris) debrisPool.release(particle.sprite);
    stars.length = 0;
    debris.length = 0;
    starPool.clear();
    debrisPool.clear();
  };

  return { root, update, resize, destroy, setIntensity };
}
