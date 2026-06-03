/**
 * Plinko 自动下注模块（类似 dice 的 useAutoBet）
 *
 * 职责：
 * - 管理自动下注开关与局数
 * - 提供开始 / 停止 / 重置自动下注的方法
 * - 不做网络请求，也不直接改 UI，只维护数据
 */

import { reactive } from 'vue'
import type { PlinkoAutoBetData } from '../types'

// 单例自动下注状态
export const plinkoAutoBetData = reactive<PlinkoAutoBetData>({
	start: false,
	gameNow: 0,
	gameNum: undefined
})

export function usePlinkoAutoBet() {
	// 开始自动下注
	const startAutoBet = (gameNum?: number) => {
		plinkoAutoBetData.start = true
		plinkoAutoBetData.gameNow = 0
		plinkoAutoBetData.gameNum = gameNum
	}

	// 停止 / 重置自动下注
	const stopAutoBet = () => {
		plinkoAutoBetData.start = false
		plinkoAutoBetData.gameNow = 0
		plinkoAutoBetData.gameNum = undefined
	}

	// 当前局数 +1
	const increaseRound = () => {
		plinkoAutoBetData.gameNow += 1
	}

	// 是否达到局数上限
	const reachedLimit = () => {
		const { gameNum, gameNow } = plinkoAutoBetData
		return gameNum !== undefined && gameNum > 0 && gameNow >= gameNum
	}

	return {
		plinkoAutoBetData,
		startAutoBet,
		stopAutoBet,
		increaseRound,
		reachedLimit
	}
}

