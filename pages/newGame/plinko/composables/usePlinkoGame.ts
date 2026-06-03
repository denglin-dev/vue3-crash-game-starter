// pages/newGame/plinko/composables/usePlinkoGame.ts
// 主入口 - 整合所有 composables

// 导出所有子模块
export * from './usePlinkoState'
export * from './usePlinkoAutoBet'
export * from './usePlinkoBet'

// 导出类型
export type { PlinkoReqData, GameBottomData, GameItemInfo, PlinkoAutoBetData } from '../types'

// 便捷导入 - 整合所有功能
import { usePlinkoState } from './usePlinkoState'
import { usePlinkoAutoBet } from './usePlinkoAutoBet'
import { usePlinkoBet } from './usePlinkoBet'

/**
 * Plinko 游戏主 Hook
 * 整合状态管理、自动下注、下注逻辑
 */
export function usePlinkoGame() {
	const plinkoState = usePlinkoState()
	const plinkoAutoBet = usePlinkoAutoBet()
	const plinkoBet = usePlinkoBet()

	return {
		// 状态
		...plinkoState,
		...plinkoAutoBet,
		// 方法
		...plinkoBet
	}
}
