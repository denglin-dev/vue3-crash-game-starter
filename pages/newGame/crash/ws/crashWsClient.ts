/**
 * Crash 房间 WebSocket 客户端（薄封装）
 *
 * 协议说明见项目根目录旁文档《Crash 游戏 WebSocket 协议说明》（你提供的 111.md 同款内容），要点：
 *
 * 1) 连接
 *    - 默认房间主链路形如 ws(s)://<host>:26581；玩家广播可拆到第二端口（见 `crashWsSessionUrl.ts` 与 `crashWsController` 双连接）
 *    - 握手 URL 需带登录票据：query 参数 `token` 或 `t`（二选一）
 *    - 鉴权失败会在握手阶段直接断开，无业务 JSON
 *
 * 2) 帧格式
 *    - **Binary + Protobuf**：`[header u16|u32 msgId][payload]`，payload 对应 `proto/game.proto`。
 *    - **JSON 文本**：与 `type`/`msg` 或根级扁平字段一致时，经 `normalizeIncomingJsonS2cEnvelope` 与 binary 共用归一化。
 *    - 上行优先发 binary，失败则 `JSON.stringify`；下行 binary 仅按包头 + Protobuf 解析（无 UTF-8 JSON 回退）。
 *
 * 3) 上行（C2S，白名单）
 *    - `c2s_bet`：{ type, amount, auto_cashout_mult?, client_ref? }；金额为 UI 小数（最多 6 位），`coerceC2sBetForProto` 一处 `floor(amount * 1e6)`；倍数为 UI 小数（2 位）→ `* 100`
 *    - `c2s_cashout`：{ type, client_ref? }（倍数由服务端计算，客户端不得上报倍数）
 *
 * 4) 下行（S2C，本文件类型仅覆盖联调常用子集）
 *    - `s2c_join`：与 `game.proto` 一致，根级 `history` + `room_data`；可选 `self_player_id`、`start_time`。
 *      文本帧若无 `type`，会先归一化为 `{ type, code, msg, history_list }` 再派发。历史项与 `CrashRoundHistoryItem` 对齐。
 *    - `s2c_room_state`：房间快照广播；飞行中 **倍数** 由 `s2c_flying_tick` 推送，`room_state` 不覆盖飞行倍数。
 *      下注人员列表 **不** 从 `room_state` 的 `round_bets` 更新：归一化时该字段恒为 `[]`，仅 `s2c_join` + `s2c_broadcast_player_*` 维护列表（见 `crashWsController.applySnapshot`）。
 *    - `s2c_flying_tick`：飞行阶段更新 `multiplier`；建议带 `elapsed_ms`（权威飞行毫秒）与可选 `version`
 *    - `s2c_bet` / `s2c_cashout`：操作结果单播（code/message）
 *    - `s2c_kick`：服务端踢线/拒绝重复连接等（如 code 2101：登录态下不可重复操作）
 *    - 另有广播类 `s2c_broadcast_*`，完整列表以服务端为准
 *
 * 5) 本类职责
 *    - 维护一条 WebSocket；下行 **binary + JSON**；上行 **binary 优先、JSON 回退**
 *    - 非用户主动 `close` 时，按间隔尝试重连（可配次数上限）
 *
 * 不负责：把快照映射到 Vue 全局状态；`s2c_broadcast_player_*` 的合并逻辑在 crashWsController.ts。
 *
 * ---------------------------------------------------------------------------
 * 本文件代码分区（便于跳转维护）
 * 1. 二进制包头与 msgId 映射
 * 2. 枚举、数值解析、`player_info` / 历史项、房间快照结构体类型
 * 3. C2S：字段白名单、下注 int32 缩放、protobuf 编解码
 * 4. S2C：`CrashWsRoomState` 拼装、`normalizeDecodedMessage`、repeated 辅助
 * 5. JSON 信封：`normalizeIncomingJsonS2cEnvelope`、无 `type` 的 join 文本帧
 * 6. `CrashWsClient`：连接、心跳、收发、`deliverIncomingS2c`
 * ---------------------------------------------------------------------------
 */

import { ref } from "vue"
import { loginStatus } from "~/utils/hook/hook"
import { waitForGameUserToken } from "~/pages/newGame/common/composables/waitForGameUserToken"
import { lookupCrashType } from "./proto/crashProto"
import {
  buildCrashWsSessionUrl,
  CRASH_WS_PORT_BROADCAST,
  CRASH_WS_PORT_ROOM,
} from "./crashWsSessionUrl"
import { gameMessages } from '~/pages/newGame/common/composables/useMessage'

type AnyObj = Record<string, any>

// --- 1) 二进制包头：小端 u16 / u32 与已知 msgId（须与服务端网关一致） ---

const CRASH_MSG_ID: Record<number, string> = {
  1000: "c2s_bet",
  1001: "s2c_bet",
  1002: "s2c_broadcast_player_bet",
  1003: "c2s_cashout",
  1004: "s2c_cashout",
  1005: "s2c_broadcast_player_cashout",
  1006: "s2c_room_state",
  1007: "s2c_flying_tick",
  1008: "s2c_join",
  1009: "s2c_online_count",
  1010: "s2c_kick"
}

const CRASH_MSG_NAME_TO_ID: Record<string, number> = Object.fromEntries(
  Object.entries(CRASH_MSG_ID).map(([k, v]) => [v, Number(k)]),
) as Record<string, number>

function readU16(view: DataView, offset: number, littleEndian: boolean) {
  return view.getUint16(offset, littleEndian)
}

function readU32(view: DataView, offset: number, littleEndian: boolean) {
  return view.getUint32(offset, littleEndian)
}

type CrashPacketHeader = { msgId: number; headerLen: number; littleEndian: boolean }

/**
 * 从首 2 或 4 字节猜测消息头：在「小端优先、短头优先」下取第一个命中 `CRASH_MSG_ID` 的候选。
 * 若服务端固定宽度/字节序，可收紧逻辑；当前实现兼容历史双端试解。
 */
function parseCrashPacketHeader(buf: ArrayBuffer): CrashPacketHeader | null {
  if (buf.byteLength < 2) return null
  const view = new DataView(buf)
  const candidates: CrashPacketHeader[] = []
  if (buf.byteLength >= 2) {
    const le = readU16(view, 0, true)
    const be = readU16(view, 0, false)
    if (CRASH_MSG_ID[le]) candidates.push({ msgId: le, headerLen: 2, littleEndian: true })
    if (CRASH_MSG_ID[be]) candidates.push({ msgId: be, headerLen: 2, littleEndian: false })
  }
  if (buf.byteLength >= 4) {
    const le = readU32(view, 0, true)
    const be = readU32(view, 0, false)
    if (CRASH_MSG_ID[le]) candidates.push({ msgId: le, headerLen: 4, littleEndian: true })
    if (CRASH_MSG_ID[be]) candidates.push({ msgId: be, headerLen: 4, littleEndian: false })
  }
  if (!candidates.length) return null
  candidates.sort((a, b) => {
    if (a.littleEndian !== b.littleEndian) return a.littleEndian ? -1 : 1
    if (a.headerLen !== b.headerLen) return a.headerLen - b.headerLen
    return 0
  })
  return candidates[0]
}

// --- 2) 枚举与展示层结构：phase / 下注状态 / 数值字符串 ---

