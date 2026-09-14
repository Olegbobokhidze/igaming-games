import { useEffect } from 'react';
import { LOOP, SFX } from '@igaming/engine';
import { disposeSound, getSound } from '../audio/sound.js';
import { useAppStore } from '../state/store.js';

/**
 * Drives the game's audio from the round state.
 *
 * Subscribes to the store directly rather than reading it through React
 * state, for the same reason the canvas does: the multiplier changes every
 * animation frame, and re-rendering a component tree to fire a sound would
 * be pure overhead. Nothing here renders.
 *
 * Every sound is tied to a transition, not to a phase. A phase is a state
 * the round sits in; a sound is an event. Firing on the edge is what stops
 * the explosion retriggering on every frame the round spends crashed.
 */

/** Seconds of countdown that get a tick, one per second. */
const TICK_FROM_MS = 3_000;

export function useGameSound(): void {
  useEffect(() => {
    // The shared instance, so the click sound in the UI and the round's
    // own audio go through one context and one set of decoded buffers.
    const sound = getSound();

    // The context starts suspended until the page has been interacted with,
    // so the first gesture of any kind unlocks it. Listening on the window
    // in the capture phase catches it wherever it happens, and `once` means
    // this costs nothing after the first.
    const unlock = (): void => {
      sound.unlock();
    };
    window.addEventListener('pointerdown', unlock, { once: true, capture: true });
    window.addEventListener('keydown', unlock, { once: true, capture: true });

    void sound.load();

    if (import.meta.env.DEV) {
      // Handle for poking at audio from the console, and for the browser
      // checks in development. Dev-only: never expose internals in a build.
      Object.assign(globalThis, { __SOUND__: sound });
    }

    const state = useAppStore.getState();
    sound.setSfxEnabled(state.soundEnabled);
    sound.setMusicEnabled(state.musicEnabled);

    let lastPhase = state.round.phase;
    let lastBetKind = state.round.bet.kind;
    let lastSound = state.soundEnabled;
    let lastMusic = state.musicEnabled;
    /** Whole seconds remaining at the last tick, so each fires once. */
    let lastTickSecond = -1;

    const unsubscribe = useAppStore.subscribe((next) => {
      if (next.soundEnabled !== lastSound) {
        lastSound = next.soundEnabled;
        sound.setSfxEnabled(lastSound);
      }
      if (next.musicEnabled !== lastMusic) {
        lastMusic = next.musicEnabled;
        sound.setMusicEnabled(lastMusic);
      }

      // The player's own bet being accepted, which is a change in the bet
      // slice rather than the round phase.
      const betKind = next.round.bet.kind;
      if (betKind !== lastBetKind) {
        if (betKind === 'placed') sound.play(SFX.betPlaced);
        // A cashout is the one good outcome in the game and gets its own
        // sound; 'lost' is covered by the explosion already playing.
        if (betKind === 'cashed_out') sound.play(SFX.cashoutWin);
        lastBetKind = betKind;
      }

      // Countdown ticks, driven off the server's deadline rather than a
      // local timer so they land with the bar the player is watching.
      const { phase, betsCloseAt } = next.round;
      if (phase === 'betting' && betsCloseAt !== null) {
        const remaining = betsCloseAt - Date.now();
        const second = Math.ceil(remaining / 1000);
        if (remaining <= TICK_FROM_MS && remaining > 0 && second !== lastTickSecond) {
          lastTickSecond = second;
          sound.play(SFX.countdownTick);
        }
      }

      if (phase === lastPhase) return;
      const previous = lastPhase;
      lastPhase = phase;
      lastTickSecond = -1;

      switch (phase) {
        case 'betting':
          sound.stopLoop(LOOP.engine);
          sound.stopLoop(LOOP.flightMusic);
          sound.startLoop(LOOP.lobbyMusic);
          break;
        case 'launching':
          sound.play(SFX.launch);
          break;
        case 'flying':
          // Joining a round already in flight skips 'launching', so the
          // launch sound would never have played — the engine still needs
          // starting either way.
          sound.stopLoop(LOOP.lobbyMusic);
          sound.startLoop(LOOP.engine);
          sound.startLoop(LOOP.flightMusic);
          if (previous !== 'launching') sound.play(SFX.launch, { volume: 0.4 });
          break;
        case 'crashed':
          sound.stopLoop(LOOP.engine);
          sound.stopLoop(LOOP.flightMusic);
          sound.play(SFX.crashExplosion);
          sound.startLoop(LOOP.lobbyMusic);
          break;
        default:
          break;
      }
    });

    return () => {
      unsubscribe();
      window.removeEventListener('pointerdown', unlock, { capture: true });
      window.removeEventListener('keydown', unlock, { capture: true });
      disposeSound();
      if (import.meta.env.DEV) {
        delete (globalThis as { __SOUND__?: unknown }).__SOUND__;
      }
    };
  }, []);
}
