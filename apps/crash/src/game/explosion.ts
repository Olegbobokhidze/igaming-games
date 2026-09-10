import { Container, Sprite, Texture } from 'pixi.js';
import { ObjectPool, SPRITE } from '@igaming/engine';

/**
 * The crash explosion.
 *
 * Three atlas frames played as a sequence, plus a debris burst. The frames
 * are a proper arc — measured from the source art, the bright core covers
 * 8% of frame 1, 19% of frame 2 and 5% of frame 3 — so they read as
 * flash, fireball, dissipating smoke rather than three unrelated pictures.
 *
 * All frames are drawn additively, so the fire reads as light over the
 * scene rather than as a pasted cut-out.
 *
 * That required work on the art. The source PNGs are not cleanly
 * transparent: their background is a flat rgb(21,21,21) at alpha ~94, and
 * additive blending adds that grey too — about 8/255 of stray light spread
 * over a 512px square, which the eye reads as a box behind the fireball.
 * The atlas packer (scripts/pack-atlas.py) now crops each frame to the
 * region that is actually brighter than that background, which removes the
 * artifact and drops roughly a third of each frame's area.
 */

/** Frames in playback order, with how long each holds. */
const SEQUENCE = [
  { name: SPRITE.explosion01, holdMs: 110 },
  { name: SPRITE.explosion02, holdMs: 260 },
  // The smoke frame is held briefly. Given a long tail it dominates the
  // whole effect, and additive pale smoke over pale cloud art washes out
  // to nothing — the fireball is what should be remembered.
  { name: SPRITE.explosion03, holdMs: 190 },
] as const;

/** Total run time of the flash-to-smoke sequence. */
const SEQUENCE_MS = SEQUENCE.reduce((total, frame) => total + frame.holdMs, 0);

/** How far the blast grows over its life, as a multiple of its start size. */
const GROWTH = 1.15;

/** Debris shards thrown outward by the blast. */
const DEBRIS_COUNT = 26;

/** Screen shake, as a fraction of the blast size. */
const SHAKE = {
  amplitude: 0.05,
  durationMs: 320,
  /** Oscillations over the shake's life. */
  frequency: 14,
} as const;

interface Shard {
  readonly sprite: Sprite;
  age: number;
  life: number;
  velocityX: number;
  velocityY: number;
  spin: number;
  baseScale: number;
}

export interface Explosion {
  readonly root: Container;
  /**
   * Detonate at a point, sized against `size` screen pixels. Calling this
   * while one is already running restarts it.
   */
  fire: (x: number, y: number, size: number) => void;
  /** Advance the animation. `deltaMS` comes from the ticker. */
  update: (deltaMS: number) => void;
  /**
   * Current shake offset, in screen pixels. The caller applies it to
   * whatever should shake — the explosion does not move the camera itself,
   * because the scene owns the rocket's position.
   */
  readonly shake: () => { x: number; y: number };
  readonly isActive: () => boolean;
  destroy: () => void;
}

const random = (min: number, max: number): number => min + Math.random() * (max - min);

