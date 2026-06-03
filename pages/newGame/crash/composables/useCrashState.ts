/**
 * Crash（新页面）全局响应式状态 —— 模块级单例 ref/reactive
 *
 * 设计说明：
 * - 旧壳层（Laya/iframe）全局回调已移除；
 * - `crashWsController` 的 WS 快照会写入 `gameState` / `gameDouble`；
 * - 组件内可 `import { gameState, ... }` 直接使用，或通过 `useCrashState()` 取 `gameConfig` 与监听。
 */

import { ref, reactive, computed, watch, shallowRef } from 'vue'
import { useGameConfigStore } from '~/stores/gameConfig'
import type { CrashGameConfig, GameStateType, AutoBetData, SavedBetData, CrashHashData } from '../types'
import type { CrashWsRoomState } from '../ws/crashWsClient'
import { GAME_CODE } from '~/pages/newGame/common/composables/newGameCodes'
import { isBetAmountPositive } from '~/pages/newGame/common/fastModeBetGate'
/** 与 store 中 Crash 配置条目的 gameId 一致 */
const GAME_ID = GAME_CODE.CRASH

/** 配置未加载时自动兑现倍数下限回退 */
export const DEFAULT_MULTIPLIER_MIN = 1.01
/** 自动兑现目标倍数上限：客户端固定，不读桌台 `cashOut` */
export const DEFAULT_MULTIPLIER_MAX = 1_000_000
/** 倍数输入框 `maxlength`：与 `DEFAULT_MULTIPLIER_MAX` 整数位数一致（1_000_000 → 7） */
export const CRASH_MULTIPLIER_INPUT_MAX_LENGTH = String(DEFAULT_MULTIPLIER_MAX).length

export function getMultiplierBounds(): { min: number; max: number } {
  const rawMax = DEFAULT_MULTIPLIER_MAX
  return { min: DEFAULT_MULTIPLIER_MIN, max: Math.max(rawMax, DEFAULT_MULTIPLIER_MIN) }
}

/** 将自动兑现目标倍数限制在 [1.01, DEFAULT_MULTIPLIER_MAX]（下限不读桌台配置）；保留 2 位小数（与上行 `* 100` 一致） */
export function clampMultiplierValue(n: number): number {
  const { min, max } = getMultiplierBounds()
  if (Number.isNaN(n) || n <= min) return min
  if (n > max) return max
  return Math.floor(n * 100) / 100
}

// ---------- 游戏流程 ----------
/** 回合阶段：0 休息/等待，1 可下注，2 飞行中（涨倍） */
export const gameState = ref<GameStateType>(0)
/** 用户侧是否处于「已点下注/持有本局注」语义（与按钮、自动逻辑联动） */
export const isBetting = ref(false)
/**
 * 已点「逃离」并已发出 `c2s_cashout`，尚未被 `s2c_cashout` / 广播合并解除。
 * 飞行段 `getButtonStr(2)` 据此显示灰（处理中），不必干等单播才离开黄钮。
 */
export const cashoutRequestPending = ref(false)
/**
 * 主按钮视觉/语义状态（BetButton 用 class）：
 * green / gray / yellow / red 等，由 `getButtonStr` + `changeBetButtonState` 维护
 */
export const betButtonState = ref('graybet')

// ---------- 下注参数 ----------
/** 当前输入的下注金额 */
export const betAmount = ref(0.01)

let crashFastBetGuardRegistered = false
function registerCrashFastBetGuardOnce() {
  if (!import.meta.client || crashFastBetGuardRegistered) return
  crashFastBetGuardRegistered = true
  const store = useGameConfigStore()
  watch(betAmount, () => {
    if (!isBetAmountPositive(betAmount.value) && store.isFastGame) {
      store.changeIsFastGame(false)
    }
  })
}
/** 自动兑现目标倍数（经典模式）；下限固定 1.01（不读桌台 `multiple`），上限为 DEFAULT_MULTIPLIER_MAX；可能与 `CommonInput` 同步为字符串 */
export const multiplier = ref<number | string>(DEFAULT_MULTIPLIER_MIN)

/**
 * `CommonInput` xInput 在输入过程中会持续 `v-model` 到本 ref，未必先失焦；仅依赖页面 `blur` 再 `clamp` 时，
 * 会出现可短暂输入超过 `DEFAULT_MULTIPLIER_MAX`、甚至未失焦就下注把非法倍数发出。超过上限时立即写回 clamp 结果。
 */
watch(
  () => multiplier.value,
  (v) => {
    if (v === null || v === undefined) return
    if (v === "") return
    const raw = v as string | number
    const n = typeof raw === "string" ? Number(raw.trim()) : Number(raw)
    if (!Number.isFinite(n)) return
    const { max } = getMultiplierBounds()
    if (n <= max) return
    multiplier.value = clampMultiplierValue(n)
  },
)

