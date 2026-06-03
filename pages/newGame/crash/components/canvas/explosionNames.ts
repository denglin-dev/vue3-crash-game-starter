import { Container, Text } from "pixi.js"

/**
 * 爆炸昵称粒子控制器 —— 从 `GameCanvas.vue` 抽离。
 *
 * 功能概述
 * - 在爆炸点（曲线末端）生成若干昵称粒子；
 * - 粒子以“向四面八方径向飞出 + 轻微旋转 + 淡入淡出”的方式呈现；
 * - 仅展示“本局未逃离且确实下注”的玩家昵称（下注金额<=0 或无效会过滤）；
 * - 展示数量上限（默认 14）；超出时最后一项用 `+N` 汇总。
 *
 * 为什么抽离
 * - 这块与曲线/火箭/下注掉落相互独立，但实现细节较长、可单独维护；
 * - 抽离后 `GameCanvas.vue` 只负责在“爆炸发生时”调用 `spawn()`，并在 ticker 每帧 `tick()`。
 *
 * 设计约束（保持旧行为）
 * - 粒子总时长、淡入/淡出时长、初速度范围、阻尼、弹出缩放曲线均保持一致；
 * - 渲染使用 Pixi `Text`，并带 dropShadow；
 * - 清理必须彻底：每局 reset / 组件卸载时要销毁粒子容器，避免内存增长。
 */

export type ExplosionNamesDeps = {
  /** 爆炸昵称挂载到此 layer（通常为 `app.stage` 下的一个 Container）。 */
  layer: Container
  /** 外部提供：收集本次要展示的昵称数组（已完成过滤/截断/去空）。 */
  collectLabels: () => string[]
  /** 外部提供：用于根据火箭半径估算粒子整体缩放（与旧实现一致）。 */
  getRocketVectorRadiusPx: () => number
}

export type ExplosionNamesOptions = {
  maxLabels?: number
  particleMs?: number
  fadeInMs?: number
  fadeOutMs?: number
  burstHeadStartS?: number
  speedMinPx?: number
  speedMaxPx?: number
  drag?: number
  popMs?: number
  spinMax?: number
}

type Particle = {
  root: Container
  vx: number
  vy: number
  vr: number
  start: number
  peakAlpha: number
  baseScale: number
}

export type ExplosionNamesController = {
  /** 初始化后调用：必要时可创建内部状态（当前实现无额外初始化动作）。 */
  init: () => void
  /** 在爆炸发生时调用：以 (cx,cy) 为中心生成粒子。 */
  spawn: (cx: number, cy: number) => void
  /** 每帧调用：推进粒子位置/透明度，并在寿命结束时销毁。 */
  tick: (deltaMs: number, nowWallMs?: number) => void
  /** 清空并销毁所有粒子。 */
  clear: () => void
  /** 卸载：销毁内部引用（与 clear 类似，但允许调用方后续丢弃 controller）。 */
  destroy: () => void
}

