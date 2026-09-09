import { create } from 'zustand';
import type { ConnectionStatus } from '@igaming/transport';

/**
 * Client-side view state. Deliberately thin: it holds only what the UI
 * needs, and the round slice arrives with the FSM.
 */
export interface AppState {
  readonly status: ConnectionStatus;
  readonly lastHeartbeatSeq: number | null;
  setStatus: (status: ConnectionStatus) => void;
  setHeartbeat: (seq: number) => void;
}

export const useAppStore = create<AppState>((set) => ({
  status: 'idle',
  lastHeartbeatSeq: null,
  setStatus: (status) => set({ status }),
  setHeartbeat: (seq) => set({ lastHeartbeatSeq: seq }),
}));

// TODO(stage-2): add a round slice fed by the FSM, and a balance slice
// using Money from @igaming/core.
