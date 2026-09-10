import { create } from 'zustand';
import {
  INITIAL_ROUND_STATE,
  transition,
  type Minor,
  type RoundEvent,
  type RoundState,
} from '@igaming/core';
import type { ConnectionStatus } from '@igaming/transport';

/**
 * Client-side view state.
 *
 * The round slice is not hand-maintained: every change goes through the
 * `transition` reducer from core, so the browser and the server agree on
 * what a frame means. The store's job is to hold the result and notify
 * React, nothing more.
 */
export interface AppState {
  readonly status: ConnectionStatus;
  readonly lastHeartbeatSeq: number | null;
  /** Authoritative round state, driven entirely by the reducer. */
  readonly round: RoundState;
  /** Balance as last reported by the server. Never computed locally. */
  readonly balance: Minor | null;
  /** Machine-readable reason for the last refused command, if any. */
  readonly lastRejection: string | null;
  /**
   * Amount won on the current round's cashout, shown the moment it lands.
   * Cleared when the next round opens, not when the round settles, so the
   * figure stays on screen through the crash.
   */
  readonly cashoutWin: { readonly payout: Minor; readonly at: number } | null;

  setStatus: (status: ConnectionStatus) => void;
  setHeartbeat: (seq: number) => void;
  /** Feed one event through the round machine. */
  dispatch: (event: RoundEvent) => void;
  setBalance: (balance: Minor) => void;
  setRejection: (reason: string | null) => void;
  setCashoutWin: (win: { payout: Minor; at: number } | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  status: 'idle',
  lastHeartbeatSeq: null,
  round: INITIAL_ROUND_STATE,
  balance: null,
  lastRejection: null,
  cashoutWin: null,

  setStatus: (status) => {
    set({ status });
  },
  setHeartbeat: (seq) => {
    set({ lastHeartbeatSeq: seq });
  },
  dispatch: (event) => {
    set((state) => {
      const next = transition(state.round, event);
      // A new round wipes last round's win banner.
      if (event.type === 'ROUND_OPENED') {
        return { round: next, cashoutWin: null, lastRejection: null };
      }
      // The reducer returns the same object when an event does not apply,
      // so this comparison skips a React render for every ignored frame —
      // and there are many, at 10 ticks a second.
      return next === state.round ? state : { round: next };
    });
  },
  setBalance: (balance) => {
    set({ balance });
  },
  setRejection: (reason) => {
    set({ lastRejection: reason });
  },
  setCashoutWin: (win) => {
    set({ cashoutWin: win });
  },
}));
