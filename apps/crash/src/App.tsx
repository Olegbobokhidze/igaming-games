import { GameCanvas } from './components/GameCanvas.js';
import { Hud } from './components/Hud.js';
import { useMultiplierInterpolation } from './hooks/useMultiplierInterpolation.js';
import { useSocket } from './hooks/useSocket.js';
import { useAppStore } from './state/store.js';
import './App.css';

export function App() {
  const commands = useSocket();
  useMultiplierInterpolation();
  const status = useAppStore((state) => state.status);

  return (
    <div className="app">
      <GameCanvas />
      <Hud connected={status === 'open'} commands={commands} />
    </div>
  );
}