// ---------- 盘面倍数与展示 ----------
/** 当前局曲线倍数（以 WS 的 multiplier 为准） */
export const gameDouble = ref(1)
/** 飞行中展示的「预计赢取」等（≈ gameDouble * betAmount） */
export const buttonDouble = ref<number>()
/** 手动模式单次兑现后在 UI 上展示的盈利数字（一段时间后由 showWinMoney 清零） */
export const classicMoney = ref(0)
/** 最近一次 WS 房间完整快照（画布、调试面板可直接 watch） */
export const crashRoomState = ref<CrashWsRoomState | null>(null)
/**
 * 是否已应用过本连接上的首帧 `s2c_join` 房间快照。
 * `s2c_room_state` 可能先于 join 到达并短暂带上 flying；若据此把「已见过飞行」置 true，
 * 随后 join 为坠毁态会导致 `deferInitialCrashPresentation` 失效并误播中央爆炸。
 */
export const crashJoinSnapshotApplied = ref(false)
/** `s2c_join` 下发的本局玩家 id，用于对照 `round_bets`（由 join 快照 + 下注/兑现广播维护，`s2c_room_state` 不写入该列表）校准是否本局已下注 */
export const crashSelfPlayerId = ref<string | number | null>(null)

/**
 * 房间主链路 WS（join / room_state / flying_tick 等）是否已 OPEN。
 * 画布、飞行曲线、HUD 仅依赖此路；**不得**与广播专线（26582）做「与」聚合，否则广播失败会导致曲线冻结。
 */
export const crashWsConnected = ref(false)
/** 玩家广播专线（`s2c_broadcast_player_*`）是否已 OPEN；下注列表更新用，与曲线无关 */
export const crashWsBroadcastConnected = ref(false)
/**
 * 曾建立过连接后出现断线 / error（不含用户离页主动 `stop`）。
 * 画布中央用于提示「连接失败」；`open` 成功会清零。
 */
export const crashWsSocketError = ref(false)

/**
 * 飞行段专用轻量 tick 数据（避免每 tick 替换整个 crashRoomState 触发全量 Vue 响应式）。
 * GameCanvas 在飞行段读取此 ref 而非 crashRoomState.multiplier。
 */
export const flyingTickData = shallowRef<{ multiplier: number; version: number; elapsed_ms: number }>({
  multiplier: 1, version: 0, elapsed_ms: 0,
})

// ---------- 逃离人员队列（用于画布随机下落） ----------
export type CrashEscapedEntry = {
  game_id: number
  player_id: string | number
  userName: string
  multiplier: number
  at: number
}

/** 兑现（逃离）人员队列：由 WS 控制器写入；画布端每秒随机抽取 2-6 条做下落 */
export const crashEscapedQueue = shallowRef<CrashEscapedEntry[]>([])
/** 去重：同一 game_id + player_id + multiplier 只入队一次（防止单播/广播重复） */
const _escapedSeen = new Set<string>()

export function enqueueCrashEscaped(game_id: number, entry: Omit<CrashEscapedEntry, "at">) {
  const gid = Number(game_id)
  if (!Number.isFinite(gid)) return
  const key = `${gid}|${entry.player_id}|${entry.multiplier}`
  if (_escapedSeen.has(key)) return
  _escapedSeen.add(key)
  crashEscapedQueue.value = [...crashEscapedQueue.value, { ...entry, game_id: gid, at: Date.now() }]
}

export function clearCrashEscapedQueue() {
  crashEscapedQueue.value = []
  _escapedSeen.clear()
}

/**
 * round_bets player_id → index 索引缓存，避免每次 broadcast 都 findIndex O(n)。
 * 由 controller 在快照/增量时维护。
 */
export const playerIdIndexMap = new Map<string, number>()

// ---------- 自动下注 ----------
/** 用户是否已开启自动下注流程（与 Manual 互斥） */
export const isStart = ref(false)
/** 当前自动序列中「一局是否已开始下注/飞行」标记，配合 reqGameStart 节流 */
export const gameStart = ref(false)

// ---------- 预约下注（非下注阶段先填好，进 1 再发） ----------
export const savedBetData = reactive<SavedBetData>({
  /** 是否存在未执行的预约 */
  state: false,
  /** 触发来源标识，如 manual / auto */
  name: '',
  /** 预约时的 bet/double 等 */
  data: {}
})

/** 顶部历史条最多保留条数 */
export const CRASH_HISTORY_MAX_LEN = 15

/**
 * Crash 回合历史一项（公平弹窗用 `server_seed` / `client_seed` / `crash_point`）。
 * - `s2c_join.history_list`：`bet_id` 为注单 UUID 字符串，可选 `time`（Unix 秒）。
 * - 本地 `room_state` 追加：仍可用 `game_id`（number）作 `bet_id`，与旧逻辑兼容。
 */
