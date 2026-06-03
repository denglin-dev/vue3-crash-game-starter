import type { CrashWsRoomState } from "../ws/crashWsClient"

export type FlyingClockState = {
  /** 最近一次视觉时钟锚点对应的飞行毫秒数；每帧都会向前滚动，避免 WS 抖动造成停顿 */
  wsElapsedMs: number
  /** 最近一次收到的服务端 tick 版本号 */
  lastWsVersion: number
  /** `wsElapsedMs` 这个视觉锚点对应的本地 performance.now() */
  lastWsTickWall: number
  /** 最近一次服务端下发的原始倍率，仅用于状态同步和兜底 */
  curWsMult: number
  /** 已经交给画布绘制过的最大飞行毫秒数，保证曲线时间单调不倒退 */
  lastRenderedElapsedMs: number
  /** 最近一次处理过的服务端权威 elapsed，用于避免同一个 WS 包在每帧重复入队校准 */
  lastAuthoritativeElapsedMs: number
  /** 服务端时间领先本地视觉时间时，拆到后续帧里慢慢补齐的正向校准量 */
  clockCorrectionMs: number
  /** 上一帧执行本地外推的 wall time，用于限制每帧最多补偿多少服务端领先量 */
  lastRenderWall: number
}

/** 与后端 Lua 一致：multiplier = e^(EXP_MS_SCALE * elapsed_ms) */
export const EXP_MS_SCALE = 0.00006

/** 预计算常量避免每次除法 */
const INV_EXP_MS_SCALE = 1 / EXP_MS_SCALE

/** 单次 WS 包最多注入到平滑校准里的毫秒数，避免网络恢复时一次性跳太远 */
const MAX_CLOCK_CORRECTION_QUEUE_MS = 300
/** 每帧最大正向校准量，保证追服务端时间时仍然是平滑加速而不是跳帧 */
const MAX_CLOCK_CORRECTION_STEP_MS = 18
/** 按上一帧间隔折算的正向校准速度，0.45 表示最多额外快 45% */
const CLOCK_CORRECTION_FRAME_RATIO = 0.45

export function multFromElapsedMs(elapsedMs: number): number {
  return Math.exp(EXP_MS_SCALE * (elapsedMs > 0 ? elapsedMs : 0))
}

/** 与 multFromElapsedMs 互逆（mult≥1） */
export function elapsedMsFromMultiplier(mult: number): number {
  const m = mult > 1 ? mult : 1
  if (m <= 1.0000001) return 0
  return Math.log(m) * INV_EXP_MS_SCALE
}

/** 线性 u=(mult-1)/(topM-1)，刻度/网格高倍区与 `multToCurveBlendNy` 搭配使用 */
export function multToLinearPlotNy(mult: number, topM: number): number {
  const top = topM > 1.001 ? topM : 1.001
  const denom = top - 1
  if (denom <= 1e-9) return 0
  const m = mult > 1 ? mult : 1
  let u = (m - 1) / denom
  if (u < 0) u = 0
  else if (u > 1) u = 1
  return u
}

/**
 * u^γ（γ>1）纵轴鼓形；供 `multToCurveBlendNy` 与曲线观感使用。
 */
export const CURVE_MULT_TO_NY_GAMMA = 1.4

export function multToDisplayNy(mult: number, topM: number, gamma: number = CURVE_MULT_TO_NY_GAMMA): number {
  const top = topM > 1.001 ? topM : 1.001
  const denom = top - 1
  const m = mult > 1 ? mult : 1
  const u = Math.max(0, Math.min(1, (m - 1) / denom))
  return Math.pow(u, gamma)
}

/**
 * 曲线绘制用：线性 + u^γ 混合（向右下鼓）。画布上请用 `multToPlotNy`：低倍顶界时自动走线性。
 * 略提高混合权重、略降低 γ，使初段更早偏离贴底直线。
 */
export const CURVE_TO_PIXEL_BULGE_BLEND = 0.52

export function multToCurveBlendNy(mult: number, topM: number): number {
  const lin = multToLinearPlotNy(mult, topM)
  const gam = multToDisplayNy(mult, topM)
  const w = CURVE_TO_PIXEL_BULGE_BLEND
  return lin * (1 - w) + gam * w
}

