/**
 * Crash WebSocket mock — local round simulator for GitHub demo (no real WS).
 * 飞行 tick 须带权威 elapsed_ms、单调 version，倍数与 flightMath 指数公式一致，避免画布时钟校正顿挫。
 */
import {
  gameState,
  gameDouble,
  isBetting,
  cashoutRequestPending,
  crashRoomState,
  crashJoinSnapshotApplied,
  crashSelfPlayerId,
  crashWsConnected,
  crashWsBroadcastConnected,
  crashWsSocketError,
  flyingTickData,
  crashHistory,
  CRASH_HISTORY_MAX_LEN,
  clampMultiplierValue,
  type CrashRoundHistoryItem,
} from '../composables/useCrashState'
import type { CrashWsRoomState } from './crashWsClient'
import { multFromElapsedMs, elapsedMsFromMultiplier } from '../utils/flightMath'
import { userInfo } from '~/utils/hook/hook'

export interface StartCrashWsControllerOptions {
  url?: string
  broadcastUrl?: string
  token?: string
}

/** 与线上一致：逻辑帧间隔；画布横轴 / 时钟校正均依赖此值 */
const TICK_INTERVAL_MS = 50
const BETTING_COUNTDOWN_MS = 5000
const BETTING_TICK_MS = 100

let started = false
let gameId = 1
let crashPoint = 2
let phaseTimer: ReturnType<typeof setTimeout> | null = null
let flyTimer: ReturnType<typeof setInterval> | null = null
let betCountdownTimer: ReturnType<typeof setInterval> | null = null
let pendingAutoCashout = 2
let selfBetMicro = 0
let roomVersion = 0

function clearTimers() {
  if (phaseTimer) clearTimeout(phaseTimer)
  if (flyTimer) clearInterval(flyTimer)
  if (betCountdownTimer) clearInterval(betCountdownTimer)
  phaseTimer = null
  flyTimer = null
  betCountdownTimer = null
}

function formatFlyingMultiplier(mult: number): number {
  return Math.floor(mult * 100) / 100
}

function demoHistoryRow(crash_point: number, bet_id: string): CrashRoundHistoryItem {
  return {
    crash_point,
    server_seed: '',
    client_seed: '',
    bet_id,
  }
}

function pushHistory(point: number) {
  const row = demoHistoryRow(point, `demo-${Date.now()}`)
  crashHistory.list.push(row)
  while (crashHistory.list.length > CRASH_HISTORY_MAX_LEN) {
    crashHistory.list.shift()
  }
}

function baseRoom(partial: Partial<CrashWsRoomState>): CrashWsRoomState {
  return {
    game_id: gameId,
    phase: 'betting',
    multiplier: 1,
    crashed: false,
    crash_point: null,
    betting_ticks_left: 0,
    server_seed: null,
    online_count: 12,
    version: roomVersion,
    round_bets: [],
    tick_interval_ms: TICK_INTERVAL_MS,
    countdown_ms: BETTING_COUNTDOWN_MS,
    ...partial,
  } as CrashWsRoomState
}

function setRoom(partial: Partial<CrashWsRoomState>) {
  if (partial.version != null) {
    roomVersion = Number(partial.version)
  } else if (partial.phase && partial.phase !== crashRoomState.value?.phase) {
    roomVersion += 1
  }
  crashRoomState.value = baseRoom({
    ...partial,
    game_id: gameId,
    version: roomVersion,
  })
}

/** 飞行段就地更新房间字段，避免每 tick 替换整个 crashRoomState 触发全量 watch */
function applyFlyingTick(elapsedMs: number, mult: number) {
  const s = crashRoomState.value
  if (!s || s.phase !== 'flying' || s.crashed) return

  roomVersion += 1
  s.multiplier = mult
  s.elapsed_ms = elapsedMs
  s.version = roomVersion

  gameDouble.value = mult
  flyingTickData.value = {
    multiplier: mult,
    version: roomVersion,
    elapsed_ms: elapsedMs,
  }
}

async function applyBetPacket(msg: { code?: number; amount?: number }) {
  const mod = await import('../composables/useCrashBet')
  mod.applyCrashWsBetPacket?.({ code: msg.code ?? 0, amount: msg.amount ?? selfBetMicro / 1e6 })
}

async function applyCashoutPacket(msg: { code?: number; multiplier?: number; profit?: number }) {
  const mod = await import('../composables/useCrashBet')
  mod.applyCrashWsCashoutPacket?.({
    code: msg.code ?? 0,
    multiplier: msg.multiplier ?? gameDouble.value,
    profit: msg.profit ?? 0,
  })
}

