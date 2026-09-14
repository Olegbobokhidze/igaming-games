/**
 * Game audio.
 *
 * Built on the Web Audio API rather than `<audio>` elements, for two
 * reasons that matter here: overlapping playback (several ticks, a cashout
 * landing over the engine loop) needs one decoded buffer played many times,
 * which an element cannot do; and scheduling a loop without a gap at the
 * wrap needs `AudioBufferSourceNode.loop`, which is sample-accurate where
 * an element's `loop` is not.
 *
 * Two independent buses — effects and music — because the player controls
 * them separately, and a mute must not stop the other. Both hang off one
 * context: browsers cap how many a page may create, and a context per sound
 * would exhaust that within a session.
 */

/** One-shot effects, keyed by the name their file is stored under. */
export const SFX = {
  uiClick: 'ui_click',
  betPlaced: 'bet_placed',
  countdownTick: 'countdown_tick',
  launch: 'launch',
  cashoutWin: 'cashout_win',
  crashExplosion: 'crash_explosion',
} as const;

export type SfxName = (typeof SFX)[keyof typeof SFX];

/** Sounds that run until stopped. */
export const LOOP = {
  engine: 'engine_loop',
  lobbyMusic: 'lobby_music',
  flightMusic: 'flight_music',
} as const;

export type LoopName = (typeof LOOP)[keyof typeof LOOP];

/** Which bus a loop belongs to: music is muted separately from effects. */
const LOOP_BUS: Record<LoopName, 'sfx' | 'music'> = {
  [LOOP.engine]: 'sfx',
  [LOOP.lobbyMusic]: 'music',
  [LOOP.flightMusic]: 'music',
};

const ALL_NAMES: readonly string[] = [...Object.values(SFX), ...Object.values(LOOP)];

/**
 * Seconds over which a loop fades in or out.
 *
 * Loops are started and stopped on phase changes, and a hard cut at either
 * end is audible as a click — the waveform jumps from silence to mid-cycle.
 * A short ramp is inaudible as a fade but removes the click.
 */
const RAMP = 0.12;

export interface SoundHandle {
  /** Fetch and decode every file. Safe to call more than once. */
  load: (baseUrl?: string) => Promise<void>;
  /** Play a one-shot. Silently does nothing if effects are muted. */
  play: (name: SfxName, options?: { readonly volume?: number }) => void;
  /** Start a loop, or do nothing if it is already running. */
  startLoop: (name: LoopName) => void;
  /** Stop a loop with a short fade. */
  stopLoop: (name: LoopName) => void;
  /** Stop every loop on both buses. */
  stopAllLoops: () => void;
  setSfxEnabled: (enabled: boolean) => void;
  setMusicEnabled: (enabled: boolean) => void;
  /**
   * Resume the context after a user gesture.
   *
   * Browsers start an AudioContext suspended until the page has been
   * interacted with, so the first click has to unlock it or nothing is ever
   * heard. Cheap and idempotent, so it can be called from any handler.
   */
  unlock: () => void;
  readonly isLoaded: () => boolean;
  destroy: () => void;
}

