# igaming-games

pnpm monorepo for an iGaming **crash** game. This repository currently contains
the **skeleton only** — rendering, transport and UI shells are wired end to end,
but the game itself (round FSM, curve maths, cashout) is deliberately not
implemented yet. Those land in stage 2; every placeholder is marked with a
`TODO(stage-2)` comment.

## Quick start

```bash
pnpm install
pnpm dev
```

`pnpm dev` runs the mock WebSocket server and the Vite dev server in parallel:

- app — http://localhost:5173
- socket — ws://localhost:8080

You should see the background, a rocket centred on screen, the HUD along the
bottom, an FPS overlay in the top-left corner, and a `[socket] heartbeat …`
line in the browser console once per second.

## Structure

```
igaming-games/
├── packages/
│   ├── core/          Pure TypeScript. No browser or Node APIs.
│   │   └── src/
│   │       ├── fsm/         Round phases, events, transition signature
│   │       ├── money/       Branded integer-minor-unit money types
│   │       └── protocol/    Zod schemas for the wire format
│   ├── transport/     WebSocket client + typed event emitter
│   ├── engine/        PixiJS bootstrap, assets, stats overlay, object pool
│   └── ui/            React components (Panel, Button, Meter) + CSS tokens
├── apps/
│   └── crash/         Vite app: React mounts the Pixi canvas, renders the HUD
├── mock-server/       ws server on :8080, dummy heartbeat once per second
├── scripts/
│   └── pack-atlas.py  Rebuilds the sprite atlas from /assets
└── assets/            Source art (packed into the atlas / copied to public)
```

### packages/core

Framework-free domain types, safe to run on a server or in a worker.

- `fsm/` — `RoundPhase`, `RoundEvent`, `RoundState` and the `Transition`
  signature. The transition table itself is stage 2.
- `money/` — money is an **integer count of minor units** behind a branded
  `Minor` type, never a float. A crash game multiplies balances constantly and
  binary floats would compound rounding error into real accounting drift.
- `protocol/` — Zod schemas for inbound frames. `parseServerMessage` returns
  `null` rather than throwing, so one malformed frame cannot kill the socket
  loop. Only `heartbeat` is modelled today, matching the mock server.

### packages/transport

`TransportClient` with `connect()` / `disconnect()` / `send()` and a typed
`Emitter`. Every inbound frame is validated through `@igaming/core` before it
is emitted. Reconnect exists **at the interface level only**: `ReconnectOptions`
and the backoff calculation (`nextDelayMs()`) are implemented and unit-tested,
while the retry loop that consumes them is a `TODO(stage-2)`.

### packages/engine

- **bootstrap** — creates the Pixi `Application`, caps resolution at
  `Math.min(devicePixelRatio, 2)`, attaches `resize` + `ResizeObserver`
  handlers, and returns an idempotent `destroy()`. Because `app.init()` is
  async, the handle also guards the case where the caller unmounts while init
  is still in flight — otherwise Strict Mode leaks an orphan canvas.
- **assets** — the `Assets` manifest with an `atlas` and a `backgrounds`
  bundle, plus `SPRITE` / `BACKGROUND` name constants.
- **overlay** — dev-only FPS + draw-call readout, built from a DOM node so it
  costs nothing in the scene graph. Pixi v8 exposes no stable public draw-call
  counter, so that figure reads `n/a` unless the renderer provides one.
- **pool** — generic `ObjectPool` for the particle/explosion bursts that stage
  2 will spawn, so steady-state allocation stays at zero.

### packages/ui

`Panel`, `Button` and `Meter`, styled entirely from the custom properties in
`src/tokens/orbit.css` — no literal colours in component code. Import the
tokens once at the app entry point.

### apps/crash

Vite + React 18 in **Strict Mode**. `GameCanvas` owns the Pixi lifecycle: the
effect's cleanup destroys the app, removes the resize listeners and drops the
overlay, so the development double-mount never produces a second canvas.
All HUD values are static placeholders.

### mock-server

`ws` server on port 8080 that broadcasts
`{"type":"heartbeat","ts":…,"seq":…}` once per second. Nothing else — the real
round loop is stage 2.

## Assets

Backgrounds are served from `apps/crash/public/assets/backgrounds/`
(`bg_01_surface` … `bg_05_deep_space`, WebP).

The sprite atlas lives at `apps/crash/public/assets/atlas/orbit.{json,png}` and
contains: `rocket`, `rocket_flame`, `explosion_01..03`, `particle_spark`,
`particle_smoke`, `particle_star`, `particle_debris`, `btn_primary`,
`panel_wide`, `panel_medium`, `panel_small`.

Regenerate it from the source art after changing anything in `assets/`:

```bash
python3 scripts/pack-atlas.py   # requires Pillow
```

## Scripts

| Command          | Description                          |
| ---------------- | ------------------------------------ |
| `pnpm dev`       | Mock server + crash app, in parallel |
| `pnpm build`     | Build every package and the app      |
| `pnpm typecheck` | `tsc --build` across the workspace   |
| `pnpm lint`      | ESLint (flat config, type-aware)     |
| `pnpm format`    | Prettier write                       |
| `pnpm test`      | Vitest                               |

## Conventions

- TypeScript `strict` **and** `noUncheckedIndexedAccess` are on everywhere,
  inherited from `tsconfig.base.json`.
- Packages are consumed from source via workspace `exports`; the app's bundler
  compiles them, so no watch-build step is needed in development.
- `tsconfig.tools.json` is a non-composite project covering tests and root
  config files, which import package sources directly.

## Not implemented yet

Intentionally out of scope for this skeleton:

- FSM transition table and the round runtime
- Multiplier curve maths and cashout
- Bet placement, balance mutation, settlement
- Reconnect retry loop (policy and backoff exist; the loop does not)
- Real round frames in the protocol and the mock server
