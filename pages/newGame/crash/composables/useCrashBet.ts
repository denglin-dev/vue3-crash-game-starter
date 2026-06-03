/**
 * Crash 经典模式：下注、兑现、自动策略、WS 结果处理、页级 `gameState` 监听与进页初始化。
 *
 * - 下注/兑现/重连：`crashWsController` WebSocket；
 * - 音效等：同源 POST `/crash/client-signal`；
 * - 下注结果：`applyCrashWs*`（`s2c_bet` / `s2c_cashout`）。
 */

import { watch, nextTick } from 'vue'
import { useGame } from '~/composables/GameHook'
import { useGameConfigStore } from '~/stores/gameConfig'
import { MessageService } from '~/utils/MessageService'
import { userInfo } from '~/utils/hook/hook'
import { blockBetIfAmountInvalid } from '~/pages/newGame/common/betAmountSubmitGuard'
import {
  resolveFastModeFromConfigSpeed,
  shouldBlockFastModeManualBetBurst
} from '~/pages/newGame/common/fastModeBetGate'
import { crashBetAmountInputExpose } from '../crashBetInputBridge'
import {
  useCrashState,
  gameState,
  isBetting,
  cashoutRequestPending,
  betAmount,
  multiplier,
  gameDouble,
  classicMoney,
  isStart,
  gameStart,
  savedBetData,
  autoBetData,
  betButtonState,
  changeBetButtonState,
  getButtonStr,
  clearBetData,
  resetState,
  clampMultiplierValue,
  crashRoomState,
} from './useCrashState'
import type { ClassicBetData } from '../types'
import {
  crashWsSendClassicBet,
  crashWsSendCashOut,
  crashWsReconnect,
  mergeSelfRoundBetCashoutFromS2c,
  mergeSelfZeroBetFromS2cBet,
  crashHasSelfPendingRoundBet,
} from '../ws/crashWsController'
import { floorToDecimal } from "~/utils/common"
import { pickDisplayPayoutMicroAmount } from "~/pages/newGame/common/pickDisplayPayoutMicroAmount"

/** 下注/预约上行用的自动兑现倍数：始终落在 `clampMultiplierValue` 区间内（输入框可能为字符串且未失焦） */
function normalizedBetDoubleForProto(raw: unknown): number {
  return clampMultiplierValue(Number(raw))
}

// 重新导出给外部使用
export { crashWsSendClassicBet } from '../ws/crashWsController'

const { setBetAmount } = useGame()

/** 手动模式盈利数字展示若干秒后清除 */
let winMoneyHideTimer: ReturnType<typeof setTimeout> | null = null

const clearWinMoneyHideTimer = () => {
  if (winMoneyHideTimer != null) {
    clearTimeout(winMoneyHideTimer)
    winMoneyHideTimer = null
  }
}

/** 防止同一 `game_id` 的下注阶段多次进入 `reqGameStart`：第二次会带着 `autoBetData.isBet===true` 误走「输局调额」把已按赢局算好的金额再乘输比例（例 0.3 → 1.2） */
let lastCrashAutoBetReqGameId: number | null = null

function currentCrashBettingGameId(): number | null {
  const room = crashRoomState.value
  if (room?.phase !== "betting") return null
  const gid = room.game_id
  if (gid == null || !Number.isFinite(Number(gid))) return null
  return Number(gid)
}

/** 页面卸载或 reset 前调用，避免定时器改已卸载组件依赖的 ref */
export const clearCrashBetVisualTimers = () => {
  clearWinMoneyHideTimer()
}

// ========== 信令（HTTP，仅保留音效等非 WS 项）==========

async function postCrashSignal(data: Record<string, unknown>) {
  if (!import.meta.client) return
  try {
    await $fetch('/crash/client-signal', { method: 'POST', body: data })
  } catch (e) {
    if (import.meta.dev) console.warn('[crash] client-signal:', e)
  }
}

/**
 * 飞行阶段兑现：发 `c2s_cashout`。
 * 不等 `s2c_cashout` 才改 UI：先置 `cashoutRequestPending` 并 `getButtonStr`，按钮立刻灰（处理中）；
 * 单播失败或断线未发出时再清 pending 并恢复黄钮。
 */
