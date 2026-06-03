/**
 * Plinko 游戏状态模块（类似 dice 的 useDiceState）
 *
 * 职责：
 * - 定义并管理 Plinko 的单例状态（下注配置、自动模式、底部赔率条、画布 key 等）
 * - 提供初始化 / 重置 / 基础计算相关的方法
 * - 不包含任何网络请求和业务副作用
 */

import { ref, reactive, watch, computed } from 'vue'
import { useGameConfigStore } from '~/stores/gameConfig'
import type { PlinkoReqData, GameBottomData } from '../types'
import { GAME_CODE } from '~/pages/newGame/common/composables/newGameCodes'
import {
	isBetAmountPositive,
	resolveFastModeFromConfigSpeed
} from '~/pages/newGame/common/fastModeBetGate'

const GAME_ID = GAME_CODE.PLINKO

interface PlinkoBetInputExpose {
	checkedinputFail?(): void
	checkedinputPass?(): void
}

interface PlinkoGameExpose {
	dropBall?(multiplier: number, path?: any[], roundId?: string): boolean
}

// ===== 单例状态 =====

export const reqData = reactive<PlinkoReqData>({
	bet: 0.01,
	risk: 0,
	row: 16,
	isAuto: false,
	isfast: false,
	isStart: false,
	gameNow: 0,
	gameNum: undefined,
	isInit: false
})

export const gameBottomData = reactive<GameBottomData>({
	x: 0,
	y: 0,
	width: 0,
	height: 0,
	spacing: 0,
	result: 0,
	tax: 0,
	index: -1,
	gameItemInfo: []
})

export const diceCanvasKey = ref(1)
export const isFastGamePlinko = ref(false)
export const initGameOver = ref(false)
export const isShowBottom = ref(false)
export const configOver = ref(false)
export const refIpt = ref<PlinkoBetInputExpose | null>(null)
export const plinkoCanvasKey = ref(1)  // ✅ 
export const plinkoGameRef = ref<PlinkoGameExpose | null>(null)  // ✅ 添加这行
export const isLoading = ref(false)

//历史记录
export const plinkHistory = reactive<{ list: Record<string, unknown>[] }>({
	list: []
})
/** 待入历史的下注结果：按 roundId（通常即 bet_id）索引，多球并行落槽时与 onResult 一一对应 */
export const pendingPlinkoHistoryByRoundId = ref(new Map<string, Record<string, unknown>>())