function phaseFromInt(n: number): CrashWsPhase {
  // proto: 1=flying 2=crashed 3=settling 4=betting
  if (n === 1) return "flying"
  if (n === 2) return "crashed"
  if (n === 3) return "settling"
  return "betting"
}

function statusFromInt(n: number): CrashWsRoundBet["status"] {
  if (n === 2) return "cashed"
  if (n === 3) return "busted"
  return "pending"
}

/** proto3 string 数值字段（倍数/坠毁点等）→ number；非法则 null */
function parseProtoNumericString(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === "number" && Number.isFinite(v)) return v
  const s = String(v).trim()
  if (!s.length) return null
  const m = s.replace(/,/g, ".").match(/-?\d+(?:\.\d+)?/)
  if (!m) return null
  const n = Number(m[0])
  return Number.isFinite(n) ? n : null
}

function normalizePlayerInfoToRoundBet(p: AnyObj): CrashWsRoundBet | null {
  if (!p || typeof p !== "object") return null
  const pid = p.player_id
  if (pid == null) return null
  if (typeof pid === "string" && !pid.trim()) return null
  const amount = Number(p.amount ?? 0)
  if (!Number.isFinite(amount) || amount < 0) return null
  const status = statusFromInt(Number(p.status ?? 1))
  const out: CrashWsRoundBet = {
    player_id: pid,
    amount: Number.isFinite(amount) ? amount : 0,
    status,
  }
  if (p.userName != null) out.userName = String(p.userName)
  if (p.avatar != null) out.avatar = String(p.avatar)
  const mult = parseProtoNumericString(p.multiplier)
  if (mult != null && (status === "cashed" || status === "busted")) out.multiplier = mult
  if (p.payout != null && Number.isFinite(Number(p.payout))) out.payout = Number(p.payout)
  if (p.profit != null && Number.isFinite(Number(p.profit))) out.profit = Number(p.profit)
  if (p.max_profit != null && String(p.max_profit) !== "") {
    const mp = Number(p.max_profit)
    if (Number.isFinite(mp)) out.max_profit = mp
  }
  if (p.auto_cashout_mult != null && Number.isFinite(Number(p.auto_cashout_mult))) {
    out.auto_cashout_mult = Number(p.auto_cashout_mult)
  } else if (status === "pending" && p.auto === true && mult != null && mult > 1) {
    out.auto_cashout_mult = mult
  }
  return out
}

function normalizeHistoryInfo(h: AnyObj): CrashWsHistoryListItem | null {
  if (!h || typeof h !== "object") return null
  const cp = parseProtoNumericString(h.crash_point)
  if (cp == null) return null
  const row: CrashWsHistoryListItem = {
    crash_point: cp,
    server_seed: h.server_seed != null ? String(h.server_seed) : "",
    client_seed: h.client_seed != null ? String(h.client_seed) : "",
    bet_id: h.bet_id != null ? String(h.bet_id) : "",
    time: h.time != null && Number.isFinite(Number(h.time)) ? Number(h.time) : undefined,
  }
  if (h.start_time != null && Number.isFinite(Number(h.start_time))) {
    row.start_time = Number(h.start_time)
  }
  return row
}

/** 房间阶段：由协议 int phase 经 `phaseFromInt` 映射，供 Vue 与画布状态机使用 */
export type CrashWsPhase = "betting" | "flying" | "crashed" | "settling"

/** 已归一化的房间快照里 `phase` 取值为上述四者之一；用于识别「勿二次 normalizeDecodedMessage」 */
const CRASH_ROOM_PHASE_SET = new Set<CrashWsPhase>(["betting", "flying", "crashed", "settling"])

function isNormalizedRoomStatePhase(v: unknown): v is CrashWsPhase {
  return typeof v === "string" && CRASH_ROOM_PHASE_SET.has(v as CrashWsPhase)
}

/** 本局下注列表单项（round_bets[]） */
export interface CrashWsRoundBet {
  player_id: string | number
  amount: number
  status: "pending" | "cashed" | "busted"
  multiplier?: number
  payout?: number
  profit?: number
  /** 单局利润上限（微单位整数，与 payout 同源）；与 payout 取 min 后作展示 */
  max_profit?: number
  /** 列表展示用，以后端是否下发为准 */
  avatar?: string
  userName?: string
  /** 仅 pending 且下注时带了自动逃离 */
  auto_cashout_mult?: number
}

/**
 * 房间快照 msg（与 s2c_room_state / s2c_join 中除 self_player_id 外结构对齐）
 * 具体字段以后端为准；未知字段解析后仍可存在于对象上，类型为文档子集。
 */
export interface CrashWsRoomState {
  game_id: number
  phase: CrashWsPhase
  /** 协议 `s2c_room_state.phase` 原值：1=flying 2=crashed 3=settling 4=betting */
  phase_pb?: number
  /** 展示倍数：下注阶段多为 1；飞行中递增；爆炸后可能为本局 crash_point */
  multiplier: number
  crashed: boolean
  crash_point: string | number | null
  /** 仅 phase===betting 时有意义 */
  betting_ticks_left: number
  /** 未爆炸前客户端可选择不展示 */
  server_seed: string | null
  /** 坠毁后公平性展示用；若后端不下发则为空 */
  client_seed?: string | null
  online_count: number
  /** 本局下注人数（服务端可选下发，见 proto `s2c_room_state.bet_count`） */
  bet_count?: number
  /**
   * 本局总下注额（服务端可选下发）。
   * proto 已升级为 int64；binary decode 时 longs→string，因此这里用 string 保留精度（通常为“微单位”整数）。
   */
  bet_amount?: string
  version: number
  round_bets: CrashWsRoundBet[]
  /** 房间逻辑帧间隔（毫秒）；飞行段横轴 tick 步长也用它累加 elapsed（无 elapsed_ms 时） */
  tick_interval_ms: number
  /**
   * 飞行段服务端权威已飞毫秒（由 `s2c_flying_tick` 写入）；有则画布横轴以该值为准。
   */
  elapsed_ms?: number
  /**
   * 剩余倒计时时长（毫秒）：下注/局间等由服务端每 tick 下发当前剩余值，非「固定总长」。
   * UI 用 (countdown_ms/1000).toFixed(1) 展示即可；与 tick_interval_ms 无关。
   */
  countdown_ms?: number
  /**
   * 本局注单唯一 id（UUID）；坠毁/结算等阶段由服务端下发，与 `s2c_join.history_list[].bet_id` 对齐。
   */
  this_bet_id?: string
  /** 公平性 / 哈希链相关上限（如 1_000_000），展示或验算用 */
  max_hash_count?: number
  /** 当前周期内剩余局数等，语义以后端为准 */
  remain_games?: number
  /**
   * 本局开始时间戳（`s2c_room_state` 可选下发；单位以后端为准，常为 Unix 秒）。
   */
  this_start_time?: number
  /**
   * 进房时下发的起始时间戳（`s2c_join`，可在 `msg` 或根级 `start_time`）；单位与 `this_start_time` 一致以后端为准。
   */
  start_time?: number
}

/**
 * 飞行段专用轻量包。常见：`multiplier` + `elapsed_ms`（权威飞行毫秒）；
 * 若仅 `multiplier`，controller 会在本地对 `crashRoomState.version` 每包 +1，
 * 画布按 `version`×`tick_interval_ms` 累加横轴（与每 tick 一包对齐）。
 */
