import { useEffect } from 'react';
import { TransportClient } from '@igaming/transport';
import { useAppStore } from '../state/store.js';

const SOCKET_URL: string = import.meta.env.VITE_SOCKET_URL ?? 'ws://localhost:8080';

/**
 * Owns the socket for the app's lifetime. Strict Mode double-mounts this,
 * so the effect fully disconnects on cleanup and builds a fresh client on
 * the second mount rather than reusing a half-torn-down one.
 */
export function useSocket(): void {
  useEffect(() => {
    const client = new TransportClient({ url: SOCKET_URL });
    const { setStatus, setHeartbeat } = useAppStore.getState();

    const offStatus = client.on('status', setStatus);
    const offMessage = client.on('message', (message) => {
      if (message.type === 'heartbeat') {
        setHeartbeat(message.seq);
        console.log(
          '[socket] heartbeat',
          message.seq,
          new Date(message.ts).toISOString(),
        );
      }
    });
    const offInvalid = client.on('invalid', ({ raw }) => {
      console.warn('[socket] dropped unparseable frame:', raw);
    });

    client.connect();

    return () => {
      offStatus();
      offMessage();
      offInvalid();
      client.disconnect();
    };
  }, []);
}
