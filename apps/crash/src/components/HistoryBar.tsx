import { toMultiplier } from '@igaming/core';
import { useAppStore } from '../state/store.js';
import './HistoryBar.css';

/**
 * Recent crash points, newest first.
 *
 * The genre convention, and it earns its space: players read the last
 * dozen results to decide their next bet, so this is the most-looked-at
 * strip on the page after the multiplier itself.
 *
 * It shows history only. Past rounds carry no information about the next
 * one — the crash point is drawn independently every round — but hiding
 * the record would be worse than showing it, since players will track it
 * on paper otherwise.
 */

/**
 * Colour tiers.
 *
 * Three bands rather than a continuous gradient: the point is to scan a
 * row of twenty and see the shape at a glance, and a smooth ramp makes
 * 1.9x and 2.1x look identical when they are on opposite sides of the
 * most common decision point.
 */
const TIERS = [
  { min: 10, name: 'gold' },
  { min: 2, name: 'high' },
  { min: 0, name: 'low' },
] as const;

const tierFor = (multiplier: number): string =>
  TIERS.find((tier) => multiplier >= tier.min)?.name ?? 'low';

/** How many results fit before the row starts scrolling. */
const VISIBLE = 24;

export function HistoryBar() {
  const history = useAppStore((state) => state.history);

  if (history.length === 0) {
    return (
      <div className="history-bar app-card app-card--clip history-bar--empty">
        <span className="history-bar__hint">Waiting for the first result…</span>
      </div>
    );
  }

  return (
    <div className="history-bar app-card app-card--clip" role="log" aria-label="Recent crash points">
      <ul className="history-bar__list">
        {history.slice(0, VISIBLE).map((round) => {
          const value = toMultiplier(round.multiplier);
          return (
            <li
              key={round.roundId}
              className={`history-chip history-chip--${tierFor(value)}`}
            >
              {value.toFixed(2)}×
            </li>
          );
        })}
      </ul>
    </div>
  );
}