export function createExplosion(): Explosion {
  const root = new Container();
  root.label = 'explosion';
  // Hidden until something detonates; a stray blast frame at the launch
  // pad would be very visible.
  root.visible = false;

  const debrisLayer = new Container();
  const blastLayer = new Container();
  root.addChild(debrisLayer, blastLayer);

  // One sprite reused across all three frames: only its texture changes.
  const blast = new Sprite(Texture.from(SEQUENCE[0].name));
  blast.anchor.set(0.5);
  blast.blendMode = 'add';
  blastLayer.addChild(blast);

  const debrisPool = new ObjectPool<Sprite>({
    create: () => {
      const sprite = new Sprite(Texture.from(SPRITE.particleDebris));
      sprite.anchor.set(0.5);
      sprite.visible = false;
      sprite.blendMode = 'add';
      debrisLayer.addChild(sprite);
      return sprite;
    },
    reset: (sprite) => {
      sprite.visible = false;
      sprite.alpha = 0;
    },
    dispose: (sprite) => {
      sprite.destroy();
    },
    initialSize: DEBRIS_COUNT,
    maxSize: DEBRIS_COUNT * 2,
  });

  const shards: Shard[] = [];
  let elapsedMs = 0;
  let active = false;
  let blastSize = 0;
  let shakeX = 0;
  let shakeY = 0;

  const releaseShards = (): void => {
    for (const shard of shards) debrisPool.release(shard.sprite);
    shards.length = 0;
  };

  const fire = (x: number, y: number, size: number): void => {
    releaseShards();
    root.visible = true;
    root.position.set(x, y);
    active = true;
    elapsedMs = 0;
    blastSize = size;

    blast.texture = Texture.from(SEQUENCE[0].name);
    blast.alpha = 1;
    // Start a little under the target so the first frames read as a
    // flash expanding rather than something already at full size.
    blast.scale.set((size / blast.texture.width) * 0.6);
    // Random roll so repeated crashes are not visibly identical.
    blast.rotation = random(0, Math.PI * 2);

    for (let i = 0; i < DEBRIS_COUNT; i += 1) {
      const sprite = debrisPool.acquire();
      sprite.visible = true;
      sprite.position.set(0, 0);
      const baseScale = random(0.05, 0.13) * (size / 256);
      sprite.scale.set(baseScale);
      sprite.rotation = random(0, Math.PI * 2);

      // Fire outward in all directions, with a slight upward bias so the
      // burst does not look like it is being poured downward.
      const angle = random(0, Math.PI * 2);
      const speed = random(0.8, 2.6) * size;
      shards.push({
        sprite,
        age: 0,
        life: random(0.45, 1),
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - size * 0.25,
        spin: random(-9, 9),
        baseScale,
      });
    }
  };

  const update = (deltaMS: number): void => {
    if (!active) return;
    const deltaSeconds = Math.min(deltaMS, 100) / 1000;
    elapsedMs += deltaMS;

    // Pick the frame whose slot the clock is currently inside.
    let cursor = 0;
    let current = SEQUENCE[SEQUENCE.length - 1];
    for (const frame of SEQUENCE) {
      cursor += frame.holdMs;
      if (elapsedMs < cursor) {
        current = frame;
        break;
      }
    }
    if (current !== undefined && blast.texture.label !== current.name) {
      blast.texture = Texture.from(current.name);
    }

    const t = Math.min(elapsedMs / SEQUENCE_MS, 1);
    // Grow throughout, and fade only over the back half so the fireball
    // stays solid while it is the point of interest.
    blast.scale.set((blastSize / Math.max(blast.texture.width, 1)) * (0.6 + t * GROWTH));
    // Hold full brightness through the fireball, then fall away quickly.
    // A long linear fade leaves a pale ghost sitting over the scene.
    blast.alpha = t < 0.62 ? 1 : (1 - (t - 0.62) / 0.38) ** 1.6;

    // Shake decays linearly and oscillates; using the blast size as the
    // amplitude keeps it proportional on every viewport.
    if (elapsedMs < SHAKE.durationMs) {
      const decay = 1 - elapsedMs / SHAKE.durationMs;
      const phase = (elapsedMs / 1000) * SHAKE.frequency;
      const amplitude = blastSize * SHAKE.amplitude * decay;
      shakeX = Math.sin(phase * Math.PI * 2) * amplitude;
      shakeY = Math.cos(phase * Math.PI * 2 * 0.7) * amplitude;
    } else {
      shakeX = 0;
      shakeY = 0;
    }

    for (let i = shards.length - 1; i >= 0; i -= 1) {
      const shard = shards[i];
      if (shard === undefined) continue;
      shard.age += deltaSeconds;
      if (shard.age >= shard.life) {
        debrisPool.release(shard.sprite);
        const last = shards.pop();
        if (last !== undefined && i < shards.length) shards[i] = last;
        continue;
      }
      shard.sprite.x += shard.velocityX * deltaSeconds;
      shard.sprite.y += shard.velocityY * deltaSeconds;
      shard.sprite.rotation += shard.spin * deltaSeconds;
      // Gravity, so debris arcs instead of flying in straight lines.
      shard.velocityY += blastSize * 1.6 * deltaSeconds;

      const life = shard.age / shard.life;
      shard.sprite.alpha = 1 - life * life;
      shard.sprite.scale.set(shard.baseScale * (1 - life * 0.4));
    }

    if (elapsedMs >= SEQUENCE_MS && shards.length === 0) {
      active = false;
      root.visible = false;
      shakeX = 0;
      shakeY = 0;
    }
  };

  return {
    root,
    fire,
    update,
    shake: () => ({ x: shakeX, y: shakeY }),
    isActive: () => active,
    destroy: () => {
      releaseShards();
      debrisPool.clear();
    },
  };
}
