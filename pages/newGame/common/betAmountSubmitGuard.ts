import {
  gameIdGetConfig,
  setRegalRate,
  userInfo,
  getUserBalanceMax,
  isUserWalletBalanceUiReady,
} from '~/utils/hook/hook'

import { useGameConfigStore } from '~/stores/gameConfig'
import { resolveGameCodeForCurrentPage } from '~/pages/newGame/common/composables/newGameCodes'
import { decimal_add } from "~/utils/decimal"

type TableCfg = { bet?: number | string; maxBetAmount?: number | string }
const MIN_BET_MICRO_STEP = 0.000001
const MIN_BET_MICRO_BUMP_THRESHOLD = 0.00001

/** 与 BetInput `resolveTableGameConfig` 同源：`gameIdGetConfig` 瞬时拿不到时用 URL path + store */
function resolveTableGameConfigForGuard(): TableCfg | undefined {
  const primary = gameIdGetConfig() as TableCfg | undefined
  if (primary) return primary
  const raw = useGameConfigStore().gameConfig as unknown
  if (raw === false || raw == null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const code = resolveGameCodeForCurrentPage()
  if (!code) return undefined
  const entry = (raw as Record<string, unknown>)[code]
  if (entry != null && typeof entry === 'object' && !Array.isArray(entry)) {
    return entry as TableCfg
  }
  return undefined
}

/** 与 BetInput `validateBetRange` 一致：仅当 amount > 0 且超出游戏 min/max 时为 true */
export function isBetTableRangeInvalid(amount: number): boolean {
  if (!Number.isFinite(amount) || amount <= 0) return false
  const cfg = resolveTableGameConfigForGuard()
  if (!cfg) return false
  const minBet = cfg.bet !== undefined && cfg.bet !== '' ? Number(cfg.bet) : Number.NaN
  const maxBet =
    cfg.maxBetAmount !== undefined && cfg.maxBetAmount !== '' ? Number(cfg.maxBetAmount) : Number.NaN
  const convertedMinBet = Number(setRegalRate(minBet))
  // 与 BetInput 保持一致：只有极小虚拟币最小值才补 1 个微单位，避免 0.01 被抬成 0.010001。
  const minBoundRaw =
    userInfo.value.currencyType === 'COIN' &&
      Number.isFinite(convertedMinBet) &&
      convertedMinBet < MIN_BET_MICRO_BUMP_THRESHOLD
      ? Number(decimal_add(convertedMinBet, MIN_BET_MICRO_STEP))
      : convertedMinBet
  const maxBound = Number(setRegalRate(maxBet))
  const minOk =
    !Number.isFinite(minBet) || (Number.isFinite(minBoundRaw) && amount >= minBoundRaw)
  const maxOk =
    !Number.isFinite(maxBet) || (Number.isFinite(maxBound) && amount <= maxBound)
  return !(minOk && maxOk)
}

export type BetAmountInputExpose = {
  /** 主动失焦并提交金额格式（H5 点下注按钮不会自动 blur） */
  blurInput?: () => void
  /** 与输入框红框一致；`BetInput` 已实现。未挂组件时为 undefined，此时仅桌台 `isBetTableRangeInvalid` 生效 */
  isBetAmountInvalid?: () => boolean
  /** 置红；拦截或本地校验失败时调用 */
  checkedinputFail?: () => void
  /** 按当前展示金额重算 min/max 并更新红框；`BetInput` 已对切换货币等做 watch，特殊流程可对 bridge 再调一次 */
  checkInputValue?: () => void
} | null | undefined

/**
 * 下注前拦截：`BetInput` 认为不合法（`isBetAmountInvalid`）、金额超出桌台 min/max（`isBetTableRangeInvalid`），
 * 或无 `BetInput` expose 时超出钱包可用余额（`getUserBalanceMax`）时不发请求。
 * 已挂 `BetInput` 且提供 `isBetAmountInvalid` 时，余额判断仅以 expose 为准，避免与全局 `getUserBalanceMax` 双轨不一致（如 Mines 本局币种展示）。
 * 拦截时会调 `checkedinputFail()` 标红（与 `BetInput` 内校验态一致）。
 * @returns true 表示已拦截
 */
export function blockBetIfAmountInvalid(
  expose: BetAmountInputExpose,
  bet: number,
  onBlock?: () => void,
  opts?: { skipBlur?: boolean }
): boolean {
  if (!opts?.skipBlur) expose?.blurInput?.()
  const b = Number(bet)
  const hasExposeCheck = expose != null && typeof expose.isBetAmountInvalid === "function"
  const fromExpose = hasExposeCheck && expose!.isBetAmountInvalid!() === true
  const fromRange = Number.isFinite(b) && b > 0 && isBetTableRangeInvalid(b)
  const fromBalance =
    !hasExposeCheck &&
    Number.isFinite(b) &&
    b > 0 &&
    isUserWalletBalanceUiReady() &&
    b > getUserBalanceMax()
  if (!fromExpose && !fromRange && !fromBalance) return false
  expose?.checkedinputFail?.()
  onBlock?.()
  return true
}