export const sendCashOut = () => {
  if (cashoutRequestPending.value) return
  cashoutRequestPending.value = true
  const ok = crashWsSendCashOut()
  if (!ok) {
    cashoutRequestPending.value = false
    getButtonStr(gameState.value)
    return
  }
  // 兑现上行优先；按钮置灰延后一帧，避免点击帧与 Pixi 飞行动画同抢主线程。
  if (import.meta.client) {
    requestAnimationFrame(() => getButtonStr(gameState.value))
  } else {
    getButtonStr(gameState.value)
  }
}

/** 用户主动/壳层触发：断线重连同一 WS 实例 */
export const sendReconnect = () => {
  crashWsReconnect()
}

export const sendSoundToggle = (isOpen: boolean) => {
  void postCrashSignal({ type: 'carshsound', isopen: isOpen })
}

// ========== 手动经典 ==========

/**
 * BetButton 聚合：黄=兑现；灰=禁止；红+预约=取消预约；
 * 其它情况走手动下注逻辑：非下注阶段预约，下注阶段直接发 WS。
 */
export const handleBetButtonDown = (name: string, data: ClassicBetData, buttonColor: string) => {
  if (buttonColor === 'yellow') return sendCashOut()
  /** 飞行/休息段「预约下一局」取消：须按真实 `gameState` 刷新按钮；误用 `getButtonStr(1)` 会在飞行中把钮锁成灰且不再恢复绿 */
  if (isBetting.value && savedBetData.state) {
    clearBetData()
    isBetting.value = false
    getButtonStr(gameState.value)
    return
  }
  if (betButtonState.value === 'gray') return

  if (shouldBlockFastModeManualBetBurst()) return

  const bet = Number(data.bet)
  if (!Number.isFinite(bet) || bet < 0) {
    crashBetAmountInputExpose.value?.checkedinputFail?.()
    return
  }
  if (
    blockBetIfAmountInvalid(
      crashBetAmountInputExpose.value,
      bet,
      undefined,
      { skipBlur: gameState.value === 2 }
    )
  ) {
    return
  }

  isBetting.value = true

  const multUi = normalizedBetDoubleForProto(data.double)

  if (gameState.value === 2 || gameState.value === 0) {
    // 非下注阶段：预约
    savedBetData.name = name
    savedBetData.data = { ...data, double: multUi }
    savedBetData.state = true
    getButtonStr(gameState.value)
  } else {
    // 下注阶段：先发 WS；必须立刻 `getButtonStr`，否则 `isBetting` 已为 true 但 `betButtonState` 仍为绿，
    // 界面只绑 `betButtonState`，会误像「卡住几秒」直到下一条 room_state / s2c_bet 才刷新。
    const sent = crashWsSendClassicBet(data.bet, multUi)
    if (!sent) {
      isBetting.value = false
    }
    getButtonStr(gameState.value)
  }
}

export const userCashOut = () => {
  sendCashOut()
}

// ========== 自动下注 ==========

/** 写入自动策略初始状态；若当前已是下注阶段则立刻尝试首注 */
export const startAutoBet = () => {
  autoBet('auto')
  if (gameState.value === 1) {
    reqGameStart()
  }
}

/** 记录起始金额、打开 isStart/isBetting，供后续每局 reqGameStart 使用 */
const autoBet = (name: string) => {
  lastCrashAutoBetReqGameId = null
  savedBetData.data = { bet: betAmount.value, double: normalizedBetDoubleForProto(multiplier.value) }
  savedBetData.state = true
  savedBetData.name = name
  isStart.value = true
  isBetting.value = true
  autoBetData.startMoney = betAmount.value
}

/**
 * 自动下一局：
 * - 若上一局已下注且仍在「持有注单」语义（`autoBetData.isBet`）、且倍数未达目标（坠毁/未逃），先按**输**规则调整 `betAmount`；
 * - **成功兑现后** `isBet` 已置 `false`，不得再进本段，否则会误用输局逻辑把「赢后已递增的 betAmount」冲回 `startMoney`；
 * - 通过后 `gameStart=true` 并发真实下注。
 */
