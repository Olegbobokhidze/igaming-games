import { useEffect, useState } from 'react';
import { formatMinor, type Minor } from '@igaming/core';
import { useAppStore } from '../state/store.js';
import './RoundResultModal.css';

/**
 * The between-rounds card: what the rocket crashed at, how this player
 * did, and how long until the next round takes bets.
 *
 * Deliberately not a real modal. It never traps focus, takes no click to
 * dismiss and blocks nothing behind it, because it appears every ninety
 * seconds whether the player is involved or not — a dialog demanding
 * acknowledgement that often would be an obstacle, not information. It
 * leaves on its own when the next round opens.
 *
 * It sits over the canvas where the rocket just exploded, which is where
 * the player is already looking.
 */

/**
 * The server's betting window, for scaling the bar only.
 *
 * A local copy of a server constant, which is a smell, but the protocol
 * sends the deadline and not the duration. It is used for the bar's width
 * alone — the countdown text and the button's enabled state both come from
 * the real deadline, so if the server retunes this the bar starts part-full
 * rather than showing the wrong time.
 */
const BETTING_WINDOW_MS = 6_000;

/**
 * Countdown to the next betting window.
 *
 * Driven off `betsCloseAt` from the server rather than a local duration:
 * the bar has to empty exactly when the button stops working, and only the
 * server knows when that is. Falls back to the intermission wait when
 * betting has not opened yet and there is no deadline to read.
 */
function BetCountdown() {
  const phase = useAppStore((state) => state.round.phase);
  const betsCloseAt = useAppStore((state) => state.round.betsCloseAt);
  const [now, setNow] = useState(() => Date.now());

  const open = phase === 'betting' && betsCloseAt !== null;

  useEffect(() => {
    if (!open) return;
    // 10fps: the bar is read as a shrinking quantity, not a stopwatch, and
    // this is a React render — it does not belong on an animation frame.
    const id = setInterval(() => {
      setNow(Date.now());
    }, 100);
    return () => {
      clearInterval(id);
    };
  }, [open]);

  if (!open) {
    return (
      <div className="result-next">
        <span className="result-next__label">Next round starting…</span>
        <div className="result-next__track">
          <div className="result-next__fill result-next__fill--idle" />
        </div>
      </div>
    );
  }

  const remainingMs = Math.max(betsCloseAt - now, 0);
  const seconds = (remainingMs / 1000).toFixed(1);

  return (
    <div className="result-next">
      <span className="result-next__label">
        Place your bet — <strong>{seconds}s</strong>
      </span>
      <div
        className="result-next__track"
        role="progressbar"
        aria-label="Time left to bet"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round((remainingMs / BETTING_WINDOW_MS) * 100)}
      >
        {/* Grows toward full as the window closes: a filling bar reads as
            a deadline approaching, where a draining one reads as something
            being spent. The player is waiting for a gate, not a budget. */}
        <div
          className="result-next__fill"
          style={{ transform: `scaleX(${String(1 - remainingMs / BETTING_WINDOW_MS)})` }}
        />
      </div>
    </div>
  );
}

/**
 * A finished round as the card presents it, detached from live state so the
 * next round opening cannot rewrite the result being read.
 */
interface Result {
  readonly multiplier: number;
  readonly outcome:
    | { readonly kind: 'won'; readonly at: number; readonly payout: Minor | null }
    | { readonly kind: 'lost'; readonly stake: Minor }
    | { readonly kind: 'idle' };
}

export function RoundResultModal() {
  const phase = useAppStore((state) => state.round.phase);
  const multiplier = useAppStore((state) => state.round.multiplier);
  const bet = useAppStore((state) => state.round.bet);
  const cashoutWin = useAppStore((state) => state.cashoutWin);

  // The card outlives the round it describes: it stays up through the next
  // 'betting' phase, and ROUND_OPENED resets the live multiplier to 1.00.
  // Reading the store directly would relabel the card "crashed at 1.00x"
  // the moment the next round opened, so the crash point and the player's
  // result are frozen here on the way into 'crashed' and held until the
  // following crash replaces them.
  const [shown, setShown] = useState<Result | null>(null);
  useEffect(() => {
    if (phase !== 'crashed') return;
    setShown({
      multiplier,
      outcome:
        bet.kind === 'cashed_out'
          ? { kind: 'won', at: bet.at, payout: cashoutWin?.payout ?? null }
          : bet.kind === 'lost'
            ? { kind: 'lost', stake: bet.stake }
            : { kind: 'idle' },
    });
    // Only the entry into 'crashed' matters; a later cashoutWin arrival for
    // an already-frozen round is a stale update, not a correction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Shown from the crash until the next round opens. 'betting' keeps it on
  // screen deliberately: that is when the countdown is live and the card
  // is doing its second job of prompting the next bet.
  const visible = phase === 'crashed' || phase === 'settled' || phase === 'betting';
  // Nothing to show before the session's first crash, even during betting.
  if (!visible || shown === null) return null;

  const { outcome } = shown;

  return (
    <div className="result-card" role="status" aria-live="polite">
      <span className="result-card__label">Crashed at</span>
      <span className="result-card__value">{shown.multiplier.toFixed(2)}×</span>

      {outcome.kind === 'won' && (
        <span className="result-card__outcome result-card__outcome--won">
          Cashed out at {outcome.at.toFixed(2)}×
          {outcome.payout !== null && <strong> +{formatMinor(outcome.payout)}</strong>}
        </span>
      )}
      {outcome.kind === 'lost' && (
        <span className="result-card__outcome result-card__outcome--lost">
          Lost {formatMinor(outcome.stake)}
        </span>
      )}
      {outcome.kind === 'idle' && (
        <span className="result-card__outcome result-card__outcome--idle">
          You sat this one out
        </span>
      )}

      <BetCountdown />
    </div>
  );
}