export interface CrashRoundHistoryItem {
  crash_point: string | number | null
  server_seed: string
  client_seed: string
  bet_id: string | number
  time?: number
  /** 局 id，用于与 room_state.game_id 对齐去重；history_list 可能带 game_id */
  game_id?: number
  /** 本局开始时间（与下行 this_start_time 对齐） */
  start_time?: number
}

/** 将下行原始项归一化为 `CrashRoundHistoryItem`；非法项返回 `null` */
export function normalizeCrashHistoryRow(raw: unknown): CrashRoundHistoryItem | null {
  if (raw == null || typeof raw !== "object") return null
  const o = raw as any
  const parseCrashPoint = (v: unknown): number | null => {
    if (v == null) return null
    if (typeof v === "number" && Number.isFinite(v)) return v
    const s = String(v).trim()
    if (!s.length) return null
    // 兼容 "12.34" / "12,34" / "12.34x" 等：抽取第一个浮点数字段
    const m = s.replace(/,/g, ".").match(/-?\d+(?:\.\d+)?/)
    if (!m) return null
    const n = Number(m[0])
    return Number.isFinite(n) ? n : null
  }
  const cp = parseCrashPoint(o.crash_point)
  if (cp == null) return null
  const bidSrc = o.bet_id != null && String(o.bet_id).length > 0 ? o.bet_id : o.game_id
  let bet_id: string | number
  if (typeof bidSrc === "number" && Number.isFinite(bidSrc)) bet_id = bidSrc
  else if (bidSrc != null && String(bidSrc).length > 0) bet_id = String(bidSrc)
  else return null
  const t = o.time
  const time = t != null && Number.isFinite(Number(t)) ? Math.floor(Number(t)) : undefined
  const st = o.start_time
  const start_time =
    st != null && Number.isFinite(Number(st)) ? Math.floor(Number(st)) : undefined
  const gid = o.game_id
  const game_id =
    gid != null && Number.isFinite(Number(gid)) ? Math.floor(Number(gid)) : undefined
  return {
    crash_point: cp,
    server_seed: o.server_seed != null ? String(o.server_seed) : "",
    client_seed: o.client_seed != null ? String(o.client_seed) : "",
    bet_id,
    time,
    ...(start_time != null ? { start_time } : {}),
    ...(game_id != null ? { game_id } : {}),
  }
}

// 游戏历史记录（Crash 页 `GameHistoryDobule`）
export const crashHistory = reactive<{ list: CrashRoundHistoryItem[] }>({
  list: [],
})


// ---------- 自动下注累计 ----------
export const autoBetData = reactive<AutoBetData>({
  start: false,
  /** 自动开始时的基准下注额（用于输赢倍率计算） */
  startMoney: 0,
  /** 上一局派彩额（展示用） */
  winMoney: 0,
  /** 赢后下次下注 = 本金 * (1 + winCount%)，由 useGame.setBetAmount 解释 */
  winCount: undefined,
  /** 输后下次下注调整 */
  lossCount: undefined,
  /** 累计亏损触顶则 stop */
  lossEndMoney: undefined,
  /** 本轮自动策略累计盈亏（与 lossEndMoney 比较） */
  allFailMoney: 0,
  /** 本局是否已成功下过注（等待兑现或已结束） */
  isBet: false,
  betNumber: 0,
  betBigNumber: null
})

// ---------- 公平性 / 本局标识 ----------
export const crashHashData = reactive<CrashHashData>({
  hash: '',
  round: '',
  server_seed: '',
  nonce: ''
})

// ---------- 组件协作 ----------
export const crashBetRef = ref()
/** 强制重挂载子树时递增（若业务使用） */
export const crashGameKey = ref(1)

/** 下注表昵称 → 画布下落动画（与 TotalBet / WS 同步） */
export const crashBettingNicknames = ref<string[]>([])

/** TotalBet 表格行：仅由 `crashWsController.notifyBettingTable` 写入，避免组件内重复 watch + O(n) map */
export type CrashBettingTableRow = {
  /** 供 `HSTable` 稳定 :key，避免整表用 index 导致兑现时大量 DOM 错位重绘 */
  rowKey: string
  /** 与 `round_bets[].player_id` 一致，供火箭头像与表格「最高下注」同源比较 */
  player_id: string | number
  /** winDisplay：已兑现时为 min(payout,max_profit) 折 UI 金额；未兑现/爆掉列不展示该值 */
  gamedata: { bet: number; cash_out: number; winDisplay: number }
  Headimg: string
  NickName: string
}
export const crashBettingTableRows = shallowRef<CrashBettingTableRow[]>([])
/**
 * 顶部人数 / 总下注额：与 `crashBettingTableRows` 同源，由 `notifyBettingTable` 从本局 `round_bets` 推导。
 */