function startBettingPhase() {
  gameState.value = 1
  gameDouble.value = 1
  crashPoint = Math.floor((1.2 + Math.random() * 8) * 100) / 100

  let countdownMs = BETTING_COUNTDOWN_MS
  setRoom({
    phase: 'betting',
    multiplier: 1,
    crashed: false,
    crash_point: null,
    round_bets: [],
    elapsed_ms: undefined,
    countdown_ms: countdownMs,
  })

  if (betCountdownTimer) clearInterval(betCountdownTimer)
  betCountdownTimer = setInterval(() => {
    const s = crashRoomState.value
    if (!s || s.phase !== 'betting') return
    countdownMs = Math.max(0, countdownMs - BETTING_TICK_MS)
    s.countdown_ms = countdownMs
    if (countdownMs <= 0 && betCountdownTimer) {
      clearInterval(betCountdownTimer)
      betCountdownTimer = null
    }
  }, BETTING_TICK_MS)

  phaseTimer = setTimeout(() => {
    if (betCountdownTimer) {
      clearInterval(betCountdownTimer)
      betCountdownTimer = null
    }
    startFlyingPhase()
  }, BETTING_COUNTDOWN_MS)
}

function startFlyingPhase() {
  gameState.value = 2
  const crashElapsedMs = Math.max(0, Math.ceil(elapsedMsFromMultiplier(crashPoint)))

  setRoom({
    phase: 'flying',
    multiplier: 1,
    crashed: false,
    crash_point: null,
    elapsed_ms: 0,
    countdown_ms: undefined,
  })

  let elapsedMs = 0
  flyingTickData.value = { multiplier: 1, version: roomVersion, elapsed_ms: 0 }

  flyTimer = setInterval(async () => {
    elapsedMs += TICK_INTERVAL_MS
    if (elapsedMs > crashElapsedMs) elapsedMs = crashElapsedMs

    let mult = formatFlyingMultiplier(multFromElapsedMs(elapsedMs))
    if (mult < 1) mult = 1

    applyFlyingTick(elapsedMs, mult)

    if (isBetting.value && !cashoutRequestPending.value && mult >= pendingAutoCashout) {
      cashoutRequestPending.value = true
      const profit = (selfBetMicro / 1e6) * mult - selfBetMicro / 1e6
      await applyCashoutPacket({ multiplier: mult, profit })
      isBetting.value = false
      cashoutRequestPending.value = false
    }

    if (elapsedMs >= crashElapsedMs || mult >= crashPoint) {
      clearTimers()
      onCrash(crashPoint, crashElapsedMs)
    }
  }, TICK_INTERVAL_MS)
}

function onCrash(point: number, elapsedMs: number) {
  gameState.value = 0
  pushHistory(point)
  setRoom({
    phase: 'crashed',
    multiplier: point,
    crash_point: point,
    crashed: true,
    elapsed_ms: elapsedMs,
  })
  isBetting.value = false
  cashoutRequestPending.value = false
  gameId++
  phaseTimer = setTimeout(startBettingPhase, 3000)
}

export function crashHasSelfPendingRoundBet(room: CrashWsRoomState | null): boolean {
  if (!room?.round_bets?.length) return false
  const sid = String(userInfo.value?.id ?? '')
  return room.round_bets.some((b) => String(b.player_id) === sid && b.status === 'pending')
}

export function mergeSelfZeroBetFromS2cBet(_msg?: { amount?: number; auto_cashout_mult?: number }) {}

export function mergeSelfRoundBetCashoutFromS2c(_msg?: Record<string, unknown>) {}

export function startCrashWsController(_opts: StartCrashWsControllerOptions = {}) {
  if (!import.meta.client || started) return
  started = true
  crashWsConnected.value = true
  crashWsBroadcastConnected.value = true
  crashWsSocketError.value = false
  crashJoinSnapshotApplied.value = true
  crashSelfPlayerId.value = userInfo.value.id
  roomVersion = 0
  crashHistory.list = [
    demoHistoryRow(1.42, 'demo-1'),
    demoHistoryRow(3.88, 'demo-2'),
    demoHistoryRow(1.05, 'demo-3'),
  ]
  startBettingPhase()
}

export function stopCrashWsController() {
  clearTimers()
  started = false
  crashWsConnected.value = false
  crashWsBroadcastConnected.value = false
  crashJoinSnapshotApplied.value = false
}

export function restartCrashWsController(opts: StartCrashWsControllerOptions = {}) {
  stopCrashWsController()
  started = false
  startCrashWsController(opts)
}

export function crashWsSendClassicBet(bet: number, autoCashoutMult: number): boolean {
  if (!started) return false
  selfBetMicro = Math.floor(bet * 1e6)
  pendingAutoCashout = clampMultiplierValue(autoCashoutMult)
  isBetting.value = true
  void applyBetPacket({ code: 0, amount: bet })
  return true
}

export function crashWsSendCashOut(): boolean {
  if (!started || gameState.value !== 2 || !isBetting.value) return false
  cashoutRequestPending.value = true
  const mult = gameDouble.value
  const profit = (selfBetMicro / 1e6) * mult - selfBetMicro / 1e6
  void applyCashoutPacket({ multiplier: mult, profit })
  isBetting.value = false
  cashoutRequestPending.value = false
  return true
}

export function crashWsReconnect() {
  if (!started) startCrashWsController()
}

export function getCrashWsClient() {
  return null
}

export function getCrashWsBroadcastClient() {
  return null
}

export function isCrashWsControllerStarted() {
  return started
}
