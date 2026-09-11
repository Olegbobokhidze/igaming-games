import { useMemo, useState } from 'react';
import {
  asMinor,
  formatMinor,
  toMultiplier,
  type BetEntry,
  type RoundResult,
} from '@igaming/core';
import { useAppStore } from '../state/store.js';
import './SidePanel.css';

/**
 * The shared table panel: who is playing, what just happened, and who is
 * ahead.
 *
 * Everything here comes from the server's broadcast frames rather than
 * being computed locally. The bots that populate it place real bets through
 * the real engine, so when a genuine backend replaces the mock server this
 * component does not change at all.
 */

/**
 * Format a protocol amount for display.
 *
 * Wire payloads carry plain numbers; `formatMinor` wants the branded type.
 * This is the single trusted boundary where the cast happens, rather than
 * an `asMinor` scattered through every row.
 */
const money = (value: number): string => formatMinor(asMinor(value));

type Tab = 'all' | 'previous' | 'top';
type Period = 'day' | 'month' | 'year';

const TABS: readonly { id: Tab; label: string }[] = [
  { id: 'all', label: 'All Bets' },
  { id: 'previous', label: 'Previous' },
  { id: 'top', label: 'Top' },
];

const PERIODS: readonly { id: Period; label: string; hours: number }[] = [
  { id: 'day', label: 'Day', hours: 24 },
  { id: 'month', label: 'Month', hours: 24 * 30 },
  { id: 'year', label: 'Year', hours: 24 * 365 },
];

/** One row of the bet list. */
function BetRow({ entry }: { readonly entry: BetEntry }) {
  const won = entry.payout !== null && entry.payout > 0;
  return (
    <li className={`panel-row${won ? ' panel-row--won' : ''}`}>
      <span className="panel-row__name">{entry.name}</span>
      <span className="panel-row__stake">{money(entry.stake)}</span>
      {won ? (
        <>
          <span className="panel-row__at">
            {toMultiplier(entry.cashedOutAt ?? 0).toFixed(2)}×
          </span>
          <span className="panel-row__payout">{money(entry.payout ?? 0)}</span>
        </>
      ) : (
        <>
          <span className="panel-row__at panel-row__at--pending">—</span>
          <span className="panel-row__payout panel-row__payout--pending">—</span>
        </>
      )}
    </li>
  );
}

function BetList({ entries }: { readonly entries: readonly BetEntry[] }) {
  if (entries.length === 0) {
    return <p className="panel-empty">No bets this round yet.</p>;
  }
  return (
    <ul className="panel-list">
      {entries.map((entry, index) => (
        <BetRow key={`${entry.name}-${String(index)}`} entry={entry} />
      ))}
    </ul>
  );
}

/** Two figures side by side above a list. */
function StatPair({
  left,
  leftLabel,
  right,
  rightLabel,
}: {
  readonly left: string;
  readonly leftLabel: string;
  readonly right: string;
  readonly rightLabel: string;
}) {
  return (
    <div className="panel-stats">
      <div className="panel-stat">
        <span className="panel-stat__label">{leftLabel}</span>
        <span className="panel-stat__value">{left}</span>
      </div>
      <div className="panel-stat">
        <span className="panel-stat__label">{rightLabel}</span>
        <span className="panel-stat__value panel-stat__value--win">{right}</span>
      </div>
    </div>
  );
}

function AllBetsTab() {
  const board = useAppStore((state) => state.board);
  const entries = board?.entries ?? [];

  return (
    <>
      <StatPair
        leftLabel="Bets"
        left={String(entries.length)}
        rightLabel="Won this round"
        right={money(board?.totalPayout ?? 0)}
      />
      <BetList entries={entries} />
    </>
  );
}

function PreviousTab() {
  const history = useAppStore((state) => state.history);
  const last = history[0];

  if (last === undefined) {
    return <p className="panel-empty">Waiting for the first round to finish.</p>;
  }

  return (
    <>
      <div className="panel-result">
        <span className="panel-result__label">Crashed at</span>
        <span className="panel-result__value">
          {toMultiplier(last.multiplier).toFixed(2)}×
        </span>
      </div>
      <StatPair
        leftLabel="Bets"
        left={String(last.entries.length)}
        rightLabel="Paid out"
        right={money(last.totalPayout)}
      />
      <BetList entries={last.entries} />
    </>
  );
}

/** A leaderboard figure with its holder. */
interface TopCard {
  readonly label: string;
  readonly value: string;
  readonly holder: string;
}

/**
 * Reduce the round history into the six leaderboard figures.
 *
 * Computed from the same history the Previous tab shows, so the numbers
 * can never disagree with the rounds the player just watched.
 */