export function createExplosionNamesController(deps: ExplosionNamesDeps, opts: ExplosionNamesOptions = {}): ExplosionNamesController {
  const MAX_LABELS = opts.maxLabels ?? 14
  const PARTICLE_MS = opts.particleMs ?? 1900
  const FADE_IN_MS = opts.fadeInMs ?? 100
  const FADE_OUT_MS = opts.fadeOutMs ?? 620
  const BURST_HEAD_START_S = opts.burstHeadStartS ?? 0.018
  const SPEED_MIN_PX = opts.speedMinPx ?? 78
  const SPEED_MAX_PX = opts.speedMaxPx ?? 155
  const DRAG = opts.drag ?? 0.997
  const POP_MS = opts.popMs ?? 160
  const SPIN_MAX = opts.spinMax ?? 1.05

  const particles: Particle[] = []

  const clear = () => {
    for (const p of particles) {
      try { p.root.destroy({ children: true }) } catch { /* ignore */ }
    }
    particles.length = 0
  }

  const textStyle = (fs: number) => ({
    fontFamily: "Manrope, system-ui, sans-serif",
    fontSize: fs,
    fontWeight: "700" as const,
    fill: 0xfb7185,
    align: "center" as const,
    letterSpacing: 0.35,
    dropShadow: {
      alpha: 0.62,
      angle: Math.PI / 2,
      blur: 4,
      color: 0x020617,
      distance: 0,
    },
  })

  const normalizeLabels = (raw: string[]): string[] => {
    const list = raw.filter((s) => (s && String(s).trim().length > 0)).map((s) => String(s).trim())
    if (list.length <= MAX_LABELS) return list
    const head = list.slice(0, MAX_LABELS - 1)
    head.push(`+${list.length - (MAX_LABELS - 1)}`)
    return head
  }

  const spawn = (cx: number, cy: number) => {
    clear()
    const labels = normalizeLabels(deps.collectLabels())
    if (labels.length === 0) return

    // 与旧逻辑一致：根据火箭矢量半径估算粒子整体缩放
    const rPx = deps.getRocketVectorRadiusPx()
    const scale = Math.max(0.55, Math.min(1.35, rPx / 24))
    const spMin = SPEED_MIN_PX * scale
    const spMax = SPEED_MAX_PX * scale
    const head = BURST_HEAD_START_S

    const n = labels.length
    for (let i = 0; i < n; i++) {
      // 均匀铺满 360°，再加少量随机扰动，保证「四面八方」
      const baseAng = n > 1 ? ((i + 0.5) / n) * Math.PI * 2 : Math.random() * Math.PI * 2
      const ang = baseAng + (Math.random() - 0.5) * 0.55
      const speed = spMin + Math.random() * (spMax - spMin)
      const cos = Math.cos(ang)
      const sin = Math.sin(ang)
      const vx = cos * speed
      const vy = sin * speed

      const fs = Math.max(11, Math.round(12 * scale))
      const baseScale = 1
      const label = labels[i]!
      const root = new Container()
      root.x = cx + vx * head
      root.y = cy + vy * head
      root.scale.set(0.38 * baseScale)
      root.alpha = 0

      const txt = new Text({ text: label, style: textStyle(fs) })
      txt.anchor.set(0.5, 0.5)
      txt.x = 0
      txt.y = 0
      txt.eventMode = "none"
      root.addChild(txt)

      const vr = (Math.random() * 2 - 1) * SPIN_MAX

      deps.layer.addChild(root)
      particles.push({
        root,
        vx,
        vy,
        vr,
        start: performance.now(),
        peakAlpha: 0.84 + Math.random() * 0.12,
        baseScale,
      })
    }
  }

  const tick = (deltaMs: number, nowWallMs = performance.now()) => {
    if (particles.length === 0) return
    const dt = Math.max(0.001, Math.min(48, deltaMs) / 1000)
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]!
      const elapsed = nowWallMs - p.start
      const r = p.root

      r.x += p.vx * dt
      r.y += p.vy * dt
      p.vx *= DRAG
      p.vy *= DRAG
      r.rotation += p.vr * dt
      p.vr *= 0.9985

      // pop scale
      if (elapsed < POP_MS) {
        const u = elapsed / POP_MS
        const ease = 1 - (1 - u) * (1 - u)
        const s = (0.38 + 0.62 * ease) * p.baseScale
        r.scale.set(s)
      } else {
        const fadeOutStart = PARTICLE_MS - FADE_OUT_MS
        if (elapsed > fadeOutStart) {
          const u = (elapsed - fadeOutStart) / FADE_OUT_MS
          const shrink = Math.max(0.55, 1 - u * 0.45)
          r.scale.set(p.baseScale * shrink)
        } else {
          r.scale.set(p.baseScale)
        }
      }

      // alpha
      if (elapsed < FADE_IN_MS) {
        r.alpha = (elapsed / FADE_IN_MS) * p.peakAlpha
      } else if (elapsed < PARTICLE_MS - FADE_OUT_MS) {
        r.alpha = p.peakAlpha
      } else {
        const u = (elapsed - (PARTICLE_MS - FADE_OUT_MS)) / FADE_OUT_MS
        r.alpha = p.peakAlpha * Math.max(0, 1 - u)
      }

      if (elapsed >= PARTICLE_MS) {
        try { r.destroy({ children: true }) } catch { /* ignore */ }
        particles.splice(i, 1)
      }
    }
  }

  const init = () => { /* no-op */ }
  const destroy = () => { clear() }

  return { init, spawn, tick, clear, destroy }
}

