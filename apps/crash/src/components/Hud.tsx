import { useState } from 'react';
import {
  asMinor,
  canCashOut,
  canPlaceBet,
  formatMinor,
  multiplierToProgress,
  type Minor,
} from '@igaming/core';
import { Button, Meter, Panel } from '@igaming/ui';
import { useAppStore } from '../state/store.js';
import type { SocketCommands } from '../hooks/useSocket.js';
import './Hud.css';

/** Stakes offered as one-tap buttons, in minor units. */
const STAKE_STEPS = [100, 500, 1000, 5000].map((value) => asMinor(value));

/** Human wording for the server's machine-readable rejection codes. */
const REJECTION_TEXT: Record<string, string> = {
  bets_closed: 'Betting has closed',
  insufficient_funds: 'Not enough balance',
  already_bet: 'Bet already placed',
  no_active_bet: 'No active bet',
  not_flying: 'Round is not running',
  already_cashed_out: 'Already cashed out',
};

/**
 * The multiplier readout, isolated in its own component.
 *
 * It re-renders on every animation frame while the rocket is flying. Kept
 * separate so the buttons and balance around it are not re-rendered sixty
 * times a second along with it.
 */
function MultiplierDisplay() {
  const phase = useAppStore((state) => state.round.phase);
  const multiplier = useAppStore((state) => state.round.multiplier);

  const crashed = phase === 'crashed' || phase === 'settled';
  const label = phase === 'flying' || crashed ? `${multiplier.toFixed(2)}×` : '—';

  return (
    <>
      <Meter
        label="Multiplier"
        value={multiplierToProgress(multiplier)}
        min={0}
        max={1}
        displayValue={label}
      />
      <span className={`hud__phase hud__phase--${phase}`}>{phaseText(phase)}</span>
    </>
  );
}

function phaseText(phase: string): string {
  switch (phase) {
    case 'betting':
      return 'Place your bets';
    case 'launching':
      return 'Bets closed — launching';
    case 'flying':
      return 'In flight';
    case 'crashed':
      return 'Crashed';
    case 'settled':
      return 'Round over';
    default:
      return 'Waiting for round';
  }
}

export function Hud({
  connected,
  commands,
}: {
  readonly connected: boolean;
  readonly commands: SocketCommands;
}) {
  const round = useAppStore((state) => state.round);
  const balance = useAppStore((state) => state.balance);
  const rejection = useAppStore((state) => state.lastRejection);
  const win = useAppStore((state) => state.cashoutWin);

  const [stake, setStake] = useState<Minor>(asMinor(1000));
  const [autoCashout, setAutoCashout] = useState<string>('');

  const bettable = canPlaceBet(round) && connected;
  const cashable = canCashOut(round) && connected;

  const parsedAuto = Number.parseFloat(autoCashout);
  // Only send an auto-cashout that could actually trigger.
  const autoTarget = Number.isFinite(parsedAuto) && parsedAuto > 1 ? parsedAuto : null;

  const betText =
    round.bet.kind === 'none' ? '—' : `${formatMinor(round.bet.stake)} staked`;

  const outcome = (() => {
    switch (round.bet.kind) {
      case 'cashed_out':
        return `Cashed out at ${round.bet.at.toFixed(2)}×`;
      case 'lost':
        return 'Lost';
      case 'placed':
        return round.phase === 'flying' ? 'In flight' : 'Waiting';
      default:
        return '—';
    }
  })();

  return (
    <div className="hud">
      <Panel title="Round" variant="small">
        <MultiplierDisplay />
      </Panel>

      <Panel title="Your bet" variant="medium">
        <div className="hud__row">
          <span className="hud__stat">{betText}</span>
          <span className="hud__stat hud__stat--muted">{outcome}</span>
        </div>

        <div className="hud__stakes">
          {STAKE_STEPS.map((step) => (
            <Button
              key={step}
              tone={step === stake ? 'primary' : 'ghost'}
              size="sm"
              disabled={!bettable}
              onClick={() => {
                setStake(step);
              }}
            >
              {formatMinor(step)}
            </Button>
          ))}
          <label className="hud__auto">
            Auto
            <input
              className="hud__auto-input"
              type="number"
              min="1.01"
              step="0.1"
              placeholder="—"
              value={autoCashout}
              disabled={!bettable}
              onChange={(event) => {
                setAutoCashout(event.target.value);
              }}
            />
          </label>
        </div>

        <div className="hud__actions">
          <Button
            tone="primary"
            size="lg"
            fullWidth
            disabled={!bettable}
            onClick={() => {
              commands.placeBet(stake, autoTarget);
            }}
          >
            Place bet
          </Button>
          <Button
            tone="danger"
            size="lg"
            fullWidth
            disabled={!cashable}
            onClick={commands.cashout}
          >
            Cash out
          </Button>
        </div>

        {win !== null && (
          <div className="hud__win" role="status">
            <span className="hud__win-label">Cashed out at {win.at.toFixed(2)}×</span>
            <span className="hud__win-amount">+{formatMinor(win.payout)}</span>
          </div>
        )}

        {rejection !== null && (
          <span className="hud__error">{REJECTION_TEXT[rejection] ?? rejection}</span>
        )}
      </Panel>

      <Panel title="Session" variant="small">
        <div className="hud__row">
          <span className="hud__stat">
            {balance === null ? '—' : formatMinor(balance)}
          </span>
        </div>
        <span className={`hud__status hud__status--${connected ? 'on' : 'off'}`}>
          {connected ? 'socket connected' : 'socket offline'}
        </span>
      </Panel>
    </div>
  );
}