export interface CrashWsFlyingTickMsg {
  multiplier: number
  /** 服务端权威：本局飞行已持续毫秒，有则优先于本地 version 累加 */
  elapsed_ms?: number
  /** 可选；与房间快照同义，有则覆盖 */
  version?: number
  /** 可选；与房间快照 `game_id` 同时存在且不一致时丢弃该 tick（防串局） */
  game_id?: number
}

/** `s2c_join` 可选 `history_list` 单项（与 `useCrashState.CrashRoundHistoryItem` 同字段） */
export interface CrashWsHistoryListItem {
  crash_point: number
  server_seed: string
  client_seed: string
  bet_id: string | number
  time?: number
  /** 与 `history_info.start_time` / 房间 `this_start_time` 对齐（单位以后端为准） */
  start_time?: number
}

/** 下行消息联合类型（联调常用；其余 type 走兜底分支） */
export type CrashWsS2C =
  | {
    type: "s2c_join"
    seq?: number
    code: number
    message: string
    msg: CrashWsRoomState & { self_player_id: string | number; history_list?: CrashWsHistoryListItem[]; start_time?: number }
    /** 可与 `msg.start_time` 二选一 */
    start_time?: number
    history_list?: CrashWsHistoryListItem[]
  }
  | { type: "s2c_room_state"; seq?: number; msg: CrashWsRoomState }
  | { type: "s2c_flying_tick"; seq?: number; msg: CrashWsFlyingTickMsg }
  | {
    type: "s2c_bet"
    seq?: number
    code: number
    message: string
    client_ref?: string
    msg?: { amount?: number; auto_cashout_mult?: number }
  }
  | {
    type: "s2c_cashout"
    seq?: number
    code: number
    message: string
    client_ref?: string
    msg?: { multiplier: number; payout: number; bet: number; profit: number; auto?: boolean }
  }
  | { type: "s2c_kick"; seq?: number; code: number; message?: string }
  | {
    type: "s2c_broadcast_player_bet"
    seq?: number
    /** 单条：与 msg 同级；多条：仅存在于每条元素上 */
    userName?: string
    avatar?: string
    /** 单条下注体，或「多条下注」数组（每项含 `msg` + 可选 `userName`/`avatar`） */
    msg:
    | { player_id: string | number; ok: boolean; amount: number; auto_cashout_mult?: number }
    | Array<{
      msg: { player_id: string | number; ok: boolean; amount: number; auto_cashout_mult?: number }
      userName?: string
      avatar?: string
    }>
  }
  | {
    type: "s2c_broadcast_player_cashout"
    seq?: number
    /** 单条兑现体，或兑现对象数组 */
    msg:
    | {
      player_id: string | number
      multiplier: number
      payout: number
      profit: number
      bet?: number
      auto?: boolean
    }
    | Array<{
      player_id: string | number
      multiplier: number
      payout: number
      profit: number
      bet?: number
      auto?: boolean
    }>
  }
  | { type: string;[k: string]: unknown }

/** 上行消息（仅文档允许的两类） */
export type CrashWsC2S =
  | { type: "c2s_bet"; amount: number; auto_cashout_mult: number; client_ref?: string }
  | { type: "c2s_cashout"; client_ref?: string }

/** 某一 `type` 频道上的订阅者签名 */
type Listener<T> = (payload: T) => void

// --- 3) C2S：仅允许白名单字段进入 verify，避免 client_ref 等污染 protobuf ---

/** JSON 文本解析失败时返回 null，避免 onmessage 抛错打断重连逻辑 */
function safeJsonParse(raw: string): unknown | null {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

const C2S_PROTO_FIELDS: Record<string, string[]> = {
  c2s_bet: ["auto_cashout_mult", "amount"],
  c2s_cashout: [],
}

function pickProtoFields(typeName: string, obj: AnyObj): AnyObj {
  const allow = C2S_PROTO_FIELDS[typeName]
  if (!allow) return obj
  const out: AnyObj = {}
  for (const k of allow) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k]
  }
  return out
}

const INT32_MAX = 0x7fffffff
const INT32_MIN = -0x80000000

function clampInt32(n: number): number {
  if (!Number.isFinite(n)) return 0
  const t = Math.trunc(n)
  if (t > INT32_MAX) return INT32_MAX
  if (t < INT32_MIN) return INT32_MIN
  return t
}

/** UI 金额 → proto 微单位（1e6），与 dice/mines 一致，最多保留 6 位小数精度 */
const CRASH_BET_AMOUNT_MICRO = 1_000_000

/**
 * `c2s_bet` 数值**仅此一处**做缩放（binary / JSON 回退共用，避免到处 *1e6 / *100）：
 * - `amount`：UI 金额 → `Math.floor(amount * 1e6)`（proto int64 微单位，最多 6 位小数）
 * - `auto_cashout_mult`：UI 倍数 → floor 到 2 位小数 → `* 100`（proto int32「百分之一倍」）
 */
function coerceC2sBetForProto(obj: AnyObj): AnyObj {
  const amountUi = Number(obj.amount)
  const multUi = obj.auto_cashout_mult

  const amountProto =
    Number.isFinite(amountUi) && amountUi >= 0
      ? Math.floor(amountUi * CRASH_BET_AMOUNT_MICRO)
      : 0

  let multProto = 0
  if (multUi != null && Number.isFinite(Number(multUi))) {
    const m = Number(multUi)
    if (m > 0) {
      const mult2 = Math.floor(m * 100) / 100
      multProto = clampInt32(Math.round(mult2 * 100))
    }
  }

  return {
    amount: amountProto,
    auto_cashout_mult: multProto,
  }
}

function coerceC2sPayloadForProto(typeName: string, obj: AnyObj): AnyObj {
  if (typeName === "c2s_bet") return coerceC2sBetForProto(obj)
  return obj
}

// --- 4a) 下行 repeated / 单条：binary.toObject 与 JSON 共用形状 ---

/**
 * `repeated player_info msg` 等在解码后可能是数组、单对象或空；统一成数组供 map。
 */
function protoRepeatedOrSingleAsArray(raw: unknown): AnyObj[] {
  if (Array.isArray(raw)) return raw as AnyObj[]
  if (raw != null && typeof raw === "object") return [raw as AnyObj]
  return []
}

/** Protobuf decode：`cybet.<typeName>`，long→string、enum→number，便于与现有 JSON 归一化共用。 */
async function decodeCrashPayload(typeName: string, payload: Uint8Array): Promise<AnyObj> {
  const t = await lookupCrashType(`cybet.${typeName}`)
  const msg = t.decode(payload)
  return t.toObject(msg, {
    longs: String,
    enums: Number,
    bytes: Uint8Array,
    defaults: true,
  }) as AnyObj
}

/** Protobuf encode：先 `verify` 再 `create`，失败抛错由 `sendBinaryByName` 捕获并回退 JSON。 */
async function encodeCrashPayload(typeName: string, obj: AnyObj): Promise<Uint8Array> {
  const t = await lookupCrashType(`cybet.${typeName}`)
  const err = t.verify(obj)
  if (err) throw new Error(err)
  const msg = t.create(obj)
  return t.encode(msg).finish()
}

// --- 4) 房间快照与历史：proto / JSON 扁平体 → `CrashWsRoomState` / `CrashWsHistoryListItem` ---

/**
 * 将 `s2c_room_state` 的下行 JSON 体归一化为 `CrashWsRoomState`。
 * @param includeRoundBetsFromServer 仅 `s2c_join.room_data` 为 true；独立下发的 `s2c_room_state` 恒为 false，不解析/不携带 `round_bets`，避免误驱动下注表。
 */
