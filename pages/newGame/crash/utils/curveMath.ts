export interface CurvePoint {
  time: number
  mult: number
  rawMult?: number
}

export interface ScreenPoint {
  x: number
  y: number
}

export type ToPixel = (time: number, mult: number, rawForY?: number) => ScreenPoint

/** tip 段起终点像素 Y 差小于此值则视为「纯横移」，不再追加 tip（仅用于 crashed 全路径；勿用于飞行 tip，否则阈值附近 tip 忽有忽无会抖） */
export const CURVE_TIP_DEGENERATE_Y_PX = 0.85

/**
 * 与 `appendCurveSegmentPoints` 一致：用 plot 在段两端算屏幕 Y，判断是否无垂直分量。
 */
export function isCurveTipScreenFlat(
  lastKey: CurvePoint,
  liveTipTime: number,
  liveTipRaw: number,
  toPixel: ToPixel,
  plotMultAtElapsedMs: (elapsedMs: number) => number
): boolean {
  if (liveTipTime <= lastKey.time + 1e-6) return true
  const msA = lastKey.time * 1000
  const msB = liveTipTime * 1000
  const mA = plotMultAtElapsedMs(msA)
  const mB = plotMultAtElapsedMs(msB)
  const multA = mA > 1 ? mA : 1
  const multB = mB > 1 ? mB : 1
  const rawA = lastKey.rawMult != null ? (lastKey.rawMult > 1 ? lastKey.rawMult : 1) : multA
  const rawB = liveTipRaw > 1 ? liveTipRaw : 1
  const pA = toPixel(lastKey.time, multA, rawA)
  const pB = toPixel(liveTipTime, multB, rawB)
  const dy = pB.y - pA.y
  return (dy < 0 ? -dy : dy) < CURVE_TIP_DEGENERATE_Y_PX
}

/**
 * 坠毁后折线：去掉「dx 明显增大而 dy≈0」的中间点（参数化在 crash_point 顶死后仍沿时间密采样会产生整段横线；sanitize 偶发压平 y 也会造横移）。
 * 仅剔除 dy 极小的边，避免误伤正常缓升斜率。
 */
const STRIP_HORIZ_DY_MAX = 0.22
const STRIP_HORIZ_DX_MIN = 0.04

export function stripPureHorizontalPolylineStepsInPlace(pts: ScreenPoint[]): void {
  if (pts.length < 2) return
  let w = 1
  for (let r = 1; r < pts.length; r++) {
    const prev = pts[w - 1]!
    const cur = pts[r]!
    const dx = cur.x - prev.x
    const dy = Math.abs(cur.y - prev.y)
    if (dx > STRIP_HORIZ_DX_MIN && dy <= STRIP_HORIZ_DY_MAX) {
      continue
    }
    if (w !== r) {
      pts[w].x = cur.x
      pts[w].y = cur.y
    }
    w++
  }
  pts.length = w
}

export interface CurveSampleRow {
  time: number
  mult: number
  raw: number
}

// ─── Object Pool for ScreenPoint ───────────────────────────────
// 400 段 × 每段最多 64 点 ≈ 25600；32768 足够覆盖并低于 65536 以减轻常驻内存
const SCREEN_PT_POOL_SIZE = 32768
const _screenPtPool: ScreenPoint[] = new Array(SCREEN_PT_POOL_SIZE)
let _screenPtPoolIdx = 0
for (let i = 0; i < SCREEN_PT_POOL_SIZE; i++) {
  _screenPtPool[i] = { x: 0, y: 0 }
}

/** 重置池索引（每帧开始时调用） */
export function resetScreenPointPool() {
  _screenPtPoolIdx = 0
}

/** 从池中获取一个 ScreenPoint，超出池大小时 fallback 到 new */
function allocScreenPt(x: number, y: number): ScreenPoint {
  if (_screenPtPoolIdx < SCREEN_PT_POOL_SIZE) {
    const pt = _screenPtPool[_screenPtPoolIdx++]
    pt.x = x
    pt.y = y
    return pt
  }
  return { x, y }
}