/** 从接口结果生成唯一局标识，供 dropBall → onResult 配对 */
export function makePlinkoRoundId(result: Record<string, unknown>): string {
	const id = result.bet_id ?? result.betId ?? result.round_id ?? result.roundId ?? result.id
	if (id != null && String(id) !== '') return String(id)
	return `plinko-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

export function registerPendingPlinkoRound(roundId: string, result: Record<string, unknown>) {
	if (!roundId) return
	pendingPlinkoHistoryByRoundId.value.set(roundId, result)
}

export function takePendingPlinkoRound(roundId: string): Record<string, unknown> | null {
	if (!roundId) return null
	const map = pendingPlinkoHistoryByRoundId.value
	const row = map.get(roundId) ?? null
	if (row != null) map.delete(roundId)
	return row
}

/** 与 UI / 下注逻辑一致的 Plinko 倍数表（risk × row → 各槽位倍数），供历史条等复用 */
export const PLINKO_RISK_MULTIPLIERS: Record<number, Record<number, number[]>> = {
	0: {
		8: [5.6, 2.1, 1.1, 1, 0.5, 1, 1.1, 2.1, 5.6],
		9: [5.6, 2, 1.6, 1, 0.7, 0.7, 1, 1.6, 2, 5.6],
		10: [8.9, 3, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 3, 8.9],
		11: [8.4, 3, 1.9, 1.3, 1, 0.7, 0.7, 1, 1.3, 1.9, 3, 8.4],
		12: [10, 3, 1.6, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 1.6, 3, 10],
		13: [8.1, 4, 3, 1.9, 1.2, 0.9, 0.7, 0.7, 0.9, 1.2, 1.9, 3, 4, 8.1],
		14: [7.1, 4, 1.9, 1.4, 1.3, 1.1, 1, 0.5, 1, 1.1, 1.3, 1.4, 1.9, 4, 7.1],
		15: [15, 8, 3, 2, 1.5, 1.1, 1, 0.7, 0.7, 1, 1.1, 1.5, 2, 3, 8, 15],
		16: [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1, 0.5, 1, 1.1, 1.2, 1.4, 1.4, 2, 9, 16]
	},
	1: {
		8: [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13],
		9: [18, 4, 1.7, 0.9, 0.5, 0.5, 0.9, 1.7, 4, 18],
		10: [22, 5, 2, 1.4, 0.6, 0.4, 0.6, 1.4, 2, 5, 22],
		11: [24, 6, 3, 1.8, 0.7, 0.5, 0.5, 0.7, 1.8, 3, 6, 24],
		12: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33],
		13: [43, 13, 6, 3, 1.3, 0.7, 0.4, 0.4, 0.7, 1.3, 3, 6, 13, 43],
		14: [58, 15, 7, 4, 1.9, 1, 0.5, 0.2, 0.5, 1, 1.9, 4, 7, 15, 58],
		15: [88, 18, 11, 5, 3, 1.3, 0.5, 0.3, 0.3, 0.5, 1.3, 3, 5, 11, 18, 88],
		16: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110]
	},
	2: {
		8: [29, 4, 1.5, 0.3, 0.2, 0.3, 1.5, 4, 29],
		9: [43, 7, 2, 0.6, 0.2, 0.2, 0.6, 2, 7, 43],
		10: [76, 10, 3, 0.9, 0.3, 0.2, 0.3, 0.9, 3, 10, 76],
		11: [120, 14, 5.2, 1.4, 0.4, 0.2, 0.2, 0.4, 1.4, 5.2, 14, 120],
		12: [170, 24, 8.1, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8.1, 24, 170],
		13: [260, 37, 11, 4, 1, 0.2, 0.2, 0.2, 0.2, 1, 4, 11, 37, 260],
		14: [420, 56, 18, 5, 1.9, 0.3, 0.2, 0.2, 0.2, 0.3, 1.9, 5, 18, 56, 420],
		15: [620, 83, 27, 8, 3, 0.5, 0.2, 0.2, 0.2, 0.2, 0.5, 3, 8, 27, 83, 620],
		16: [1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2, 0.2, 0.2, 2, 4, 9, 26, 130, 1000]
	}
}

export const getPlinkoMultipliersForRiskRow = (risk: number, row: number): number[] => {
	const r = Math.max(0, Math.min(2, Math.floor(risk)))
	const rows = Math.max(8, Math.min(16, Math.floor(row)))
	return PLINKO_RISK_MULTIPLIERS[r]?.[rows] || []
}

// ===== 基础方法 =====
// 添加当前倍数数组计算
export const currentMultipliers = computed(() => getPlinkoMultipliersForRiskRow(reqData.risk, reqData.row))

/** 重置底部赔率条结果 */
export const resetBottomResult = () => {
	gameBottomData.index = -1
	gameBottomData.result = 0
	gameBottomData.tax = 0
}

/** 下注结束后恢复基础状态（不清空配置） */
export const handleInitGameData = () => {
	reqData.isAuto = false
	reqData.gameNow = 0
	reqData.isStart = false
	reqData.gameNum = undefined
}

/** 清空待入历史（按局 id） */
export const clearPendingPlinkoHistoryQueue = () => {
	pendingPlinkoHistoryByRoundId.value.clear()
}

/** 离开页面时的完整重置（含画布 key、路单等） */
export const handleLeavePageInitData = () => {
	const gameConfigStore = useGameConfigStore()
	handleInitGameData()
	reqData.isInit = false
	reqData.isfast = false
	diceCanvasKey.value = 1
	initGameOver.value = false
	configOver.value = false
	isShowBottom.value = false
	resetBottomResult()
	gameBottomData.gameItemInfo = []
	plinkHistory.list = []
	clearPendingPlinkoHistoryQueue()
	gameConfigStore.changeGameLoadingOver(false)
}

/** 根据游戏配置初始化下注金额 / 难度 / 行数 / 快速模式 */
export const applyPlinkoGameConfig = () => {
	const gameConfigStore = useGameConfigStore()
	const config = gameConfigStore.gameConfig?.[GAME_ID]
	if (!config) return

	reqData.bet = config.bet
	reqData.risk = Number(config.defaultNum)
	reqData.row = Number(config.defaultRows)
	const wantFast = resolveFastModeFromConfigSpeed(config.speed, reqData.bet)
	isFastGamePlinko.value = wantFast
	gameConfigStore.changeIsFastGame(wantFast)
}

let plinkoStateWatchersRegistered = false

/** 初始化监听（目前只在 row/risk 改变时重置底部结果） */
const initWatchers = () => {
	if (plinkoStateWatchersRegistered) return
	plinkoStateWatchersRegistered = true
	watch(
		() => reqData.row,
		() => {
			resetBottomResult()
		}
	)
	watch(
		() => reqData.risk,
		() => {
			resetBottomResult()
		}
	)
	watch(
		() => reqData.bet,
		() => {
			if (!isBetAmountPositive(reqData.bet)) {
				isFastGamePlinko.value = false
				useGameConfigStore().changeIsFastGame(false)
			}
		}
	)
}

/**
 * 使用 Plinko 状态 Hook
 * - 对外暴露所有状态和基础方法
 */
export function usePlinkoState() {
	initWatchers()
	const gameConfigStore = useGameConfigStore()
	const gameConfig = computed(() => gameConfigStore.gameConfig?.[GAME_ID])
	return {
		// 状态
		reqData,
		gameBottomData,
		diceCanvasKey,
		isFastGamePlinko,
		initGameOver,
		isShowBottom,
		configOver,
		refIpt,
		// 方法
		resetBottomResult,
		handleInitGameData,
		handleLeavePageInitData,
		applyPlinkoGameConfig,
		gameConfig
	}
}

