/**
 * Crash 画布坐标轴刻度（纯函数，无 Vue 依赖）。
 * 由 GameCanvas 在「量化后的显示范围」变化时调用，避免每帧 computed 抖动。
 */

import { multToLinearPlotNy, multToPlotNy } from "../utils/flightMath"

export type CrashAxisTick = { value: number; label: string; position: number }

/**
 * Y 轴倍率刻度文案：高倍用整数/k 缩写，减少大数值时标签堆积与宽度。
 */
export function formatYMultiplierLabel(v: number): string {
    if (!Number.isFinite(v)) return ""
    if (Math.abs(v - 1) < 1e-9) return ""
    if (v >= 1000) {
        const k = v / 1000
        return k >= 10 ? `${Math.round(k)}kx` : `${k.toFixed(1)}kx`
    }
    if (v >= 100) return `${Math.round(v)}x`
    if (v >= 10) return `${Math.round(v)}x`
    if (Math.abs(v % 1) < 1e-6 || Math.abs(v - Math.round(v)) < 1e-6) return `${Math.round(v)}x`
    return `${v.toFixed(1)}x`
}

export function getNiceStep(range: number): number {
    if (!Number.isFinite(range) || range <= 0) return 1
    const magnitude = Math.pow(10, Math.floor(Math.log10(range)))
    const normalized = range / magnitude
    if (normalized <= 2) return magnitude * 0.5
    if (normalized <= 5) return magnitude * 1
    return magnitude * 2
}

/**
 * 在 [minV, maxV] 上生成约 desiredCount 条刻度时的「漂亮步长」（1/2/5×10^n）。
 */
export function niceStepForAxisSpan(span: number, desiredCount: number): number {
    if (!Number.isFinite(span) || span <= 0) return 1
    const n = Math.max(2, Math.floor(desiredCount))
    const rough = span / n
    const pow10 = Math.pow(10, Math.floor(Math.log10(rough)))
    const frac = rough / pow10
    let niceFrac = 1
    if (frac <= 1.5) niceFrac = 1
    else if (frac <= 3) niceFrac = 2
    else if (frac <= 7) niceFrac = 5
    else niceFrac = 10
    return niceFrac * pow10
}

export type BuildYAxisTicksOptions = {
    /** 可选：强制最顶刻度文案，避免 HUD+0.5 被格式化成整数 */
    topAuthorityLabel?: string
}

/** 左侧倍数轴固定档位数：仅更新文案与数值，无合并/缓动 */
export const Y_AXIS_FIXED_TICK_COUNT = 5

/**
 * 低倍 1〜2×：六条刻度；Y 像素与曲线同用 `multToPlotNy`（顶界≤2.05 时为减弱版鼓形混合）。
 */
export const LOW_BAND_Y_AXIS_TICK_MULTS = [1, 1.2, 1.4, 1.6, 1.8, 2.0] as const

/**
 * 低倍 1〜2×：六条刻度线位置；仅显示 5 个文案（不显示底端 1x）。`position` 与 `GameCanvas.toPixel` 一致。
 */
export function buildYAxisTicksLowBandLinearSix(
    axisTop: number,
    plotBv: number,
    safePlotH: number,
    nudgeY: number
): CrashAxisTick[] {
    const hi = axisTop > 1.001 ? axisTop : 1.001
    const h = Math.max(safePlotH, 1e-6)
    const out: CrashAxisTick[] = []
    for (const v of LOW_BAND_Y_AXIS_TICK_MULTS) {
        const ny = multToPlotNy(v, hi)
        const position = plotBv - ny * h - nudgeY
        let label: string
        if (Math.abs(v - 1) < 1e-9) label = ""
        else if (Math.abs(v - 2) < 1e-9) label = "2x"
        else label = formatYMultiplierLabel(v)
        out.push({ value: v, label, position })
    }
    return out
}

/**
 * 固定 5 条左侧倍数刻度：高倍区等分倍数；像素与线性纵轴一致（与曲线 toPixel 高倍段一致）。
 */
export function buildYAxisTicksFixedFive(
    minY: number,
    maxY: number,
    plotBv: number,
    safePlotH: number,
    nudgeY: number
): CrashAxisTick[] {
    const lo = Math.max(minY, 1)
    const hi = Math.max(maxY, lo + 1e-6)
    const den = hi - lo
    const h = Math.max(safePlotH, 1e-6)
    const yFor = (v: number) => plotBv - multToLinearPlotNy(v, hi) * h - nudgeY
    const n = Y_AXIS_FIXED_TICK_COUNT
    const out: CrashAxisTick[] = []
    for (let i = 0; i < n; i++) {
        const t = i / (n - 1)
        const v = lo + den * t
        const label = Math.abs(v - 1) < 1e-6 ? "1x" : formatYMultiplierLabel(v)
        out.push({ value: v, label, position: yFor(v) })
    }
    return out
}

/**
 * 横轴（时间）、纵轴（倍率）刻度合并共用：相邻标签最小像素间距，越大越稀疏。
 * 与 buildXAxisTicks 中 merge 所用公式一致。
 */