// ─── Object Pool for CurveSampleRow ────────────────────────────
/** 与 SCREEN_PT_POOL_SIZE 同量级，单次 parametric rebuild 借用上限 */
const SAMPLE_ROW_POOL_SIZE = 32768
const _sampleRowPool: CurveSampleRow[] = new Array(SAMPLE_ROW_POOL_SIZE)
for (let i = 0; i < SAMPLE_ROW_POOL_SIZE; i++) {
  _sampleRowPool[i] = { time: 0, mult: 0, raw: 0 }
}
let _sampleRowPoolNext = 0

/** 在每次 `rebuildParametricBaseRows` 开头调用，重置借用游标 */
export function resetRowPoolForParametricRebuild() {
  _sampleRowPoolNext = 0
}

function borrowSampleRow(): CurveSampleRow {
  if (_sampleRowPoolNext < SAMPLE_ROW_POOL_SIZE) {
    return _sampleRowPool[_sampleRowPoolNext++]!
  }
  return { time: 0, mult: 0, raw: 0 }
}

/** 参数化段采样选项：高倍率时可降低密度以减轻 CPU（Pixi 折线 tessellation） */
export interface ParametricSegmentOpts {
  maxSegments?: number
  multDensityMul?: number
  timeDensityMul?: number
}

/**
 * 仅生成 (time,mult,raw) 样本，使用对象池避免每次 rebuild 分配数万小对象（GC/CPU）。
 */
export function appendCurveSegmentParametricPoints(
  rows: CurveSampleRow[],
  pointA: CurvePoint,
  pointB: CurvePoint,
  includeStart: boolean,
  plotMultAtElapsedMs: (elapsedMs: number) => number,
  opts?: ParametricSegmentOpts
) {
  const dt = pointB.time - pointA.time
  if (dt < 0.0001) return

  const maxSeg = opts?.maxSegments ?? 64
  const multMul = opts?.multDensityMul ?? 16
  const timeMul = opts?.timeDensityMul ?? 32

  const multA = pointA.mult > 1 ? pointA.mult : 1
  const rawMultB = pointB.mult > multA ? pointB.mult : multA
  const multB = rawMultB > 1 ? rawMultB : 1
  const rawA = pointA.rawMult != null ? (pointA.rawMult > 1 ? pointA.rawMult : 1) : multA
  const rawB = pointB.rawMult != null ? (pointB.rawMult > 1 ? pointB.rawMult : 1) : multB

  const densityByTime = Math.ceil(dt * timeMul)
  const densityByMult = Math.ceil((multB - multA > 0 ? multB - multA : multA - multB) * multMul)
  let segments = densityByTime > densityByMult ? densityByTime : densityByMult
  if (segments < 6) segments = 6

  if (pointA.time < 0.01 && segments < 12) {
    segments = 12
  }
  if (segments > maxSeg) segments = maxSeg

  const invSegments = 1 / segments
  const startJ = includeStart ? 0 : 1
  const rawDelta = rawB - rawA

  for (let j = startJ; j <= segments; j++) {
    const ratio = j * invSegments
    const time = pointA.time + dt * ratio
    const m = plotMultAtElapsedMs(time * 1000)
    const mult = m > 1 ? m : 1
    const raw = rawA + rawDelta * ratio
    const row = borrowSampleRow()
    row.time = time
    row.mult = mult
    row.raw = raw
    rows.push(row)
  }
}

/**
 * 段内密采样 → 屏幕坐标。使用对象池减少 GC。
 * 注意：返回的 ScreenPoint 来自池，仅在当前帧有效。
 */
/** tip 段屏幕采样：高倍率时可降低 maxSegments */
export interface CurveSegmentScreenOpts {
  maxSegments?: number
}

