import { GameCanvas } from './components/GameCanvas.js';
import { Hud } from './components/Hud.js';
import { useSocket } from './hooks/useSocket.js';
import { useAppStore } from './state/store.js';
import './App.css';

export function App() {
  useSocket();
  const status = useAppStore((state) => state.status);

  return (
    <div className="app">
      <GameCanvas />
      <Hud connected={status === 'open'} />
    </div>
  );
}