export function getAxisTickMergeGapPx(graphExtentPx: number, span: number): number {
    const g = Math.max(graphExtentPx, 1)
    const s = Math.max(span, 1e-6)
    const tier = s > 120 ? 28 : s > 80 ? 22 : s > 40 ? 16 : s > 15 ? 12 : 8
    const gap = g / 8 + tier
    return Math.min(96, Math.max(56, gap))
}

/** merge 之后钉死顶刻度像素与数值（对应时间轴 merge 后钉右端），去掉与顶重叠的候选避免叠字 */
function applyPinnedTopAfterMerge(
    merged: CrashAxisTick[],
    effectiveMax: number,
    paddingTop: number,
    topAuthorityLabel?: string
): CrashAxisTick[] {
    const topPos = paddingTop
    const label = topAuthorityLabel ?? formatYMultiplierLabel(effectiveMax)
    const pruned = merged.filter((t) => Math.abs(t.position - topPos) > 6)
    pruned.push({ value: effectiveMax, label, position: topPos })
    pruned.sort((a, b) => a.position - b.position)
    return pruned
}

/**
 * @param maxY — GameCanvas 中 Y 轴映射上界（与曲线包络一致）。
 * 实现路径与 buildXAxisTicks 一致：span 分档步长 → raw → mergeXAxisTicksByPixelGap → 钉顶。
 */
export function buildYAxisTicks(
    maxY: number,
    minY: number,
    graphHeight: number,
    paddingTop: number,
    /** 低倍阶段固定顶到 2x */
    lockLowBand: boolean,
    options?: BuildYAxisTicksOptions
): CrashAxisTick[] {
    const effectiveMax = lockLowBand ? 2.0 : maxY
    const linearDen = Math.max(effectiveMax - minY, 1e-6)
    /** 与时间轴 span=max(maxTime,8) 类似：避免极窄区间时步长逻辑失真 */
    const span = Math.max(linearDen, 0.25)
    const g = Math.max(graphHeight, 1)

    const yFor = (v: number) => paddingTop + (1 - (v - minY) / linearDen) * graphHeight

    /** 低倍锁区：固定枚举刻度，不做像素合并（合并会随 minGap/span 抖动而随机丢刻度，最低可见倍数会跳） */
    if (lockLowBand) {
        const preset = [1, 1.2, 1.4, 1.6, 1.8] as const
        const raw: CrashAxisTick[] = []
        for (const value of preset) {
            if (value < minY - 1e-9 || value > effectiveMax + 1e-9) continue
            raw.push({
                value,
                label: Math.abs(value - 1) < 1e-9 ? "" : formatYMultiplierLabel(value),
                position: yFor(value),
            })
        }
        return applyPinnedTopAfterMerge(raw, effectiveMax, paddingTop, options?.topAuthorityLabel)
    }

    /** 非锁区：步长分档与 buildXAxisTicks 的 stepSec 分档同一风格 → raw → merge → 钉顶 */
    let step = 0.2
    if (span > 180) step = 20
    else if (span > 120) step = 10
    else if (span > 80) step = 5
    else if (span > 50) step = 4
    else if (span > 25) step = 2
    else if (span > 12) step = 1
    else if (span > 4) step = 0.5

    const minGapPx = getAxisTickMergeGapPx(g, span)
    const raw: CrashAxisTick[] = []
    const nMax = Math.min(5000, Math.ceil((effectiveMax - minY) / step) + 2)
    for (let i = 0; i <= nMax; i++) {
        const value = Math.round((minY + i * step) * 1e6) / 1e6
        if (value > effectiveMax + 1e-6) break
        raw.push({
            value,
            label: Math.abs(value - 1) < 1e-9 ? "" : formatYMultiplierLabel(value),
            position: yFor(value),
        })
    }

    const merged = mergeXAxisTicksByPixelGap(raw, minGapPx)
    if (merged.length === 0) return applyPinnedTopAfterMerge(raw, effectiveMax, paddingTop, options?.topAuthorityLabel)
    return applyPinnedTopAfterMerge(merged, effectiveMax, paddingTop, options?.topAuthorityLabel)
}

/** 时间轴默认步长（秒） */
const X_AXIS_BASE_STEP_SEC = 2

/** 默认短视窗（约 11s）横轴刻度秒数：与曲线时间轴同一套 span 映射到像素，单独一支显式计算 */
const X_AXIS_SHORT_WINDOW_TICK_SEC = [0, 2, 4, 6, 8, 10] as const

/** 与 buildXAxisTicks 中分档一致，用于判断「上一帧刻度是否仍属于当前步长网格」 */
export function getXAxisStepSecForSpan(span: number): number {
    const s = Math.max(span, 8)
    let stepSec = X_AXIS_BASE_STEP_SEC
    if (s > 180) stepSec = 20
    else if (s > 120) stepSec = 10
    else if (s > 80) stepSec = 5
    else if (s > 50) stepSec = 4
    return stepSec
}

function isStepAlignedToXAxisGrid(value: number, stepSec: number): boolean {
    const q = Math.round(value / stepSec) * stepSec
    return Math.abs(value - q) < 0.05 * Math.max(1, stepSec)
}

