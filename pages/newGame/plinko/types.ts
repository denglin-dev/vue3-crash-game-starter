/**
 * Plinko 游戏的统一类型定义
 * - 只放纯类型，不包含任何运行时逻辑
 * - 方便在多个 composable / 组件之间复用
 */

export interface PlinkoReqData {
	bet: number
	risk: number
	row: number
	isAuto: boolean
	isfast: boolean
	isStart: boolean
	gameNow: number
	gameNum: number | undefined
	isInit: boolean
}

export interface GameItemInfo {
	index: number
	result: number
	tax: number
}

export interface GameBottomData {
	x: number
	y: number
	width: number
	height: number
	spacing: number
	result: number
	tax: number
	index: number
	gameItemInfo: GameItemInfo[]
}

// 自动下注状态（类似 dice 的 AutoBetData，字段精简）
export interface PlinkoAutoBetData {
	start: boolean      // 是否正在自动下注
	gameNow: number     // 当前已执行局数
	gameNum?: number    // 总局数（0 或 undefined 表示无限）
}


