import { Container, Graphics, Text } from "pixi.js"

/**
 * 下落昵称（逃离人员）控制器 —— 从 `GameCanvas.vue` 抽离。
 *
 * 背景
 * - 逃离（cashout）人员通过 WS 进入 `crashEscapedQueue`；
 * - 画布每隔一段时间从队列尾部窗口里随机抽取 2~6 人，让其从火箭下方开始下落；
 * - 下落过程中横坐标随时间轴左移（绑定开落瞬间的曲线锚点），落到底部停留一会再淡出。
 *
 * 为什么要抽离
 * - 这块与曲线绘制/火箭绘制相对独立，但在 `GameCanvas.vue` 内非常占行；
 * - 抽离后可以单独优化（减少 GC / 减少 interval 内数组分配 / 池化复用 Pixi 对象）；
 * - `GameCanvas.vue` 只保留“把最新的火箭位置与 toPixel 函数喂进来”。
 *
 * 设计约束
 * - 逃离采样间隔在 `escapedSampleIntervalMinMs`~`escapedSampleIntervalMaxMs` 间每次滚动随机（默认由中心值推导），避免固定节拍
 * - 同批次内每条昵称的 `spawnWall` 间隔在 `fallChipStaggerMinMs`~`fallChipStaggerMaxMs` 间随机，避免「等间距下落」
 * - 每次从队列**尾部**最近 `escapedLatestWindow` 条里随机抽 2~6 条（不按 `game_id` 过滤；跨局残留由外部如下注回合 reset、爆炸时清空队列）
 * - 同屏 chip 数量上限 `FALLING_CHIPS_MAX`（默认 40）
 * - chip 对象视图用对象池复用（避免频繁 new Text/Container）
 * - 逃离采样在 `tick` 内用 `escapedSamplerDeltaMs` 累积（与 Pixi 主循环同频），避免 `setInterval` 在高负载下被饿死；
 *   crashed/betting/卸载时必须停止并清理
 *
 * 调参入口（改动画/密度时按顺序找）
 * 1. **落在底部停多久、淡出多久**：在 `GameCanvas.vue` 调 `nameOnAxisMs` / `nameOnAxisFadeRatio`（经 `tick.dwellMs` / `fadeRatio` 传入；本文件内还会再乘固定系数，见 `fallChipHoldDwellMs` / `fallChipFadeMs`）。
 * 2. **从火箭落到底部要多久**：同上 `GameCanvas.vue` 的 `nameFallMoveMs`（对应 `tick.moveMs`）。落体 Y 为 ease-out 立方缓动（未改）；**落底后停多久**只由 `nameOnAxisMs` / `fadeRatio` 决定，可把 `nameOnAxisMs` 置 `0` 取消底部停留与淡出。
 * 3. **多久从 WS 队列抽一波人、一波里几条错开多久、池子多大**：在 `GameCanvas.vue` 里 `createFallChipsController(..., { ... })` 第二参数，字段说明见下方 `FallChipsOptions`。
 * 4. **队列从哪取、落到哪一行的 Y**：`FallChipsDeps`（由 GameCanvas 注入 `getEscapedQueue` / `getLandY` 等）。
 */

export type FallChipEntry = {
  game_id: number
  player_id: string | number
  userName: string
  multiplier: number
  at: number
}

type PixiChipView = {
  root: Container
  bg: Graphics
  label: Text
  inUse: boolean
}

type FallBetChip = {
  id: number
  nick: string
  /** 入队时间，用于清理兜底 */
  createdAt: number
  spawnWall: number
  /** 开落瞬间火箭尖对应的曲线时间锚点；横坐标随视窗推进向左移动 */
  anchorPlotTSec: number
  anchorPlotMult: number
  /** 开落瞬间火箭下方的屏幕 Y，下落过程冻结 */
  spawnPlaneY: number
  landYPx: number
  /** 落体动画起点；0 表示尚未到 spawnWall */
  fallT0: number
  view: PixiChipView | null
}