export const crashBettingTableSummary = shallowRef<{ count: number; totalBet: number }>({
  count: 0,
  totalBet: 0,
})

export function syncCrashBettingTable(rows: Array<{ NickName?: string }>) {
  crashBettingNicknames.value = rows.map((r) => String(r.NickName || "")).filter(Boolean)
}

/**
 * 由壳层或路由切换游戏状态。
 */
export const changeGameState = (state: GameStateType) => {
  gameState.value = state
}

export const changeBetButtonState = (state: string) => {
  betButtonState.value = state
}

/**
 * 根据 `gameState` 与是否预约/下注中，推导主按钮应变为什么样式（绿下注/灰等待/黄兑现/红取消）。
 * 每次调用都会写入 `betButtonState`，避免「未下注仍残留上一局灰/黄」。
 */
export const getButtonStr = (state: number) => {
  let str = 'green'
  switch (state) {
    case 0:
      str = savedBetData.state ? 'red' : 'green'
      break
    case 1:
      // 已点下注/已提交 WS、或仍处预约态：都应灰；仅「未预约且未在下注流程」为绿
      str = !savedBetData.state && !isBetting.value ? 'green' : 'gray'
      break
    case 2:
      if (isBetting.value && savedBetData.state) {
        str = 'red'
      } else if (isBetting.value && cashoutRequestPending.value) {
        str = 'gray'
      } else if (isBetting.value) {
        str = 'yellow'
      } else {
        str = 'green'
      }
      break
    default:
      str = 'green'
  }
  changeBetButtonState(str)
}

/**
 * 清空预约下注；若无预约则顺带 `isBetting = false`。
 */
export const clearBetData = () => {
  if (!savedBetData.state) {
    isBetting.value = false
    cashoutRequestPending.value = false
  }
  savedBetData.name = ''
  savedBetData.data = {}
  savedBetData.state = false
}

/**
 * 离开页或初始化：恢复金额、倍数、自动/预约相关标记。
 * @param configBet 若传入则用为默认 betAmount，否则 0.01
 */
export const resetState = (configBet?: number) => {
  betAmount.value = configBet ?? 0.01
  multiplier.value = getMultiplierBounds().min
  isBetting.value = false
  cashoutRequestPending.value = false
  isStart.value = false
  gameStart.value = false
  gameDouble.value = 1
  crashRoomState.value = null
  crashJoinSnapshotApplied.value = false
  crashSelfPlayerId.value = null
  classicMoney.value = 0
  buttonDouble.value = undefined
  betButtonState.value = 'graybet'

  savedBetData.state = false
  savedBetData.name = ''
  savedBetData.data = {}

  autoBetData.startMoney = 0
  autoBetData.winMoney = 0
  autoBetData.allFailMoney = 0
  autoBetData.isBet = false
  autoBetData.betNumber = 0
  crashBettingNicknames.value = []
  crashBettingTableRows.value = []
  crashBettingTableSummary.value = { count: 0, totalBet: 0 }
  crashHistory.list = []
  crashWsConnected.value = false
  crashWsBroadcastConnected.value = false
  crashWsSocketError.value = false
  flyingTickData.value = { multiplier: 1, version: 0, elapsed_ms: 0 }
  playerIdIndexMap.clear()
  clearCrashEscapedQueue()
}

/** 与 resetState 相同，语义上表示「进页默认」 */
export const initPageData = resetState

/**
 * 在组件内使用：提供 `gameConfig` 及币种切换时清理「余额不足」标记。
 */
export function useCrashState() {
  registerCrashFastBetGuardOnce()
  const gameConfigStore = useGameConfigStore()
  const gameConfig = computed(() => gameConfigStore.gameConfig?.[GAME_ID] as CrashGameConfig | undefined)
  const multiplierMin = computed(() => DEFAULT_MULTIPLIER_MIN)
  const multiplierMax = computed(() => getMultiplierBounds().max)

  return {
    gameState,
    isBetting,
    cashoutRequestPending,
    betButtonState,
    betAmount,
    multiplier,
    gameDouble,
    buttonDouble,
    classicMoney,
    isStart,
    gameStart,
    savedBetData,
    autoBetData,
    crashHashData,
    crashSelfPlayerId,
    crashWsConnected,
    crashWsBroadcastConnected,
    crashWsSocketError,
    crashBetRef,
    crashGameKey,
    gameConfig,
    multiplierMin,
    multiplierMax,
    changeGameState,
    changeBetButtonState,
    getButtonStr,
    clearBetData,
    resetState,
    initPageData,
  }
}