function normalizeS2cRoomStateFromBody(body: AnyObj, includeRoundBetsFromServer: boolean): CrashWsRoomState {
  const rawPhase = Number(body.phase)
  const phase_pb = Number.isFinite(rawPhase) ? rawPhase : undefined
  const phase = phaseFromInt(Number(body.phase ?? 4))
  const betsRaw =
    includeRoundBetsFromServer && Array.isArray(body.round_bets) ? body.round_bets : []
  const bets = betsRaw.map(normalizePlayerInfoToRoundBet).filter(Boolean) as CrashWsRoundBet[]
  const mult = parseProtoNumericString(body.multiplier) ?? 1
  const crashPointParsed = parseProtoNumericString(body.crash_point)
  const tickMs = Math.max(1, Number(body.tick_interval_ms) || 50)
  const ticksLeft = Math.max(0, Number(body.betting_ticks_left ?? 0))
  const rawCd = Number(body.countdown_ms)
  const cdFromProto = Number.isFinite(rawCd) ? Math.max(0, rawCd) : undefined
  const cdFromTicks = ticksLeft * tickMs
  const countdown_ms =
    cdFromProto != null && cdFromProto > 0
      ? cdFromProto
      : cdFromTicks > 0
        ? cdFromTicks
        : cdFromProto ?? 0
  const rawGid = Number(body.game_id)
  const game_id = Number.isFinite(rawGid) ? rawGid : 0
  const bet_count =
    body.bet_count != null && Number.isFinite(Number(body.bet_count))
      ? Math.max(0, Math.floor(Number(body.bet_count)))
      : undefined
  const bet_amount =
    body.bet_amount != null && String(body.bet_amount).length > 0
      ? String(body.bet_amount)
      : undefined
  const thisBetId =
    body.this_bet_id != null && String(body.this_bet_id).length > 0
      ? String(body.this_bet_id)
      : undefined
  return {
    game_id,
    phase,
    ...(phase_pb !== undefined ? { phase_pb } : {}),
    multiplier: Math.max(1, mult),
    crashed: !!body.crashed,
    crash_point: crashPointParsed != null ? crashPointParsed : (body.crash_point != null ? String(body.crash_point) : null),
    betting_ticks_left: ticksLeft,
    server_seed: body.server_seed != null ? String(body.server_seed) : null,
    client_seed: body.client_seed != null ? String(body.client_seed) : null,
    online_count: Number(body.online_count ?? 0),
    ...(bet_count != null ? { bet_count } : {}),
    ...(bet_amount != null ? { bet_amount } : {}),
    version: 0,
    round_bets: bets,
    tick_interval_ms: tickMs,
    this_start_time: body.this_start_time != null ? Number(body.this_start_time) : undefined,
    remain_games: body.remain_games != null ? Number(body.remain_games) : undefined,
    ...(thisBetId ? { this_bet_id: thisBetId } : {}),
    countdown_ms,
  }
}
// --- 4c) 单条 S2C：按协议消息名转 `CrashWsS2C`（供 emit 与 controller 使用）---
/**
 * 将单条 S2C 的 **proto 体或等价 JSON 扁平体** 转为 `CrashWsS2C`（controller 订阅的形态）。
 * - 仅处理本文件显式分支；未知 `typeName` 走兜底 `{ type, msg: body }`。
 * - **binary 路径**在调用本函数后不再走 `normalizeIncomingJsonS2cEnvelope`，避免对已归一字段二次解析。
 */
function normalizeDecodedMessage(typeName: string, body: AnyObj): CrashWsS2C | null {
  if (typeName != "s2c_flying_tick") {
    if (body.code && body.code !== 0) {
      gameMessages(body) //报错提示
    }
    console.log(typeName, "typeName111", body, "body222");
  }
  if (typeName === "s2c_room_state") {
    const msg = normalizeS2cRoomStateFromBody(body, false)
    return { type: "s2c_room_state", msg } as CrashWsS2C
  }

  if (typeName === "s2c_flying_tick") {
    const mult = parseProtoNumericString(body.multiplier) ?? 1
    const msg: CrashWsFlyingTickMsg = {
      multiplier: Math.max(1, mult),
      elapsed_ms: body.elapsed_ms != null ? Number(body.elapsed_ms) : undefined,
    }
    return { type: "s2c_flying_tick", msg } as CrashWsS2C
  }

  if (typeName === "s2c_join") {
    const historyRaw = Array.isArray(body.history) ? body.history : []
    const history = historyRaw.map(normalizeHistoryInfo).filter(Boolean) as CrashWsHistoryListItem[]
    const room = body.room_data && typeof body.room_data === "object" ? body.room_data : {}
    const roomState = normalizeS2cRoomStateFromBody(room, true)
    const selfId = body.self_player_id
    const hasBetRaw = body.has_bet
    /** 根包 `has_bet` 显式 false 时须清 UI；缺字段则 unknown，避免误清老协议包 */
    const joinHasBetStatus: "yes" | "no" | "unknown" = Object.prototype.hasOwnProperty.call(body, "has_bet")
      ? hasBetRaw === true || hasBetRaw === 1 || String(hasBetRaw).toLowerCase() === "true"
        ? "yes"
        : hasBetRaw === false || hasBetRaw === 0 || String(hasBetRaw).toLowerCase() === "false"
          ? "no"
          : "unknown"
      : "unknown"
    const joinHasBet = joinHasBetStatus === "yes"
    const joinBetMicro =
      body.bet_amount != null && String(body.bet_amount).trim() !== ""
        ? String(body.bet_amount)
        : undefined
    const joinAutoProto =
      body.auto_cashout_mult != null && Number.isFinite(Number(body.auto_cashout_mult))
        ? Number(body.auto_cashout_mult)
        : undefined
    return {
      type: "s2c_join",
      code: 0,
      message: "ok",
      msg: {
        ...roomState,
        self_player_id: (selfId != null ? selfId : null) as any,
        history_list: history,
        join_has_bet_status: joinHasBetStatus,
        ...(joinHasBet
          ? {
            join_has_bet: true,
            ...(joinBetMicro != null ? { join_bet_amount_micro: joinBetMicro } : {}),
            ...(joinAutoProto != null ? { join_auto_cashout_mult_proto: joinAutoProto } : {}),
          }
          : {}),
      } as any,
      history_list: history,
      ...(body.start_time != null && Number.isFinite(Number(body.start_time))
        ? { start_time: Number(body.start_time) }
        : {}),
    } as CrashWsS2C
  }

  if (typeName === "s2c_bet") {
    const amount = body.amount != null && Number.isFinite(Number(body.amount)) ? Number(body.amount) : undefined
    const autoMult =
      body.auto_cashout_mult != null && Number.isFinite(Number(body.auto_cashout_mult))
        ? Number(body.auto_cashout_mult)
        : undefined
    return {
      type: "s2c_bet",
      code: Number(body.code ?? -1),
      message: body.message != null ? String(body.message) : "",
      ...(amount != null || autoMult != null ? { msg: { amount, auto_cashout_mult: autoMult } } : {}),
    } as CrashWsS2C
  }

  if (typeName === "s2c_cashout") {
    const code = Number(body.code ?? -1)
    const mult = parseProtoNumericString(body.multiplier)
    const payout = body.payout != null && Number.isFinite(Number(body.payout)) ? Number(body.payout) : undefined
    const bet = body.bet != null && Number.isFinite(Number(body.bet)) ? Number(body.bet) : undefined
    const profit = body.profit != null && Number.isFinite(Number(body.profit)) ? Number(body.profit) : undefined
    const auto = body.auto === true
    const msg =
      code === 0 && mult != null && payout != null && bet != null && profit != null
        ? { multiplier: mult, payout, bet, profit, auto }
        : undefined
    return {
      type: "s2c_cashout",
      code,
      message: body.message != null ? String(body.message) : "",
      ...(msg ? { msg } : {}),
    } as CrashWsS2C
  }

  if (typeName === "s2c_broadcast_player_bet") {
    const list = protoRepeatedOrSingleAsArray(body.msg)
    const msg = list
      .map((p: AnyObj) => {
        const pid = p?.player_id
        if (pid == null) return null
        const status = statusFromInt(Number(p.status ?? 1))
        const mult = parseProtoNumericString(p.multiplier)
        const autoMult =
          status === "pending" && p.auto === true && mult != null && mult > 1 ? mult : undefined
        return {
          msg: {
            player_id: pid,
            ok: true,
            amount: Number(p.amount ?? 0),
            auto_cashout_mult: autoMult,
          },
          userName: p.userName != null ? String(p.userName) : undefined,
          avatar: p.avatar != null ? String(p.avatar) : undefined,
        }
      })
      .filter(Boolean)
    return { type: "s2c_broadcast_player_bet", msg } as any
  }

  if (typeName === "s2c_broadcast_player_cashout") {
    const list = protoRepeatedOrSingleAsArray(body.msg)
    const msg = list
      .map((p: AnyObj) => {
        if (!p || typeof p !== "object") return null
        if (p.player_id == null) return null
        const mult = parseProtoNumericString(p.multiplier) ?? 0
        return {
          player_id: p.player_id,
          multiplier: mult,
          payout: Number(p.payout ?? 0),
          profit: Number(p.profit ?? 0),
          bet: Number(p.amount ?? 0),
          auto: !!p.auto,
        }
      })
      .filter(Boolean)
    return { type: "s2c_broadcast_player_cashout", msg } as any
  }

  if (typeName === "s2c_online_count") {
    return { type: "s2c_online_count", msg: { online_count: Number(body.online_count ?? 0) } } as any
  }

  if (typeName === "s2c_kick") {
    return {
      type: "s2c_kick",
      code: Number(body.code ?? -1),
      ...(body.message != null && String(body.message).trim()
        ? { message: String(body.message).trim() }
        : {}),
    } as any
  }

  return { type: typeName, msg: body } as any
}