// 现有 multToPlotNy 改名为 multToTickNy（刻度/网格专用，始终线性）
export function multToTickNy(mult: number, topM: number): number {
  return multToLinearPlotNy(mult, topM > 1.001 ? topM : 1.001)
}

// multToPlotNy 改为始终使用鼓形混合（曲线专用）
export function multToPlotNy(mult: number, topM: number): number {
  const top = topM > 1.001 ? topM : 1.001
  return multToCurveBlendNy(mult, top)
}
/**
 * min(mult_from_elapsed_ms(elapsed), crash_point)；飞行中无 crash_point 时即为纯指数。
 */
export function plotMultForCanvas(args: { elapsedMs: number; crashPoint: number | null }): number {
  const raw = multFromElapsedMs(args.elapsedMs)
  const cp = args.crashPoint
  if (cp != null && cp >= 1 && cp === cp) { // cp === cp 替代 isFinite 减少函数调用
    return raw < cp ? raw : cp
  }
  return raw
}

export function resetFlyingClockState(state: FlyingClockState) {
  state.wsElapsedMs = 0
  state.lastWsVersion = -1
  state.lastWsTickWall = 0
  state.curWsMult = 1
  state.lastRenderedElapsedMs = 0
  state.lastAuthoritativeElapsedMs = -1
  state.clockCorrectionMs = 0
  state.lastRenderWall = 0
}

/** 从服务端包恢复权威飞行时间；elapsed_ms 与 multiplier 任一滞后时，取两者能表达的最大值。 */
function resolveAuthoritativeElapsedMs(roomState: CrashWsRoomState, multiplier: number): number | null {
  /** 服务端直接下发的飞行毫秒数，网络/窗口恢复时可能短暂滞后。 */
  const serverElapsed = roomState.elapsed_ms
  /** 根据倍率反推的飞行毫秒数，用于兜底 elapsed_ms 旧值。 */
  const multiplierElapsed = multiplier > 1.01 ? elapsedMsFromMultiplier(multiplier) : null
  if (serverElapsed != null && Number.isFinite(Number(serverElapsed))) {
    const elapsed = Math.max(0, Number(serverElapsed))
    if (multiplierElapsed != null && multiplierElapsed > elapsed) return multiplierElapsed
    return elapsed
  }
  return multiplierElapsed
}

/** 获取当前本地视觉时钟已经跑到的毫秒数，不允许低于已经渲染过的时间。 */
function currentVisualElapsedMs(state: FlyingClockState, now: number): number {
  const wallDelta = state.lastWsTickWall > 0 ? Math.max(0, now - state.lastWsTickWall) : 0
  const visual = state.wsElapsedMs + wallDelta
  return visual > state.lastRenderedElapsedMs ? visual : state.lastRenderedElapsedMs
}

/** 将服务端领先的时间差放入平滑补偿队列；服务端落后时不回拉，避免低倍曲线停顿。 */
function enqueuePositiveClockCorrection(state: FlyingClockState, authoritativeElapsed: number, visualElapsed: number) {
  const diff = authoritativeElapsed - visualElapsed
  if (diff <= 0) return
  const safeDiff = diff > MAX_CLOCK_CORRECTION_QUEUE_MS ? MAX_CLOCK_CORRECTION_QUEUE_MS : diff
  state.clockCorrectionMs = Math.min(MAX_CLOCK_CORRECTION_QUEUE_MS, state.clockCorrectionMs + safeDiff)
}