/**
 * 像素距不足时优先保留「上一帧已出现」的刻度，减轻合并抖动导致的标签忽隐忽现。
 */
function mergeXAxisTicksPreferStable(
    sortedByX: CrashAxisTick[],
    minGapPx: number,
    prevValueSet: Set<number>
): CrashAxisTick[] {
    sortedByX.sort((a, b) => a.position - b.position)
    const out: CrashAxisTick[] = []
    let lastPx = -Infinity
    for (const t of sortedByX) {
        if (out.length === 0 || t.position - lastPx >= minGapPx) {
            out.push(t)
            lastPx = t.position
        } else {
            const last = out[out.length - 1]!
            const tStable = prevValueSet.has(t.value)
            const lStable = prevValueSet.has(last.value)
            if (tStable && !lStable) {
                out[out.length - 1] = t
                lastPx = t.position
            }
            // else 保留左侧 last（含双稳定时），避免来回换边
        }
    }
    return out
}

function finalizeXAxisTicksWithStable(
    merged: CrashAxisTick[],
    span: number,
    paddingLeft: number,
    graphWidth: number,
    minGapPx: number,
    stepSec: number,
    previousTicks: CrashAxisTick[] | undefined
): CrashAxisTick[] {
    if (!previousTicks?.length) return merged
    const w = Math.max(graphWidth, 1)
    const prevSet = new Set(previousTicks.map((x) => x.value))
    const prevAligned = previousTicks.filter(
        (p) => p.value >= -1e-6 && p.value <= span + 1e-3 && isStepAlignedToXAxisGrid(p.value, stepSec)
    )
    const byValue = new Map<number, CrashAxisTick>()
    for (const t of merged) {
        byValue.set(t.value, t)
    }
    for (const p of prevAligned) {
        if (!byValue.has(p.value)) {
            const pos = paddingLeft + (p.value / span) * w
            byValue.set(p.value, {
                value: p.value,
                label: `${Math.round(p.value)}s`,
                position: pos,
            })
        }
    }
    const candidates = Array.from(byValue.values())
    return mergeXAxisTicksPreferStable(candidates, minGapPx, prevSet)
}

function mergeXAxisTicksByPixelGap(
    raw: CrashAxisTick[],
    minGapPx: number
): CrashAxisTick[] {
    raw.sort((a, b) => a.position - b.position)
    const merged: CrashAxisTick[] = []
    let lastPx = -Infinity
    for (const t of raw) {
        if (merged.length === 0 || t.position - lastPx >= minGapPx) {
            merged.push(t)
            lastPx = t.position
        }
    }
    return merged
}

/**
 * 横轴刻度：分母 span=max(maxTime,8) 与曲线 toPixel 时间一致；
 * 短视窗（8s<span<12s、步长 2s）显式生成 0,2,4,6,8,10s 并按 value/span 映射像素；
 * 更长区间按步长扫描，过密时按像素合并。
 * 不再在右缘单独钉「当前 span」秒数，避免出现右下角闪现的一条；
 * 若传入 previousTicks，在像素冲突时优先保留上一帧已显示的步长对齐刻度，减少标签忽隐忽现。
 */
export function buildXAxisTicks(
    maxTime: number,
    paddingLeft: number,
    graphWidth: number,
    previousTicks?: CrashAxisTick[] | null
): CrashAxisTick[] {
    const mt = Math.max(maxTime, 1e-6)
    const span = Math.max(mt, 8)
    const w = Math.max(graphWidth, 1)

    const stepSec = getXAxisStepSecForSpan(span)

    const minGapPx = getAxisTickMergeGapPx(w, span)

    if (stepSec === X_AXIS_BASE_STEP_SEC && span > 8 && span < 12) {
        const raw: CrashAxisTick[] = X_AXIS_SHORT_WINDOW_TICK_SEC.map((value) => ({
            value,
            label: `${value}s`,
            position: paddingLeft + (value / span) * w,
        }))
        const merged = mergeXAxisTicksByPixelGap(raw, minGapPx)
        const base = merged.length > 0 ? merged : raw
        return finalizeXAxisTicksWithStable(base, span, paddingLeft, w, minGapPx, 2, previousTicks ?? undefined)
    }

    const raw: CrashAxisTick[] = []
    for (let v = 0; v <= span + 1e-6; v += stepSec) {
        const value = Math.min(v, span)
        const position = paddingLeft + (value / span) * w
        raw.push({
            value,
            label: `${Math.round(value)}s`,
            position,
        })
    }

    const merged = mergeXAxisTicksByPixelGap(raw, minGapPx)
    if (merged.length === 0) {
        return finalizeXAxisTicksWithStable(raw, span, paddingLeft, w, minGapPx, stepSec, previousTicks ?? undefined)
    }
    return finalizeXAxisTicksWithStable(merged, span, paddingLeft, w, minGapPx, stepSec, previousTicks ?? undefined)
}

/** 低倍区横向网格：仅与刻度文案一致（1～1.8），不再单独画 2.0 线避免「有线无字」 */
export const DEFAULT_LOW_BAND_GRID_MULTS = [1, 1.2, 1.4, 1.6, 1.8] as const
