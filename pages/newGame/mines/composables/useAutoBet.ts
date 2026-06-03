// pages/newGame/mines/composables/useAutoBet.ts
import { reactive } from 'vue'
import type { MinesAutoBetData } from '../types'
import { autoBetRoundCap } from '~/pages/newGame/common/autoBetRoundCap'

// 单例自动下注状态
const autoBetData = reactive<MinesAutoBetData>({
  start: false,
  win: undefined,
  lose: undefined,
  stop: null,
  betNumber: 0,
  betBigNumber: null,
  total: 0,
  defaultBetAmount: 0,
  isAutoRandom: false
})

export function useAutoBet() {
  // 重置统计
  const resetTotal = () => {
    autoBetData.total = 0
    autoBetData.betNumber = 0
  }

  // 开始/停止自动下注
  const setAutoBet = (start: boolean) => {
    autoBetData.start = start
    if (!start) {
      autoBetData.total = 0
      autoBetData.betNumber = 0
    }
  }

  // 更新下注统计
  const updateBetStats = (result: number, betAmount: number) => {
    autoBetData.betNumber++
    autoBetData.total = autoBetData.total + result - betAmount
  }

  // 检查是否应该停止
  const shouldStop = (): boolean => {
    if (autoBetData.stop && autoBetData.total <= -Number(autoBetData.stop) && Number(autoBetData.stop) !== 0) {
      return true
    }
    const cap = autoBetRoundCap(autoBetData.betBigNumber)
    if (cap != null && autoBetData.betNumber >= cap) {
      return true
    }
    return false
  }

  // 重置自动下注配置
  const resetAutoBet = () => {
    autoBetData.start = false
    autoBetData.win = undefined
    autoBetData.lose = undefined
    autoBetData.stop = null
    autoBetData.betNumber = 0
    autoBetData.betBigNumber = null
    autoBetData.total = 0
    autoBetData.defaultBetAmount = 0
    autoBetData.isAutoRandom = false
  }

  // 重置并初始化游戏状态
  const changeAutoStart = (bol: boolean, gameContentRef?: any) => {
    autoBetData.start = bol
    if (!bol) {
      gameContentRef?.initGridList(true, true)
    }
    resetTotal()
  }

  return {
    autoBetData,
    resetTotal,
    setAutoBet,
    updateBetStats,
    shouldStop,
    resetAutoBet,
    changeAutoStart,
  }
}

export { autoBetData }