function buildTopCards(
  history: readonly RoundResult[],
  period: Period,
): { cards: readonly TopCard[]; leaders: readonly BetEntry[] } {
  const hours = PERIODS.find((p) => p.id === period)?.hours ?? 24;
  const cutoff = Date.now() - hours * 3_600_000;
  const rounds = history.filter((round) => round.endedAt >= cutoff);

  let topX: BetEntry | null = null;
  let topWin: BetEntry | null = null;
  let totalStake = 0;
  let totalPayout = 0;
  const roundsBy = new Map<string, number>();
  const winsBy = new Map<string, number>();

  for (const round of rounds) {
    totalStake += round.totalStake;
    totalPayout += round.totalPayout;
    for (const entry of round.entries) {
      roundsBy.set(entry.name, (roundsBy.get(entry.name) ?? 0) + 1);
      if (entry.payout === null || entry.payout <= 0) continue;
      winsBy.set(entry.name, (winsBy.get(entry.name) ?? 0) + entry.payout);
      if (topX === null || (entry.cashedOutAt ?? 0) > (topX.cashedOutAt ?? 0)) {
        topX = entry;
      }
      if (topWin === null || entry.payout > (topWin.payout ?? 0)) topWin = entry;
    }
  }

  const mostRounds = [...roundsBy.entries()].sort((a, b) => b[1] - a[1])[0];
  const players = roundsBy.size;

  const cards: TopCard[] = [
    {
      label: 'Top X',
      value: topX === null ? '—' : `${toMultiplier(topX.cashedOutAt ?? 0).toFixed(2)}×`,
      holder: topX?.name ?? '—',
    },
    {
      label: 'Top win',
      value: topWin === null ? '—' : money(topWin.payout ?? 0),
      holder: topWin?.name ?? '—',
    },
    {
      label: 'Rounds',
      value: String(rounds.length),
      holder:
        mostRounds === undefined ? '—' : `${mostRounds[0]} · ${String(mostRounds[1])}`,
    },
    {
      label: 'Players',
      value: String(players),
      holder: 'seen',
    },
    {
      label: 'Wagered',
      value: money(totalStake),
      holder: 'total',
    },
    {
      label: 'Paid out',
      value: money(totalPayout),
      holder: 'total',
    },
  ];

  // The list below the cards ranks players by what they actually took.
  const leaders: BetEntry[] = [...winsBy.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([name, payout]) => ({
      name,
      stake: 0,
      cashedOutAt: null,
      payout,
    }));

  return { cards, leaders };
}

function TopTab() {
  const history = useAppStore((state) => state.history);
  const [period, setPeriod] = useState<Period>('day');

  const { cards, leaders } = useMemo(
    () => buildTopCards(history, period),
    [history, period],
  );

  return (
    <>
      <div className="panel-cards">
        {cards.map((card) => (
          <div className="panel-card" key={card.label}>
            <span className="panel-card__label">{card.label}</span>
            <span className="panel-card__value">{card.value}</span>
            <span className="panel-card__holder">{card.holder}</span>
          </div>
        ))}
      </div>

      <div className="panel-periods" role="group" aria-label="Period">
        {PERIODS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`panel-period${period === entry.id ? ' panel-period--on' : ''}`}
            onClick={() => {
              setPeriod(entry.id);
            }}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {leaders.length === 0 ? (
        <p className="panel-empty">No wins recorded in this period yet.</p>
      ) : (
        <ul className="panel-list">
          {leaders.map((entry, index) => (
            <li className="panel-row panel-row--won" key={entry.name}>
              <span className="panel-row__rank">{index + 1}</span>
              <span className="panel-row__name">{entry.name}</span>
              <span className="panel-row__payout">{money(entry.payout ?? 0)}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function SidePanel() {
  const [tab, setTab] = useState<Tab>('all');
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Narrow screens hide the panel behind this toggle: the rocket is
          the point of the game and must keep the full viewport. */}
      <button
        type="button"
        className={`panel-toggle${open ? ' panel-toggle--open' : ''}`}
        aria-expanded={open}
        aria-label={open ? 'Close table panel' : 'Open table panel'}
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        {open ? '✕' : '☰'}
      </button>

      <aside className={`side-panel app-card app-card--clip${open ? ' side-panel--open' : ''}`}>
        <nav className="panel-tabs" role="tablist">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              className={`panel-tab${tab === entry.id ? ' panel-tab--on' : ''}`}
              onClick={() => {
                setTab(entry.id);
              }}
            >
              {entry.label}
            </button>
          ))}
        </nav>

        <div className="panel-body">
          {tab === 'all' && <AllBetsTab />}
          {tab === 'previous' && <PreviousTab />}
          {tab === 'top' && <TopTab />}
        </div>

        <footer className="panel-footer">
          Powered by <strong>Oleg Bobokhidze</strong>
        </footer>
      </aside>
    </>
  );
}