export function appendCurveSegmentPoints(
  pts: ScreenPoint[],
  pointA: CurvePoint,
  pointB: CurvePoint,
  includeStart: boolean,
  toPixel: ToPixel,
  plotMultAtElapsedMs: (elapsedMs: number) => number,
  screenOpts?: CurveSegmentScreenOpts
) {
  const dt = pointB.time - pointA.time
  if (dt < 0.0001) return

  const capSeg = screenOpts?.maxSegments ?? 80

  const multA = pointA.mult > 1 ? pointA.mult : 1
  const rawMultB = pointB.mult > multA ? pointB.mult : multA
  const multB = rawMultB > 1 ? rawMultB : 1
  const rawA = pointA.rawMult != null ? (pointA.rawMult > 1 ? pointA.rawMult : 1) : multA
  const rawB = pointB.rawMult != null ? (pointB.rawMult > 1 ? pointB.rawMult : 1) : multB

  const _pA = toPixel(pointA.time, multA, rawA)
  const pAx = _pA.x, pAy = _pA.y
  const _pB = toPixel(pointB.time, multB, rawB)
  const dxPx = _pB.x - pAx
  const dyPx = _pB.y - pAy
  const absDx = dxPx > 0 ? dxPx : -dxPx
  const absDy = dyPx > 0 ? dyPx : -dyPx
  const densityByDistance = Math.ceil((absDx / 6 > absDy / 5 ? absDx / 6 : absDy / 5))
  const densityByTime = Math.ceil(dt * 32)
  let segments = densityByDistance > densityByTime ? densityByDistance : densityByTime
  if (segments < 6) segments = 6
  if (pointA.time < 0.01 && segments < 12) segments = 12
  if (segments > capSeg) segments = capSeg

  const invSegments = 1 / segments
  const startJ = includeStart ? 0 : 1
  const rawDelta = rawB - rawA

  for (let j = startJ; j <= segments; j++) {
    const ratio = j * invSegments
    const time = pointA.time + dt * ratio
    const m = plotMultAtElapsedMs(time * 1000)
    const mult = m > 1 ? m : 1
    const raw = rawA + rawDelta * ratio
    const p = toPixel(time, mult, raw)
    pts.push(allocScreenPt(p.x, p.y))
  }
}

export function normalizeAngleDiff(target: number, current: number): number {
  let diff = target - current
  // 用 if 替代 while，因为 diff 不会超过 2*PI 范围太多
  if (diff > Math.PI) diff -= Math.PI * 2
  else if (diff < -Math.PI) diff += Math.PI * 2
  return diff
}

const ROCKET_TANGENT_MIN_SEG_LEN_SQ = 900
const ROCKET_ANGLE_SMOOTH = 0.08
const ROCKET_MAX_ANGLE_STEP_RAD = 0.03

/** 复用返回对象，避免每帧分配 */
const _rocketPoseResult = { x: 0, y: 0, angle: 0 }

export function getRocketPoseFromPoints(
  pts: ScreenPoint[],
  currentAngle: number
): { x: number; y: number; angle: number } | null {
  const len = pts.length
  if (len === 0) return null

  const tip = pts[len - 1]
  const tipX = tip.x, tipY = tip.y
  let targetAngle = currentAngle
  let found = false

  for (let i = len - 2; i >= 0; i--) {
    const prev = pts[i]
    const dx = tipX - prev.x
    const dy = tipY - prev.y
    if (dx * dx + dy * dy < ROCKET_TANGENT_MIN_SEG_LEN_SQ) continue
    targetAngle = Math.atan2(dy, dx)
    found = true
    break
  }

  if (!found && len >= 2) {
    const look = len / 5 | 0
    const clampedLook = look < 4 ? 4 : (look > 24 ? 24 : look)
    const j = len - 1 - clampedLook
    const idx = j > 0 ? j : 0
    const prev = pts[idx]
    targetAngle = Math.atan2(tipY - prev.y, tipX - prev.x)
  }

  const angleDiff = normalizeAngleDiff(targetAngle, currentAngle)
  let step = angleDiff * ROCKET_ANGLE_SMOOTH
  if (step > ROCKET_MAX_ANGLE_STEP_RAD) step = ROCKET_MAX_ANGLE_STEP_RAD
  else if (step < -ROCKET_MAX_ANGLE_STEP_RAD) step = -ROCKET_MAX_ANGLE_STEP_RAD

  _rocketPoseResult.x = tipX
  _rocketPoseResult.y = tipY
  _rocketPoseResult.angle = currentAngle + step
  return _rocketPoseResult
}