export type FallChipsDeps = {
  /** 读取逃离队列（外部维护的 shallowRef 数组） */
  getEscapedQueue: () => FallChipEntry[]
  /** 写回逃离队列（用于消费已抽取的人） */
  setEscapedQueue: (next: FallChipEntry[]) => void

  /** Pixi Application 已初始化后传入 stage，控制器会在其下创建 chipLayer */
  stage: Container

  /** 当前火箭屏幕坐标（用于确定开落起点 Y） */
  getRocketScreenPosition: () => { x: number; y: number } | null
  /** 火箭半径（屏幕像素），用于计算“火箭下方”偏移 */
  getRocketRadiusPx: () => number

  /**
   * 逃离昵称「落到曲线底部一带」的屏幕 Y（像素，一般为文字顶对齐）。
   * GameCanvas 里通常绑定 `getBetChipLandY`（与下注昵称行、时间轴刻度视觉带一致）。
   */
  getLandY: () => number
  /** 曲线坐标映射（世界→屏幕）；用于让开落时刻的 X 随时间轴向左移动 */
  toPixel: (tSec: number, mult: number) => { x: number; y: number }
  /** 把 X 夹在安全绘制区域内 */
  clampX: (x: number) => number
  /** 当前火箭尖对应的曲线锚点；只能取当前火箭，不要用逃离倍数反推 */
  getAnchorTm: () => { tSec: number; m: number }

  /**
   * 当 sampler 从队列中“抽中并消费”一条逃离记录时回调（可选）。
   * 用于 GameCanvas 侧记录「本局已逃离人员」集合（例如爆炸粒子昵称过滤）。
   */
  onPicked?: (e: FallChipEntry) => void

  /** 是否 H5 布局（决定字体大小等） */
  isH5: () => boolean
  /** UI scale（决定字号） */
  getScale: () => number
}

/**
 * `createFallChipsController(deps, opts)` 的 **opts**：只影响「多久抽样 / 一次抽几条 / 同屏多少条 / 池子多大」，
 * 不影响「下落速度、底部停多久」（那两项由 `tick` 的 `moveMs`、`dwellMs`、`fadeRatio` 决定，通常来自 GameCanvas props）。
 */
export type FallChipsOptions = {
  /**
   * Pixi `Text`+`Container` 视图池大小。逃离高峰时若池不够，`spawnOne` 会失败，该条继续留在队列里下波再试。
   * 一般 ≥ `fallingChipsMax`，略大即可（默认 60）。
   */
  chipPoolSize?: number
  /**
   * 同屏同时存在的下落昵称条数上限；超过时按「未开落 / 已播完」优先驱逐，避免内存与绘制压力。
   */
  fallingChipsMax?: number
  /**
   * **逃离队列抽样间隔**的中心值（毫秒）。实际间隔在 `[escapedSampleIntervalMinMs, escapedSampleIntervalMaxMs]` 间每次随机；
   * 若未显式传 min/max，则由本值推导：约 `0.35×` ~ `1.9×`（见实现处常量），避免固定节拍。
   */
  escapedSampleIntervalMs?: number
  /**
   * 两次「从队列抽一波」之间的**最短**等待（毫秒）。显式传入则覆盖由 `escapedSampleIntervalMs` 推导的下界。
   */
  escapedSampleIntervalMinMs?: number
  /**
   * 两次抽样之间的**最长**等待（毫秒）。显式传入则覆盖由 `escapedSampleIntervalMs` 推导的上界。
   */
  escapedSampleIntervalMaxMs?: number
  /**
   * 每次抽样只在队列**尾部**最近 N 条里取样本，再从中随机抽 2~6 条落地。
   * N 越大越「跟最新逃离」，但单次 Fisher–Yates 与重建队列成本略增（默认 12）。
   */
  escapedLatestWindow?: number
  /**
   * **同一波**里相邻两条昵称开始下落之间的间隔**中心值**（毫秒）。实际每条在
   * `[fallChipStaggerMinMs, fallChipStaggerMaxMs]` 随机；未传 min/max 时由本值推导（约 `0.16×` ~ `1.12×`）。
   */
  fallChipStaggerMs?: number
  /** 同波相邻开落间隔随机下界（毫秒）；与 `fallChipStaggerMaxMs` 一起可完全固定错开范围。 */
  fallChipStaggerMinMs?: number
  /** 同波相邻开落间隔随机上界（毫秒）。 */
  fallChipStaggerMaxMs?: number
  /**
   * 已创建但尚未到 `spawnWall` 开落的 chip，在内存里最多保留多久（毫秒）；超时由 cleanup 剔除，防止异常堆积。
   */
  fallChipMaxQueueMs?: number
}

