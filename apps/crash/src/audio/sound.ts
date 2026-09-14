import { SFX, createSound, type SoundHandle } from '@igaming/engine';
import { useAppStore } from '../state/store.js';

/**
 * The game's single sound instance.
 *
 * A module singleton rather than a React context, because audio is not
 * state: nothing re-renders when a sound plays, so a provider would add
 * plumbing for no benefit. One instance also means one AudioContext and one
 * decode of each file — two instances would fetch and decode everything
 * twice, and browsers cap how many contexts a page may hold.
 */
let instance: SoundHandle | null = null;

export function getSound(): SoundHandle {
  instance ??= createSound();
  return instance;
}

/**
 * Tear the instance down. Only the hook that owns the lifecycle calls this;
 * it exists so a Strict Mode remount does not leak a context.
 */
export function disposeSound(): void {
  instance?.destroy();
  instance = null;
}

/**
 * Play the UI click, if effects are on.
 *
 * Reads the store directly rather than taking the flag as an argument, so
 * no call site can forget the check. Also unlocks the context: a click is
 * by definition a user gesture, so this is the moment a suspended context
 * is allowed to resume.
 */
export function playClick(): void {
  if (!useAppStore.getState().soundEnabled) return;
  const sound = getSound();
  sound.unlock();
  sound.play(SFX.uiClick);
}
