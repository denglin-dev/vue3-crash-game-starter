/**
 * Plinko 游戏下注模块（类似 dice 的 useDiceBet）
 *
 * 职责：
 * - 处理手动 / 自动下注的完整流程
 * - 调用 HTTP API（plinkoApi）发送下注请求
 * - 根据返回结果更新状态（余额不足、底部赔率条、历史记录等）
 *
 * 注意：
 * - 不直接定义任何状态，只通过 usePlinkoState 暴露的引用进行读写
 */
// 添加导入
import { gameMessages } from '~/pages/newGame/common/composables/useMessage'
import { MessageService } from '~/utils/MessageService'
import { loginStatus } from '~/utils/hook/hook'
import { usePlinkoApi } from '~/utils/ts/game/plinkoApi'
import { usePlinkoAutoBet, plinkoAutoBetData } from './usePlinkoAutoBet'
import { floorToDecimal } from "~/utils/common"
import { pickDisplayPayoutMicroAmount } from "~/pages/newGame/common/pickDisplayPayoutMicroAmount"
import { blockBetIfAmountInvalid } from '~/pages/newGame/common/betAmountSubmitGuard'
import { autoBetRoundCap } from '~/pages/newGame/common/autoBetRoundCap'
import { GAME_CODE } from '~/pages/newGame/common/composables/newGameCodes'
import { waitForGameUserToken } from '~/pages/newGame/common/composables/waitForGameUserToken'
import {
	reqData,
	gameBottomData,
	isFastGamePlinko,
	refIpt,
	initGameOver,
	resetBottomResult,
	handleInitGameData,
	handleLeavePageInitData,
	applyPlinkoGameConfig,
	usePlinkoState,
	plinkHistory,
	plinkoGameRef,
	isLoading,
	registerPendingPlinkoRound,
	makePlinkoRoundId,
	getPlinkoMultipliersForRiskRow
} from './usePlinkoState'


function computeSlotByRightCount(route: number[], rows: number): number {
	const n = Math.min(rows, route.length)
	const rightCount = route.slice(0, n).reduce((acc, v) => acc + (v > 0.5 ? 1 : 0), 0)
	return Math.max(0, Math.min(rows, rightCount))
}

/**
 * 解析后端落槽下标：优先接口字段；赔率唯一则信赔率；赔率重复时用 route 列模拟（与游戏内引导一致），避免“有时多有时少”。
 */
function resolvePlinkoSlotIndex(
	result: Record<string, unknown>,
	route: number[],
	mults: number[],
	rows: number
): number {
	const max = Math.max(0, mults.length - 1)
	const rawSlot =
		typeof result.slot_index === 'number' ? result.slot_index :
			typeof result.bin_index === 'number' ? result.bin_index :
				typeof result.slot === 'number' ? result.slot : null
	if (rawSlot != null && !Number.isNaN(rawSlot)) {
		const s = Math.floor(rawSlot)
		if (s >= 0 && s <= max) return s
	}
	const simSlot = Math.max(0, Math.min(max, computeSlotByRightCount(route, rows)))
	const mult = Number(result.multplier)
	const nearEqual = (a: number, b: number) => Math.abs(a - b) < 0.02
	const candidates = mults.map((m, i) => (nearEqual(m, mult) ? i : -1)).filter(i => i >= 0)
	if (candidates.length === 1) return candidates[0]
	if (candidates.length > 1) {
		return candidates.reduce((best, i) =>
			Math.abs(i - simSlot) < Math.abs(best - simSlot) ? i : best
		)
	}
	return simSlot
}

type PlinkoPathPoint = {
	row: number
	column: number
}

function normalizePath(pathRaw: unknown, rows: number): PlinkoPathPoint[] {
	if (!Array.isArray(pathRaw)) return []
	const result: PlinkoPathPoint[] = []
	for (const item of pathRaw) {
		const row = Number((item as any)?.row)
		const column = Number((item as any)?.column)
		if (!Number.isFinite(row) || !Number.isFinite(column)) continue
		const rowIdx = Math.floor(row) - 1
		if (rowIdx < 0 || rowIdx >= rows) continue
		const clampedColumn = Math.max(0, Math.min(rowIdx + 1, Math.floor(column)))
		result.push({ row: rowIdx + 1, column: clampedColumn })
	}
	return result
}

