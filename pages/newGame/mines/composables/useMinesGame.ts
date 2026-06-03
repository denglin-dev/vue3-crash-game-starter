// pages/newGame/mines/composables/useMinesGame.ts
// 主入口 - 整合所有 composables

// 导出所有子模块
export * from './useMinesState'
export * from './useAutoBet'
export * from './useMinesBet'

// 导出类型
export type {
  MinesAutoBetData,
  MinesProfit,
  MinesCommonSet,
  MinesGameConfig,
  MinesBetData,
  MinesBetResult,
  MinesInitResult,
  MinesPickResult,
  GridItem,
} from '../types'

// 便捷导入 - 整合所有功能
import { useMinesState } from './useMinesState'
import { useAutoBet } from './useAutoBet'
import { useMinesBet } from './useMinesBet'

/**
 * Mines 游戏主 Hook
 * 整合状态管理、自动下注、下注逻辑
 */
export function useMinesGame(i18n: { t: (key: string) => string }) {
  const minesState = useMinesState()
  const minesAutoBet = useAutoBet()
  const minesBet = useMinesBet(i18n)

  return {
    // 状态
    ...minesState,
    ...minesAutoBet,
    // 方法
    ...minesBet,
  }
}

export { useMinesGameConfigSync } from './useMinesGameConfigSync'
