# Vue3 Crash Game Starter

**Production-ready Crash casino frontend** — ship a real-time multiplier game in days, not weeks.

Built with **Vue 3**, **Nuxt 3**, **TypeScript**, and **Pixi.js**. This starter includes a full **Crash** experience plus **Mines** and **Plinko** reference implementations in one codebase — ideal for MVPs, client demos, and white-label prototypes.

### 中文简介

面向 **博彩 / 加密赌场 Crash 玩法** 的前端商业模板：含 **实时倍率曲线**、下注面板、自动投注、历史记录与三套可运行 Demo（Crash / Mines / Plinko）。**开箱可演示**，接口层已预留 Mock，接入你们自己的 API / WebSocket 即可上线。适合创业 Demo、外包交付、白标站点与二次开发。

---


## Product Preview

Watch the three core games in action (screen recordings from the demo build):

### Crash — real-time multiplier curve

<video src="public/demo/videos/crash-demo.mp4" controls width="100%"></video>

[Download Crash demo video](public/demo/videos/crash-demo.mp4)

### Mines — grid reveal & cash-out flow

<video src="public/demo/videos/mines-demo.mp4" controls width="100%"></video>

[Download Mines demo video](public/demo/videos/mines-demo.mp4)

### Plinko — physics ball & multiplier slots

<video src="public/demo/videos/plinko-demo.mp4" controls width="100%"></video>

[Download Plinko demo video](public/demo/videos/plinko-demo.mp4)

> **Tip:** Clone the repo and open this README locally, or download the files under `public/demo/videos/`, for the best playback experience.

---

## Why This Template

| Pain point | What you get |
|------------|----------------|
| Weeks building curve math & canvas sync | Exponential flight clock, Pixi renderer, WS tick merge patterns |
| Betting UI from scratch | Manual / Auto tabs, amount input, quick buttons, state machine |
| Inconsistent mobile layout | 1296px desktop shell + responsive game blocks |
| Hard to demo without backend | **Included mock layer** — run `npm run dev` with zero API |

**Stop reinventing Crash.** Plug in your API and WebSocket, keep the UX.

---

## Feature Highlights

- **Real-time multiplier curve** — smooth rocket path, HUD, crash explosion
- **Provably-fair ready UI** — history strip, round IDs, fairness hooks
- **Betting panel** — bet amount, auto cashout, Manual / Auto modes
- **Auto bet engine** — stop on win/loss, round caps, wallet guards
- **Mines & Plinko** — complete secondary games for portfolio depth
- **i18n** — multi-language JSON packs included
- **Clean architecture** — composables, Pinia, typed WS client stubs

---

## What’s Included

- Full **Nuxt 3** source code
- Crash **GameCanvas** (Pixi) + flight math (`flightMath.ts`)
- Shared **BetInput**, **TabBar**, **GameHistory** components
- Mock **REST** + **Crash WS simulator** for offline demos
- Game assets (images, sounds) under `public/`
- **3 preview videos** under `public/demo/videos/`
- Setup documentation (this README)

---

## Tech Stack

- Vue 3 + `<script setup>` + TypeScript
- Nuxt 3
- Pinia
- Pixi.js 8
- Sass / design tokens (`skin.scss`)

---

## Quick Start

```bash
npm install
npm run dev
```

Open **http://localhost:3000**

| Game   | Route          |
|--------|----------------|
| Home   | `/`            |
| Crash  | `/game/crash`  |
| Mines  | `/game/mines`  |
| Plinko | `/game/plinko` |

### Connect your backend

Replace mocks with production services:

| Demo mock | Production hook |
|-----------|-----------------|
| `utils/ts/game/*Api.ts` | Your REST / gRPC client |
| `crash/ws/crashWsController.ts` | Real `crashWsClient` + server |
| `utils/hook/hook.ts` | Wallet & session from your auth |

---

## Perfect For

- Crash game **MVP** and investor demos  
- **Casino / crypto** frontend prototypes  
- **Startup** pitch decks with live UI  
- Agencies delivering **white-label** game skins  
- Developers learning **Crash logic** and canvas sync  

---

## Commercial License

This is a **paid commercial template**.

| | |
|---|---|
| **Price** | $29 USD |
| **Delivery** | Repository access or source archive after purchase |
| **Updates** | Check with seller for maintenance terms |

**Purchase / licensing:** contact below.

---

## Contact

| Channel | |
|---------|---|
| **Email** | d18200517389@163.com |
| **GitHub** | [denglin-dev/vue3-crash-game-starter](https://github.com/denglin-dev/vue3-crash-game-starter) |

For custom integration (real WS, wallet, KYC UI), reach out for implementation quotes.

---

## Project Structure

```
pages/newGame/crash/   # Crash game (canvas, WS, bet flow)
pages/newGame/mines/   # Mines
pages/newGame/plinko/  # Plinko (Pixi)
components/            # BetInput, TabBar, GameHistory…
public/demo/videos/    # Product preview MP4s
i18n/lang/             # Locales
```

---

## License

**Commercial use requires a valid license purchase.**  
Unauthorized redistribution or resale of the source code is prohibited.  
Demo / evaluation use: run locally from this repository for preview purposes.

© denglin-dev. Game UI patterns derived from production casino frontend work.
