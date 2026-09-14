# igaming-games

pnpm monorepo for an iGaming **crash** game. Rounds are played end to end: a
mock server runs the authoritative round loop, the client mirrors it through a
pure state machine, and the scene reacts — launch, climb, cashout, explosion,
with audio and a between-rounds result card.

## Quick start

```bash
pnpm install
pnpm dev
```

`pnpm dev` runs the mock WebSocket server and the Vite dev server in parallel:

- app — http://localhost:5173
- socket — ws://localhost:8080

Rounds start on their own. You should see a betting countdown, the rocket
rising out of frame and settling, the multiplier climbing until it crashes,
and a result card with a loader counting down to the next round. Bot players
populate the side panel by betting through the real engine.

## How a round works

The server owns the round; the client only ever mirrors it. One round is:

```
betting (6s) → launching (1.5s) → flying → crashed → settled → intermission (4s)
```

- **betting** — bets accepted until `betsCloseAt`, which the server sends as an
  absolute timestamp so the client's countdown and the server's deadline cannot
  drift apart.
- **launching** — bets closed, ignition. The rocket's entrance plays here.
- **flying** — the server ticks the multiplier 10× a second; the client
  interpolates between ticks for presentation only.
- **crashed / settled** — the crash point, then payouts.

Two rules shape the whole client:

1. **The server is authoritative.** The client never decides when a round
   crashes and never computes a payout. The one value it derives locally is the
   multiplier between ticks, and the next authoritative frame overwrites it.
2. **Totality.** Every (phase, event) pair either produces a next state or is
   explicitly ignored — `transition` never throws. Out-of-order and duplicate
   frames are normal on a real socket, so a late tick arriving after a crash
   must be dropped, not treated as a bug.

## Structure

```
igaming-games/
├── packages/
│   ├── core/          Pure TypeScript. No browser or Node APIs.
│   │   └── src/
│   │       ├── fsm/         Round machine, round engine, curve, crash point
│   │       ├── money/       Branded integer-minor-unit money types
│   │       └── protocol/    Zod schemas for the wire format
│   ├── transport/     WebSocket client + typed event emitter
│   ├── engine/        PixiJS bootstrap, assets, sound, stats overlay, pool
│   └── ui/            React components (Panel, Button, Meter) + CSS tokens
├── apps/
│   └── crash/         Vite app: React shell around a Pixi canvas
├── mock-server/       ws server on :8080, runs the real round engine
├── scripts/
│   └── pack-atlas.py  Rebuilds the sprite atlas from /assets
└── assets/            Source art and audio (packed / copied to public)
```

### packages/core

Framework-free domain logic, safe to run on a server or in a worker. The mock
server and the browser import the same code, which is what keeps them agreeing
about what a frame means.

- `fsm/index.ts` — `transition`, a pure `(state, event) => state` reducer, plus
  `canPlaceBet` / `canCashOut` so the UI and the server apply one rule rather
  than two that drift.
- `fsm/round-engine.ts` — the authoritative round runtime: phase timing, bet
  book, cashout and settlement. The mock server drives it; a real backend would
  replace it without the client changing.
- `fsm/curve.ts` — multiplier over time, and `multiplierToProgress` for the
  backdrop's altitude.
- `fsm/crash-point.ts` — the crash point distribution.
- `fsm/adapter.ts` — translates wire frames into machine events, so a protocol
  change does not ripple into the transition table.
- `money/` — money is an **integer count of minor units** behind a branded
  `Minor` type, never a float. A crash game multiplies balances constantly, and
  binary floats would compound rounding error into real accounting drift.
- `protocol/` — Zod schemas for every frame. `parseServerMessage` returns `null`
  rather than throwing, so one malformed frame cannot kill the socket loop.

### packages/transport

`TransportClient` with `connect()` / `disconnect()` / `send()` and a typed
`Emitter`. Every inbound frame is validated through `@igaming/core` before it is
emitted. Reconnect exists **at the interface level only**: `ReconnectOptions`
and `nextDelayMs()` are implemented and unit-tested, while the retry loop that
consumes them is still a `TODO(stage-2)`.

### packages/engine

- **bootstrap** — creates the Pixi `Application`, caps resolution at
  `Math.min(devicePixelRatio, 2)`, attaches `resize` + `ResizeObserver`
  handlers, and returns an idempotent `destroy()`. Because `app.init()` is
  async, the handle also guards the case where the caller unmounts while init is
  still in flight — otherwise Strict Mode leaks an orphan canvas.
- **assets** — the `Assets` manifest with `atlas` and `backgrounds` bundles.
- **sound** — Web Audio playback on two independent buses (effects, music) over
  one `AudioContext`. Web Audio rather than `<audio>` elements because
  overlapping one-shots need a decoded buffer played many times, and gapless
  looping needs sample-accurate scheduling.
- **overlay** — dev-only FPS + draw-call readout, built from a DOM node so it
  costs nothing in the scene graph. Pixi v8 exposes no stable public draw-call
  counter, so that figure reads `n/a` unless the renderer provides one.
- **pool** — generic `ObjectPool`, used by the particle and explosion bursts so
  steady-state allocation stays at zero.

### packages/ui

`Panel`, `Button` and `Meter`, styled entirely from the custom properties in
`src/tokens/orbit.css` — no literal colours in component code. The
`--orbit-shell-*` tokens define the app shell: one radius, one gap and one
padding shared by every region, so the layout cannot drift out of step one
stylesheet at a time.

