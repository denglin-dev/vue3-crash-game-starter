/**
 * `pages/newGame/crash` 共用类型：状态机、配置、自动下注与公平字段。
 * 与 store 中游戏配置结构对齐的字段以 `CrashGameConfig` 为准。
 */

/**
 * 低于该倍率时 GameCanvas 视窗贴目标、Y 刻度用 0.5 步长；须与 `useCrashCanvasTicks` 分支一致。
 * （与组件 props 里 `nameExtraLeftMultThreshold` 默认 3.5 无关，勿混用。）
 */
export const CRASH_VIEW_SNAP_BELOW_MULT = 3.8

/** 游戏阶段：休息 | 可下注 | 飞行中 */
export type GameStateType = 0 | 1 | 2

/** 来自 gameConfigStore 的 Crash 条目（字段名与后端/Store 一致） */
export interface CrashGameConfig {
  icon: string
  bet: number
  /** 自动兑现倍数上限（与接口 content.cashOut 一致） */
  cashOut: number
  gameCode: string
  gameId: string
  /** 自动兑现默认目标倍数及下限（与接口 content.multiple 一致） */
  multiple: number
  /** 玩法位图：经典/买色等，新页已只保留经典 */
  pattern: string
  speed: number
  inter: { id: string; lang: string; content: string }[]
}

/** 发往服务/WS 的经典下注体；`type` 与历史 HTTP 信令一致便于日志对齐 */
export interface ClassicBetData {
  bet: number
  double: number
  type: 'carshsendBetReq'
}

/** 旧壳下注回调参数打包（历史数组下标约定） */
export interface CrashBetResult {
  uid: number
  bet: number
  double?: number
  head?: string
  nick?: string
  result: number
  msg: string
}

/** 旧壳兑现回调前几项；展示金额在 args[6] */
export interface CrashEscapeResult {
  uid: number
  profit: number
  result: number
  double?: number
  bet?: number
  msg?: string
}

export interface FairData {
  state?: number
  public_seed?: string
  server_seed?: string
}

/** 本局可验证信息 + 展示用 hash/round */
export interface CrashHashData {
  hash: string
  round: string
  server_seed: string
  nonce: string
}

/** 自动下注策略与累计器（与 Auto 面板绑定） */
export interface AutoBetData {
  start: boolean
  startMoney: number
  winMoney: number
  winCount: number | undefined
  lossCount: number | undefined
  lossEndMoney: number | undefined
  allFailMoney: number
  isBet: boolean
  betNumber: number
  betBigNumber: number | null
}

/** 预约下注：`useCrashState.savedBetData` */
export interface SavedBetData {
  state: boolean
  name: string
  data: Record<string, any>
}