// --- 5) JSON 文本：信封展开后与 binary 共用 `normalizeDecodedMessage` ---

const JSON_S2C_NORMALIZE_TYPES = new Set([
  "s2c_room_state",
  "s2c_flying_tick",
  "s2c_join",
  "s2c_bet",
  "s2c_cashout",
  "s2c_broadcast_player_bet",
  "s2c_broadcast_player_cashout",
  "s2c_online_count",
  "s2c_kick",
])

/** 从 `{ type, seq?, msg?, ...payload }` 中剥离信封字段，得到可喂给 `normalizeDecodedMessage` 的扁平体 */
const S2C_ENVELOPE_SKIP_KEYS = new Set(["type", "seq", "msg", "history_list"])

function flatS2cEnvelopeBody(raw: AnyObj): AnyObj {
  const body: AnyObj = {}
  for (const k of Object.keys(raw)) {
    if (S2C_ENVELOPE_SKIP_KEYS.has(k)) continue
    body[k] = raw[k]
  }
  return body
}

/**
 * 文本 JSON：`{ type, msg?, code?, ... }` 或根级扁平字段 → 与 binary 经 `normalizeDecodedMessage` 后相同的业务结构。
 * **不得**对已是 `normalizeDecodedMessage` 产物的 `s2c_room_state.msg` 再归一化（见内联 `isNormalizedRoomStatePhase`）。
 */
function normalizeIncomingJsonS2cEnvelope(raw: AnyObj): CrashWsS2C {
  const t = raw.type
  if (typeof t !== "string" || !JSON_S2C_NORMALIZE_TYPES.has(t)) return raw as CrashWsS2C

  // join 已由 normalizeJsonTextFrameIfJoinEnvelope / 上游拼好 msg；不能再把 msg 当 body 喂给 normalizeDecodedMessage(join)（缺 history/room_data 键会清空）
  if (t === "s2c_join") return raw as CrashWsS2C

  const inner = raw.msg
  let body: AnyObj | null = null

  if (t === "s2c_broadcast_player_bet" || t === "s2c_broadcast_player_cashout") {
    if (Array.isArray(inner)) body = { msg: inner }
    else if (inner != null && typeof inner === "object") body = inner as AnyObj
  } else if (t === "s2c_bet" || t === "s2c_cashout") {
    if (inner != null && typeof inner === "object" && !Array.isArray(inner)) {
      body = { ...(inner as AnyObj), code: raw.code, message: raw.message }
    } else {
      body = flatS2cEnvelopeBody(raw)
    }
  } else if (t === "s2c_room_state" || t === "s2c_flying_tick" || t === "s2c_online_count") {
    if (inner != null && typeof inner === "object" && !Array.isArray(inner)) {
      // 已是 normalizeDecodedMessage 的 CrashWsRoomState（phase 为业务枚举字符串），勿再当 proto 体解析
      if (t === "s2c_room_state" && isNormalizedRoomStatePhase((inner as AnyObj).phase)) {
        return raw as CrashWsS2C
      }
      body = inner as AnyObj
    } else {
      body = flatS2cEnvelopeBody(raw)
      if (Object.keys(body).length === 0) return raw as CrashWsS2C
    }
  }

  if (!body) return raw as CrashWsS2C
  const norm = normalizeDecodedMessage(t, body)
  if (!norm) return raw as CrashWsS2C
  const seq = raw.seq
  if (typeof seq === "number") return { ...norm, seq } as CrashWsS2C
  return norm as CrashWsS2C
}

/**
 * JSON 文本帧：仅当根级无 `type`、无 `msg`、且含 `room_data` 时视为 join（与 proto 根字段一致），归一化后再派发。
 */
function normalizeJsonTextFrameIfJoinEnvelope(parsed: unknown): CrashWsS2C | null {
  if (!parsed || typeof parsed !== "object") return null
  const o = parsed as AnyObj
  if (typeof o.type === "string" && o.type.length > 0) return null
  if (o.msg != null) return null
  if (o.room_data == null || typeof o.room_data !== "object") return null
  return normalizeDecodedMessage("s2c_join", o)
}

