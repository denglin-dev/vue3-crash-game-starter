import { useGameConfigStore } from '~/stores/gameConfig'

/** 仅「全局快速模式」下对手动下注连点做短防抖；普通模式不拦截 */
export const FAST_MODE_MANUAL_BET_DEBOUNCE_MS = 320

let lastFastModeManualBetAt = 0

export function isBetAmountPositive(bet: unknown): boolean {
	const n = typeof bet === 'number' ? bet : Number(bet)
	return Number.isFinite(n) && n > 0
}

/** 后端 speed：0=快速；若当前金额无效则不允许保持快速 */
export function resolveFastModeFromConfigSpeed(configSpeed: unknown, currentBet: unknown): boolean {
	return Number(configSpeed) === 0 && isBetAmountPositive(currentBet)
}

/**
 * 全局极速下、距上次放行不足间隔 → true，调用方应直接 return。
 * 非极速恒为 false（不防抖，保持原手动下注节奏）。
 */
export function shouldBlockFastModeManualBetBurst(): boolean {
	const store = useGameConfigStore()
	if (!store.isFastGame) return false
	const now = Date.now()
	if (now - lastFastModeManualBetAt < FAST_MODE_MANUAL_BET_DEBOUNCE_MS) return true
	lastFastModeManualBetAt = now
	return false
}

/** 金额≤0 或未定义时关闭 store 中的快速模式 */
export function turnOffStoreFastModeIfBetNotPositive(bet: unknown): void {
	if (isBetAmountPositive(bet)) return
	const store = useGameConfigStore()
	if (store.isFastGame) store.changeIsFastGame(false)
}