export type FallChipsController = {
  /** 进入 flying 时调用：启动采样 + cleanup */
  start: () => void
  /** 退出 flying / 卸载时调用：停止所有定时器并清空 */
  stopAll: () => void
  /**
   * 每帧调用：更新所有 chip 的位置与透明度；飞行段传入 `escapedSamplerDeltaMs` 驱动逃离队列采样。
   * `moveMs` / `dwellMs` / `fadeRatio` 通常对应 GameCanvas 的 `nameFallMoveMs` / `nameOnAxisMs` / `nameOnAxisFadeRatio`。
   */
  tick: (params: {
    /** 当前墙钟时间；不传则用 `performance.now()` */
    nowWallMs?: number
    /**
     * 从开落到落在 `getLandY()` 一带的**下落动画时长**（毫秒，Y 为 ease-out 立方缓动）。GameCanvas：`nameFallMoveMs`。
     * `<=0` 时视为无下落段（直接进入落底后逻辑）。与落底后停留 `dwellMs` 无关。
     */
    moveMs: number
    /**
     * 落在底部后的**寿命基准**（毫秒）。底部全不透明停留 = `dwellMs * 0.5`；淡出时长见 `fallChipFadeMs`。
     * GameCanvas：`nameOnAxisMs`（昵称在曲线底/时间轴上方那一行的可读时间尺度）。
     */
    dwellMs: number
    /**
     * 相对 `dwellMs` 的淡出比例。实际淡出毫秒 = `fallChipFadeMs(dwellMs, fadeRatio)`（`dwellMs<=0` 时为 0）。
     * GameCanvas：`nameOnAxisFadeRatio`。
     */
    fadeRatio: number
    /**
     * 仅 `flying` 且未坠毁时传入 `app.ticker.deltaMS`（≥0），用于累加逃离抽样时钟。
     * **勿**在 crashed / betting 传入，否则会误抽队列。
     */
    escapedSamplerDeltaMs?: number
  }) => void
  /** 显式清空（不销毁 layer，只释放 view 回池） */
  clear: () => void
}