export interface CrashWsClientOptions {
  /**
   * 完整 ws(s) 地址。若已带 `token` / `t` / `sticket` 等鉴权 query，则 **不会再** 拼接 `opts.token`。
   */
  url: string
  /**
   * 当 `url` 无鉴权参数时追加：
   * - 若以 `token=`、`t=`、`guest=`、`sticket=` 开头或含 `&`，按「已拼好的 query 片段」原样追加
   * - 否则视为纯 token，拼成 `token=<encodeURIComponent(token)>`（Base64 含 `=` 也走此分支）
   */
  token?: string
  /** 断线后重连间隔（毫秒） */
  reconnectDelayMs?: number
  /** 最大重连次数；null 表示无限重试 */
  maxReconnectAttempts?: number | null
  /** 控制台日志前缀，便于多实例区分 */
  debugTag?: string
  /**
   * 握手超时（毫秒）。>0 时：在 `readyState === CONNECTING` 超过该时间则 `close()`，
   * 随后 `close` 事件的 `CrashWsCloseDetail.connectTimedOut === true`。
   * 浏览器无法拿到 HTTP 升级失败的状态码，超时是补充判断手段。
   */
  connectTimeoutMs?: number
  /**
   * >0 时周期性发送 `heartbeatPayload` 文本帧，避免 Nginx/负载均衡「空闲超时」在无推送阶段断连。
   * 需与服务端约定 type；不需要时设为 0。
   */
  heartbeatIntervalMs?: number
  /** 与 `heartbeatIntervalMs` 同时生效；默认 `{ type: "c2s_ping" }` */
  heartbeatPayload?: Record<string, unknown>
  /**
   * 每次 `connect` / 自动重连、且在游客 `sticket` 准备完成之后调用，用于得到最终握手 URL。
   * - 不传时保持历史行为：使用 `defaultCrashWsUrl()`（房间主端口）。
   * - 广播专线实例应传入 `defaultCrashWsBroadcastUrl` 或自定义同鉴权规则的 URL 工厂。
   */
  getConnectUrl?: () => string
}

/** `close` 事件载荷：用于区分「从未连上」与「连上后断开」 */
export interface CrashWsCloseDetail {
  code: number
  reason: string
  wasClean: boolean
  /** 本次 socket 是否曾进入 OPEN（未收到 onopen 就 close 多为网络/地址/握手失败） */
  handshakeCompleted: boolean
  /** 是否由 `connectTimeoutMs` 触发关闭 */
  connectTimedOut: boolean
}

/**
 * Crash 房间 WebSocket 封装类
 *
 * 事件订阅：
 * - `open` / `close` / `error`：连接生命周期（`close` 见 `CrashWsCloseDetail`）
 * - 任意下行 `type`：与 JSON 中 `type` 字段同名（如 `s2c_room_state`）
 * - `s2c_flying_tick`：同帧内多条合并为一次派发（见 `scheduleFlyingTickFlush`），减轻主线程与下游 Vue
 */
// --- 6) WebSocket 封装：生命周期、binary/JSON、订阅式 emit ---

export class CrashWsClient {
  /** 底层浏览器 WebSocket；close 后置 null */
  private ws: WebSocket | null = null
  /** 合并默认后的连接/重连/日志配置 + token + 可选 URL 工厂 */
  private opts: Required<Omit<CrashWsClientOptions, "token" | "getConnectUrl">> &
    Pick<CrashWsClientOptions, "token" | "getConnectUrl">
  /** `scheduleReconnect` 使用的单次定时器句柄 */
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  /** 已连续尝试次数，达 `maxReconnectAttempts` 则停止（null 上限表示无限） */
  private reconnectAttempts = 0
  /** 用户主动 close() 时为 true，不再自动重连 */
  private closedByUser = false
  /**
   * 服务端踢线（如 `s2c_kick` code 2101）后为 true：禁止自动重连、`connect()`、`resetAndConnect()`。
   * 离页 `stopCrashWsController` / 重新 `start` 会新建实例，标志重置为 false。
   */
  private suppressAutoReconnect = false
  /** 每次 `runConnect` 递增，忽略旧 socket 的晚到事件 */
  private connectGen = 0
  /** `connectTimeoutMs` 定时器 */
  private connectTimeoutTimer: ReturnType<typeof setTimeout> | null = null
  /** 本次关闭是否由连接超时触发（在 `onclose` 里读一次后清零） */
  private pendingConnectTimedOut = false
  /** 应用层保活定时器（与协议层 WebSocket ping 无关） */
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  /**
   * 飞行 tick 合并：一帧内多条 `s2c_flying_tick` 只保留最后一条再 `emit`，避免 20～50 次/s × 全链路处理。
   */
  private flyingTickFlushRaf: number = 0
  private flyingTickPending: CrashWsS2C | null = null

  public readonly connected = ref(false)
  /** 最近一次下行包里的 seq（若有） */
  public readonly lastSeq = ref<number | null>(null)

  /** 事件表：type → Set<Listener>，与协议 JSON.type 一致 */
  private listeners = new Map<string, Set<Listener<any>>>()