### apps/crash

Vite + React 18 in **Strict Mode**. The page is a set of rounded cards — header,
side panel, game, betting controls — on a common background.

- `game/` — the Pixi scene: `scene.ts` (rocket, launch entrance, idle sway),
  `backdrop.ts` (scrolling star field), `particles.ts`, `explosion.ts`.
- `state/store.ts` — Zustand. The round slice is not hand-maintained: every
  change goes through `transition` from core.
- `hooks/useSocket.ts` — socket lifecycle and outbound commands.
- `hooks/useGameSound.ts` — fires audio off the round's transitions. Subscribes
  to the store directly rather than rendering, for the same reason the canvas
  does: the multiplier changes every frame.
- `components/GameCanvas.tsx` — owns the Pixi lifecycle. The effect's cleanup
  destroys the app and drops the overlay, so the development double-mount never
  produces a second canvas.

The canvas is driven from a store subscription, not from React props. The
multiplier changes every animation frame, and re-rendering a component tree at
that rate to move a sprite would be pure overhead.

### mock-server

`ws` server on port 8080. It contains no round logic at all: `createRoundHost`
from core owns the timing, bets, bots, payouts and history, and this package
adds only the parts a unit test cannot cover — a socket, a timer and player
identity.

That split is what lets the browser build run the same rounds with no server.
`LocalTransport` in `packages/transport` drives the identical host from a timer
in the page, so there is one implementation of a payout rather than one per
host.

## Assets

The backdrop is a tiling star field at
`apps/crash/public/assets/backgrounds/orbit-stars.png`. Painted altitude
scenery was tried twice and dropped: five cross-dissolved images left a
washed-out band at every handover, and a single tall strip could not be
generated long enough to give a phone-shaped viewport more than a screenful of
travel. Stars tile, so the climb never runs out and there is no seam.

Audio lives in `apps/crash/public/assets/audio/` as Ogg Vorbis. Ogg rather than
mp3 because mp3 carries encoder padding at both ends, which is audible as a gap
every time a loop wraps. Effects are peak-normalised and music is normalised to
−20 LUFS so it sits under them; the three loops are crossfaded at the seam.

The sprite atlas lives at `apps/crash/public/assets/atlas/orbit.{json,png}` and
contains: `rocket`, `rocket_flame`, `explosion_01..03`, `particle_spark`,
`particle_smoke`, `particle_star`, `particle_debris`, `btn_primary`,
`panel_wide`, `panel_medium`, `panel_small`.

Regenerate it from the source art after changing anything in `assets/`:

```bash
python3 scripts/pack-atlas.py   # requires Pillow
```

## Deploying

The app ships as static files with **no game server**. `VITE_SOCKET_URL` is
unset in a normal build, which makes the client use `LocalTransport`: the same
round host the mock server runs, driven by a timer in the page instead of a
socket. Bots, payouts, history and the shared table all work; the round is
simply hosted by the browser.

That is a deliberate trade, not a shortcut around one. Static hosting has no
process that stays alive, so a WebSocket cannot be served from it — and a demo
that loads but cannot play is worse than one that plays locally. Because both
transports implement the same interface and exchange the same protocol frames,
nothing above the transport changes between the two, so the socket path does
not rot while the local one is in use.

To point a build at a real server instead, set `VITE_SOCKET_URL`:

```bash
VITE_SOCKET_URL=wss://your-host.example pnpm --filter @igaming/crash build
```

`apps/crash/vercel.json` carries the build configuration. On Vercel, set the
project's **Root Directory** to `apps/crash`; the install and build commands
step up to the repo root first, because the workspace packages live there and
installing inside `apps/crash` alone cannot resolve them.

Each app in `apps/` is its own Vercel project pointing at the same repository,
distinguished only by Root Directory. Give each one an **Ignored Build Step** so
a change to one app does not rebuild the others.

## Scripts

| Command             | Description                          |
| ------------------- | ------------------------------------ |
| `pnpm dev`          | Mock server + crash app, in parallel |
| `pnpm build`        | Build every package and the app      |
| `pnpm typecheck`    | `tsc --build` across the workspace   |
| `pnpm lint`         | ESLint (flat config, type-aware)     |
| `pnpm format`       | Prettier write                       |
| `pnpm format:check` | Prettier check                       |
| `pnpm test`         | Vitest                               |

## Conventions

- TypeScript `strict` **and** `noUncheckedIndexedAccess` are on everywhere,
  inherited from `tsconfig.base.json`.
- Packages are consumed from source via workspace `exports`; the app's bundler
  compiles them, so no watch-build step is needed in development.
- `tsconfig.tools.json` is a non-composite project covering tests and root
  config files, which import package sources directly.
- Tests cover the pure layers — the state machine, round engine, curve, money
  and protocol — because those are where a bug costs real money. The renderer
  and the React shell are verified by running the app.

## Not implemented yet

- Reconnect retry loop (policy and backoff exist and are tested; the loop that
  consumes them does not)
- A real multiplayer server. The deployed build hosts its own round, so every
  visitor sees their own table — the bots make it look shared, but two people
  opening the link are not playing together.
- Real accounts, balances and persistence — balance is per-connection and
  resets when the mock server restarts
- Provably-fair crash point (seed, hash chain, client verification)
- Auto-cashout is accepted by the engine but has no UI beyond the target input