function computeSlotByPath(path: PlinkoPathPoint[], rows: number): number {
	if (!path.length) return 0
	const last = path[path.length - 1]
	const rowIdx = Math.max(0, Math.min(rows - 1, Math.floor(last.row) - 1))
	const maxColumn = rowIdx + 1
	return Math.max(0, Math.min(maxColumn, Math.floor(last.column)))
}

/** 由 path 相邻行 column 变化生成「左/右」序列，供 resolvePlinkoSlotIndex 在倍数重复时算 simSlot */
function buildRouteFromPath(path: PlinkoPathPoint[], rows: number): number[] {
	if (!path.length || rows < 2) return []
	const byRow = new Map<number, number>()
	for (const p of path) {
		byRow.set(p.row, p.column)
	}
	const route: number[] = []
	for (let r = 1; r < rows; r++) {
		const c0 = byRow.get(r)
		const c1 = byRow.get(r + 1)
		if (c0 === undefined || c1 === undefined) break
		route.push(c1 > c0 ? 1 : 0)
	}
	return route
}

/** 历史记录单行：解析 row（8～16），兼容字符串 */
function parseHistoryRow(item: any, fallback: number): number {
	const n = Number(item?.row ?? item?.rows)
	if (Number.isFinite(n)) return Math.max(8, Math.min(16, Math.floor(n)))
	return fallback
}

/** 历史记录单行：解析 risk（0～2），兼容字符串 */
function parseHistoryRisk(item: any, fallback: number): number {
	const n = Number(item?.risk ?? item?.default_risk)
	if (Number.isFinite(n)) return Math.max(0, Math.min(2, Math.floor(n)))
	return fallback
}

/**
 * 为历史记录条目计算落槽索引（用于路单背景色）。
 * 优先：接口 slot_index / bin_index / slot；其次 path 最后一行；否则按倍数表 + route 解析（与 resolvePlinkoSlotIndex 一致）。
 */
function computeHistorySlotIndex(item: any, rowCount: number, riskNum: number): number {
	const pathNorm = normalizePath(item?.path, rowCount)
	const mults = getPlinkoMultipliersForRiskRow(riskNum, rowCount)
	const route = buildRouteFromPath(pathNorm, rowCount)
	const merged: Record<string, unknown> = {
		...item,
		multplier: item?.multplier ?? item?.multiplier,
		multiplier: item?.multiplier ?? item?.multplier
	}
	const max = Math.max(0, mults.length - 1)
	const rawSlot = merged.slot_index ?? merged.bin_index ?? merged.slot
	if (rawSlot != null && rawSlot !== '' && Number.isFinite(Number(rawSlot))) {
		const s = Math.floor(Number(rawSlot))
		if (s >= 0 && s <= max) return s
	}
	if (pathNorm.length > 0) {
		return computeSlotByPath(pathNorm, rowCount)
	}
	return resolvePlinkoSlotIndex(merged, route, mults, rowCount)
}
// 添加游戏组件引用
let betTimer: ReturnType<typeof setTimeout> | null = null
const MAX_HISTORY = 15 // 你可按 UI 需要调大/调小
/** 手动且下注额为 0：对「下注请求」防抖，避免连点重复请求；金额为 0 仍允许下注 */
let lastPlinkoManualZeroBetRequestAt = 0
const PLINKO_MANUAL_ZERO_BET_REQUEST_DEBOUNCE_MS = 1000
/** 页面清理代际：离页/登出后晚返回的下注、历史和自动 timer 都必须丢弃 */
let plinkoRuntimeVersion = 0

function nextPlinkoRuntimeVersion() {
	plinkoRuntimeVersion++
	return plinkoRuntimeVersion
}

function isCurrentPlinkoRuntime(version: number): boolean {
	return version === plinkoRuntimeVersion
}