/**
 * 裁剪描边末端。复用静态数组避免每帧 slice()。
 * 返回的数组在下次调用时失效（复用同一内存）。
 */
let _trimmedPtsCache: ScreenPoint[] = []
const _trimmedLastPt: ScreenPoint = { x: 0, y: 0 }

export function getTrimmedStrokePts(
  pts: ScreenPoint[],
  lineWidth: number,
  trimDistance: number
): ScreenPoint[] {
  if (pts.length < 2 || trimDistance <= 0) return pts

  const last = pts[pts.length - 1]
  for (let i = pts.length - 2; i >= 0; i--) {
    const prev = pts[i]
    const dx = last.x - prev.x
    const dy = last.y - prev.y
    const segmentLength = Math.hypot(dx, dy)
    if (segmentLength <= 0.001) continue

    const maxTrim = segmentLength - lineWidth * 0.2
    const appliedTrim = trimDistance < maxTrim ? trimDistance : (maxTrim > 0 ? maxTrim : 0)
    if (appliedTrim <= 0) return pts

    const invLen = 1 / segmentLength
    _trimmedLastPt.x = last.x - dx * invLen * appliedTrim
    _trimmedLastPt.y = last.y - dy * invLen * appliedTrim

    // 复用数组：仅在长度变化时重新分配引用
    const targetLen = pts.length
    if (_trimmedPtsCache.length !== targetLen) {
      _trimmedPtsCache = new Array(targetLen)
    }
    for (let k = 0; k < targetLen - 1; k++) {
      _trimmedPtsCache[k] = pts[k]
    }
    _trimmedPtsCache[targetLen - 1] = _trimmedLastPt
    return _trimmedPtsCache
  }

  return pts
}

/** 复用数组：getCurveScreenPoints 需要 base+tip 合并时避免每帧 new */
let _fullPtsScratch: ScreenPoint[] = []

/**
 * 生成完整曲线屏幕点（兼容旧接口，保留用于 crashed/一次性场景）。
 *
 * ⚠️ 飞行阶段请优先使用 getCurveTipScreenPoints() + getCachedBasePts() 分段绘制，
 *    可消除每帧 ~25000 点的数组拷贝与对象分配。
 */
