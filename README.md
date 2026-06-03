# Cy Games Demo

Nuxt 3 + Vue 3 demo showcasing three original crypto casino games:

- **Mines** — grid-based minesweeper
- **Plinko** — Pixi.js ball physics
- **Crash** — multiplier curve game

> This is a **frontend-only demo** for GitHub. All API / WebSocket calls are replaced with local mock hooks. No backend, wallet, or auth required.

## Quick Start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Routes

| Game   | URL            |
|--------|----------------|
| Home   | `/`            |
| Mines  | `/game/mines`  |
| Plinko | `/game/plinko` |
| Crash  | `/game/crash`  |

## Mock Layer

| Production              | Demo replacement                          |
|-------------------------|-------------------------------------------|
| `minesApi` / `plinkoApi`| `utils/ts/game/*Api.ts` — local logic     |
| Crash WebSocket         | `crash/ws/crashWsController.ts` — simulator |
| `utils/hook/hook.ts`    | Demo wallet stub (balance: 10000 USDT)    |
| `stores/gameConfig`     | Hardcoded table config                    |

## Tech Stack

- Nuxt 3
- Vue 3 + TypeScript
- Pinia
- Pixi.js 8 (Plinko & Crash canvas)
- Sass

## Project Structure

```
pages/newGame/     # Game source (copied from production)
i18n/lang/         # Locale JSON (from cy_client_nuxt3)
components/        # Shared GameTemplate, BetInput, TabBar…
utils/hook/        # Demo auth/wallet stub
stores/            # Mock gameConfig
public/            # Game assets (images, sounds)
```

Layout is capped at **1296px** (`--center-width`), centered on wide screens.

## License

Demo code for portfolio / GitHub showcase. Game UI logic © original project.
