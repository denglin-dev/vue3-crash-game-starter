# Vue3 Crash Game Starter

Production-style **Crash** game frontend starter (Vue 3 + Nuxt 3 + TypeScript + Pixi.js), with **Mines** and **Plinko** demos in the same repo.

> **Frontend-only demo** — no backend required. APIs and Crash WebSocket are replaced with local mocks.

## Live Demo

Run locally:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Preview

(Add screenshots or GIF here)

## Features

- Real-time multiplier crash curve (Pixi canvas)
- Betting panel UI (Manual / Auto)
- Auto cashout
- Mines & Plinko mini-games (demo)
- Responsive layout (1296px centered desktop shell)
- i18n-ready
- Easy to swap mocks for real API / WS

## Games & Routes

| Game   | URL            |
|--------|----------------|
| Home   | `/`            |
| Crash  | `/game/crash`  |
| Mines  | `/game/mines`  |
| Plinko | `/game/plinko` |

## Built With

- Nuxt 3
- Vue 3 + TypeScript
- Pinia
- Pixi.js 8
- Sass

## Mock Layer (Demo)

| Production               | Demo replacement                             |
|--------------------------|----------------------------------------------|
| `minesApi` / `plinkoApi` | `utils/ts/game/*Api.ts`                      |
| Crash WebSocket          | `pages/newGame/crash/ws/crashWsController.ts` |
| Wallet / auth            | `utils/hook/hook.ts` (stub balance)          |
| Game config              | `stores/gameConfig.ts`                       |

## Project Structure

```
pages/newGame/     # Crash, Mines, Plinko
components/        # BetInput, TabBar, GameHistory…
i18n/lang/         # Locales
public/            # Images & sounds
```

## Perfect For

- Crash game MVP / prototype
- Casino frontend demos
- Learning crash curve & bet flow
- GitHub portfolio showcase

## Contact

Email: d18200517389@163.com

## License

Demo code for portfolio / showcase. Game UI logic © original project.