export function getCurveScreenPoints(args: {
  curveData: CurvePoint[]
  liveTipTime: number
  liveTipMult: number
  liveTipRaw: number
  toPixel: ToPixel
  getCachedBasePts: () => ScreenPoint[]
  plotMultAtElapsedMs: (elapsedMs: number) => number
  screenSegmentOpts?: CurveSegmentScreenOpts
  /**
   * 坠毁阶段传入 `crash_point`：若末段与 tip 端显示倍率都已顶在该值上，则时间再增只会产生纯横移，禁止追加 tip。
   */
  crashClampMult?: number | null
}): ScreenPoint[] {
  const { curveData, liveTipTime, liveTipMult, liveTipRaw, toPixel, getCachedBasePts, plotMultAtElapsedMs } = args
  if (curveData.length < 1) return []

  const basePts = getCachedBasePts()

  if (curveData.length === 1) {
    const p0 = curveData[0]
    const tp = toPixel(p0.time, p0.mult, p0.rawMult ?? p0.mult)
    return [allocScreenPt(tp.x, tp.y)]
  }

  const lastKey = curveData[curveData.length - 1]
  const needTipSegment = lastKey && liveTipTime > lastKey.time + 0.001

  if (!needTipSegment) {
    return basePts
  }

  const cm = args.crashClampMult
  if (cm != null && cm >= 1 && cm === cm && lastKey) {
    const capTol = Math.max(1e-7, 1e-9 * cm)
    const pAtLast = plotMultAtElapsedMs(lastKey.time * 1000)
    const pAtTip = plotMultAtElapsedMs(liveTipTime * 1000)
    if (Math.abs(pAtLast - cm) < capTol && Math.abs(pAtTip - cm) < capTol) {
      return basePts
    }
  }

  if (isCurveTipScreenFlat(lastKey, liveTipTime, liveTipRaw, toPixel, plotMultAtElapsedMs)) {
    return basePts
  }

  // 需要追加 liveTip 段：复用静态数组拷贝 basePts，再 append
  if (_fullPtsScratch.length < basePts.length) {
    _fullPtsScratch.length = basePts.length
  }
  for (let i = 0; i < basePts.length; i++) {
    if (!_fullPtsScratch[i]) _fullPtsScratch[i] = { x: 0, y: 0 }
    _fullPtsScratch[i].x = basePts[i].x
    _fullPtsScratch[i].y = basePts[i].y
  }
  _fullPtsScratch.length = basePts.length
  const pts = _fullPtsScratch

  const tipRaw = liveTipRaw > 1 ? liveTipRaw : 1

  appendCurveSegmentPoints(
    pts,
    lastKey,
    { time: liveTipTime, mult: liveTipMult, rawMult: tipRaw },
    pts.length === 0,
    toPixel,
    plotMultAtElapsedMs,
    args.screenSegmentOpts
  )

  return pts
}

/**
 * 仅生成 tip 段屏幕点（飞行阶段专用）。
 * 返回的点数量通常 <100，避免每帧拷贝整个 basePts 数组（~25000+点）。
 * 调用方应自行将 basePts 与 tipPts 拼接后绘制。
 */
/** 复用 tip 段屏幕点数组，避免每帧 new */
let _tipPtsScratch: ScreenPoint[] = []

export function getCurveTipScreenPoints(args: {
  curveData: CurvePoint[]
  liveTipTime: number
  liveTipMult: number
  liveTipRaw: number
  toPixel: ToPixel
  plotMultAtElapsedMs: (elapsedMs: number) => number
  screenSegmentOpts?: CurveSegmentScreenOpts
}): ScreenPoint[] {
  const { curveData, liveTipTime, liveTipMult, liveTipRaw, toPixel, plotMultAtElapsedMs, screenSegmentOpts } = args
  if (curveData.length < 2) return []

  const lastKey = curveData[curveData.length - 1]
  /**
   * 飞行段 tip（尖端）：
   * - 旧阈值用 `+0.001`（1ms）会在低倍数阶段出现 “tip 忽有忽无” 的抖动（UI 观感像轻微卡顿）。
   * - 原因：`curveData` 的 keyframe 推进与渲染帧率不同步时，`liveTipTime` 与 `lastKey.time` 可能频繁落在阈值附近，
   *   导致部分帧直接返回空 tip，`GameCanvas` 每帧在 “画 tip / clear tip” 间切换。
   *
   * 这里将阈值收紧到更小的 epsilon：只在几乎完全相等时才认为“不需要 tip 段”，
   * 其余情况让 tip 生成交给 `appendCurveSegmentPoints(dt<0.0001)` 的安全门槛处理。
   */
  if (!lastKey || liveTipTime <= lastKey.time + 1e-6) return []

  const tipRaw = liveTipRaw > 1 ? liveTipRaw : 1
  _tipPtsScratch.length = 0

  appendCurveSegmentPoints(
    _tipPtsScratch,
    lastKey,
    { time: liveTipTime, mult: liveTipMult, rawMult: tipRaw },
    true,
    toPixel,
    plotMultAtElapsedMs,
    screenSegmentOpts
  )

  return _tipPtsScratch
}