export function createFallChipsController(deps: FallChipsDeps, opts: FallChipsOptions = {}): FallChipsController {
  // ── opts 解析后的运行常量（调密度/抽样改 `FallChipsOptions`；调下落快慢改 `tick` 参数）──
  const CHIP_POOL_SIZE = opts.chipPoolSize ?? 60
  const FALLING_CHIPS_MAX = opts.fallingChipsMax ?? 40
  const _sampleCenterMs = opts.escapedSampleIntervalMs ?? 1200
  const ESCAPED_FALL_SAMPLE_MIN_MS =
    opts.escapedSampleIntervalMinMs ?? Math.max(380, Math.round(_sampleCenterMs * 0.35))
  const ESCAPED_FALL_SAMPLE_MAX_MS =
    opts.escapedSampleIntervalMaxMs ?? Math.round(_sampleCenterMs * 1.9)
  const ESCAPED_FALL_LATEST_WINDOW = opts.escapedLatestWindow ?? 12
  const _staggerCenterMs = opts.fallChipStaggerMs ?? 520
  const FALL_CHIP_STAGGER_MIN_MS =
    opts.fallChipStaggerMinMs ?? Math.max(70, Math.round(_staggerCenterMs * 0.16))
  const FALL_CHIP_STAGGER_MAX_MS =
    opts.fallChipStaggerMaxMs ?? Math.round(_staggerCenterMs * 1.12)
  const FALL_CHIP_MAX_QUEUE_MS = opts.fallChipMaxQueueMs ?? 180_000
  /** 排队开落时间轴不得比「现在」超前超过此值，否则 `spawnOne` 拒收（防一波把人排到几秒后） */
  const FALL_CHIP_MAX_PENDING_SPAWN_MS = Math.max(FALL_CHIP_STAGGER_MAX_MS * 5, 4200)

  function rollNextEscapeSampleThresholdMs(): number {
    const lo = Math.min(ESCAPED_FALL_SAMPLE_MIN_MS, ESCAPED_FALL_SAMPLE_MAX_MS)
    const hi = Math.max(ESCAPED_FALL_SAMPLE_MIN_MS, ESCAPED_FALL_SAMPLE_MAX_MS)
    return lo + Math.random() * (hi - lo)
  }

  function rollStaggerMs(): number {
    const lo = Math.min(FALL_CHIP_STAGGER_MIN_MS, FALL_CHIP_STAGGER_MAX_MS)
    const hi = Math.max(FALL_CHIP_STAGGER_MIN_MS, FALL_CHIP_STAGGER_MAX_MS)
    return lo + Math.random() * (hi - lo)
  }
  /** 落地停留/淡出时的 Y：在 `getLandY()` 基础上再向下（屏幕 +Y） */
  const FALL_CHIP_LAND_Y_OFFSET_PX = 15

  /**
   * 底部全不透明停留时长。为 `tick.dwellMs`（GameCanvas `nameOnAxisMs`）的 **0.5×**。
   * 若希望总「在轴边可读时间」与 prop 一致，需把这里改成 `1.0` 或把 prop 减半二选一，避免双重缩放搞混。
   */
  function fallChipHoldDwellMs(dwellMs: number): number {
    return dwellMs * 0.5
  }

  /**
   * 底部淡出时长：`dwellMs * fadeRatio * 0.5`；正数时至少 1ms 避免除零。
   * `dwellMs <= 0` 时返回 0，落底后不再强制多停一帧。
   */
  function fallChipFadeMs(dwellMs: number, fadeRatio: number): number {
    const raw = dwellMs * fadeRatio * 0.5
    if (!(raw > 0)) return 0
    return Math.max(1, raw)
  }

  // chips model
  let chipSeq = 0
  /** 下一条昵称允许开始掉落的时间；跨批次连续排队，避免同一时间成片下落 */
  let nextSpawnWallMs = 0
  const chips: FallBetChip[] = []

  /** 逃离队列采样：用 tick 累积 delta，避免 setInterval 与主线程抢不过时「长时间不掉」 */
  let _escapeSamplerAccMs = 0
  /** 距离下一次 `runEscapeSampleOnce` 的累积目标（毫秒），每次触发后重新随机 */
  let _nextEscapeSampleThresholdMs = rollNextEscapeSampleThresholdMs()

  /** 与 `tick` 传入的动画参数同步，供溢出驱逐与 interval 兜底清理使用（避免与 tick 寿命公式不一致） */
  let _lastAnimForCleanup = { moveMs: 4000, dwellMs: 800, fadeRatio: 0.2 }

  // timers：仅兜底清理用 400ms interval（与抽样无关）；主逻辑全在 `tick` + Pixi ticker
  let chipCleanupTimer: ReturnType<typeof setInterval> | null = null

  // pixi pool
  let chipLayer: Container | null = null
  const chipPool: PixiChipView[] = []

  // sampler scratch (复用，避免 interval 内产生临时数组/Set)
  const _escapedWindowIdxs: number[] = []

  const ensureChipLayer = () => {
    if (chipLayer) return
    chipLayer = new Container()
    chipLayer.eventMode = "none"
    chipLayer.sortableChildren = false
    deps.stage.addChild(chipLayer)
    for (let i = 0; i < CHIP_POOL_SIZE; i++) {
      const root = new Container()
      root.eventMode = "none"
      root.visible = false
      const bg = new Graphics({ roundPixels: false })
      bg.eventMode = "none"
      bg.visible = false
      const label = new Text({
        text: "",
        style: { fill: 0x94a3b8, fontSize: 12, fontWeight: "500" },
      })
      label.eventMode = "none"
      label.anchor.set(0.5, 0)
      root.addChild(bg)
      root.addChild(label)
      chipLayer.addChild(root)
      chipPool.push({ root, bg, label, inUse: false })
    }
  }

  const releaseAllViews = () => {
    for (const v of chipPool) {
      v.inUse = false
      v.root.visible = false
      v.root.alpha = 0
    }
  }

  const allocView = (): PixiChipView | null => {
    for (const v of chipPool) {
      if (!v.inUse) {
        v.inUse = true
        v.root.visible = true
        v.root.alpha = 0
        return v
      }
    }
    return null
  }

  function animLifeEndMs(moveMs: number, dwellMs: number, fadeRatio: number): number {
    return moveMs + fallChipHoldDwellMs(dwellMs) + fallChipFadeMs(dwellMs, fadeRatio)
  }

  function releaseChipView(c: FallBetChip): void {
    if (c.view) {
      c.view.inUse = false
      c.view.root.visible = false
      c.view = null
    }
  }

  /** 超出同屏上限时：优先赶走「尚未可见 / 已播完」的 chip，避免 splice 头部误删正在下落的那条 */
  function evictExcessChips(nowWall: number): void {
    const { moveMs, dwellMs, fadeRatio } = _lastAnimForCleanup
    const lifeEnd = animLifeEndMs(moveMs, dwellMs, fadeRatio)
    while (chips.length > FALLING_CHIPS_MAX) {
      let pick = 0
      for (let i = 1; i < chips.length; i++) {
        const a = chips[pick]!
        const b = chips[i]!
        const ta = evictionTier(a, nowWall, lifeEnd)
        const tb = evictionTier(b, nowWall, lifeEnd)
        if (tb > ta) pick = i
        else if (tb === ta && b.createdAt < a.createdAt) pick = i
      }
      releaseChipView(chips[pick]!)
      chips.splice(pick, 1)
    }
  }

  function evictionTier(c: FallBetChip, nowWall: number, lifeEndMs: number): number {
    if (nowWall < c.spawnWall) return 4
    if (c.fallT0 === 0) return 3
    if (c.fallT0 > 0 && nowWall - c.fallT0 >= lifeEndMs) return 2
    return 1
  }

  function runEscapeSampleOnce(): void {
    const q0 = deps.getEscapedQueue()
    if (!Array.isArray(q0) || q0.length === 0) return
    const idxs = _escapedWindowIdxs
    idxs.length = 0
    const n = q0.length
    const take = Math.min(n, ESCAPED_FALL_LATEST_WINDOW)
    for (let k = 0; k < take; k++) {
      const i = n - 1 - k
      if (q0[i]) idxs.push(i)
    }
    if (idxs.length === 0) return

    const want = 2 + (Math.random() * 5 | 0) // 2..6
    const pickCount = Math.min(idxs.length, want)
    if (pickCount <= 0) return

    for (let i = 0; i < pickCount; i++) {
      const r = i + (Math.random() * (idxs.length - i) | 0)
      const tmp = idxs[i]
      idxs[i] = idxs[r]
      idxs[r] = tmp
    }

    const pickedIdxs: number[] = []
    for (let i = 0; i < pickCount; i++) {
      const qi = idxs[i]
      const e = q0[qi]
      if (!e) continue
      if (!spawnOne(e.userName)) continue
      pickedIdxs.push(qi)
      deps.onPicked?.(e)
    }
    if (pickedIdxs.length === 0) return

    const nextQ: FallChipEntry[] = []
    for (let i = 0; i < q0.length; i++) {
      const e = q0[i]
      if (!e) continue
      let hit = false
      for (let j = 0; j < pickedIdxs.length; j++) {
        if (i === pickedIdxs[j]) {
          hit = true
          break
        }
      }
      if (hit) continue
      nextQ.push(e)
    }
    deps.setEscapedQueue(nextQ)
  }

  const stopCleanup = () => {
    if (chipCleanupTimer != null) {
      clearInterval(chipCleanupTimer)
      chipCleanupTimer = null
    }
  }

  const startCleanup = () => {
    stopCleanup()
    chipCleanupTimer = setInterval(() => {
      if (chips.length === 0) return
      const now = performance.now()
      const { moveMs, dwellMs, fadeRatio } = _lastAnimForCleanup
      const totalLifeMs = animLifeEndMs(moveMs, dwellMs, fadeRatio) + 120
      // 单遍压缩
      for (let i = chips.length - 1; i >= 0; i--) {
        const c = chips[i]!
        const keep =
          c.fallT0 === 0
            ? (now - c.createdAt < FALL_CHIP_MAX_QUEUE_MS)
            : (now - c.fallT0 < totalLifeMs)
        if (keep) continue
        if (c.view) {
          c.view.inUse = false
          c.view.root.visible = false
          c.view = null
        }
        chips.splice(i, 1)
      }
    }, 400)
  }

  const clear = () => {
    _escapeSamplerAccMs = 0
    _nextEscapeSampleThresholdMs = rollNextEscapeSampleThresholdMs()
    stopCleanup()
    for (const c of chips) {
      if (c.view) {
        c.view.inUse = false
        c.view.root.visible = false
        c.view = null
      }
    }
    chips.length = 0
    releaseAllViews()
    nextSpawnWallMs = 0
  }

  function spawnOne(nick: string): boolean {
    ensureChipLayer()
    const id = ++chipSeq
    const nowWall = performance.now()
    const scheduledSpawnWall = Math.max(nowWall, nextSpawnWallMs)
    // 如果当前可见队列已经排得太远，先暂停消费，等前面的昵称开始掉落后再继续抽队列。
    if (scheduledSpawnWall - nowWall > FALL_CHIP_MAX_PENDING_SPAWN_MS) return false
    nextSpawnWallMs = scheduledSpawnWall + rollStaggerMs()
    const chip: FallBetChip = {
      id,
      nick,
      createdAt: nowWall,
      spawnWall: scheduledSpawnWall,
      anchorPlotTSec: 0,
      anchorPlotMult: 1,
      spawnPlaneY: 0,
      landYPx: deps.getLandY() + FALL_CHIP_LAND_Y_OFFSET_PX,
      fallT0: 0,
      view: null,
    }
    chip.view = allocView()
    if (!chip.view) return false

    chip.view.label.text = nick
    const fs = deps.isH5() ? 11 : 12
    chip.view.label.style.fontSize = fs
    chip.view.bg.clear()
    chip.view.bg.visible = false
    chip.view.label.x = 0
    chip.view.label.y = 0
    chip.view.root.x = 0
    chip.view.root.y = 0
    chip.view.root.alpha = 0

    chips.push(chip)
    evictExcessChips(nowWall)
    return true
  }

  const tick = (params: {
    nowWallMs?: number
    moveMs: number
    dwellMs: number
    fadeRatio: number
    escapedSamplerDeltaMs?: number
  }) => {
    const nowWallMs = params.nowWallMs ?? performance.now()
    const moveMs = params.moveMs
    const dwellMs = params.dwellMs
    const fadeRatio = params.fadeRatio
    _lastAnimForCleanup = { moveMs, dwellMs, fadeRatio }

    const dt = params.escapedSamplerDeltaMs
    if (dt != null && dt > 0) {
      _escapeSamplerAccMs += dt
      _escapeSamplerAccMs = Math.min(_escapeSamplerAccMs, ESCAPED_FALL_SAMPLE_MAX_MS * 2.5)
      // 每帧最多抽样一次：避免单帧连抽 + push 触发「删头」时砍掉仍在下落的昵称
      if (_escapeSamplerAccMs >= _nextEscapeSampleThresholdMs) {
        _escapeSamplerAccMs -= _nextEscapeSampleThresholdMs
        _nextEscapeSampleThresholdMs = rollNextEscapeSampleThresholdMs()
        runEscapeSampleOnce()
      }
    }

    if (chips.length === 0) return
    const holdDwellMs = fallChipHoldDwellMs(dwellMs)
    const safeFadeMs = fallChipFadeMs(dwellMs, fadeRatio)
    for (let ci = 0; ci < chips.length; ci++) {
      const c = chips[ci]!
      const v = c.view
      if (!v) continue

      if (nowWallMs < c.spawnWall) {
        v.root.alpha = 0
        v.root.visible = false
        continue
      }
      if (c.fallT0 === 0) {
        const pos = deps.getRocketScreenPosition()
        if (!pos) {
          v.root.alpha = 0
          v.root.visible = false
          continue
        }
        const below = deps.getRocketRadiusPx() * 0.75
        c.spawnPlaneY = pos.y + below
        c.landYPx = deps.getLandY() + FALL_CHIP_LAND_Y_OFFSET_PX
        c.fallT0 = nowWallMs
        const tm = deps.getAnchorTm()
        c.anchorPlotTSec = tm.tSec
        c.anchorPlotMult = tm.m
      }

      const pNow = deps.toPixel(c.anchorPlotTSec, c.anchorPlotMult)
      const anchorX = deps.clampX(pNow.x)
      const landY = c.landYPx
      const elapsed = nowWallMs - c.fallT0

      let yOff: number
      let opacity: number
      if (moveMs > 0 && elapsed < moveMs) {
        const t = elapsed / moveMs
        const te = 1 - (1 - t) ** 3
        yOff = c.spawnPlaneY + (landY - c.spawnPlaneY) * te
        opacity = 1
      } else if (elapsed < moveMs + holdDwellMs) {
        yOff = landY
        opacity = 1
      } else if (safeFadeMs > 0 && elapsed < moveMs + holdDwellMs + safeFadeMs) {
        yOff = landY
        const f = (elapsed - moveMs - holdDwellMs) / safeFadeMs
        opacity = 1 - f
        if (opacity < 0) opacity = 0
      } else {
        yOff = landY
        opacity = 0
      }

      v.root.x = anchorX
      v.root.y = yOff
      v.root.alpha = opacity
      v.root.visible = opacity > 0
    }

    const lifeEndMs = moveMs + holdDwellMs + safeFadeMs
    for (let ci = chips.length - 1; ci >= 0; ci--) {
      const c = chips[ci]!
      if (c.fallT0 > 0 && nowWallMs - c.fallT0 >= lifeEndMs) {
        releaseChipView(c)
        chips.splice(ci, 1)
      }
    }
  }

  const start = () => {
    ensureChipLayer()
    _escapeSamplerAccMs = 0
    _nextEscapeSampleThresholdMs = rollNextEscapeSampleThresholdMs()
    nextSpawnWallMs = 0
    startCleanup()
  }

  const stopAll = () => {
    clear()
  }

  return { start, stopAll, tick, clear }
}

