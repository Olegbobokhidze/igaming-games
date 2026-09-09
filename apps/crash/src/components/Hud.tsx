import { Button, Meter, Panel } from '@igaming/ui';
import './Hud.css';

/**
 * Static HUD. Every value below is a placeholder — wiring these to the
 * round store happens once the FSM exists.
 */
export function Hud({ connected }: { readonly connected: boolean }) {
  return (
    <div className="hud">
      <Panel title="Round" variant="small">
        <Meter label="Multiplier" value={1.0} min={1} max={10} displayValue="1.00×" />
        <span className="hud__hint">Waiting for round</span>
      </Panel>

      <Panel title="Your bet" variant="medium">
        <div className="hud__row">
          <span className="hud__stat">10.00 EUR</span>
          <span className="hud__stat hud__stat--muted">Cashout —</span>
        </div>
        <div className="hud__actions">
          <Button tone="primary" size="lg" fullWidth disabled>
            Place bet
          </Button>
          <Button tone="danger" size="lg" fullWidth disabled>
            Cash out
          </Button>
        </div>
      </Panel>

      <Panel title="Session" variant="small">
        <div className="hud__row">
          <span className="hud__stat">1 000.00 EUR</span>
        </div>
        <span className={`hud__status hud__status--${connected ? 'on' : 'off'}`}>
          {connected ? 'socket connected' : 'socket offline'}
        </span>
      </Panel>
    </div>
  );
}
