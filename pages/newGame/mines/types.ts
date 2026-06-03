// pages/newGame/mines/types.ts
// 统一的 Mines 游戏类型定义

export interface MinesAutoBetData {
  start: boolean
  win: number | undefined
  lose: number | undefined
  stop: number | null
  betNumber: number
  /** 自动局数上限；`0` / `null` / 空 表示无限局 */
  betBigNumber: number | null
  total: number
  defaultBetAmount: number
  isAutoRandom?: boolean
}

export interface MinesProfit {
  current: number
  next: number
}

export interface MinesCommonSet {
  gridIndex: number
  bombNumber: number
}

export interface MinesRollChangeData {
  winchance: number
  Probability: number
  letters: number
  PayoutOnWin: number
}

export interface MinesGameConfig {
  icon: string
  bet: number
  cashOut: number
  defaultNum: string
  defaultRows: string
  gameCode: string
  gameId: string
  multiple: number
  pattern: string
  speed: number
  inter: { id: string; lang: string; content: string }[]
}

export interface MinesBetData {
  bet: number
  minenum: number
  allnum: number
  list?: number[]
}

export interface MinesBetResult {
  uid: number
  bet: number
  result: number
  is_suc: number
  msg: string
  m: number
  win?: boolean
  list?: number[]
  multplier?: number
}

export interface MinesInitResult {
  server_seed: string
  public_seed: string
  rt: number
  bet: number
  str_total_profit: number
  next_profit_gold: number
  mines: number
  box_count: number
  list: number[]
  money: number
}

export interface MinesPickResult {
  total_profit_gold: number
  next_profit_gold: number
  ret: number
  msg: string
  index: number
  type: number
  total_profit: number
}

export interface GridItem {
  id?: number
  isClick: boolean
  isFlipped: boolean
  /** 格上展示金额：可为格式化后的字符串（法币 2 位 / 虚拟币 6 位） */
  money: number | string
  state: number
  type: 'mine' | 'money' | '' | 'ques'
  score?: number
}
