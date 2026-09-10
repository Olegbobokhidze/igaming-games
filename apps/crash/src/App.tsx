import { GameCanvas } from './components/GameCanvas.js';
import { Header } from './components/Header.js';
import { HistoryBar } from './components/HistoryBar.js';
import { Hud } from './components/Hud.js';
import { SidePanel } from './components/SidePanel.js';
import { useMultiplierInterpolation } from './hooks/useMultiplierInterpolation.js';
import { useSocket } from './hooks/useSocket.js';
import { useAppStore } from './state/store.js';
import './App.css';

export function App() {
  const commands = useSocket();
  // Smooths the multiplier between server ticks; presentation only.
  useMultiplierInterpolation();
  const status = useAppStore((state) => state.status);

  return (
    <div className="app">
      <SidePanel />
      {/* The canvas and HUD share the remaining width as one column, so
          the panel's presence never changes the HUD's relationship to the
          game above it. */}
      <div className="app__stage">
        <Header />
        <HistoryBar />
        <GameCanvas />
        <Hud connected={status === 'open'} commands={commands} />
      </div>
    </div>
  );
}