export function createSound(): SoundHandle {
  // Constructed lazily: building a context before any gesture leaves it
  // suspended, and some browsers log a warning for it on every load.
  let ctx: AudioContext | null = null;
  let sfxGain: GainNode | null = null;
  let musicGain: GainNode | null = null;

  const buffers = new Map<string, AudioBuffer>();
  const running = new Map<LoopName, { src: AudioBufferSourceNode; gain: GainNode }>();

  let sfxEnabled = true;
  let musicEnabled = true;
  let loading: Promise<void> | null = null;
  let destroyed = false;

  const ensureContext = (): AudioContext | null => {
    if (destroyed) return null;
    if (ctx === null) {
      // Safari still only exposes the prefixed constructor.
      const Ctor =
        globalThis.AudioContext ??
        (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor === undefined) return null;
      ctx = new Ctor();
      sfxGain = ctx.createGain();
      musicGain = ctx.createGain();
      sfxGain.connect(ctx.destination);
      musicGain.connect(ctx.destination);
      sfxGain.gain.value = sfxEnabled ? 1 : 0;
      musicGain.gain.value = musicEnabled ? 1 : 0;
    }
    return ctx;
  };

  const load = async (baseUrl = '/assets/audio'): Promise<void> => {
    // One shared promise: React may mount this twice under Strict Mode, and
    // fetching every file twice would double the transfer for nothing.
    loading ??= (async () => {
      const context = ensureContext();
      if (context === null) return;
      await Promise.all(
        ALL_NAMES.map(async (name) => {
          try {
            const response = await fetch(`${baseUrl}/${name}.ogg`);
            if (!response.ok) return;
            const bytes = await response.arrayBuffer();
            buffers.set(name, await context.decodeAudioData(bytes));
          } catch {
            // A missing or undecodable file must not take the game down:
            // the round still plays, it just plays silently.
          }
        }),
      );
    })();
    return loading;
  };

  const unlock = (): void => {
    const context = ensureContext();
    if (context !== null && context.state === 'suspended') void context.resume();
  };

  const play = (name: SfxName, options?: { readonly volume?: number }): void => {
    if (!sfxEnabled || destroyed) return;
    const context = ctx;
    const buffer = buffers.get(name);
    if (context === null || sfxGain === null || buffer === undefined) return;

    const src = context.createBufferSource();
    src.buffer = buffer;
    const volume = options?.volume ?? 1;
    if (volume === 1) {
      src.connect(sfxGain);
    } else {
      const gain = context.createGain();
      gain.gain.value = volume;
      src.connect(gain).connect(sfxGain);
    }
    src.start();
  };

  const startLoop = (name: LoopName): void => {
    if (destroyed || running.has(name)) return;
    const context = ctx;
    const buffer = buffers.get(name);
    const bus = LOOP_BUS[name] === 'music' ? musicGain : sfxGain;
    if (context === null || bus === null || buffer === undefined) return;

    const src = context.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const gain = context.createGain();
    // Ramp up from silence so starting mid-waveform does not click.
    gain.gain.setValueAtTime(0, context.currentTime);
    gain.gain.linearRampToValueAtTime(1, context.currentTime + RAMP);
    src.connect(gain).connect(bus);
    src.start();
    running.set(name, { src, gain });
  };

  const stopLoop = (name: LoopName): void => {
    const entry = running.get(name);
    const context = ctx;
    if (entry === undefined || context === null) return;
    running.delete(name);
    const stopAt = context.currentTime + RAMP;
    // Cancel first: a start ramp may still be in flight, and scheduling a
    // fade against it leaves the value jumping when the old ramp resolves.
    entry.gain.gain.cancelScheduledValues(context.currentTime);
    entry.gain.gain.setValueAtTime(entry.gain.gain.value, context.currentTime);
    entry.gain.gain.linearRampToValueAtTime(0, stopAt);
    entry.src.stop(stopAt);
  };

  const stopAllLoops = (): void => {
    for (const name of [...running.keys()]) stopLoop(name);
  };

  const setSfxEnabled = (enabled: boolean): void => {
    sfxEnabled = enabled;
    if (sfxGain !== null && ctx !== null) {
      // Ramp rather than assign: muting a running engine loop by setting
      // gain to 0 outright clicks just as a hard stop would.
      sfxGain.gain.cancelScheduledValues(ctx.currentTime);
      sfxGain.gain.setValueAtTime(sfxGain.gain.value, ctx.currentTime);
      sfxGain.gain.linearRampToValueAtTime(enabled ? 1 : 0, ctx.currentTime + RAMP);
    }
  };

  const setMusicEnabled = (enabled: boolean): void => {
    musicEnabled = enabled;
    if (musicGain !== null && ctx !== null) {
      musicGain.gain.cancelScheduledValues(ctx.currentTime);
      musicGain.gain.setValueAtTime(musicGain.gain.value, ctx.currentTime);
      musicGain.gain.linearRampToValueAtTime(enabled ? 1 : 0, ctx.currentTime + RAMP);
    }
  };

  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    for (const entry of running.values()) {
      try {
        entry.src.stop();
      } catch {
        // Already stopped; nothing to do.
      }
    }
    running.clear();
    buffers.clear();
    void ctx?.close();
    ctx = null;
    sfxGain = null;
    musicGain = null;
  };

  return {
    load,
    play,
    startLoop,
    stopLoop,
    stopAllLoops,
    setSfxEnabled,
    setMusicEnabled,
    unlock,
    isLoaded: () => buffers.size > 0,
    destroy,
  };
}