/**
 * 使用 Plinko 下注 Hook
 * - 依赖 usePlinkoState 提供的状态
 */
export function usePlinkoBet() {
	// 确保状态已初始化
	const { gameConfig } = usePlinkoState()
	const plinkoApi = usePlinkoApi()
	const { stopAutoBet, startAutoBet, increaseRound, reachedLimit } = usePlinkoAutoBet()

	/** 与 Dice/Mines/Limbo 一致：0 / 空 / 无效 → 无限局；正整数 → 上限 */
	const parsePlinkoAutoGameNumLimit = (raw: unknown): number | undefined => {
		const cap = autoBetRoundCap(raw)
		return cap === null ? undefined : cap
	}

	/** 切换快速模式（只更新本地状态，实际节奏由前端控制） */
	const toGameFast = () => {
		reqData.isfast = isFastGamePlinko.value
	}

	/** 停止自动下注 */
	const handleStopBet = () => {
		reqData.isAuto = false
		plinkoAutoBetData.start = false
		stopAutoBet()
		reqData.gameNow = 0
		if (betTimer) {
			clearTimeout(betTimer)
			betTimer = null
		}
	}

	/** 核心下注逻辑（支持手动 / 自动） */
	const handlePinkoBetReq = async (mode?: 'auto') => {
		const runtime = plinkoRuntimeVersion
		const betNum = Number(reqData.bet)

		// 手动：仅拒绝无效/负数；金额为 0 允许下注，仅对请求做防抖
		if (mode !== 'auto') {
			if (!Number.isFinite(betNum) || betNum < 0) {
				refIpt.value?.checkedinputFail?.()
				return
			}
			if (betNum === 0) {
				const now = Date.now()
				if (now - lastPlinkoManualZeroBetRequestAt < PLINKO_MANUAL_ZERO_BET_REQUEST_DEBOUNCE_MS) return
				lastPlinkoManualZeroBetRequestAt = now
			}
		} else if (!Number.isFinite(betNum) || betNum < 0) {
			refIpt.value?.checkedinputFail?.()
			return
		}

		if (
			blockBetIfAmountInvalid(refIpt.value, betNum, () => {
				if (mode === 'auto') handleStopBet()
			})
		) {
			return
		}

		// 自动模式：仅在「本局自动会话」的第一把（gameNow===0）同步次数上限。
		// 若用 gameNum===undefined 判断，在「无限局」时 gameNum 恒为 undefined，会每把都 startAutoBet，
		// 而 startAutoBet 会清零 gameNow，导致 gameNow 永远为 1、永远达不到上限。
		if (mode === 'auto') {
			reqData.isAuto = true
			plinkoAutoBetData.start = true
			if (plinkoAutoBetData.gameNow === 0) {
				startAutoBet(parsePlinkoAutoGameNumLimit(reqData.gameNum))
			}
			increaseRound()
			reqData.gameNow = plinkoAutoBetData.gameNow
		}

		reqData.isStart = true
		isLoading.value = true

		try {
			const result: any = await plinkoApi.bet({
				bet: reqData.bet * 1000000,
				risk: reqData.risk,
				row: reqData.row,
				token: sessionStorage.getItem('Game_User_Token')
			}).catch(() => {
				isLoading.value = false
				return undefined
			})
			if (!isCurrentPlinkoRuntime(runtime)) return
			isLoading.value = false
			if (!result) {
				reqData.isStart = false
				if (mode === 'auto') handleStopBet()
				return
			}
			// ✅ 添加：请求失败处理（类似 Limbo 的 handleBetResult）
			if (result.is_suc !== 0) {
				reqData.isStart = false
				isLoading.value = false
				handleStopBet() // 停止自动下注
				gameMessages(result) // 显示错误消息
				return
			}
			// ✅ 更新底部结果
			resetBottomResult()
			gameBottomData.result =
				floorToDecimal(pickDisplayPayoutMicroAmount(result.payout, result.max_profit), 2, 1000000) ?? 0

			const rowCount = typeof result.row === 'number' ? result.row : reqData.row
			const path = normalizePath(result.path, rowCount)
			// 目前后端只返回 path：槽位索引用最后一排 column 直接映射
			const slotIndex = computeSlotByPath(path, rowCount)
			gameBottomData.index = slotIndex
			// ✅ 调用游戏组件的 dropBall 方法
			const roundId = makePlinkoRoundId(result)
			const pendingRound = {
				...result,
				_ui_slot_index: slotIndex,
				_plinko_round_id: roundId
			}
			const ballStarted = plinkoGameRef.value?.dropBall
				? plinkoGameRef.value.dropBall(result.multplier, path, roundId)
				: false
			if (ballStarted) {
				registerPendingPlinkoRound(roundId, pendingRound)
			} else {
				// 组件未就绪时，兜底立即写历史，避免丢记录
				reqData.isStart = false
				plinkHistory.list.push({
					...pendingRound,
					_ui_slot_index: slotIndex
				})
				if (plinkHistory.list.length > MAX_HISTORY) {
					plinkHistory.list.splice(0, plinkHistory.list.length - MAX_HISTORY)
				}
			}

			// 自动下注循环
			if (reqData.isAuto && plinkoAutoBetData.start) {
				if (!reachedLimit()) {
					if (betTimer) {
						clearTimeout(betTimer)
						betTimer = null
					}

					betTimer = setTimeout(() => {
						if (!isCurrentPlinkoRuntime(runtime)) return
						handlePinkoBetReq('auto')
					}, isFastGamePlinko.value ? 100 : 500)
				} else {
					if (betTimer) {
						clearTimeout(betTimer)
						betTimer = null
					}
					handleInitGameData()
					stopAutoBet()
				}
			}
		} catch (e: any) {
			if (!isCurrentPlinkoRuntime(runtime)) return
			MessageService.error(e?.message || 'Plinko bet failed')
			handleInitGameData()
			handleStopBet()
			isLoading.value = false
		}
	}

	// ===== 历史记录 =====

	/**
	 * 获取游戏历史记录
	 * 从 API 获取当前游戏的历史记录
	 */
	const _getLimboHistory = async () => {
		const runtime = plinkoRuntimeVersion
		if (!loginStatus.value) {
			plinkHistory.list = []
			return
		}
		const token = await waitForGameUserToken()
		if (!token) {
			plinkHistory.list = []
			return
		}
		const cfg = gameConfig.value
		const gameId =
			cfg?.gameCode != null && String(cfg.gameCode) !== ''
				? cfg.gameCode
				: GAME_CODE.PLINKO
		try {
			const result = await plinkoApi.getHistory({
				token,
				game_id: Number(gameId)
			})
			if (!isCurrentPlinkoRuntime(runtime)) return
			// 如果期间已经 reset/unmount，直接丢弃这次响应，避免卸载后 set state
			if (import.meta.dev) {
				console.debug("[plinko] history", result)
			}
			const historyList = ((Array.isArray(result) ? result : []).reverse() || []).slice(-MAX_HISTORY)
			plinkHistory.list = historyList.map((item: any) => {
				const rowCount = parseHistoryRow(item, reqData.row)
				const riskNum = parseHistoryRisk(item, reqData.risk)
				const slotIndex = computeHistorySlotIndex(item, rowCount, riskNum)
				return {
					...item,
					_ui_slot_index: slotIndex
				}
			})
		} catch (e) {
		}
	}

	/** 页面挂载时调用的初始化逻辑 */
	const initPlinkoEvents = () => {
		initGameOver.value = true
		_getLimboHistory()
	}

	/** 页面卸载时的清理逻辑 */
	const cleanupPlinko = () => {
		nextPlinkoRuntimeVersion()
		handleStopBet()
		handleInitGameData()
		handleLeavePageInitData()
	}

	return {
		handlePinkoBetReq,
		handleStopBet,
		toGameFast,
		initPlinkoEvents,
		cleanupPlinko,
		CyGameConfigSetData: applyPlinkoGameConfig
	}
}