export const reqGameStart = async () => {
  if (savedBetData.state) {
    const gid = currentCrashBettingGameId()
    if (gameState.value === 1 && gid != null && gid === lastCrashAutoBetReqGameId) {
      return
    }
  }
  const multUi = normalizedBetDoubleForProto(multiplier.value)
  if ((gameDouble.value === 1 || gameDouble.value < multUi) && gameStart.value && autoBetData.isBet) {
    autoBetData.allFailMoney -= Number(betAmount.value)
    betAmount.value = setBetAmount(
      true,
      Number(betAmount.value),
      Number(autoBetData.lossCount),
      Number(autoBetData.winCount),
      autoBetData.startMoney
    )

    const bet = Number(betAmount.value)
    if (!Number.isFinite(bet) || bet < 0) return exitAutoGame(true)
    if (blockBetIfAmountInvalid(crashBetAmountInputExpose.value, bet, () => exitAutoGame(true))) return

    if (
      Number(autoBetData.lossEndMoney) > 0 &&
      Number(autoBetData.lossEndMoney) + autoBetData.allFailMoney <= 0
    ) {
      gameStart.value = false
      return exitAutoGame()
    }
  }

  {
    const bet = Number(betAmount.value)
    if (!Number.isFinite(bet) || bet < 0) return exitAutoGame(true)
  }

  if (blockBetIfAmountInvalid(crashBetAmountInputExpose.value, Number(betAmount.value), () => exitAutoGame(true))) {
    return
  }

  gameStart.value = true
  const sent = crashWsSendClassicBet(betAmount.value, multUi)
  if (savedBetData.state && sent) {
    const gid = currentCrashBettingGameId()
    if (gid != null) lastCrashAutoBetReqGameId = gid
  }
  if (!sent) {
    isBetting.value = false
    gameStart.value = false
    exitAutoGame(true)
    getButtonStr(gameState.value)
  }
}

/**
 * 停止自动：
 * - 若本局已下注且仍在飞：只关 `gameStart`，等兑现后再清；
 * - 否则一次性清掉自动/预约/累计标记。
 */
export const exitAutoGame = (force = false) => {
  if (!force && autoBetData.isBet && gameStart.value) {
    gameStart.value = false
  } else {
    isStart.value = false
    savedBetData.data = {}
    savedBetData.state = false
    savedBetData.name = ''
    autoBetData.allFailMoney = 0
    autoBetData.lossEndMoney = undefined
    gameDouble.value = 1
    isBetting.value = false
    autoBetData.isBet = false
    lastCrashAutoBetReqGameId = null
  }
}

const handleBetFail = () => {
  lastCrashAutoBetReqGameId = null
  isBetting.value = false
  cashoutRequestPending.value = false
  betButtonState.value = 'green'
  clearBetData()
  exitAutoGame()
}

/**
 * WS `s2c_bet`：code===0 等同下注成功；非 0 走错误映射 + `handleBetFail`。
 */
export function applyCrashWsBetPacket(m: {
  code: number
  message?: string
  client_ref?: string
  msg?: { amount?: number; auto_cashout_mult?: number }
}) {
  void m.client_ref
  if (m.code === 0) {
    mergeSelfZeroBetFromS2cBet(m.msg)
    if (!isStart.value) changeBetButtonState('gray')
    if (savedBetData.state) {
      autoBetData.isBet = true
    }
    return
  }
  // MessageService.error(String(m.message ?? m.code))
  handleBetFail()
}

/**
 * WS `s2c_cashout`：失败仅提示；成功分支与旧逻辑一致（自动用手动用 classicMoney）。
 */
export function applyCrashWsCashoutPacket(m: {
  code: number
  message?: string
  msg?: { multiplier?: number; max_profit?: number; bet?: number; profit?: number; payout?: number }
}) {
  cashoutRequestPending.value = false
  if (m.code !== 0) {
    // MessageService.error(String(m.message ?? m.code))
    getButtonStr(gameState.value)
    return
  }
  mergeSelfRoundBetCashoutFromS2c(m.msg)
  const payout = floorToDecimal(
    pickDisplayPayoutMicroAmount(m.msg?.payout, m.msg?.max_profit),
    userInfo.value.currencyType === "FAIT" ? 2 : 6,
    1000000
  )
  if (savedBetData.state) {
    betAmount.value = setBetAmount(
      false,
      Number(betAmount.value),
      Number(autoBetData.lossCount),
      Number(autoBetData.winCount),
      autoBetData.startMoney
    )
    autoBetData.winMoney = payout
    autoBetData.allFailMoney += Number(autoBetData.winMoney)
    autoBetData.isBet = false
    showWinMoney()

    if (!gameStart.value) {
      exitAutoGame()
    }
  } else {
    classicMoney.value = payout
    changeBetButtonState('green')
    isBetting.value = false
    showWinMoney()
  }
}