export function syncFlyingClock(
  state: FlyingClockState,
  roomState: CrashWsRoomState,
  now = performance.now()
) {
  if (roomState.phase !== "flying" || roomState.crashed) return

  const version = Number(roomState.version) || 0
  const multiplier = Math.max(1, Number(roomState.multiplier) || 1)
  const authoritativeElapsed = resolveAuthoritativeElapsedMs(roomState, multiplier)

  if (authoritativeElapsed != null) {
    if (state.lastWsVersion < 0) {
      state.curWsMult = multiplier
      state.wsElapsedMs = authoritativeElapsed
      state.lastWsTickWall = now
      state.lastWsVersion = version
      state.lastRenderedElapsedMs = authoritativeElapsed
      state.lastAuthoritativeElapsedMs = authoritativeElapsed
      state.lastRenderWall = now
      state.clockCorrectionMs = 0
      return
    }

    const authoritativeChanged =
      version !== state.lastWsVersion ||
      Math.abs(authoritativeElapsed - state.lastAuthoritativeElapsedMs) > 0.001
    if (!authoritativeChanged) {
      state.curWsMult = multiplier
      return
    }

    const visualElapsed = currentVisualElapsedMs(state, now)
    state.curWsMult = multiplier
    state.wsElapsedMs = visualElapsed
    state.lastWsTickWall = now
    if (version !== state.lastWsVersion) state.lastWsVersion = version
    state.lastAuthoritativeElapsedMs = authoritativeElapsed
    enqueuePositiveClockCorrection(state, authoritativeElapsed, visualElapsed)
    return
  }

  if (state.lastWsVersion < 0) {
    state.lastWsVersion = version
    state.lastWsTickWall = now
    state.curWsMult = multiplier
    state.wsElapsedMs = multiplier > 1.01 ? Math.log(multiplier) * INV_EXP_MS_SCALE : 0
    state.lastRenderedElapsedMs = state.wsElapsedMs
    state.lastAuthoritativeElapsedMs = state.wsElapsedMs
    state.lastRenderWall = now
    state.clockCorrectionMs = 0
    return
  }

  if (version !== state.lastWsVersion) {
    const visualElapsed = currentVisualElapsedMs(state, now)
    state.curWsMult = multiplier
    const tickMs = Math.max(1, Number(roomState.tick_interval_ms) || 100)
    const versionDelta = version - state.lastWsVersion
    const clampedDelta = versionDelta < 1 ? 1 : (versionDelta > 600 ? 600 : versionDelta)
    state.wsElapsedMs = visualElapsed
    enqueuePositiveClockCorrection(state, visualElapsed + clampedDelta * tickMs, visualElapsed)
    state.lastWsVersion = version
    state.lastWsTickWall = now
  }
}

/** 计算本帧允许消耗的正向校准量，避免一次性跳到服务端时间造成曲线抖动。 */
function consumeClockCorrectionForFrame(state: FlyingClockState, now: number): number {
  if (state.clockCorrectionMs <= 0) return 0
  const frameDelta = state.lastRenderWall > 0 ? Math.max(0, now - state.lastRenderWall) : 0
  const frameBudget = Math.max(1, Math.min(MAX_CLOCK_CORRECTION_STEP_MS, frameDelta * CLOCK_CORRECTION_FRAME_RATIO))
  const correction = state.clockCorrectionMs > frameBudget ? frameBudget : state.clockCorrectionMs
  state.clockCorrectionMs -= correction
  return correction
}

export function getFlyingMs(
  state: FlyingClockState,
  roomState: CrashWsRoomState,
  now = performance.now()
): number {
  syncFlyingClock(state, roomState, now)
  if (state.lastWsVersion < 0) return 0

  const rawDelta = now - state.lastWsTickWall
  /**
   * 必须用「距上次同步锚点」的完整墙钟差做外推，**不能**用 `tick_interval_ms` 封顶。
   * 旧逻辑 `localDelta = min(rawDelta, tickMs)` 会在 `rawDelta > tickMs` 后使
   * `candidate = wsElapsedMs + tickMs` 恒成立 → `lastRenderedElapsedMs` 无法再涨，
   * 飞行时间在两次 WS 之间周期性「冻住」，低倍下曲线几乎全靠时间推进，停顿感极强。
   */
  const localDelta = rawDelta > 0 ? rawDelta : 0
  const correction = consumeClockCorrectionForFrame(state, now)
  const candidate = state.wsElapsedMs + localDelta + correction
  if (candidate > state.lastRenderedElapsedMs) {
    state.lastRenderedElapsedMs = candidate
  }
  state.wsElapsedMs = state.lastRenderedElapsedMs
  state.lastWsTickWall = now
  state.lastRenderWall = now
  return state.lastRenderedElapsedMs
}