  constructor(options: CrashWsClientOptions) {
    this.opts = {
      url: options.url,
      reconnectDelayMs: options.reconnectDelayMs ?? 1200,
      maxReconnectAttempts: options.maxReconnectAttempts ?? null,
      debugTag: options.debugTag ?? "crash-ws",
      connectTimeoutMs: options.connectTimeoutMs ?? 0,
      token: options.token,
      heartbeatIntervalMs: options.heartbeatIntervalMs ?? 0,
      heartbeatPayload: options.heartbeatPayload ?? { type: "c2s_ping" },
      getConnectUrl: options.getConnectUrl,
    }
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat()
    const ms = this.opts.heartbeatIntervalMs
    if (!ms || ms <= 0) return
    const payload = this.opts.heartbeatPayload ?? { type: "c2s_ping" }
    this.heartbeatTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
      try {
        const type = typeof (payload as any)?.type === "string" ? String((payload as any).type) : ""
        const msgId = type ? CRASH_MSG_NAME_TO_ID[type] : undefined
        if (!msgId) {
          this.ws.send(JSON.stringify(payload))
          return
        }
        void this.sendBinaryByName(type, payload as AnyObj, msgId)
      } catch {
        /* ignore */
      }
    }, ms)
  }

  /** 开发环境打印握手 URL、重连等 */
  private log(...args: any[]) {
    if (import.meta.dev) console.log(`[${this.opts.debugTag}]`, ...args)
  }

  /** `url` 已带握手鉴权参数时不再拼 `opts.token`（避免与 `defaultCrashWsUrl()` 重复） */
  private urlAlreadyHasCrashAuth(url: string): boolean {
    if (!url.includes("?")) return false
    try {
      const normalized = url.replace(/^wss:/i, "https:").replace(/^ws:/i, "http:")
      const { searchParams } = new URL(normalized)
      return searchParams.has("token") || searchParams.has("t") || searchParams.has("sticket")
    } catch {
      return /\btoken=/.test(url) || /\bsticket=/.test(url) || /[?&]t=/.test(url)
    }
  }

  /** 调用方传入的整段 query 片段（非裸 Base64） */
  private isPreformattedQueryFragment(token: string): boolean {
    return token.includes("&") || /^(token|t|guest|sticket)=/i.test(token)
  }

  /**
   * 将 token 拼进握手 URL（符合 111.md：?token= 或 &token=）
   */
  private buildUrlWithToken(): string {
    const base = this.opts.url
    if (this.urlAlreadyHasCrashAuth(base)) return base

    const token = (this.opts.token ?? "").trim()
    if (!token) return base
    const hasQuery = base.includes("?")
    const joiner = hasQuery ? "&" : "?"
    if (this.isPreformattedQueryFragment(token)) return `${base}${joiner}${token}`
    return `${base}${joiner}token=${encodeURIComponent(token)}`
  }

  /**
   * 订阅某一类下行消息（按 JSON.type）
   * @returns 取消订阅函数
   */
  on<T = any>(type: string, cb: Listener<T>): () => void {
    const set = this.listeners.get(type) ?? new Set()
    set.add(cb as Listener<any>)
    this.listeners.set(type, set)
    return () => this.off(type, cb)
  }

  /** 与 `on` 配对；取消后若集合为空则删除 key，避免泄漏 */
  off<T = any>(type: string, cb: Listener<T>) {
    const set = this.listeners.get(type)
    if (!set) return
    set.delete(cb as Listener<any>)
    if (set.size === 0) this.listeners.delete(type)
  }

  /** 同步派发：同一 type 多订阅者串行执行 */
  private emit(type: string, payload: any) {
    const set = this.listeners.get(type)
    if (!set) return
    for (const cb of set) cb(payload)
  }

  /**
   * 下行统一派发：`s2c_flying_tick` 走 RAF 合并；其余写 `lastSeq`（若有）再 `emit`。
   * 文本帧与 binary 解码共用，避免 `onmessage` 两处复制相同分支。
   */
  private deliverIncomingS2c(msg: CrashWsS2C) {
    const t = (msg as AnyObj).type
    if (typeof t !== "string") return
    if (t === "s2c_flying_tick") {
      this.scheduleFlyingTickFlush(msg)
      return
    }
    if (typeof (msg as AnyObj).seq === "number") this.lastSeq.value = (msg as AnyObj).seq as number
    this.emit(t, msg)
  }

  private cancelFlyingTickFlush() {
    if (this.flyingTickFlushRaf !== 0) {
      cancelAnimationFrame(this.flyingTickFlushRaf)
      this.flyingTickFlushRaf = 0
    }
    this.flyingTickPending = null
  }

  /**
   * 将高频 `s2c_flying_tick` 合并到每帧至多一次派发；`msg` 为整条 JSON（含 seq）。
   */
  private scheduleFlyingTickFlush(msg: CrashWsS2C) {
    this.flyingTickPending = msg
    if (this.flyingTickFlushRaf !== 0) return
    const genAtSchedule = this.connectGen
    this.flyingTickFlushRaf = requestAnimationFrame(() => {
      this.flyingTickFlushRaf = 0
      if (genAtSchedule !== this.connectGen) {
        this.flyingTickPending = null
        return
      }
      const m = this.flyingTickPending
      this.flyingTickPending = null
      if (!m) return
      if (typeof (m as any).seq === "number") this.lastSeq.value = (m as any).seq
      this.emit("s2c_flying_tick", m)
    })
  }

  /**
   * 未登录：建连前拉取 sticket；`reconnectAttempts > 0` 时强制换票（应对握手失败/过期）。
   */
  private async prepareGuestSticketIfNeeded(): Promise<void> {
    if (loginStatus.value) return
    const { crashTemporaryToken } = await import("~/utils/hook/hook")
    await crashTemporaryToken({ force: this.reconnectAttempts > 0 })
  }

  private async waitForLoginTokenIfNeeded(): Promise<boolean> {
    if (!loginStatus.value) return true
    const token = await waitForGameUserToken()
    if (token && loginStatus.value) return true
    if (!loginStatus.value) {
      await this.prepareGuestSticketIfNeeded()
      return true
    }
    this.log("connect skipped: login token not ready")
    return false
  }

  /** 建立连接（浏览器端）；会关闭旧连接再开新连接 */
  connect() {
    if (!import.meta.client) return
    void this.runConnect()
  }

  /** 是否因踢线等原因禁止重连（供 controller 区分 close 原因） */
  isSuppressAutoReconnect(): boolean {
    return this.suppressAutoReconnect
  }

  /**
   * 踢线等业务场景：为 true 时不再 `scheduleReconnect` / `runConnect`（含 `resetAndConnect`）。
   * 重新 `false` 仅在新建 `CrashWsClient` 或显式调用时恢复（一般无需手动恢复）。
   */
  setSuppressAutoReconnect(on: boolean) {
    this.suppressAutoReconnect = on
    if (on) {
      this.clearReconnectTimer()
      this.reconnectAttempts = 0
    }
  }

  private async runConnect(): Promise<void> {
    if (!import.meta.client) return
    if (this.suppressAutoReconnect) {
      if (import.meta.dev) this.log("connect skipped (suppressAutoReconnect / kicked)")
      return
    }
    this.closedByUser = false
    this.clearReconnectTimer()
    this.stopHeartbeat()
    this.cancelFlyingTickFlush()

    try {
      await this.prepareGuestSticketIfNeeded()
      const authReady = await this.waitForLoginTokenIfNeeded()
      if (!authReady) {
        if (!this.closedByUser) this.scheduleReconnect()
        return
      }
      /** 重连时刷新 URL，保证 sessionStorage 内 token / sticket 与网关一致 */
      this.opts.url = this.opts.getConnectUrl ? this.opts.getConnectUrl() : defaultCrashWsUrl()
    } catch (e) {
      this.log("prepare guest sticket failed", e)
      if (!this.closedByUser) this.scheduleReconnect()
      return
    }

    const url = this.buildUrlWithToken()
    this.log("connect", url)

    this.clearConnectTimeoutTimer()
    this.pendingConnectTimedOut = false
    const gen = ++this.connectGen
    let handshakeCompleted = false

    this.ws?.close()
    this.ws = new WebSocket(url)
    this.ws.binaryType = "arraybuffer"

    const timeoutMs = this.opts.connectTimeoutMs
    if (timeoutMs > 0) {
      this.connectTimeoutTimer = setTimeout(() => {
        if (gen !== this.connectGen) return
        const s = this.ws
        if (s && s.readyState === WebSocket.CONNECTING) {
          this.pendingConnectTimedOut = true
          this.log("connect timeout", timeoutMs, "ms")
          try {
            s.close()
          } catch {
            /* ignore */
          }
        }
      }, timeoutMs)
    }

    this.ws.onopen = () => {
      if (gen !== this.connectGen) return
      this.clearConnectTimeoutTimer()
      handshakeCompleted = true
      this.connected.value = true
      this.reconnectAttempts = 0
      this.emit("open", undefined)
      this.startHeartbeat()
    }

    this.ws.onclose = (ev) => {
      if (gen !== this.connectGen) return
      this.clearConnectTimeoutTimer()
      const detail: CrashWsCloseDetail = {
        code: ev.code,
        reason: ev.reason,
        wasClean: ev.wasClean,
        handshakeCompleted,
        connectTimedOut: this.pendingConnectTimedOut,
      }
      this.pendingConnectTimedOut = false
      this.stopHeartbeat()
      this.connected.value = false
      if (import.meta.dev) {
        this.log("socket closed → will auto-reconnect if not user close", {
          code: ev.code,
          reason: ev.reason || "(empty)",
          wasClean: ev.wasClean,
          handshakeCompleted: detail.handshakeCompleted,
          connectTimedOut: detail.connectTimedOut,
        })
      }
      this.emit("close", detail)
      if (!this.closedByUser && !this.suppressAutoReconnect) this.scheduleReconnect()
    }

    this.ws.onerror = (e) => {
      if (gen !== this.connectGen) return
      this.emit("error", e)
    }
    // 下行：`string` → JSON 管线；`ArrayBuffer`/`Blob` → binary 管线（无 UTF-8 JSON 误解析回退）
    this.ws.onmessage = (e) => {
      const genAtMsg = gen
      const dispatchLegacyJson = (raw: string) => {
        const parsed = safeJsonParse(raw)
        if (!parsed || typeof parsed !== "object") return
        let msg = parsed as CrashWsS2C
        const coercedJoin = normalizeJsonTextFrameIfJoinEnvelope(parsed)
        if (coercedJoin) msg = coercedJoin
        msg = normalizeIncomingJsonS2cEnvelope(msg as AnyObj) as CrashWsS2C
        this.deliverIncomingS2c(msg)
      }

      const handleBinary = async (ab: ArrayBuffer) => {
        if (genAtMsg !== this.connectGen) return
        const hdr = parseCrashPacketHeader(ab)
        if (!hdr) return
        const typeName = CRASH_MSG_ID[hdr.msgId]
        if (!typeName) return
        const bytes = new Uint8Array(ab, hdr.headerLen)
        const body = await decodeCrashPayload(typeName, bytes)
        if (genAtMsg !== this.connectGen) return
        const normalized = normalizeDecodedMessage(typeName, body)
        if (!normalized) return
        // 与文本 JSON 不同：binary 已在上面的 decode+normalizeDecodedMessage 得到最终业务形状。
        // 再跑 normalizeIncomingJsonS2cEnvelope 会把 room_state 的 phase 等已归一字段当 proto 再解析一次（例如 phase 字符串 → NaN → 误判为 betting），导致飞行 tick 全丢、曲线/倒计时/下注表异常。
        const msg = normalized as CrashWsS2C
        this.deliverIncomingS2c(msg)
      }

      if (typeof e.data === "string") {
        dispatchLegacyJson(e.data)
        return
      }
      if (e.data instanceof ArrayBuffer) {
        void handleBinary(e.data)
        return
      }
      if (typeof Blob !== "undefined" && e.data instanceof Blob) {
        void e.data.arrayBuffer().then(handleBinary).catch(() => { })
      }
    }
  }

  /** 主动关闭并停止重连 */
  close() {
    this.closedByUser = true
    this.connectGen++
    this.clearReconnectTimer()
    this.clearConnectTimeoutTimer()
    this.stopHeartbeat()
    this.cancelFlyingTickFlush()
    this.connected.value = false
    try {
      this.ws?.close()
    } finally {
      this.ws = null
    }
  }

  /**
   * 用户/业务主动重连（对应旧版 carshConnect）。
   * 先以 closedByUser 关闭旧连接，避免 onclose 再触发自动重连与本次抢连冲突。
   */
  resetAndConnect() {
    if (!import.meta.client) return
    if (this.suppressAutoReconnect) {
      if (import.meta.dev) this.log("resetAndConnect skipped (suppressAutoReconnect / kicked)")
      return
    }
    this.closedByUser = true
    this.connectGen++
    this.clearReconnectTimer()
    this.clearConnectTimeoutTimer()
    this.stopHeartbeat()
    this.cancelFlyingTickFlush()
    try {
      this.ws?.close()
    } catch {
      /* ignore */
    }
    this.ws = null
    this.connected.value = false
    this.closedByUser = false
    this.reconnectAttempts = 0
    void this.runConnect()
  }

  /** 更新 token；需在下一次 connect 前调用才会生效于新连接 */
  setToken(token?: string) {
    this.opts.token = token
  }

  private buildBinaryPacket(msgId: number, payloadBytes: Uint8Array): ArrayBuffer {
    const useU16 = msgId >= 0 && msgId <= 0xffff
    const headerLen = useU16 ? 2 : 4
    const out = new Uint8Array(headerLen + payloadBytes.byteLength)
    const view = new DataView(out.buffer)
    if (useU16) view.setUint16(0, msgId, true)
    else view.setUint32(0, msgId, true)
    out.set(payloadBytes, headerLen)
    return out.buffer
  }

  private async sendBinaryByName(typeName: string, obj: AnyObj, msgId?: number): Promise<boolean> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false
    const id = msgId ?? CRASH_MSG_NAME_TO_ID[typeName]
    if (!id) return false
    try {
      const clean = coerceC2sPayloadForProto(typeName, pickProtoFields(typeName, obj))
      const payloadBytes = await encodeCrashPayload(typeName, clean)
      const pkt = this.buildBinaryPacket(id, payloadBytes)
      this.ws.send(pkt)
      return true
    } catch (e) {
      if (import.meta.dev) this.log("sendBinary failed", typeName, e)
      return false
    }
  }

  /** 发送 C2S：优先 binary(protobuf)，失败则 JSON 文本 */
  send(payload: CrashWsC2S) {
    const typeName = payload.type
    const obj: AnyObj = { ...payload }
    delete obj.type
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false
    void (async () => {
      const ok = await this.sendBinaryByName(typeName, obj)
      if (ok) return
      try {
        const picked = pickProtoFields(typeName, obj)
        const wire = coerceC2sPayloadForProto(typeName, picked)
        const jsonBody: AnyObj = { type: typeName, ...wire }
        if (obj.client_ref != null) jsonBody.client_ref = obj.client_ref
        this.ws?.send(JSON.stringify(jsonBody))
      } catch {
        /* ignore */
      }
    })()
    return true
  }

  /** 下注（仅 betting 阶段且本局未下过）；`amount` / `auto_cashout_mult` 传 UI 小数，缩放见 `coerceC2sBetForProto` */
  bet(amount: number, auto_cashout_mult = 0, client_ref?: string) {
    return this.send({ type: "c2s_bet", amount, auto_cashout_mult, client_ref })
  }

  /** 兑现（仅 flying 阶段且本局已下注未兑现） */
  cashout(client_ref?: string) {
    return this.send({ type: "c2s_cashout", client_ref })
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private clearConnectTimeoutTimer() {
    if (this.connectTimeoutTimer) {
      clearTimeout(this.connectTimeoutTimer)
      this.connectTimeoutTimer = null
    }
  }

  /**
   * 非用户关闭触发的 onclose：延迟后 `connect()`。
   * 超过 max 次则停（避免后台页疯狂重连）。
   */
  private scheduleReconnect() {
    if (this.suppressAutoReconnect) {
      if (import.meta.dev) this.log("auto-reconnect skipped (suppressAutoReconnect / kicked)")
      return
    }
    const max = this.opts.maxReconnectAttempts
    if (max != null && this.reconnectAttempts >= max) return
    this.reconnectAttempts += 1
    this.clearReconnectTimer()
    this.reconnectTimer = setTimeout(() => {
      this.connect()
    }, this.opts.reconnectDelayMs)
  }
}

/**
 * 默认房间主链路 WS（含鉴权 query），端口见 `CRASH_WS_PORT_ROOM`。
 * 玩家广播见 `defaultCrashWsBroadcastUrl`。
 */
export function defaultCrashWsUrl(): string {
  return buildCrashWsSessionUrl(CRASH_WS_PORT_ROOM)
}

/**
 * 玩家下注 / 兑现广播专用线（仅应由第二路 `CrashWsClient` 使用），端口见 `CRASH_WS_PORT_BROADCAST`。
 */
export function defaultCrashWsBroadcastUrl(): string {
  return buildCrashWsSessionUrl(CRASH_WS_PORT_BROADCAST)
}

/** 供外部或测试复用：与 `crashWsSessionUrl` 同源 */
export { buildCrashWsSessionUrl, CRASH_WS_PORT_BROADCAST, CRASH_WS_PORT_ROOM } from "./crashWsSessionUrl"