const showWinMoney = () => {
  clearWinMoneyHideTimer()
  winMoneyHideTimer = setTimeout(() => {
    winMoneyHideTimer = null
    classicMoney.value = 0
    autoBetData.winMoney = 0
  }, 3000)
}

// ========== 快捷金额 ==========

export const quickBet = (val: string, number: number): string => {
  switch (val) {
    case '1/2':
      return (number * 0.5).toFixed(2)
    case 'X2': {
      const max = parseInt(userInfo.value.balance[userInfo.value.selectedCoinType].amount)
      return number * 2 >= max ? max.toFixed(2) : (number * 2).toFixed(2)
    }
    case 'MAX':
      return parseInt(userInfo.value.balance[userInfo.value.selectedCoinType].amount).toFixed(2)
    default:
      return number.toFixed(2)
  }
}

/** 避免重复进页注册多个 `gameState` watch */
let gameStateWatchStarted = false
let stopGameStateWatch: ReturnType<typeof watch> | null = null

function mountGameStateWatch() {
  if (gameStateWatchStarted) return
  gameStateWatchStarted = true
  stopGameStateWatch = watch(
    () => gameState.value,
    (state, prev) => {
      if (!isStart.value) {
        // 进入下注阶段：若服侧已无本人 pending、且非「预约下一局」，清掉误残留的 isBetting。
        // 原先在 getButtonStr 之后才用 betButtonState==='green' 才清 isBetting，会形成死锁（一直灰 → 永远不绿）。
        if (
          state === 1 &&
          prev !== 1 &&
          !savedBetData.state &&
          crashRoomState.value?.phase === "betting" &&
          !crashHasSelfPendingRoundBet(crashRoomState.value)
        ) {
          isBetting.value = false
        }
        getButtonStr(state)
        if (savedBetData.state && state === 1) {
          const bet = savedBetData.data.bet
          const double = savedBetData.data.double
          clearBetData()
          crashWsSendClassicBet(bet, normalizedBetDoubleForProto(double))
        }
        if (state === 1) {
          void nextTick(() => {
            crashBetAmountInputExpose.value?.checkInputValue?.()
          })
        }
      } else if (state === 1 && savedBetData.state) {
        if (!gameStart.value && autoBetData.isBet) return exitAutoGame()
        reqGameStart()
      }
    }
  )
}

/** 进 Crash 页调用一次 */
export function initCrashGame() {
  mountGameStateWatch()
}

/** 离页：清定时器 + 重置状态，允许下次再挂 watch */
export function initCrashData() {
  clearCrashBetVisualTimers()
  lastCrashAutoBetReqGameId = null
  stopGameStateWatch?.()
  stopGameStateWatch = null
  resetState()
  crashBetAmountInputExpose.value = null
  gameStateWatchStarted = false
}

export function useCrashBet(i18n: { t: (key: string) => string }) {
  void i18n
  const gameConfigStore = useGameConfigStore()
  const { gameConfig } = useCrashState()

  /** 从 store 的 Crash 配置同步默认 bet / 极速模式；自动兑现倍数下限固定 1.01，`config.multiple` 仅作默认展示值并由 clamp 约束 */
  const applyGameConfig = () => {
    const config = gameConfig.value
    if (!config) return

    /**
     * 本局已下注（含进房 `has_bet` 回填）：避免配置晚到或 watch 二次触发把 WS 快照金额/倍数盖回默认值。
     * 自动下注已启动（`isStart`）：当局结束后 `isBetting` 会回到 false，但输赢比例仍会由 `reqGameStart`→`setBetAmount`
     * 改写 `betAmount`；若此处仍按「未下注」同步桌台默认 bet，`gameConfig` 的 deep watch 会把递进金额冲掉。
     */
    if (!isBetting.value && !isStart.value) {
      betAmount.value = config.bet
      multiplier.value = clampMultiplierValue(config.multiple)
    }
    const wantFast = resolveFastModeFromConfigSpeed(config.speed, betAmount.value)
    gameConfigStore.changeIsFastGame(wantFast)
  }

  return {
    handleBetButtonDown,
    userCashOut,
    startAutoBet,
    exitAutoGame,
    sendCashOut,
    sendReconnect,
    sendSoundToggle,
    quickBet,
    applyGameConfig,
    CyGameConfigSetData: applyGameConfig,
    initCrashGame,
    initCrashData,
  }
}
