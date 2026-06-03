<template>

    <div ref="gameContainer" class="game-container" :class="{
        'crash-flash-active': crashFlashActive,
        'crash-h5': isH5Layout,
    }" :style="{ height: props.canvasHeight }">
        <header class="crash-hud" v-if="isReady && !deferInitialCrashPresentation">
            <div class="crash-hud-left">
                <span class="crash-phase-pill" :data-phase="gamePhase">{{ phaseLabel }}</span>
                <span class="crash-hud-sub">{{ hudSubtitle }}</span>
            </div>
        </header>

        <div ref="canvasWrapper" class="canvas-wrapper" :class="{ 'h5-canvas-layout': isH5Layout }">
            <div ref="pixiHost" class="pixi-host"></div>
            <img v-if="bangGifVisible && !deferInitialCrashPresentation" :key="bangGifNonce" class="bang-gif"
                :src="bangGifSrc" :style="bangGifStyle" alt="" decoding="sync" fetchpriority="high"
                aria-hidden="true" />

            <!-- <div class="axis-frame-overlay" :style="axisFrameStyle"></div> -->

            <div class="y-axis-overlay" :style="{ width: yAxisGutterWidthPx + 'px' }">
                <div v-for="(tick, yi) in yAxisTicks" :key="'y-slot-' + yi" class="y-label"
                    :style="{ top: tick.position + 'px' }">
                    <span class="y-text">{{ tick.label }}</span>
                </div>
            </div>

            <div class="x-axis-overlay">
                <div v-for="tick in xAxisTicks" :key="'x-t-' + tick.value" class="x-label"
                    :style="{ left: tick.position + 'px' }">
                    <span class="x-text">{{ tick.label }}</span>
                </div>
            </div>

        </div>

        <div class="multiplier-display" :class="{ crashed: isGameOver }"
            v-if="isReady && !showCountdown && crashWsConnected && crashRoomState && !deferInitialCrashPresentation">
            <div class="multiplier-value-wrap" :class="{ 'multiplier-flash-ping': hudFlashPlaying }"
                @animationend="onHudFlashAnimationEnd">
                <span class="multiplier-value">{{ displayMultiplier }}</span>
                <span class="multiplier-suffix">x</span>
            </div>
            <!-- <div v-if="isGameOver" class="crashed-label" role="status" aria-live="polite">
                {{ $t("game.crash.crashed") }}
            </div> -->
        </div>

        <!-- Pixi 与 WS 分离：`isReady` 只表示 WebGL/Pixi 已就绪；与 `crashWsConnected` 无关 -->
        <div class="loading" v-if="!isReady" role="status" aria-live="polite">
            <span class="loading-dot"></span>
            <span v-if="crashWsConnected">{{ $t("game.crash.renderer_starting") }}</span>
            <span v-else>{{ $t("game.crash.initializing_chart") }}</span>
        </div>
        <div class="loading loading-ws" v-else-if="!crashWsConnected" role="status" aria-live="polite">
            <span class="loading-dot"></span>
            {{ $t("game.crash.waiting_for_data") }}
        </div>
        <!-- 首屏竞态：渲染器已就绪但首包已是坠毁态，曲线锚点未就绪；不播中央爆炸，等同「等数据」直至下一局 betting -->
        <div class="loading loading-ws loading-ws-cover" v-else-if="deferInitialCrashPresentation" role="status"
            aria-live="polite">
            <span class="loading-dot"></span>
            {{ $t("game.crash.waiting_for_data") }}
        </div>

        <div class="countdown-overlay" v-if="showCountdown">
            <div class="countdown-pill">
                <div class="countdown-text">{{ $t("game.crash.next_round_in") }} {{ countdownTime }}s</div>
                <div ref="countdownProgressRef" class="countdown-progress"></div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
/**
 * ==========================================================================
 * GameCanvas.vue — Crash game chart (performance-optimized)
 * ==========================================================================
 *
 * 优化要点：
 *   1. 对象池：ScreenPoint / CurveSampleRow 使用预分配池，每帧重置索引
 *   2. 脏标记渲染：grid / ticks 在数据变化时重绘
 *   3. 帧跳过：betting/crashed 阶段降至 ~15fps 渲染
 *   4. 飞行阶段：base 低频 + tip 每帧；填充在存在 live tip 时合并为单路径单次 fill（与 static 填充互斥），避免接缝双层半透明
 *   5. 减少 Vue 响应式访问：热路径使用普通变量
 *   6. 合并 sanitize + draw：避免两次遍历点数组
 */
import { onMounted, onUnmounted, ref, computed, nextTick, watch, shallowRef } from "vue"
import { useI18n } from "vue-i18n"
import { Application, Assets, Container, FillGradient, Graphics, Sprite, Text, type Texture, loadTextures } from "pixi.js"
import { createRocketMarkerController, type RocketMarkerController, type RocketPose } from "./canvas/rocketMarker"
import { toPixiCrossOriginSafeImageUrl } from "~/utils/pixiAvatarUrl"

// Pixi 8 默认在 blob Worker 里解码纹理；正式站 CSP 常未放行 blob: + Worker，会导致头像等资源「请求成功但纹理失败」。
// 关闭 Worker 解码后走主线程 fetch + createImageBitmap，与常见 script-src CSP 兼容。
if (import.meta.client) {
    loadTextures.config.preferWorkers = false
}
import { createFallChipsController, type FallChipsController } from "./canvas/fallChips"
import { createExplosionNamesController, type ExplosionNamesController } from "./canvas/explosionNames"
import {
    crashRoomState,
    crashJoinSnapshotApplied,
    crashSelfPlayerId,
    crashWsConnected,
    crashWsSocketError,
    crashEscapedQueue,
    clearCrashEscapedQueue,
} from "../composables/useCrashState"
import {
    buildXAxisTicks,
    buildYAxisTicksFixedFive,
    buildYAxisTicksLowBandLinearSix,
    DEFAULT_LOW_BAND_GRID_MULTS,
    type CrashAxisTick,
} from "../composables/useCrashCanvasTicks"
import {
    appendCurveSegmentParametricPoints,
    getCurveScreenPoints,
    getCurveTipScreenPoints,
    getRocketPoseFromPoints,
    isCurveTipScreenFlat,
    resetRowPoolForParametricRebuild,
    resetScreenPointPool,
    stripPureHorizontalPolylineStepsInPlace,
    type CurvePoint,
    type CurveSampleRow,
    type ParametricSegmentOpts,
    type CurveSegmentScreenOpts,
    type ScreenPoint,
} from "../utils/curveMath"
import {
    getFlyingMs,
    elapsedMsFromMultiplier,
    multToPlotNy,
    multToLinearPlotNy,
    plotMultForCanvas,
    type FlyingClockState,
    resetFlyingClockState,
} from "../utils/flightMath"
import { useGame } from "~/composables/GameHook"
import { registerCrashBoomPoolGestureUnlock } from "~/utils/sound/crashBoomGestureBridge"
import boomSoundUrl from "/sounds/limbo/boom.mp3"
import bangGifUrl from "/img/gamepage/bang.gif"

const { t: $t } = useI18n()
const { soundState } = useGame()

type CrashRoomStateValue = NonNullable<typeof crashRoomState.value>
type CrashRoundBet = NonNullable<CrashRoomStateValue["round_bets"]>[number]

// ─── bang.gif overlay (DOM, keeps GIF animation) ────────────────
const BANG_GIF_URL = bangGifUrl
const BANG_GIF_SHOW_MS = 1200
/** 先出爆炸 GIF，再出 name 粒子 */
const BANG_NAME_PARTICLE_DELAY_MS = 400
const bangGifVisible = ref(false)
const bangGifX = ref(0)
const bangGifY = ref(0)
const bangGifScale = ref(1)
const bangGifNonce = ref(0)
let bangGifReadyPromise: Promise<void> | null = null
/** import 得到构建 hash URL；fragment 只用于重挂重播，不触发额外网络请求 */
const bangGifSrc = computed(() => `${BANG_GIF_URL}#${bangGifNonce.value}`)
const bangGifStyle = computed(() => ({
    left: `${bangGifX.value}px`,
    top: `${bangGifY.value}px`,
    // translate3d：与 iOS/WebGL 叠图时促建立体层，避免仅用 translate2d 偶现不合成
    transform: `translate3d(-50%, -50%, 0) scale(${bangGifScale.value})`,
}))
let bangGifHideTimer: ReturnType<typeof setTimeout> | null = null
let bangNameParticleTimer: ReturnType<typeof setTimeout> | null = null
let crashFlashTimer: ReturnType<typeof setTimeout> | null = null

// ─── Props ───────────────────────────────────────────────────────
/**
 * 与「逃离昵称从火箭落到曲线底部」相关的只有下列三项；均传入 `fallChipsCtl.tick(...)`（见 `canvas/fallChips.ts` 内 `tick` 的 JSDoc）。
 * 逃离**抽样间隔 / 同屏条数**等在 `createFallChipsController` 第二参数里改，不在 props。
 */
const props = defineProps({
    /** 画布区域 CSS 高度 */
    canvasHeight: { type: String, required: true, default: "750px" },
    /**
     * 逃离昵称从火箭落到 `getBetChipLandY()` 一带的**下落动画时长**（ms）；fallChips 内为 ease-out 立方，不改此效果。
     * **落底后是否停留**由 `nameOnAxisMs` 控制；置 `0` 即无底部停留/淡出，不影响下落曲线本身。
     */
    nameFallMoveMs: { type: Number, default: 4000 },
    /**
     * **仅**落底之后：全不透明停留与淡出两段的基准（ms），经 `fallChips` 内 `fallChipHoldDwellMs` / `fallChipFadeMs` 换算。
     * 设为 `0` 表示落底后不停留、无淡出段（昵称尽快从池里回收）；不缩短「在空中下落」的时间。
     */
    nameOnAxisMs: { type: Number, default: 400 },
    /**
     * 淡出相对 `nameOnAxisMs` 的强度。`nameOnAxisMs===0` 时淡出时长为 0；否则见 `fallChips` 内 `fallChipFadeMs`。
     */
    nameOnAxisFadeRatio: { type: Number, default: 0.2 },
})

// ─── Pixi objects (raw JS, not reactive) ─────────────────────────
let app: Application | null = null
let gridGfx: Graphics | null = null
let curveGfx: Graphics | null = null
let staticCurveGfx: Graphics | null = null
let tipCurveGfx: Graphics | null = null
/** 本人逃离：图钉 + 倍数标签（Pixi，与 GameCanvas copy 一致） */
let selfEscapeMarkerLayer: Container | null = null
let selfEscapeMarkerInner: Container | null = null
let selfEscapeMarkTexture: Texture | null = null
let selfEscapeMarkTexturePromise: Promise<Texture | null> | null = null
let selfEscapePin: Sprite | null = null
let selfEscapeLabelBlock: Container | null = null
let selfEscapeLabelBg: Graphics | null = null
let selfEscapeLabelText: Text | null = null
let selfEscapeCashoutActive = false
let selfEscapeCashoutTSec = 0
let selfEscapeCashoutAnimStartMs = 0
/** 本帧与 Pixi 曲线实际绘制一致的折线（飞行为 base+tip 合并），供逃离图钉按 x 取 y，与 stroke 中心线重合 */
let _selfEscapeOverlayCurvePts: ScreenPoint[] | null = null
/** 左缘触发后整组固定，避免倍数盒/图钉被裁切 */
let _selfEscapeLeftFrozen = false
let _selfEscapeFrozenX = 0
let _selfEscapeFrozenY = 0
/** selfEscapeMarkerInner 本地坐标中整组最左侧，用于计算完整显示所需的最小 world x */
let _selfEscapeGroupLeftLocal = 0
/** 矢量火箭专用光晕（在 rocketGfx 下层） */
let rocketVectorGlowGfx: Graphics | null = null
let rocketGfx: Graphics | null = null
let rocketAvatarRoot: Container | null = null
let rocketAvatarGlowGfx: Graphics | null = null
let rocketAvatarSprite: Sprite | null = null
let rocketAvatarMaskGfx: Graphics | null = null
/** 头像圆形描边（盖在 sprite 之上，与 mask 同半径） */
let rocketAvatarBorderGfx: Graphics | null = null
let plotMaskGfx: Graphics | null = null
let pixiCanvasEl: HTMLCanvasElement | null = null
let isDisposed = false

/** 窗口/标签页恢复前临时隐藏 Pixi canvas，避免浏览器先展示上一帧 WebGL 缓存画面。 */
function setPixiCanvasHiddenDuringResume(hidden: boolean) {
    if (!pixiCanvasEl) return
    pixiCanvasEl.style.visibility = hidden ? "hidden" : ""
    pixiCanvasEl.style.opacity = hidden ? "0" : ""
}

/** Crash 爆炸：使用 DOM 叠层 `bang.gif`（保留 name 粒子） */
let crashBoomPlaying = false
let crashBoomStartMs = 0
let crashBoomRoundStarted = false
/**
 * 本局「进入坠毁相位」后是否已播爆炸音（仅用布尔，不用 game_id）。
 * game_id 可能在 crashed 与 betting 之间提前变化，若与 phase watch 交错会误伤去重 → 间隔一局无声。
 */
let crashBoomSoundEmittedThisCrashEdge = false
const CRASH_BOOM_AUDIO_POOL_SIZE = 3
let crashBoomAudioPool: HTMLAudioElement[] = []
let crashBoomAudioPoolCursor = 0
/** iOS Safari：须先在用户手势里成功 play 一次，之后非手势触发的爆炸音才能播 */
let crashBoomAudioIosUnlocked = false
/** document / 画布根节点分步挂载，避免 initGame 完成前用户点击无法解锁 */
let crashBoomGestureDocCleanup: (() => void) | null = null
let crashBoomGestureRootCleanup: (() => void) | null = null
let crashBoomAudioUnlockCleanup: (() => void) | null = null

/** 爆炸昵称粒子：已抽离到 `canvas/explosionNames.ts` */

function truncateExplosionNick(raw: string, maxChars: number): string {
    const s = String(raw).trim()
    if (s.length <= maxChars) return s
    return `${s.slice(0, Math.max(1, maxChars - 1))}…`
}

/** 本局未兑现（未逃离）且已下注的玩家昵称，用于爆炸粒子 */
function collectUnescapedNickLabelsForExplosion(): string[] {
    const s = crashRoomState.value
    const bets = s?.round_bets
    if (!Array.isArray(bets) || bets.length === 0) return []
    const out: string[] = []
    for (const b of bets) {
        if (isRoundBetEscapedForExplosion(b)) continue
        const amt = Number(b.amount)
        if (!Number.isFinite(amt) || amt < 0) continue
        const nick = truncateExplosionNick(
            (b.userName && String(b.userName).trim()) || `Player${b.player_id}`,
            11
        )
        if (nick) out.push(nick)
    }
    return out
}

function createCrashBoomAudioElement(): HTMLAudioElement {
    const a = new Audio(boomSoundUrl)
    a.preload = "auto"
    a.setAttribute("playsinline", "true")
    a.setAttribute("webkit-playsinline", "true")
    try {
        ; (a as any).playsInline = true
    } catch {
        /* ignore */
    }
    a.load()
    return a
}

function ensureCrashBoomAudioPool(): HTMLAudioElement[] {
    if (isDisposed) return []
    if (crashBoomAudioPool.length > 0) return crashBoomAudioPool
    for (let i = 0; i < CRASH_BOOM_AUDIO_POOL_SIZE; i++) {
        crashBoomAudioPool.push(createCrashBoomAudioElement())
    }
    return crashBoomAudioPool
}

function stopAndReleaseCrashBoomAudioPool(): void {
    crashBoomAudioIosUnlocked = false
    for (const a of crashBoomAudioPool) {
        try {
            a.pause()
            a.currentTime = 0
            a.removeAttribute("src")
            a.load()
        } catch { /**/ }
    }
    crashBoomAudioPool = []
    crashBoomAudioPoolCursor = 0
}

function isAppleTouchDevice(): boolean {
    if (!import.meta.client) return false
    const ua = navigator.userAgent || ""
    if (/iP(hone|ad|od)/i.test(ua)) return true
    return navigator.platform === "MacIntel" && (navigator.maxTouchPoints ?? 0) > 1
}

/** 仅当「音效开关」已开启时，在用户手势内解锁 WebKit（关音效时不做任何解锁/播放） */
function tryUnlockCrashBoomAudioFromGesture(): void {
    if (crashBoomAudioIosUnlocked || !soundState.isClickSoundEnabled) return
    const pool = ensureCrashBoomAudioPool()
    if (isDisposed || pool.length === 0) return
    const states = pool.map((a) => {
        const prevVol = a.volume
        const prevMuted = a.muted
        a.muted = true
        a.volume = 0
        return { a, prevVol, prevMuted }
    })
    // 必须在手势同步栈内发起 play()；async/await 会脱离 WebKit 手势上下文，导致「必须先点下注」才偶发有声
    const plays = states.map(({ a }) => a.play())
    void Promise.allSettled(plays).then((results) => {
        if (isDisposed) {
            stopAndReleaseCrashBoomAudioPool()
            return
        }
        crashBoomAudioIosUnlocked = crashBoomAudioIosUnlocked || results.some((r) => r.status === "fulfilled")
        for (const { a, prevVol, prevMuted } of states) {
            try {
                a.pause()
                a.currentTime = 0
            } catch {
                /* ignore */
            }
            a.muted = prevMuted
            a.volume = prevVol > 0 && prevVol <= 1 ? prevVol : 1
        }
    })
}

function disposeAllCrashBoomGestureListeners(): void {
    crashBoomGestureDocCleanup?.()
    crashBoomGestureDocCleanup = null
    crashBoomGestureRootCleanup?.()
    crashBoomGestureRootCleanup = null
    crashBoomAudioUnlockCleanup = null
}

function attachCrashBoomAudioUnlockListeners(): void {
    if (isDisposed || !import.meta.client) return
    const onFirstGesture = () => {
        tryUnlockCrashBoomAudioFromGesture()
    }
    const docOpts: AddEventListenerOptions = { capture: true, passive: true }
    if (!crashBoomGestureDocCleanup) {
        document.addEventListener("pointerdown", onFirstGesture, docOpts)
        document.addEventListener("touchstart", onFirstGesture, docOpts)
        document.addEventListener("click", onFirstGesture, docOpts)
        crashBoomGestureDocCleanup = () => {
            document.removeEventListener("pointerdown", onFirstGesture, docOpts)
            document.removeEventListener("touchstart", onFirstGesture, docOpts)
            document.removeEventListener("click", onFirstGesture, docOpts)
        }
    }
    const root = canvasWrapper.value ?? gameContainer.value
    const localOpts: AddEventListenerOptions = { passive: true }
    if (root && !crashBoomGestureRootCleanup) {
        root.addEventListener("pointerdown", onFirstGesture, localOpts)
        root.addEventListener("touchstart", onFirstGesture, localOpts)
        crashBoomGestureRootCleanup = () => {
            root.removeEventListener("pointerdown", onFirstGesture, localOpts)
            root.removeEventListener("touchstart", onFirstGesture, localOpts)
        }
    }
    crashBoomAudioUnlockCleanup = disposeAllCrashBoomGestureListeners
}

/** 爆炸音效：仅当全局「音效开关」开启时播放（与 bang.gif 是否显示无关） */
function playCrashBoomSound() {
    if (isDisposed || !soundState.isClickSoundEnabled) return
    const pool = ensureCrashBoomAudioPool()
    if (pool.length === 0) return
    const start = crashBoomAudioPoolCursor % pool.length
    crashBoomAudioPoolCursor = (crashBoomAudioPoolCursor + 1) % pool.length
    const tryPlay = (idx: number, attemptsLeft: number) => {
        const a = pool[idx]!
        a.muted = false
        a.volume = 1
        a.currentTime = 0
        void a.play().catch(() => {
            if (attemptsLeft <= 1) return
            tryPlay((idx + 1) % pool.length, attemptsLeft - 1)
        })
    }
    // iOS 未解锁时大概率会被策略拦截；仍尝试一次，非 iOS/已解锁则从池中轮播。
    tryPlay(start, pool.length)
}

function resetCrashBoomPixiRound() {
    crashBoomPlaying = false
    crashBoomRoundStarted = false
    explosionNamesCtl?.clear()
    if (bangGifHideTimer) {
        clearTimeout(bangGifHideTimer)
        bangGifHideTimer = null
    }
    if (bangNameParticleTimer) {
        clearTimeout(bangNameParticleTimer)
        bangNameParticleTimer = null
    }
    bangGifVisible.value = false
}

/**
 * 清除画布上所有游戏元素（曲线 + 火箭 + 光晕）。
 * 用于 defer 激活、reset 等需要彻底清空 Pixi Graphics 的场景，
 * 避免 watcher 竞态期间已绘制的图形残留导致「中央闪现爆炸/火箭」。
 */
function clearAllGameGraphics() {
    curveGfx?.clear()
    staticCurveGfx?.clear()
    tipCurveGfx?.clear()
    if (rocketMarkerCtl) rocketMarkerCtl.reset()
    else {
        rocketGfx?.clear()
        hideRocketRipplesCompletely()
    }
}

/**
 * 统一的 defer 检查：同时检查同步标志（绕过 Vue 微任务竞态）和响应式 computed。
 * 所有绘制路径（ticker帧 / resize / visibility恢复）都必须通过此函数判断，
 * 不得直接读取 deferInitialCrashPresentation.value。
 */
function shouldDeferCrashRendering(): boolean {
    return _syncDeferCrashRendering || deferInitialCrashPresentation.value
}

function tickCrashBoomPixi() {
    if (crashBoomPlaying) {
        const elapsed = performance.now() - crashBoomStartMs
        if (elapsed >= BANG_GIF_SHOW_MS) {
            crashBoomPlaying = false
        }
    }
}

function preloadImage(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const img = new Image()
        img.decoding = "async"
        img.onload = () => resolve()
        img.onerror = () => reject(new Error(`image load failed: ${src}`))
        img.src = src
    })
}

function ensureBangGifReady(): Promise<void> {
    if (bangGifReadyPromise) return bangGifReadyPromise
    bangGifReadyPromise = (async (): Promise<void> => {
        if (!import.meta.client) return
        try {
            await preloadImage(BANG_GIF_URL)
        } catch (e) {
            if (import.meta.dev) console.warn("[GameCanvas] bang.gif preload failed", e)
        }
    })()
    return bangGifReadyPromise
}

//开始爆炸动画（GIF 与音效解耦：GIF 必出；音效仅受 soundState 控制）
function startCrashBoomPixi(x: number, y: number) {
    if (shouldDeferCrashRendering()) return
    // 标记本局爆炸管线已启动，供 crashed 降帧分支判断；与音效去重分离，避免「未出声却锁死」
    crashBoomRoundStarted = true
    crashBoomPlaying = true
    crashBoomStartMs = performance.now()

    // 爆炸后清空逃离队列，停止继续随机下落
    clearCrashEscapedQueue()
    stopAllChips()

    bangGifX.value = x
    bangGifY.value = y
    // scale relative to rocket vector radius (tuned to resemble sprite boom size)
    bangGifScale.value = Math.max(0.5, Math.min(1.6, (getRocketVectorDrawRadiusPx() * 5) / 220))

    const scheduleBangTimers = () => {
        if (bangGifHideTimer) clearTimeout(bangGifHideTimer)
        bangGifHideTimer = setTimeout(() => {
            bangGifVisible.value = false
            bangGifHideTimer = null
        }, BANG_GIF_SHOW_MS)

        if (bangNameParticleTimer) clearTimeout(bangNameParticleTimer)
        bangNameParticleTimer = setTimeout(() => {
            bangNameParticleTimer = null
            explosionNamesCtl?.spawn(x, y)
        }, BANG_NAME_PARTICLE_DELAY_MS)
    }

    const revealBangGif = () => {
        bangGifNonce.value = Date.now()
        bangGifVisible.value = true
        scheduleBangTimers()
    }

    const revealWhenReady = () => {
        void ensureBangGifReady()
            .catch(() => { /* GIF 预加载失败时仍尝试挂 img，让浏览器自行加载 */ })
            .then(() => {
                if (isDisposed || !crashBoomPlaying || shouldDeferCrashRendering()) {
                    if (shouldDeferCrashRendering()) crashBoomPlaying = false
                    return
                }
                revealBangGif()
            })
    }

    // WebKit：同 tick 内 v-if 挂载 + 换 query 偶现首帧不解码；layout/滑动 后需再等 1～2 帧再挂图
    if (isAppleTouchDevice()) {
        bangGifVisible.value = false
        void nextTick(() => {
            if (isDisposed) return
            requestAnimationFrame(() => {
                if (isDisposed) return
                requestAnimationFrame(() => {
                    if (isDisposed) return
                    revealWhenReady()
                })
            })
        })
    } else {
        revealWhenReady()
    }

    // 爆炸音仅在 `handleCrashedPhase` 播一次（与 GIF 解耦），避免与 game_id watch 交错导致间隔无声
}

async function loadCrashBoomPixiAssets() {
    // 爆炸改为 DOM gif，这里仅保留 name 粒子层
    if (isDisposed || !app) return
    if (import.meta.client) {
        void ensureBangGifReady()
        ensureCrashBoomAudioPool()
    }
    try {
        const layer = new Container()
        layer.eventMode = "none"
        layer.sortableChildren = false
        app.stage.addChild(layer)
        explosionNamesCtl = createExplosionNamesController({
            layer,
            collectLabels: collectUnescapedNickLabelsForExplosion,
            getRocketVectorRadiusPx: getRocketVectorDrawRadiusPx,
        })
    } catch (e) {
        if (import.meta.dev) console.warn("[GameCanvas] explosionNamesLayer init failed", e)
    }
}

// ─── Curve data ──────────────────────────────────────────────────
let curveData: CurvePoint[] = []
let lastSampleTime = -1
let liveTipTime = 0
let liveTipMult = 1
let liveTipRaw = 1
let curveGeometryVersion = 0
let cachedParametricVersion = -1
let cachedParametricCrashKey = ""
/** 与 `lastPlotMultForDraw` 超过 `HIGH_MULT_CPU_RELAX_THRESHOLD` 时的参数化档位一致，用于缓存失效 */
let cachedParametricRelaxKey = -1
const cachedParametricBaseRows: CurveSampleRow[] = []
let currentRocketAngle = -Math.PI / 4
let currentPlotCrashPoint: number | null = null
/** 爆炸/结算阶段冻结最终曲线，避免 axis/view 继续缓动造成曲线上浮 */
let _crashFrozenCurvePts: ScreenPoint[] | null = null
let _crashFrozenCurveDrawn = false

// ─── DOM refs ────────────────────────────────────────────────────
const pixiHost = ref<HTMLDivElement | null>(null)
const gameContainer = ref<HTMLDivElement | null>(null)
const canvasWrapper = ref<HTMLDivElement | null>(null)
const countdownProgressRef = ref<HTMLDivElement | null>(null)

// ─── Reactive state ──────────────────────────────────────────────
/** 窄屏（宽度 < 768px）布局：加粗曲线、加大 plot 内边距，避免网格/曲线压住 HTML 刻度 */
const isH5Layout = ref(false)
const isReady = ref(false)
const isGameOver = ref(false)
const showCountdown = ref(false)
const countdownTime = ref("5")
/** 首帧在 `crashRoomState` 未到前不展示倍数块，默认用「—」避免闪 1.00x */
const displayMultiplier = ref<string>("—")
/** 中央倍数一次性放大闪烁（由 hudFlashStep 跨档触发） */
const hudFlashPlaying = ref(false)
const gamePhase = ref<"waiting" | "countdown" | "flying" | "crashed">("waiting")
const crashFlashActive = ref(false)
/**
 * 本连接上 `s2c_join` 首帧房间快照是否已是坠毁/结算（由 `crashJoinSnapshotApplied` 边沿写入）。
 * 与「是否见过 flying」解耦：进房首包即 flying 时服务端仍可能带误报/竞态，不应据此关掉首屏坠毁遮罩。
 */
const initialJoinSnapshotWasCrashedRound = ref(false)
/** 本连接上是否已出现过下注倒计时阶段（收到过 `phase === "betting"`） */
const hasSeenBettingPhaseSinceWsConnect = ref(false)
/**
 * 进房首包已是坠毁/结算：全屏「等数据」直至下一局 `betting`（倒计时），且不播中央爆炸。
 * 本局中途刷新且首包为 flying 的，仍按正常坠毁播爆炸。
 */
const deferInitialCrashPresentation = computed(() => {
    const s = crashRoomState.value
    if (!s) return false
    const crashedNow = !!(s.crashed || s.phase === "crashed" || s.phase === "settling")
    return (
        crashedNow &&
        initialJoinSnapshotWasCrashedRound.value &&
        !hasSeenBettingPhaseSinceWsConnect.value
    )
})
// 使用 shallowRef 替代 ref —— tick 数组整体替换时触发更新，不深度追踪每个元素
const yAxisTicks = shallowRef<CrashAxisTick[]>([])
const xAxisTicks = shallowRef<CrashAxisTick[]>([])
/** 与 _plotL 同步：左侧倍率刻度条像素宽，保证文字在竖向网格线左侧且随画布缩放 */
const yAxisGutterWidthPx = ref(48)
const axisFrameStyle = ref<Record<string, string>>({
    left: "48px",
    top: "24px",
    width: "690px",
    height: "348px",
})

// ─── HUD multiplier smoothing ────────────────────────────────────
/**
 * 中央倍数显示：用 elapsed_ms 外推的连续倍数（指数增长，天然“越大越快”），再做轻量平滑与单调递增保护，
 * 避免后端 multiplier 跳变导致 UI 数字跳动。
 */
let _hudMultSmooth = 1
// “跟手”或更“柔和”，只需要调 HUD_MULT_SMOOTH_RATE_PER_SEC：
// 更大：更贴近真实值（更快跟随）
// 更小：更柔和（更慢跟随）
const HUD_MULT_SMOOTH_RATE_PER_SEC = 14
/** 高倍时提高跟手速度，减轻「数字停几帧再跳」与 WS 外推不同步感 */
const HUD_MULT_SMOOTH_RATE_HIGH_MULT = 32
const HUD_MULT_SMOOTH_RATE_MID_MULT = 22

// ─── Canvas dimensions ──────────────────────────────────────────
/** 使用普通变量避免 computed 在热路径的开销；仅在 resize 时更新 */
let _canvasW = 750
let _canvasH = 420
let _scale = 1
/** 与 isH5Layout 同步，热路径用布尔避免读 ref（由画布宽度决定，用于内边距/曲线粗细/HTML 窄栏样式） */
let _isH5Layout = false
/** 画布较窄时火箭/头像标记半径 ×2（与 _canvasW 阈值同步，见 syncRocketMarkerSizeCaches） */
let _rocketMarkerDouble = false

let _PAD_L = 48
let _PAD_R = 12
let _PAD_T = 24
let _PAD_B = 48
let _plotL = 48
let _plotR = 738
let _plotT = 24
let _plotB = 372
let _plotW = 690
let _plotH = 348

/** 画布宽度小于该值时，火箭标记半径相对 design 13px 放大一倍（26×scale） */
const ROCKET_MARKER_DOUBLE_CANVAS_W_MAX = 600

/** @returns 是否跨越「窄画布」阈值（火箭半径/缓存需更新） */
function syncRocketMarkerSizeCaches(): boolean {
    const next = _canvasW < ROCKET_MARKER_DOUBLE_CANVAS_W_MAX
    if (next === _rocketMarkerDouble) return false
    _rocketMarkerDouble = next
    _lastBaseCurveHash = 0
    _lastFlyingHadLiveTip = null
    _lastRocketX = -1
    _lastRocketY = -1
    return true
}

function recalcLayoutConsts() {
    _scale = _canvasW / 750
    syncRocketMarkerSizeCaches()
    const wasH5 = _isH5Layout
    const h5 = _canvasW < 768
    if (h5 !== wasH5) {
        _isH5Layout = h5
        isH5Layout.value = h5
        _gridDirty = true
    }
    if (h5) {
        _PAD_L = (48 + 26) * _scale
        _PAD_R = (12 + 8) * _scale
        /** 加大顶边距，让网格/曲线整体下移，与 HUD、左侧倍率区留白更协调 */
        _PAD_T = (24 + 22) * _scale
        // 仅保留时间刻度行所需高度（与 .x-axis-overlay ~26px 匹配），减少曲线底与刻度间暗色空带
        _PAD_B = (48 + 14) * _scale
    } else {
        _PAD_L = 48 * _scale
        _PAD_R = 12 * _scale
        _PAD_T = (24 + 8) * _scale
        _PAD_B = 48 * _scale
    }
    _plotL = _PAD_L
    _plotR = _canvasW - _PAD_R
    _plotT = _PAD_T
    _plotB = _canvasH - _PAD_B
    _plotW = _plotR - _plotL
    if (_plotW < 1) _plotW = 1
    _plotH = _plotB - _plotT
    if (_plotH < 1) _plotH = 1
    yAxisGutterWidthPx.value = Math.max(0, Math.round(_plotL))
    axisFrameStyle.value = {
        left: `${Math.round(_plotL)}px`,
        top: `${Math.round(_plotT)}px`,
        width: `${Math.round(_plotW)}px`,
        height: `${Math.round(_plotH)}px`,
    }
    refreshFrameLayoutCache()
}

// ─── View range ─────────────────────────────────────────────────
/** 略小于旧 11.3s：初段时间轴占宽更多，曲线更早显出弯折（与纵轴鼓形配合） */
const MIN_VIEW_TIME_SPAN_SEC = 11.3
let viewMaxX = MIN_VIEW_TIME_SPAN_SEC
let smoothViewMaxX = MIN_VIEW_TIME_SPAN_SEC
let targetMaxX = MIN_VIEW_TIME_SPAN_SEC
const X_AXIS_TIP_TARGET_RATIO = 0.987
const VIEW_MAX_X_LERP = 0.72
const VIEW_MAX_X_LERP_GAP_MID = 0.10
const VIEW_MAX_X_LERP_BOOST_MID = 0.12
const VIEW_MAX_X_LERP_GAP_LARGE = 0.25
const VIEW_MAX_X_LERP_BOOST_LARGE = 0.16
const PLOT_AXIS_TOP_HEADROOM_RATIO = 1.025
const CURVE_PLOT_UPWARD_NUDGE_PX = 9.5
let currentRawMult = 1
let lastPlotMultForDraw = 1

/** 圆形头像固定朝向（弧度），不随曲线切线旋转；矢量火箭仍用 angle */
const ROCKET_AVATAR_FIXED_ROTATION_RAD = 0
/** 飞行中曲线上人员头像描边宽度（屏幕像素） */
const ROCKET_AVATAR_BORDER_PX = 1.5

/** 安全区内归一化 nx/nyUp 超过阈值时视为「右上角」，才可能启用短距拍动 */
const ROCKET_PAT_ZONE_NX_MIN = 0.68
const ROCKET_PAT_ZONE_NY_MIN = 0.58
/** 游戏倍数 ≥ 此值（含）才出现拍动，与「2 倍及以后」一致 */
const ROCKET_PAT_MIN_MULT = 2
/** 沿 45°（左上 ↔ 右下）像素拍动半幅，宜小避免露出标记下曲线 */
const ROCKET_PAT_AMPLITUDE_PX = 0.8
/** 高频（与 performance.now() 相乘，越大越快） */
const ROCKET_PAT_FREQ = 0.028

function isRocketInUpperRightPatZone(px: number, py: number): boolean {
    const c = _frameLayoutCache
    const sw = Math.max(c.safePlotW, 1e-6)
    const sh = Math.max(c.safePlotH, 1e-6)
    const nx = (px - c.plotLv) / sw
    const nyUp = (c.plotBv - c.nudgeY - py) / sh
    return nx >= ROCKET_PAT_ZONE_NX_MIN && nyUp >= ROCKET_PAT_ZONE_NY_MIN
}

/**
 * 右上角且倍数 ≥ ROCKET_PAT_MIN_MULT：以锚点为原点沿 45° 短距高频拍动（不旋转）。
 * 沿屏幕「左上 ↔ 右下」对角线：s>0 偏右下，s<0 偏左上（ox、oy 同号）。
 * 已爆炸/结算阶段不应用。
 */
function applyRocketMarkerPatFromPose(pose: RocketPose, gameMultiplier: number) {
    const rs = crashRoomState.value
    if (rs && (rs.crashed || rs.phase === "crashed" || rs.phase === "settling")) return
    const m = Number(gameMultiplier)
    const multOk = m === m && m >= ROCKET_PAT_MIN_MULT
    const inZone = isRocketInUpperRightPatZone(pose.x, pose.y)
    const s = inZone && multOk ? Math.sin(performance.now() * ROCKET_PAT_FREQ) * ROCKET_PAT_AMPLITUDE_PX : 0
    const k = Math.SQRT1_2
    const ox = s * k
    const oy = s * k
    if (rocketMarkerCtl) {
        rocketMarkerCtl.applyPatOffset(pose, ox, oy)
        return
    }
    if (rocketGfx?.visible) {
        rocketGfx.x = pose.x + ox
        rocketGfx.y = pose.y + oy
        rocketGfx.rotation = pose.angle
    }
    if (rocketAvatarRoot?.visible) {
        rocketAvatarRoot.x = pose.x + ox
        rocketAvatarRoot.y = pose.y + oy
        rocketAvatarRoot.rotation = ROCKET_AVATAR_FIXED_ROTATION_RAD
    }
}

/** 矢量火箭 / 圆形头像：基准 13 设计 px；画布宽 <600 时等效 26（×2） */
const ROCKET_MARKER_RADIUS_BASE_DESIGN_PX = 13
/**
 * 画布宽 ≥ 此值时，头像/矢量火箭半径不再随画布变宽继续放大或切换「单倍」变小，
 * 固定为与「宽 500px 且仍用窄屏双倍(26)」相同的屏幕像素，保证宽屏列表与曲线上头像尺寸一致。
 */
const ROCKET_MARKER_RADIUS_LOCK_MIN_CANVAS_W = 500

function getRocketMarkerRadiusPx(): number {
    if (_canvasW >= ROCKET_MARKER_RADIUS_LOCK_MIN_CANVAS_W) {
        const lockScale = ROCKET_MARKER_RADIUS_LOCK_MIN_CANVAS_W / 750
        return ROCKET_MARKER_RADIUS_BASE_DESIGN_PX * 2 * lockScale
    }
    return ROCKET_MARKER_RADIUS_BASE_DESIGN_PX * (_rocketMarkerDouble ? 2 : 1) * _scale
}

/** 仅矢量火箭绘制用，略小于头像半径；再乘以下系数单独缩小矢量体（不影响圆形头像） */
const ROCKET_VECTOR_DISPLAY_SCALE = 0.82
/** 矢量火箭相对「头像基准半径×ROCKET_VECTOR_DISPLAY_SCALE」再缩小 1/4（半径 ×0.75） */
const ROCKET_VECTOR_ONLY_SIZE_MULT = 0.75
function getRocketVectorDrawRadiusPx(): number {
    return getRocketMarkerRadiusPx() * ROCKET_VECTOR_DISPLAY_SCALE * ROCKET_VECTOR_ONLY_SIZE_MULT
}

/** 爆炸/坠毁后矢量火箭配色（比 #fb7185 更淡的玫瑰粉） */
const ROCKET_CRASH_BODY = 0xfb7185

function isCrashRocketTintPhase(): boolean {
    const s = crashRoomState.value
    return !!(s && (s.crashed || s.phase === "crashed" || s.phase === "settling"))
}

let _lastRocketCrashTint = false

/** 光晕从圆心向外超出本体边缘的扩散带宽度（px） */
const ROCKET_GLOW_OUTER_EXTRA_PX = 10
/** 单层水波纹从本体边缘扩到外侧的周期（ms），数值越小频率越快 */
const ROCKET_RIPPLE_CYCLE_MS = 820
/** phase≈0 时仍保证有贴边环形带，避免线宽为 0 */
const ROCKET_RIPPLE_MIN_BAND_PX = 0.85

/**
 * 单层水波纹：描边中线在 (r + band/2)，线宽为 band，使内侧始终贴齐本体半径 r、外侧扫到 r+extra，
 * 不会出现「细环外移」在头像/火箭与光晕之间的露底黑缝。
 */
function paintRippleGlowRing(g: Graphics, contentRadiusR: number) {
    g.clear()
    const extra = ROCKET_GLOW_OUTER_EXTRA_PX
    const phase = (performance.now() / ROCKET_RIPPLE_CYCLE_MS) % 1
    const r = contentRadiusR
    const R_out = r + phase * extra
    const bandW = Math.max(R_out - r, ROCKET_RIPPLE_MIN_BAND_PX)
    const midR = r + bandW / 2
    const tail = 1 - phase
    const alpha = 0.14 + 0.38 * tail * tail
    g.circle(0, 0, midR)
    g.stroke({ width: bandW, color: 0x22d3ee, alpha })
}

/** 仅飞行中显示；倒计时、下注、爆炸/坠毁后不显示波纹 */
function shouldDrawRocketRipples(): boolean {
    if (showCountdown.value) return false
    const s = crashRoomState.value
    if (!s) return false
    if (s.phase === "betting") return false
    if (s.phase !== "flying" || s.crashed) return false
    return true
}

function hideRocketRipplesCompletely() {
    rocketMarkerCtl?.hideGlows()
    if (!rocketMarkerCtl) {
        rocketVectorGlowGfx?.clear()
        if (rocketVectorGlowGfx) rocketVectorGlowGfx.visible = false
        rocketAvatarGlowGfx?.clear()
        if (rocketAvatarGlowGfx) rocketAvatarGlowGfx.visible = false
    }
}


let _glowFrameCounter = 0

function tickRocketMarkerGlows() {
    if (rocketMarkerCtl) {
        rocketMarkerCtl.tickGlows()
        return
    }
    // 兜底（理论上不会走到）：保持旧行为
    if (!app) return
    if (!shouldDrawRocketRipples()) {
        hideRocketRipplesCompletely()
        return
    }
    const rFull = getRocketMarkerRadiusPx()
    const rVec = getRocketVectorDrawRadiusPx()
    _glowFrameCounter++
    // 移动端每 4 帧更新一次光晕（降低 GPU stroke 开销，减轻发烫）；桌面端保持每 2 帧
    const glowSkip = _isH5Layout ? 3 : 1
    if ((_glowFrameCounter & glowSkip) !== 0) return
    if (rocketVectorGlowGfx && rocketGfx?.visible) {
        rocketVectorGlowGfx.visible = true
        rocketVectorGlowGfx.x = rocketGfx.x
        rocketVectorGlowGfx.y = rocketGfx.y
        rocketVectorGlowGfx.rotation = rocketGfx.rotation
        paintRippleGlowRing(rocketVectorGlowGfx, rVec)
    }
    if (rocketAvatarGlowGfx && rocketAvatarRoot?.visible) {
        rocketAvatarGlowGfx.visible = true
        rocketAvatarGlowGfx.x = 0
        rocketAvatarGlowGfx.y = 0
        rocketAvatarGlowGfx.rotation = 0
        paintRippleGlowRing(rocketAvatarGlowGfx, rFull)
    }
}
// ─── Plot clock ─────────────────────────────────────────────────
let plotElapsedMsFrozen = 0
let lastPlotElapsedMs = 0
let lastMonotonicPlotElapsedMs = 0
let lastKeyframeWallMs = 0
const KEYFRAME_INTERVAL_MS = 50
/** 低倍区分档阈值：用于 grid 选「低倍六档」与「线性五档」。曾经也用于 keyframe 短间隔，已废弃该用法。 */
const LOW_MULT_KEYFRAME_MULT_THRESHOLD = 2.2

// ─── WS flying clock ────────────────────────────────────────────
let lastRoomPhase = ""
/** 与 HUD 闪烁档位对齐，避免进飞行首帧误闪 */
let _lastHudFlashStep = -1
const flyingClockState: FlyingClockState = {
    wsElapsedMs: 0,
    lastWsVersion: -1,
    lastWsTickWall: 0,
    curWsMult: 1,
    lastRenderedElapsedMs: 0,
    lastAuthoritativeElapsedMs: -1,
    clockCorrectionMs: 0,
    lastRenderWall: 0,
}

// ─── Countdown ──────────────────────────────────────────────────
let cdTotalMs = 0
let cdRemainMs = 0
let cdWall = 0

// ─── Timers ─────────────────────────────────────────────────────
let resizeObserver: ResizeObserver | null = null
let resizeRafId = 0
let visibilityHandler: (() => void) | null = null
let windowBlurHandler: (() => void) | null = null
let windowFocusHandler: (() => void) | null = null
let pageShowHandler: (() => void) | null = null

// ─── Dirty flags for conditional redraws ────────────────────────
let _gridDirty = true
let _ticksDirty = true
/** 暂停 Pixi 网格线绘制：iOS 曲线飞行时网格 Graphics 重绘会与曲线/火箭抢 GPU。 */
const CRASH_GRID_LINES_ENABLED = false
/** 静态基础曲线几何哈希（飞行分段模式）：base 段仅在此变化时重绘 */
let _lastBaseCurveHash = 0
/** 飞行段是否存在 live tip；与 baseHash 解耦，用于在 tip 出现/消失时强制切换 static 仅描边 vs 含填充 */
let _lastFlyingHadLiveTip: boolean | null = null
/** 上一帧 rocketPose 的 x/y（像素级变化才重绘；坠毁曲线异常为空时也可作最后兜底锚点） */
let _lastRocketX = -1
let _lastRocketY = -1
/** defer 激活后是否已清除过残留图形（避免每帧重复 clear 导致闪烁） */
let _deferGraphicsCleared = false
/**
 * 【关键】同步 defer 标志位（非响应式），用于解决 Vue 微任务调度 vs Pixi RAF 宏任务的竞态。
 *
 * 问题：crashJoinSnapshotApplied watcher 设置 initialJoinSnapshotWasCrachedRound=true
 *       → deferInitialCrashPresentation computed 重新计算 → 值通过 Vue 微任务队列异步生效
 *       → 但 Pixi ticker 由 RAF（宏任务）驱动，可能在 Vue flush 前就读到旧值 false
 *       → 导致 crashed 分支绘制 1-3 帧后才被 clearAllGameGraphics 清除
 *
 * 解决：在本 watcher 同步调用栈中直接设此普通变量，ticker 和所有绘制路径读取它时
 *       无需等待 Vue flush，立即可见。
 */
let _syncDeferCrashRendering = false

/** 抽离模块：火箭/头像/光晕控制器（渲染与纹理加载都在模块内） */
let rocketMarkerCtl: RocketMarkerController | null = null
let fallChipsCtl: FallChipsController | null = null
let explosionNamesCtl: ExplosionNamesController | null = null

// ─── Production-switchable curve smoothness instrumentation ───────
/**
 * 低倍数段“轻微停顿感”排查用：统计飞行阶段 base 重绘频率、tip 更新频率、curveGeometryVersion 推进频率。
 *
 * 说明：
 * - 默认关闭，开发/生产都必须显式打开；不会改动曲线绘制逻辑。
 * - 日志节流为每 2 秒输出一次，避免刷屏。
 *
 * 开关：
 * - 构建环境：`VITE_CRASH_CURVE_DEBUG=true`
 * - 控制台临时开启：`window.__CRASH_CURVE_DEBUG__ = true`
 * - 持久开启：`localStorage.setItem('__CRASH_CURVE_DEBUG__', 'true')`
 */
/** 曲线 debug 运行时开关名，window 与 localStorage 共用同一个 key。 */
const CRASH_CURVE_DEBUG_FLAG = "__CRASH_CURVE_DEBUG__"
/** 曲线 debug 开关缓存，避免每帧读取 localStorage 影响低倍曲线性能。 */
let _curveDebugEnabledCache = false
/** 上次刷新曲线 debug 开关的时间戳；生产环境通过 1s 轮询支持运行时开关。 */
let _curveDebugFlagLastCheckWall = 0
/** 曲线 debug 开关刷新间隔，兼顾运行时可切换和热路径开销。 */
const CURVE_DEBUG_FLAG_CHECK_INTERVAL_MS = 1000

/** 从 env/window/localStorage 读取曲线 debug 开关；localStorage 异常时保持关闭。 */
function readCrashCurveDebugFlag(): boolean {
    if (import.meta.env.VITE_CRASH_CURVE_DEBUG === "true") return true
    if (typeof window === "undefined") return false
    if (Reflect.get(window, CRASH_CURVE_DEBUG_FLAG) === true) return true
    try {
        return window.localStorage?.getItem(CRASH_CURVE_DEBUG_FLAG) === "true"
    } catch {
        return false
    }
}

/** 是否启用曲线 debug；结果短暂缓存，避免生产热路径频繁读存储。 */
function isCrashCurveDebugEnabled(): boolean {
    const now = performance.now()
    if (
        _curveDebugFlagLastCheckWall <= 0 ||
        now - _curveDebugFlagLastCheckWall > CURVE_DEBUG_FLAG_CHECK_INTERVAL_MS
    ) {
        _curveDebugFlagLastCheckWall = now
        _curveDebugEnabledCache = readCrashCurveDebugFlag()
    }
    return _curveDebugEnabledCache
}

interface CurveBaseHashParts {
    geomVer: number
    viewQ: number
    axisQ: number
    crashQ: number
    rocketBit: number
}

const _curveDbg = {
    /** 上次输出 debug 日志的 wall time */
    lastPrintWall: 0,
    /** 当前统计窗口内的飞行渲染帧数 */
    framesFlying: 0,
    /** 当前统计窗口内有 live tip 的帧数 */
    framesWithLiveTip: 0,
    /** 当前统计窗口内 base 曲线重绘次数 */
    baseRedraws: 0,
    /** 当前统计窗口内 tip 曲线重绘次数 */
    tipRedraws: 0,
    /** 当前统计窗口内 curveGeometryVersion 推进次数 */
    geomBumps: 0,
    /** 上次观察到的 curveGeometryVersion */
    lastSeenGeomVer: -1,
    /** 当前统计窗口内最后一次绘制倍率 */
    lastSeenPlotMult: 1,
    /** 当前统计窗口内上一次飞行 elapsed，用于识别本地时钟是否卡住 */
    lastSeenPlotElapsedMs: -1,
    /** 当前统计窗口内 elapsed 推进小于 0.5ms 的帧数 */
    nearStallFrames: 0,
    /** 当前统计窗口内最大“画布时间 - 服务端 elapsed_ms”差值 */
    maxVisualAheadServerMs: 0,
    /** baseHash 组成拆分（对应 computeBaseCurveHash 的量化项） */
    lastBaseHashParts: null as CurveBaseHashParts | null,
    /** base 重绘原因计数，用于判断是几何、视口还是纵轴触发重绘 */
    baseRedrawReasons: {
        geomVer: 0,
        viewQ: 0,
        axisQ: 0,
        crashQ: 0,
        rocketBit: 0,
        unknown: 0,
    },
}

// ─── Frame throttle for non-flying phases ───────────────────────
/** 非飞行阶段帧计数器，每 N 帧才执行完整更新 */
let _frameCounter = 0
const IDLE_FRAME_SKIP = 4 // betting/crashed 时每 4 帧更新一次 (~15fps)

// ─── Ticker：根据倍数分档限帧 ────────────────────────────────
/** 桌面端飞行帧率：平衡流畅度与 CPU/GPU 开销 */
const TICKER_MAX_FPS_FLYING_DESKTOP = 30
/** 移动端飞行帧率：iPhone 等设备 30fps 仍易发烫，20fps 肉眼差异可接受 */
const TICKER_MAX_FPS_FLYING_MOBILE = 30
const TICKER_MAX_FPS_FLYING_HIGH = 16
const TICKER_MAX_FPS_FLYING_EXTREME = 12
const TICKER_MAX_FPS_DEFAULT = 50
/** defer 模式下极低帧率：仅保持 ticker 存活，几乎不消耗 CPU/GPU */
const TICKER_MAX_FPS_DEFER = 4
let _lastTickerFlyingPhase: boolean | null = null

function syncTickerFpsWithPhase() {
    if (!app?.ticker) return
    const s = crashRoomState.value
    const flying = !!(s && s.phase === "flying" && !s.crashed)
    let targetFps: number
    if (!flying) {
        targetFps = TICKER_MAX_FPS_DEFAULT
    } else if (lastPlotMultForDraw > 1000) {
        targetFps = TICKER_MAX_FPS_FLYING_EXTREME
    } else if (lastPlotMultForDraw > 100) {
        targetFps = TICKER_MAX_FPS_FLYING_HIGH
    } else {
        // 移动端降低帧率以减轻 CPU/GPU 发热（iPhone 尤其敏感）
        targetFps = _isH5Layout ? TICKER_MAX_FPS_FLYING_MOBILE : TICKER_MAX_FPS_FLYING_DESKTOP
    }
    if (_lastTickerFlyingPhase === flying && app.ticker.maxFPS === targetFps) return
    _lastTickerFlyingPhase = flying
    app.ticker.maxFPS = targetFps
}

// ─── 下落昵称 chips（已抽离到 fallChips.ts）─────────────────────────

// ─── Computed UI ────────────────────────────────────────────────
const phaseLabel = computed(() => {
    const m: Record<string, string> = { waiting: "OFFLINE", countdown: "WAITING", crashed: "CRASHED", flying: "FLYING" }
    return m[gamePhase.value] || "FLYING"
})

const hudSubtitle = computed(() => {
    const p = gamePhase.value
    /** `gamePhase==='waiting'` 在 watch 里表示尚无 `crashRoomState` 快照，不等价于「WS 未连接」 */
    if (p === "waiting") {
        return crashWsConnected.value
            ? $t("game.crash.waiting_for_room_sync")
            : $t("game.crash.waiting_for_data")
    }
    if (p === "crashed") return $t("game.crash.round_settled")
    if (p === "flying") return $t("game.crash.cash_out_anytime")
    if (p === "countdown") {
        const t = parseFloat(countdownTime.value)
        if (!Number.isFinite(t) || t < 0.05) return $t("game.crash.starting")
        return $t("game.crash.round_starts_in", { time: t.toFixed(1) })
    }
    return ""
})

/**
 * 中央倍数闪烁档位（单调递增，随 m 增大）。
 * - 1–8×：每 1× 一档（原样）
 * - 8–100×：每 2× 一档（与原 `10 + floor((x-8)/2)` 一致）
 * - 100–200×：每 5× 一档
 * - 200–500×：每 10× 一档
 * - 500–1000×：每 15× 一档，避免高倍区间「每帧跨档」叠 CSS 缩放动画
 * - >1000×：每 100× 一档，减轻 2000× 附近手机 compositor 与 rAF 压力
 */
function hudFlashStep(m: number): number {
    const x = Math.max(1, m)
    if (x <= 8) return Math.floor(x)
    if (x <= 100) return 10 + Math.floor((x - 8) / 2)
    const stepAt100 = 10 + Math.floor((100 - 8) / 2)
    if (x <= 200) return stepAt100 + Math.floor((x - 100) / 5)
    const stepAt200 = stepAt100 + Math.floor((200 - 100) / 5)
    if (x <= 500) return stepAt200 + Math.floor((x - 200) / 10)
    const stepAt500 = stepAt200 + Math.floor((500 - 200) / 10)
    if (x <= 1000) return stepAt500 + Math.floor((x - 500) / 15)
    const stepAt1000 = stepAt500 + Math.floor((1000 - 500) / 15)
    return stepAt1000 + Math.floor((x - 1000) / 100)
}

/**
 * 每次档位上升都要重新触发一次 CSS animation；若上一段仍在播放，仅设 true 不会重播。
 * 先清 class 再下一帧加回，保证 keyframes 从 0% 重跑（双 rAF 确保布局已提交）。
 */
function triggerHudFlashPing() {
    // 高频触发时去重，避免 rAF 回调队列爆炸
    if (_hudFlashRafPending) return
    _hudFlashRafPending = true
    hudFlashPlaying.value = false
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            hudFlashPlaying.value = true
            _hudFlashRafPending = false
        })
    })
}

function onHudFlashAnimationEnd(e: Event) {
    const ae = e as AnimationEvent
    const n = ae.animationName
    if (
        n !== "multiplier-flash-ping" &&
        n !== "multiplier-flash-ping-crashed" &&
        n !== "multiplier-flash-ping-h5" &&
        n !== "multiplier-flash-ping-crashed-h5"
    )
        return
    hudFlashPlaying.value = false
}

function plotMultAtElapsedMsForCurve(elapsedMs: number): number {
    return plotMultForCanvas({ elapsedMs, crashPoint: currentPlotCrashPoint })
}

// ═════════════════════════════════════════════════════════════════
// COORDINATE MAPPING
// ═════════════════════════════════════════════════════════════════

let _smoothedAxisTop = 2.0
const _AXIS_TOP_SMOOTH_ALPHA = 0.82

/** 本帧曲线映射用的纵轴顶界：`toPixel` 只读此值，避免每点对 `getEffectiveMultAxisTopForPlot` 重复调用（数万次/帧） */
let _plotAxisTopForFrame = 2.0

function refreshPlotAxisTopForFrame() {
    _plotAxisTopForFrame = getEffectiveMultAxisTopForPlot()
}

function getEffectiveMultAxisTopForPlot(): number {
    const tipMult = lastPlotMultForDraw > 1.001 ? lastPlotMultForDraw : 1.001
    const instantTarget = tipMult * PLOT_AXIS_TOP_HEADROOM_RATIO
    const minTarget = instantTarget > 2.0 ? instantTarget : 2.0
    if (minTarget >= _smoothedAxisTop) {
        _smoothedAxisTop += (minTarget - _smoothedAxisTop) * _AXIS_TOP_SMOOTH_ALPHA
    } else {
        _smoothedAxisTop += (minTarget - _smoothedAxisTop) * 0.15
    }
    const floor = tipMult * PLOT_AXIS_TOP_HEADROOM_RATIO
    return _smoothedAxisTop > floor ? _smoothedAxisTop : floor
}

function getEffectiveTimeSpanForX(): number {
    let v = viewMaxX
    if (v < MIN_VIEW_TIME_SPAN_SEC) v = MIN_VIEW_TIME_SPAN_SEC
    return v > 1e-3 ? v : 1e-3
}

/** 帧布局缓存 */
const _frameLayoutCache = {
    plotLv: 0, plotRv: 0, plotTv: 0, plotBv: 0,
    scaleV: 1, nudgeY: 0, rocketMarkerEdgeInset: 0,
    safePlotRight: 0, safePlotTop: 0,
    safePlotW: 1, safePlotH: 1,
}

function refreshFrameLayoutCache() {
    const c = _frameLayoutCache
    c.plotLv = _plotL
    c.plotRv = _plotR
    c.plotTv = _plotT
    c.plotBv = _plotB
    c.scaleV = _scale
    c.nudgeY = CURVE_PLOT_UPWARD_NUDGE_PX * _scale
    const rocketRadius = getRocketMarkerRadiusPx()
    c.rocketMarkerEdgeInset = rocketRadius + 3
    const rocketInsetTop = rocketRadius * 1.8 + 3
    c.safePlotRight = _plotR - c.rocketMarkerEdgeInset
    if (c.safePlotRight < _plotL + 1) c.safePlotRight = _plotL + 1
    c.safePlotTop = _plotT + rocketInsetTop
    if (c.safePlotTop > _plotB - 1) c.safePlotTop = _plotB - 1
    c.safePlotW = c.safePlotRight - _plotL
    if (c.safePlotW < 1) c.safePlotW = 1
    c.safePlotH = _plotB - c.safePlotTop
    if (c.safePlotH < 1) c.safePlotH = 1
}

const _toPixelTmp: ScreenPoint = { x: 0, y: 0 }

/**
 * 横轴归一化 nx=time/xSpan。
 * 旧实现用全局 `_toPixelNxPinnedRight` 滞回：飞行帧先算 tip 再扫整条 base 时，同一帧内/帧间状态与
 * `lerpView` 每帧变化的 xSpan 耦合，易在「贴右缘」附近产生 nx 跳变（右上角抖）。
 * 改为无状态 clamp；指数曲线时间单调，夹到 [0,1] 即可。
 */
function toPixel(time: number, mult: number, _rawForY?: number): ScreenPoint {
    const c = _frameLayoutCache
    const xSpan = getEffectiveTimeSpanForX()
    let nx = time / xSpan
    if (nx < 0) nx = 0
    else if (nx > 1) nx = 1

    const m = mult > 1 ? mult : 1
    const topMult = _plotAxisTopForFrame
    const denom = topMult - 1
    // 低倍顶界≤2.05 时与刻度一致用减弱版线性+u^γ 混合；更高用完整鼓形（见 flightMath.multToPlotNy）
    let ny = multToPlotNy(m, topMult)
    if (denom <= 0.001) ny = 0
    if (ny < 0) ny = 0; else if (ny > 1) ny = 1

    _toPixelTmp.x = c.plotLv + nx * c.safePlotW
    _toPixelTmp.y = c.plotBv - ny * c.safePlotH - c.nudgeY
    return _toPixelTmp
}



function updateViewTargets(seconds: number) {
    const xCandidate = seconds / X_AXIS_TIP_TARGET_RATIO
    const xMin = xCandidate > MIN_VIEW_TIME_SPAN_SEC ? xCandidate : MIN_VIEW_TIME_SPAN_SEC
    if (xMin > targetMaxX) targetMaxX = xMin
}

/** 高倍/恢复帧中 elapsed 跳变时直接同步横轴，防止曲线末端被 clamp 到右侧形成竖线。 */
function snapViewIfLiveTipWouldClamp(seconds: number) {
    if (seconds <= 0) return
    const required = Math.max(MIN_VIEW_TIME_SPAN_SEC, seconds / X_AXIS_TIP_TARGET_RATIO)
    if (required > targetMaxX) targetMaxX = required
    /**
     * 高倍/恢复帧里 elapsed 可能一次跳很多。如果继续等 viewMaxX 缓动，
     * toPixel 会把末端多个点夹到同一个右边界 x，形成截图里的竖线。
     */
    if (seconds >= viewMaxX * 0.995 || required - viewMaxX > 0.2) {
        smoothViewMaxX = required
        viewMaxX = required
    }
}

/** 上一帧 viewMaxX / axisTop 量化快照，仅变化时标脏 */
let _lastGridViewMaxX = -1
let _lastGridAxisTop = -1

function lerpView() {
    const tx = targetMaxX
    const gap = tx - smoothViewMaxX
    const ag = gap > 0 ? gap : -gap
    let alpha = VIEW_MAX_X_LERP
    if (ag > VIEW_MAX_X_LERP_GAP_LARGE) {
        alpha = VIEW_MAX_X_LERP + VIEW_MAX_X_LERP_BOOST_LARGE
        if (alpha > 0.88) alpha = 0.88
    } else if (ag > VIEW_MAX_X_LERP_GAP_MID) {
        alpha = VIEW_MAX_X_LERP + VIEW_MAX_X_LERP_BOOST_MID
        if (alpha > 0.72) alpha = 0.72
    }
    // H5：横轴视窗略快跟上 target，减少「新刻度已钉右缘、smooth 仍滞后」的一帧叠影
    if (_isH5Layout && gap > 0.02) {
        alpha = Math.min(0.94, alpha + 0.1)
    }
    smoothViewMaxX += gap * alpha
    if (ag < 0.1) smoothViewMaxX = tx
    viewMaxX = smoothViewMaxX
    /**
     * 仅当 viewMaxX 或纵轴顶界发生「肉眼可察」变化时才标脏。
     * 旧阈值 0.02s / 0.005x 太敏 → 缓动每帧都让 grid 重画;放粗到 0.1s / 0.02x
     * 后,grid 重画频率从 30Hz 降到 1-3Hz,与 base 哈希命中策略保持一致。
     */
    const vxD = viewMaxX - _lastGridViewMaxX
    const atD = _plotAxisTopForFrame - _lastGridAxisTop
    if ((vxD > 0.1 || vxD < -0.1) || (atD > 0.02 || atD < -0.02)) {
        _gridDirty = true
        _lastGridViewMaxX = viewMaxX
        _lastGridAxisTop = _plotAxisTopForFrame
    }
}

// ═════════════════════════════════════════════════════════════════
// AXIS TICKS — 左侧倍数：低倍与曲线同用 multToPlotNy（顶界≤2.05 时轻鼓形）；高倍五档线性 ny
// ═════════════════════════════════════════════════════════════════

/** syncTicks 签名缓存，避免每帧触发 Vue DOM 更新 */
let _lastTicksSignature = ""

function syncTicks() {
    const topM = _plotAxisTopForFrame
    const c = _frameLayoutCache
    const xSpan = getEffectiveTimeSpanForX()
    // 量化签名：topM/xSpan/布局参数变化才重新生成 tick 数组
    const sig = `${(topM * 100 | 0)}_${(xSpan * 10 | 0)}_${(c.plotBv | 0)}_${(c.safePlotH | 0)}_${(c.nudgeY * 10 | 0)}_${(_plotL | 0)}_${(_plotW | 0)}`
    if (sig === _lastTicksSignature) return
    _lastTicksSignature = sig
    if (topM <= 2.05) {
        yAxisTicks.value = buildYAxisTicksLowBandLinearSix(topM, c.plotBv, c.safePlotH, c.nudgeY)
    } else {
        yAxisTicks.value = buildYAxisTicksFixedFive(1, topM, c.plotBv, c.safePlotH, c.nudgeY)
    }
    xAxisTicks.value = buildXAxisTicks(xSpan, _plotL, _plotW, xAxisTicks.value)
}

// ═════════════════════════════════════════════════════════════════
// DRAWING
// ═════════════════════════════════════════════════════════════════

function drawGrid() {
    if (!gridGfx || !_gridDirty) return
    _gridDirty = false
    gridGfx.clear()
    if (!CRASH_GRID_LINES_ENABLED) return

    // 横轴网格：所有线条一次性 stroke
    const cachedXTicks = xAxisTicks.value
    for (let i = 0; i < cachedXTicks.length; i++) {
        const x = cachedXTicks[i].position
        gridGfx.moveTo(x, _plotT)
        gridGfx.lineTo(x, _plotB)
    }
    if (cachedXTicks.length > 0) gridGfx.stroke({ width: 1, color: 0x4a5568, alpha: 0.12 })

    // 纵轴网格：所有线条一次性 stroke
    const c = _frameLayoutCache
    const topM = _plotAxisTopForFrame
    const useLowBandGrid = topM <= 2.05 && lastPlotMultForDraw < LOW_MULT_KEYFRAME_MULT_THRESHOLD
    if (useLowBandGrid) {
        for (let i = 0; i < DEFAULT_LOW_BAND_GRID_MULTS.length; i++) {
            const m = DEFAULT_LOW_BAND_GRID_MULTS[i]
            const ny = multToPlotNy(m, topM)
            const y = c.plotBv - ny * c.safePlotH - c.nudgeY
            gridGfx.moveTo(_plotL, y)
            gridGfx.lineTo(_plotR, y)
        }
    } else {
        const lo = 1
        const hi = Math.max(topM, lo + 1e-6)
        const den = hi - lo
        for (let j = 0; j < 5; j++) {
            const t = j / 4
            const m = lo + den * t
            const ny = multToLinearPlotNy(m, topM)
            const y = c.plotBv - ny * c.safePlotH - c.nudgeY
            gridGfx.moveTo(_plotL, y)
            gridGfx.lineTo(_plotR, y)
        }
    }
    gridGfx.stroke({ width: 1, color: 0x4a5568, alpha: 0.1 })
}

function updatePlotMask() {
    if (!plotMaskGfx) return
    plotMaskGfx.clear()
    const maskPad = 6 * _scale
    const mp = maskPad > 4 ? maskPad : 4
    plotMaskGfx.rect(
        _plotL - mp,
        _plotT - mp,
        _plotW + mp * 2,
        _plotH + mp * 2
    )
    plotMaskGfx.fill({ color: 0xffffff, alpha: 1 })
}

function bumpCurveGeometry() {
    curveGeometryVersion++
}

/**
 * 超过该倍数后略降参数化密度（与「飞得越久 curveData 越长」叠加）。
 * 阈值过低时中倍区也会变「折线感」；提高到 ~15× 再放松，优先保证观感。
 */
const HIGH_MULT_CPU_RELAX_THRESHOLD = 15

/** 常态（未进高倍降采样，≤15×） */
const PARAMETRIC_DEFAULT_OPTS: ParametricSegmentOpts = {
    maxSegments: 40,
    multDensityMul: 13,
    timeDensityMul: 26,
}

/** 高倍率（15x～1000x）：略收紧以减少 cached 行数 / 屏幕点；1000x+ 走 EXTREME */
const PARAMETRIC_RELAX_OPTS: ParametricSegmentOpts = {
    maxSegments: 44,
    multDensityMul: 9,
    timeDensityMul: 18,
}

/** 极高倍率（1000x+）：base 参数化略增一档，减轻折线感（仍只在该档位生效） */
const PARAMETRIC_EXTREME_OPTS: ParametricSegmentOpts = {
    maxSegments: 60,
    multDensityMul: 16,
    timeDensityMul: 30,
}

/** 根据当前倍数选择参数化配置 */
function getParametricOpts(): ParametricSegmentOpts {
    if (lastPlotMultForDraw > 1000) return PARAMETRIC_EXTREME_OPTS
    if (lastPlotMultForDraw > HIGH_MULT_CPU_RELAX_THRESHOLD) return PARAMETRIC_RELAX_OPTS
    return PARAMETRIC_DEFAULT_OPTS
}

/** 根据当前倍数动态调整 curveData 上限：高倍时屏幕左侧被压缩，不需要那么多关键帧 */
function getEffectiveCurveDataMaxLen(): number {
    const m = lastPlotMultForDraw
    if (m > 5000) return 120
    if (m > 1000) return 200
    if (m > 100) return 300
    return CURVE_DATA_MAX_LEN
}

/** 高倍时加大 keyframe 间隔，减少 rebuildParametricBaseRows 频率 */
function getKeyframeIntervalMs(): number {
    const m = lastPlotMultForDraw
    /**
     * 注：旧实现在 m < LOW_MULT_KEYFRAME_MULT_THRESHOLD（2.2x）时返回 34ms，
     * 与 30fps ticker 几乎同周期 → 每帧都 push keyframe 触发 rebuildParametricBaseRows
     * （整段重建参数化点，热路径里最重的一步），正好把 2-5x 启动区 CPU 钉死。
     * tip 段每帧更新已经够顺滑，中间补点交给参数化即可。
     */
    if (m > 5000) return 200
    if (m > 1000) return 150
    if (m > 100) return 100
    return KEYFRAME_INTERVAL_MS
}

/**
 * Pixi Graphics 折线/填充用的 base 顶点预算下限；高倍时 `getMaxBaseVerticesForGraphicsDraw` 会再提高。
 * 逻辑上仍用完整 `getCachedCurveBasePts` 供火箭姿态。
 */
const MAX_BASE_VERTICES_FOR_GRAPHICS_DRAW_BASE = 2600
const _basePtsDrawScratch: ScreenPoint[] = []

/**
 * Pixi 绘制用 base 抽稀预算：≤1000× 略收紧以减内存/GPU；>1000× 保持较高上限保尖端观感。
 */
function getMaxBaseVerticesForGraphicsDraw(): number {
    const m = lastPlotMultForDraw
    if (m > 1000) {
        if (m > 200) return 4200
        if (m > 80) return 3800
        if (m > 30) return 3400
        if (m > 15) return 3000
        return MAX_BASE_VERTICES_FOR_GRAPHICS_DRAW_BASE
    }
    if (m > 200) return 3300
    if (m > 80) return 2900
    if (m > 30) return 2600
    if (m > 15) return 2400
    return 2400
}

/** 飞行段 tip 很短但纵向变化大，段数上限略抬高可减轻「尖端」折线感 */
function getFlyingTipScreenOpts(): CurveSegmentScreenOpts {
    if (lastPlotMultForDraw <= HIGH_MULT_CPU_RELAX_THRESHOLD) {
        return { maxSegments: 44 }
    }
    const m = lastPlotMultForDraw
    // tip 段 appendCurveSegmentPoints 中 density≈ceil(|dy|/5)，高倍陡升易顶 cap，需高于 base PARAMETRIC
    if (m > 1000) return { maxSegments: 120 }
    if (m > 150) return { maxSegments: 64 }
    if (m > 60) return { maxSegments: 56 }
    if (m > 25) return { maxSegments: 50 }
    return { maxSegments: 48 }
}

/**
 * 屏幕空间方向抽稀：只合并近乎共线的连续段，弯曲区全部保留。
 * 配合 refineScreenPtsAtBends 使用——细分保证弯曲区足够密，抽稀只删平坦区冗余。
 */
function pickBasePtsForGraphicsDraw(full: ScreenPoint[]): ScreenPoint[] {
    const len = full.length
    const budget = getMaxBaseVerticesForGraphicsDraw()
    if (len <= budget) return full

    const out = _basePtsDrawScratch
    out.length = 0
    out.push(full[0]!)

    // 平坦区共线判定阈值：cos > 此值视为直线可合并
    const cosFlat = 0.9998  // cos(~1.1°)

    let prevKeptIdx = 0
    for (let i = 1; i < len - 1; i++) {
        const p = full[prevKeptIdx]!
        const c = full[i]!
        const n = full[i + 1]!
        const dx1 = c.x - p.x, dy1 = c.y - p.y
        const dx2 = n.x - c.x, dy2 = n.y - c.y
        const len1sq = dx1 * dx1 + dy1 * dy1
        const len2sq = dx2 * dx2 + dy2 * dy2

        // 段太短直接跳过
        if (len1sq < 0.5 && len2sq < 0.5) continue

        if (len1sq > 0.1 && len2sq > 0.1) {
            const dot = dx1 * dx2 + dy1 * dy2
            const lenProd = Math.sqrt(len1sq * len2sq)
            const cosA = dot / lenProd
            // 近乎直线 → 跳过
            if (cosA >= cosFlat && out.length < budget) continue
        }

        out.push(c)
        prevKeptIdx = i
    }

    out.push(full[len - 1]!)
    return out
}

function rebuildParametricBaseRows() {
    // 每次重建前重置 CurveSampleRow 池游标，否则多次 bump 后超过池容量会大量 new 小对象 → 长时间运行 GC 卡顿
    resetRowPoolForParametricRebuild()
    // 复用数组，清空但不重新分配
    cachedParametricBaseRows.length = 0
    const relaxKey = lastPlotMultForDraw > 1000 ? 2 : lastPlotMultForDraw > HIGH_MULT_CPU_RELAX_THRESHOLD ? 1 : 0
    if (curveData.length < 2) {
        cachedParametricVersion = curveGeometryVersion
        cachedParametricCrashKey = String(currentPlotCrashPoint ?? "")
        cachedParametricRelaxKey = relaxKey
        return
    }
    const paramOpts = getParametricOpts()
    for (let i = 0; i < curveData.length - 1; i++) {
        appendCurveSegmentParametricPoints(
            cachedParametricBaseRows,
            curveData[i],
            curveData[i + 1],
            i === 0,
            plotMultAtElapsedMsForCurve,
            paramOpts
        )
    }
    cachedParametricVersion = curveGeometryVersion
    cachedParametricCrashKey = String(currentPlotCrashPoint ?? "")
    cachedParametricRelaxKey = relaxKey
}

/** 复用的屏幕点数组 */
const _cachedScreenPts: ScreenPoint[] = []
/** 细分后的最终屏幕点（可能比 _cachedScreenPts 更多） */
const _refinedScreenPts: ScreenPoint[] = []
/** 屏幕坐标映射缓存 key（viewMaxX/axisTop/布局参数量化）*/
let _screenPtsCacheKey = ""
let _screenPtsCacheValid = false

function makeScreenPtsCacheKey(): string {
    const c = _frameLayoutCache
    /**
     * 与 computeBaseCurveHash 保持一致的粗量化:axisTop/viewMaxX 不再用千/百分位,
     * 否则缓动每帧改 key,getCachedCurveBasePts 每帧 toPixel 整条 base 上百点。
     */
    const axisQ = _plotAxisTopForFrame > 2.05
        ? (_plotAxisTopForFrame * 8 | 0)
        : (_plotAxisTopForFrame * 40 | 0)
    return `${(viewMaxX * 4 | 0)}_${axisQ}_${(c.plotBv | 0)}_${(c.safePlotW | 0)}_${(c.safePlotH | 0)}_${(c.nudgeY | 0)}_${(c.plotLv | 0)}`
}

function invalidateScreenPtsCache() {
    _screenPtsCacheValid = false
}

/**
 * 屏幕空间自适应细分：对相邻点之间角度偏转过大的区间，插入中间采样点。
 * 这是解决"高倍曲线变形"的根本方案——无论 1000x 还是 100000x，
 * 弯曲区总能自动获得足够的采样密度。
 *
 * 原理：检测 P[i-1]→P[i] 和 P[i]→P[i+1] 的夹角，如果角度偏转超过阈值，
 * 则在 P[i-1] 和 P[i] 之间的时间中点处插入新的点（通过 toPixel 精确计算）。
 * 最多递归 MAX_REFINE_DEPTH 层，控制总点数。
 */
const REFINE_COS_THRESHOLD = 0.992  // cos(~7.2°)，≤1000×
/** 1000×+：约 5° 以上偏转即插中点，补「缓弯长弦」观感（略增 CPU） */
const REFINE_COS_THRESHOLD_EXTREME = 0.998
const MAX_REFINE_DEPTH = 3          // 最多递归 3 层，每个弯角最多加 7 个点
/** 1000× 以内细分上限低一些，减轻 _refinedScreenPts 常驻长度；极高倍略抬高以配合更敏角度/更短弦阈值 */
const MAX_REFINED_TOTAL_LEQ_1000 = 4000
const MAX_REFINED_TOTAL_GT_1000 = 7700

function getMaxRefinedTotalForPlotMult(): number {
    return lastPlotMultForDraw > 1000 ? MAX_REFINED_TOTAL_GT_1000 : MAX_REFINED_TOTAL_LEQ_1000
}

function refineCosThresholdForPlotMult(): number {
    return lastPlotMultForDraw > 1000 ? REFINE_COS_THRESHOLD_EXTREME : REFINE_COS_THRESHOLD
}

/** 1000x+：弦长阈值略收，长而缓的折线更易被二分（与角度阈值配合） */
const REFINE_CHORD_PX_SQ_EXTREME = 20 * 20
function refineScreenPtsAtBends(
    rawPts: ScreenPoint[],
    rows: { time: number; mult: number; raw: number }[]
): ScreenPoint[] {
    const len = rawPts.length
    if (len < 3 || len !== rows.length) return rawPts

    const outCap = getMaxRefinedTotalForPlotMult()
    const cosTh = refineCosThresholdForPlotMult()
    const out = _refinedScreenPts
    out.length = 0
    out.push(rawPts[0])

    const extremeChordSplit = lastPlotMultForDraw > 1000

    for (let i = 1; i < len - 1; i++) {
        const cur = rawPts[i]
        const next = rawPts[i + 1]

        if (extremeChordSplit && out.length < outCap) {
            const rp = rawPts[i - 1]
            const ddx = cur.x - rp.x
            const ddy = cur.y - rp.y
            if (ddx * ddx + ddy * ddy > REFINE_CHORD_PX_SQ_EXTREME) {
                insertRefinedPoints(out, rows, i - 1, i, 1, outCap, cosTh)
            }
        }

        // 检测 P[i-1]→P[i]→P[i+1] 的角度偏转（若上面插过点，prev 须取 out 尾点）
        const prev = out[out.length - 1]
        const dx1 = cur.x - prev.x
        const dy1 = cur.y - prev.y
        const dx2 = next.x - cur.x
        const dy2 = next.y - cur.y
        const len1sq = dx1 * dx1 + dy1 * dy1
        const len2sq = dx2 * dx2 + dy2 * dy2

        if (len1sq > 1 && len2sq > 1) {
            const dot = dx1 * dx2 + dy1 * dy2
            const lenProd = Math.sqrt(len1sq * len2sq)
            const cosAngle = dot / lenProd

            if (cosAngle < cosTh && out.length < outCap) {
                // 弯曲处：在 rows[i-1] 和 rows[i] 之间插入中间点
                insertRefinedPoints(out, rows, i - 1, i, 1, outCap, cosTh)
            }
        }

        out.push(cur)
    }

    // 最后一个点
    out.push(rawPts[len - 1])
    return out
}

/** 在 rows[idxA] 和 rows[idxB] 之间递归插入中间点 */
function insertRefinedPoints(
    out: ScreenPoint[],
    rows: { time: number; mult: number; raw: number }[],
    idxA: number,
    idxB: number,
    depth: number,
    outCap: number,
    cosTh: number
) {
    if (depth > MAX_REFINE_DEPTH || out.length >= outCap) return

    const rA = rows[idxA]
    const rB = rows[idxB]
    const midTime = (rA.time + rB.time) * 0.5
    const midMult = plotMultAtElapsedMsForCurve(midTime * 1000)
    const midRaw = (rA.raw + rB.raw) * 0.5
    const p = toPixel(midTime, midMult > 1 ? midMult : 1, midRaw)

    // 检查左半段是否还需要细分
    if (depth < MAX_REFINE_DEPTH && out.length > 0) {
        const prev = out[out.length - 1]
        const dx1 = p.x - prev.x
        const dy1 = p.y - prev.y
        const pB = toPixel(rB.time, rB.mult > 1 ? rB.mult : 1, rB.raw)
        const dx2 = pB.x - p.x
        const dy2 = pB.y - p.y
        const len1sq = dx1 * dx1 + dy1 * dy1
        const len2sq = dx2 * dx2 + dy2 * dy2
        if (len1sq > 4 && len2sq > 4) {
            const dot = dx1 * dx2 + dy1 * dy2
            const lenProd = Math.sqrt(len1sq * len2sq)
            if (dot / lenProd < cosTh) {
                // 仍然弯曲：先在左半插点，再把当前中点加入
                // 创建临时 row 给递归使用
                const tmpRow = { time: midTime, mult: midMult > 1 ? midMult : 1, raw: midRaw }
                const savedB = rows[idxB]
                rows[idxB] = tmpRow
                insertRefinedPoints(out, rows, idxA, idxB, depth + 1, outCap, cosTh)
                rows[idxB] = savedB
            }
        }
    }

    // 确保不重复添加
    if (out.length < outCap) {
        const pt: ScreenPoint = { x: p.x, y: p.y }
        out.push(pt)
    }
}

/** 火箭姿态用 base 尾 + tip，避免飞行段每帧 `[...slice, ...tip]` 产生临时数组 */
const _rocketPoseMergePts: ScreenPoint[] = []
/** 本人逃离 Y 取样：须整段 base+tip 的真实绘制点引用，不可复用火箭用的「仅尾 50 点」合并 */
const _selfEscapeFullMergePts: ScreenPoint[] = []

function getCachedCurveBasePts(): ScreenPoint[] {
    if (curveData.length < 2) return []
    const crashKey = String(currentPlotCrashPoint ?? "")
    const relaxKey = lastPlotMultForDraw > 1000 ? 2 : lastPlotMultForDraw > HIGH_MULT_CPU_RELAX_THRESHOLD ? 1 : 0
    if (cachedParametricVersion !== curveGeometryVersion || cachedParametricCrashKey !== crashKey ||
        cachedParametricRelaxKey !== relaxKey) {
        rebuildParametricBaseRows()
        _screenPtsCacheValid = false
    }
    const rows = cachedParametricBaseRows
    const len = rows.length

    // 屏幕映射缓存：视口参数未变 → 跳过全部 toPixel 调用
    const newCacheKey = makeScreenPtsCacheKey()
    if (_screenPtsCacheValid && _screenPtsCacheKey === newCacheKey && _cachedScreenPts.length >= 0 && _refinedScreenPts.length > 0) {
        return _refinedScreenPts
    }
    _screenPtsCacheKey = newCacheKey
    _screenPtsCacheValid = true

    // 按需扩容
    if (_cachedScreenPts.length < len) {
        const oldLen = _cachedScreenPts.length
        _cachedScreenPts.length = len
        for (let i = oldLen; i < len; i++) {
            _cachedScreenPts[i] = { x: 0, y: 0 }
        }
    }
    for (let i = 0; i < len; i++) {
        const r = rows[i]
        const p = toPixel(r.time, r.mult, r.raw)
        _cachedScreenPts[i].x = p.x
        _cachedScreenPts[i].y = p.y
    }
    _cachedScreenPts.length = len

    // 屏幕空间自适应细分：在弯曲区自动插入中间点
    if (lastPlotMultForDraw > 8 && len >= 3) {
        const refined = refineScreenPtsAtBends(_cachedScreenPts, rows)
        return refined
    }
    // 低倍时直接返回
    _refinedScreenPts.length = 0
    for (let i = 0; i < len; i++) {
        _refinedScreenPts.push(_cachedScreenPts[i])
    }
    return _refinedScreenPts
}

function curveToScreenPts(): ScreenPoint[] {
    return getCurveScreenPoints({
        curveData,
        liveTipTime,
        liveTipMult,
        liveTipRaw,
        toPixel,
        getCachedBasePts: getCachedCurveBasePts,
        plotMultAtElapsedMs: plotMultAtElapsedMsForCurve,
        crashClampMult: currentPlotCrashPoint,
    })
}

/**
 * 就地 sanitize：保证 y 随 x 推进不向下凹。
 */
function sanitizeCurveScreenPointsInPlace(pts: ScreenPoint[]): ScreenPoint[] {
    for (let i = 1; i < pts.length; i++) {
        const prev = pts[i - 1]
        const cur = pts[i]
        if (cur.x < prev.x) cur.x = prev.x
        if (cur.y > prev.y) cur.y = prev.y
    }
    return pts
}

function getRocketPose(sanitizedPts: ScreenPoint[]): { x: number; y: number; angle: number } | null {
    const pose = getRocketPoseFromPoints(sanitizedPts, currentRocketAngle)
    if (!pose) return null
    currentRocketAngle = pose.angle
    return pose
}

/**
 * 飞行段 static 是否重画：须随几何、视口横向、纵轴顶界变化而失效。
 * 仅含 viewMaxX 时，纵轴每帧缓动但 bucket 未变会错误跳过 drawStatic → 表现为卡顿/错层或迫使其它路径多算。
 */
/** 曲线下方填充：纵向渐变，顶侧保留原透明度、底侧透明（local 0→1 为形状包围盒由上到下） */
let _curveFillGradNormal: FillGradient | null = null
let _curveFillGradCrashed: FillGradient | null = null

function createVerticalCurveGradient(hex: number, topAlpha: number): FillGradient {
    const r = (hex >> 16) & 0xff
    const g = (hex >> 8) & 0xff
    const b = hex & 0xff
    return new FillGradient({
        type: "linear",
        start: { x: 0, y: 0 },
        end: { x: 0, y: 1 },
        textureSpace: "local",
        colorStops: [
            { offset: 0, color: `rgba(${r},${g},${b},${topAlpha})` },
            { offset: 1, color: `rgba(${r},${g},${b},0)` },
        ],
    })
}

function getCurveAreaFillGradient(crashed: boolean): FillGradient {
    if (!crashed) {
        if (!_curveFillGradNormal) _curveFillGradNormal = createVerticalCurveGradient(0x22d3ee, 0.18)
        return _curveFillGradNormal
    }
    if (!_curveFillGradCrashed) _curveFillGradCrashed = createVerticalCurveGradient(0xff3355, 0.12)
    return _curveFillGradCrashed
}

function computeBaseCurveHash(): number {
    const rocketDoubleBit = _rocketMarkerDouble ? 1 : 0
    /**
     * axisTop / viewMaxX 在飞行段都是每帧缓动,如果用千分/百分位量化,
     * 缓存 key 几乎每帧都换 → base 全量重绘,2-5x 区间 CPU 飙到 100%+。
     *
     * 这里改用「肉眼几乎不可察」的粗量化:
     * - axisTop ≤2.05(顶界仍按 2x 起步):1/40 单位,够细但不会每帧抖
     * - axisTop  >2.05(高倍鼓形):1/8  单位
     * - viewMaxX:1/4 秒(250ms)一档,与 lerpView 的可视容忍度匹配
     * 只要 base 屏幕投影差异 <1px,就当作未变化命中缓存。
     */
    const axisQ = _plotAxisTopForFrame > 2.05
        ? (_plotAxisTopForFrame * 8 | 0)
        : (_plotAxisTopForFrame * 40 | 0)
    const viewQ = (viewMaxX * 4 | 0)
    let h = curveGeometryVersion | 0
    h = (Math.imul(h, 31) + viewQ) | 0
    h = (Math.imul(h, 31) + axisQ) | 0
    h = (Math.imul(h, 31) + ((currentPlotCrashPoint ?? 0) * 100 | 0)) | 0
    h = (Math.imul(h, 31) + rocketDoubleBit) | 0
    return h
}

/**
 * 飞行段且存在 live tip 时 `strokeOnly=true`：只画 base 描边，填充改由 `drawTipCurve` 单路径 base+tip 完成，避免与 tip 填充双层半透明叠加。
 */
function drawStaticBaseCurve(crashed: boolean, strokeOnly = false, basePtsOverride?: ScreenPoint[]) {
    if (!staticCurveGfx) return
    staticCurveGfx.clear()
    const basePtsFull = basePtsOverride ?? getCachedCurveBasePts()
    if (basePtsFull.length < 2) return
    const basePts = pickBasePtsForGraphicsDraw(basePtsFull)
    const color = crashed ? 0xff3355 : 0x22d3ee
    const lw = (_isH5Layout ? 8.5 : 6) * _scale
    const yBottom = _plotB

    if (!strokeOnly) {
        staticCurveGfx.moveTo(basePts[0].x, yBottom)
        for (let i = 0; i < basePts.length; i++) staticCurveGfx.lineTo(basePts[i].x, basePts[i].y)
        staticCurveGfx.lineTo(basePts[basePts.length - 1].x, yBottom)
        staticCurveGfx.closePath()
        staticCurveGfx.fill(getCurveAreaFillGradient(crashed))
    }

    staticCurveGfx.moveTo(basePts[0].x, basePts[0].y)
    for (let i = 1; i < basePts.length; i++) staticCurveGfx.lineTo(basePts[i].x, basePts[i].y)
    staticCurveGfx.stroke({ width: lw, color, alpha: 0.95, cap: "round", join: "round" })
}

/**
 * 飞行段 tip：描边 + 局部填充。
 * 填充仅从 base 尾点到 tip 末端，不再遍历整个 base（高倍时省 ~4000 lineTo）。
 */
function drawTipCurve(crashed: boolean, tipPts: ScreenPoint[], basePtsOverride?: ScreenPoint[]) {
    if (!tipCurveGfx) return
    tipCurveGfx.clear()
    if (tipPts.length < 1) return

    const basePtsFull = basePtsOverride ?? getCachedCurveBasePts()
    const lastBasePt = basePtsFull.length > 0 ? basePtsFull[basePtsFull.length - 1] : null

    const color = crashed ? 0xff3355 : 0x22d3ee
    const lw = (_isH5Layout ? 8.5 : 6) * _scale
    const yBottom = _plotB

    sanitizeCurveScreenPointsInPlace(tipPts)

    // 填充：base 尾点 → tip → 底边（不再遍历整个 base）
    const startX = lastBasePt?.x ?? tipPts[0].x
    const startY = lastBasePt?.y ?? tipPts[0].y

    tipCurveGfx.moveTo(startX, yBottom)
    tipCurveGfx.lineTo(startX, startY)

    let startTip = 0
    if (lastBasePt && tipPts.length > 0) {
        const t0 = tipPts[0]
        const dx = t0.x - lastBasePt.x
        const dy = t0.y - lastBasePt.y
        if (dx * dx + dy * dy < 2.25) startTip = 1
    }
    for (let i = startTip; i < tipPts.length; i++) tipCurveGfx.lineTo(tipPts[i].x, tipPts[i].y)
    tipCurveGfx.lineTo(tipPts[tipPts.length - 1].x, yBottom)
    tipCurveGfx.closePath()
    tipCurveGfx.fill(getCurveAreaFillGradient(crashed))

    // 描边：仅 tip 段
    if (lastBasePt) tipCurveGfx.moveTo(lastBasePt.x, lastBasePt.y)
    else tipCurveGfx.moveTo(tipPts[0].x, tipPts[0].y)
    for (let i = 0; i < tipPts.length; i++) tipCurveGfx.lineTo(tipPts[i].x, tipPts[i].y)
    tipCurveGfx.stroke({ width: lw, color, alpha: 0.95, cap: "round", join: "round" })
}

/**
 * crashed：整段绘制在 curveGfx（与 copy 一致的单路径）。
 * 飞行：curveGfx 清空 + static/tip 分段，降低每帧点数量。
 */
function drawCurve(crashed: boolean, sanitizedPts?: ScreenPoint[], isFlyingPhase: boolean = false, precomputedBasePts?: ScreenPoint[], precomputedTipPts?: ScreenPoint[]) {
    // 底层防御性守卫：即使上层调用链遗漏检查，也能阻止中央闪现
    if (shouldDeferCrashRendering()) return
    if (isFlyingPhase && staticCurveGfx && tipCurveGfx) {
        curveGfx?.clear()
        const tipPtsFlying = precomputedTipPts ?? getCurveTipScreenPoints({
            curveData,
            liveTipTime,
            liveTipMult,
            liveTipRaw,
            toPixel,
            plotMultAtElapsedMs: plotMultAtElapsedMsForCurve,
            screenSegmentOpts: getFlyingTipScreenOpts(),
        })
        const hasLiveTip = tipPtsFlying.length >= 1
        const basePtsFlying = precomputedBasePts ?? getCachedCurveBasePts()
        const baseHash = computeBaseCurveHash()
        /**
         * 关键修复：tipModeChanged（hasLiveTip 在 true/false 间抖动）不再触发 base 重绘。
         * base 几何并未变化，只是 tip 段瞬时空/有；tip 自己会按 hasLiveTip 处理（下方 if/else 已覆盖）。
         */
        if (baseHash !== _lastBaseCurveHash) {
            _lastBaseCurveHash = baseHash
            // base 始终画 fill+stroke（tip 改为局部填充，不再遍历 base）
            drawStaticBaseCurve(false, false, basePtsFlying)
            if (isCrashCurveDebugEnabled()) {
                _curveDbg.baseRedraws++
                // 解析 baseHash 的组成变化来源（与 computeBaseCurveHash 的量化项保持一致）
                const axisQDbg = _plotAxisTopForFrame > 2.05
                    ? (_plotAxisTopForFrame * 8 | 0)
                    : (_plotAxisTopForFrame * 40 | 0)
                const curParts = {
                    geomVer: curveGeometryVersion | 0,
                    viewQ: (viewMaxX * 4) | 0,
                    axisQ: axisQDbg,
                    crashQ: (((currentPlotCrashPoint ?? 0) * 100) | 0),
                    rocketBit: _rocketMarkerDouble ? 1 : 0,
                }
                const prev = _curveDbg.lastBaseHashParts
                if (prev) {
                    let any = false
                    if (curParts.geomVer !== prev.geomVer) { _curveDbg.baseRedrawReasons.geomVer++; any = true }
                    if (curParts.viewQ !== prev.viewQ) { _curveDbg.baseRedrawReasons.viewQ++; any = true }
                    if (curParts.axisQ !== prev.axisQ) { _curveDbg.baseRedrawReasons.axisQ++; any = true }
                    if (curParts.crashQ !== prev.crashQ) { _curveDbg.baseRedrawReasons.crashQ++; any = true }
                    if (curParts.rocketBit !== prev.rocketBit) { _curveDbg.baseRedrawReasons.rocketBit++; any = true }
                    if (!any) _curveDbg.baseRedrawReasons.unknown++
                } else {
                    // 首次无法对比，记为 unknown
                    _curveDbg.baseRedrawReasons.unknown++
                }
                _curveDbg.lastBaseHashParts = curParts
            }
        }
        // tip 模式变化只更新标志位，不强制 base 重绘
        if (_lastFlyingHadLiveTip !== hasLiveTip) {
            _lastFlyingHadLiveTip = hasLiveTip
        }
        if (hasLiveTip) {
            drawTipCurve(false, tipPtsFlying, basePtsFlying)
            if (isCrashCurveDebugEnabled()) {
                _curveDbg.tipRedraws++
                _curveDbg.framesWithLiveTip++
            }
        } else {
            tipCurveGfx.clear()
        }
        return
    }

    if (!curveGfx) return
    curveGfx.clear()
    staticCurveGfx?.clear()
    tipCurveGfx?.clear()

    const pts = sanitizedPts ?? sanitizeCurveScreenPointsInPlace(curveToScreenPts())
    if (crashed && pts.length >= 2) {
        stripPureHorizontalPolylineStepsInPlace(pts)
    }
    if (pts.length < 2) return
    const color = crashed ? 0xff3355 : 0x22d3ee
    const lw = (_isH5Layout ? 8.5 : 6) * _scale
    const yBottom = _plotB

    curveGfx.moveTo(pts[0].x, yBottom)
    for (let i = 0; i < pts.length; i++) curveGfx.lineTo(pts[i].x, pts[i].y)
    curveGfx.lineTo(pts[pts.length - 1].x, yBottom)
    curveGfx.closePath()
    curveGfx.fill(getCurveAreaFillGradient(crashed))

    curveGfx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length; i++) curveGfx.lineTo(pts[i].x, pts[i].y)
    curveGfx.stroke({ width: lw, color, alpha: 0.95, cap: "round", join: "round" })
}

function getTopPendingBetAvatarUrl(): string | null {
    const s = crashRoomState.value
    const bets = s?.round_bets
    if (!bets?.length) return null
    let best: CrashRoundBet | null = null
    let bestAmt = -1
    for (let i = 0; i < bets.length; i++) {
        const b = bets[i]
        if (b.status !== "pending") continue
        const a = Number(b.amount) || 0
        if (a > bestAmt) {
            bestAmt = a
            best = b
        }
    }
    if (!best) return null
    const url = String(best.avatar ?? "").trim()
    return url ? toPixiCrossOriginSafeImageUrl(url) : null
}

/** 新回合或清空火箭头像时释放纹理（具体实现已在 rocketMarkerCtl 内部） */
function releaseRocketAvatarIfAny() {
    rocketMarkerCtl?.releaseAvatarIfAny()
}

function drawRocketMarker(x: number, y: number, angle: number, avatarUrl: string | null) {
    // 底层防御性守卫
    if (shouldDeferCrashRendering()) return
    rocketMarkerCtl?.draw({ x, y, angle }, avatarUrl)
}

// ═════════════════════════════════════════════════════════════════
// CURVE SAMPLING
// ═════════════════════════════════════════════════════════════════

const GAP_BRIDGE_MS = 120
const BRIDGE_STEP_MS = 40
const MAX_BRIDGE_POINTS_PER_FRAME = 200
/** 控制 curveData 长度，减轻 parametric 重建与内存 */
const CURVE_DATA_MAX_LEN = 400

/** @returns 本次是否执行了裁剪（裁剪路径内已 bump 几何版本） */
function trimCurveDataKeepOrigin(): boolean {
    const maxLen = getEffectiveCurveDataMaxLen()
    if (curveData.length <= maxLen) return false
    // 就地 splice 替代 spread+slice，避免 O(n) 数组拷贝
    const removeCount = curveData.length - maxLen
    curveData.splice(1, removeCount)
    bumpCurveGeometry()
    return true
}

function bridgeCurveTimeGap(plotElapsedMs: number) {
    if (curveData.length === 0) return
    const lastMs = curveData[curveData.length - 1].time * 1000
    const gap = plotElapsedMs - lastMs
    if (gap <= GAP_BRIDGE_MS) return

    let added = 0
    for (let e = lastMs + BRIDGE_STEP_MS; e < plotElapsedMs && added < MAX_BRIDGE_POINTS_PER_FRAME; e += BRIDGE_STEP_MS) {
        const t = e / 1000
        curveData.push({
            time: t,
            mult: plotMultForCanvas({ elapsedMs: e, crashPoint: null }),
        })
        lastSampleTime = t
        added++
    }
    const trimmed = trimCurveDataKeepOrigin()
    // trim 内已 bump；避免与下方重复 bump → 双倍 `rebuildParametricBaseRows`
    if (added > 0 && !trimmed) bumpCurveGeometry()
}

function maybePushKeyframe(seconds: number) {
    if (curveData.length === 0) {
        curveData.push({ time: 0, mult: 1 })
        lastSampleTime = 0
        lastKeyframeWallMs = performance.now()
        bumpCurveGeometry()
    }
    const now = performance.now()
    const interval = getKeyframeIntervalMs()
    if (now - lastKeyframeWallMs >= interval && seconds > lastSampleTime + 0.001) {
        lastKeyframeWallMs = now
        const prevMult = curveData.length > 0 ? curveData[curveData.length - 1].mult : 1
        const safePrev = prevMult > 1 ? prevMult : 1
        const mult = plotMultForCanvas({ elapsedMs: seconds * 1000, crashPoint: currentPlotCrashPoint })
        const safeMult = mult > safePrev ? mult : safePrev
        /**
         * 关键帧时间轻微滞后（秒）：
         * - tip 段生成需要 `liveTipTime > lastKey.time`，且段长 dt 不能太短（见 `appendCurveSegmentPoints(dt<0.0001)`）。
         * - 在 30fps + KEYFRAME_INTERVAL_MS=50ms 场景下，关键帧常常在某一帧刚好推进到“当前 seconds”，
         *   导致 tip dt≈0，从而该帧 tip 直接返回空（尖端忽有忽无 → 观感轻微停顿）。
         * - 这里让关键帧时间比当前 seconds 略微落后 ~0.2ms（远小于一帧、也远小于 UI 可感知精度），
         *   以保证 tip 段在绝大多数帧都有一个非零长度。
         */
        const KEYFRAME_TIME_LAG_SEC = 0.0002
        const kfTime = Math.max(lastSampleTime + 0.00011, seconds - KEYFRAME_TIME_LAG_SEC)
        // 低倍时指数增长极慢，50ms 内 mult 可能不变：再 push 会形成 (time↑, mult 同) 的水平折线
        if (curveData.length > 0 && safeMult <= safePrev + 1e-12) {
            /**
             * 低倍平台期（mult 几乎不变）处理：
             *
             * 旧逻辑会把最后一个 keyframe 的 `time` 直接推进到当前 `seconds`，从而让
             * `getCurveTipScreenPoints` 频繁判定 “liveTipTime ≈ lastKey.time → 不需要 tip”，
             * 造成飞行尖端（tip）在相邻帧里反复 “出现 / 消失”，观感像轻微停顿。
             *
             * 这里改为：**不推进最后一个 keyframe 的 time**，仅更新 `lastSampleTime` 用于节流；
             * 让飞行段的“时间推进”主要由 tip 段承担（即 base 末端 + liveTip 形成短段），从而 tip 更稳定。
             *
             * 注意：这不会改变倍数函数/曲线形状，只改变平台期 tip 的可见性与重绘节奏。
             */
            lastSampleTime = seconds
            return
        }
        curveData.push({ time: kfTime, mult: safeMult > 1 ? safeMult : 1 })
        lastSampleTime = kfTime
        const trimmed = trimCurveDataKeepOrigin()
        if (!trimmed) bumpCurveGeometry()
    }
}

// ═════════════════════════════════════════════════════════════════
// NICKNAME CHIPS
// ═════════════════════════════════════════════════════════════════

/** 逃离人员：供爆炸粒子排除（同一局内、被抽中过的 pid 视为“已逃离”） */
let escapedForExplosionGameId: number | null = null
const escapedForExplosionPids = new Set<string>()
let _hudFlashRafPending = false
/** H5 上限制 HUD 跳动动画最小间隔（ms），避免高倍时连续 trigger 造成停顿-闪烁循环 */
let _lastHudFlashPingWallMs = 0

function stopAllChips() {
    fallChipsCtl?.stopAll()
}

/**
 * 下注昵称 / 逃离下落昵称最终对齐的屏幕 Y（文字顶部）。
 * - 与「时间轴刻度」同一视觉带：在填充下沿 `_plotB` 之上，HTML `.x-axis-overlay` 在更下的 DOM 层。
 * - PC：尽量贴近填充下沿，略留间隙；H5：加大行高与留白，避免压线。
 * - 下落动画的「快慢」见 props `nameFallMoveMs`，「停多久」见 `nameOnAxisMs`（经 fallChips 计算）。
 */
function getBetChipLandY(): number {
    const h5 = _isH5Layout
    const chipLineH = (h5 ? 26 : 15) * _scale
    const gapAboveFillBottom = (h5 ? 12 : 0) * _scale
    const y = _plotB - chipLineH - gapAboveFillBottom
    const minY = _plotT + 18 * _scale
    return y < minY ? minY : y
}

/** 横坐标夹在曲线实际绘制宽区内（与 toPixel 安全区一致） */
function clampBetChipAnchorX(x: number): number {
    const c = _frameLayoutCache
    const pad = 8 * _scale
    const left = c.plotLv + pad
    const right = c.safePlotRight - pad
    if (x < left) return left
    if (x > right) return right
    return x
}

const SELF_ESCAPE_MARK_URL = "/img/gamepage/mark3.svg"
const SELF_ESCAPE_MARK_ANIM_MS = 480
/** 整组相对「折线取样点」的微调（px×_scale）；低倍曲线处用于消除 SVG/抗锯齿留下的针尖空隙 */
const SELF_ESCAPE_GROUP_NUDGE_Y_PX = 3
/**
 * mark3.svg viewBox 高 40，茎/尖端约 y≈31.49。Sprite anchor 直接指向视觉尖端，
 * markerLayer.position 才能始终等于曲线采样点；不要再靠每帧下移整组抵消透明底。
 */
const SELF_ESCAPE_PIN_TIP_ANCHOR_Y = 31.4919 / 40

function hideSelfEscapeCashoutMarker() {
    selfEscapeCashoutActive = false
    _selfEscapeOverlayCurvePts = null
    _selfEscapeLeftFrozen = false
    if (selfEscapeMarkerLayer) selfEscapeMarkerLayer.visible = false
    if (selfEscapeMarkerInner) {
        selfEscapeMarkerInner.alpha = 1
        selfEscapeMarkerInner.scale.set(1)
    }
}

function ensureSelfEscapeMarkTextureLoaded(): Promise<Texture | null> {
    if (selfEscapeMarkTexture) return Promise.resolve(selfEscapeMarkTexture)
    if (selfEscapeMarkTexturePromise) return selfEscapeMarkTexturePromise
    selfEscapeMarkTexturePromise = (async () => {
        try {
            // iOS + 高 DPR 下，SVG 纹理默认栅格分辨率偏低，缩放后容易发糊：按 DPR 提高加载分辨率
            if (import.meta.client) {
                const dpr = window.devicePixelRatio || 1
                const res = Math.min(Math.max(dpr, 1), 3)
                const req = {
                    src: SELF_ESCAPE_MARK_URL,
                    data: { resolution: res },
                } as any
                const t = await Assets.load(req) as Texture
                selfEscapeMarkTexture = t
                return t
            }
            const t = await Assets.load(SELF_ESCAPE_MARK_URL) as Texture
            selfEscapeMarkTexture = t
            return t
        } catch {
            if (import.meta.dev) console.warn("[GameCanvas] mark3.png load failed")
            return null
        } finally {
            selfEscapeMarkTexturePromise = null
        }
    })()
    return selfEscapeMarkTexturePromise
}

function updateSelfEscapeLabelLayout(mult: number) {
    if (!selfEscapeLabelText || !selfEscapeLabelBg || !selfEscapeLabelBlock || !selfEscapePin) return
    // H5 画布空间更紧凑：图钉/倍数标签整体缩小一点，避免遮挡曲线与火箭
    const isH5 = _isH5Layout
    const pinBaseRaw = isH5 ? Math.max(18, 22 * _scale) : Math.max(22, 26 * _scale)
    /** PC：图钉视觉尺寸比原设计缩小 1/4（×0.75） */
    const pinBase = isH5 ? pinBaseRaw : pinBaseRaw * 0.75
    selfEscapePin.scale.set(pinBase / Math.max(selfEscapePin.texture?.width ?? 1, 1))
    const fsRaw = isH5 ? Math.max(10, Math.round(9 * _scale)) : Math.max(11, Math.round(10 * _scale))
    const fs = isH5 ? fsRaw : Math.max(8, Math.round(fsRaw * 0.75))
    // pixi Text style 支持运行时调整字号（会触发重新排版）
    selfEscapeLabelText.style.fontSize = fs
    selfEscapeLabelText.text = `${mult.toFixed(2)}x`
    const padX = (isH5 ? 6 : 8) * _scale
    const padY = (isH5 ? 3 : 4) * _scale
    const bw = selfEscapeLabelText.width + padX * 2
    const bh = selfEscapeLabelText.height + padY * 2
    const rad = Math.min(isH5 ? 10 : 12, (isH5 ? 8 : 10) * _scale)
    selfEscapeLabelBg.clear()
    /** 背景从局部 y=0 向下延伸，与顶对齐的文案共用同一顶边基准 */
    selfEscapeLabelBg.roundRect(-bw * 0.5, 0, bw, bh, rad)
    selfEscapeLabelBg.fill({ color: 0x1e293b, alpha: 0.92 })
    selfEscapeLabelText.position.set(0, padY)
    /** 与图钉的间距（画布缩放后）；略紧，避免倍数块离图钉过远 */
    const gap = (isH5 ? 2 : 3) * _scale
    const pinB = selfEscapePin.getLocalBounds()
    /** 纹理非透明外接矩形：比 `anchor×height` 更贴近「肉眼看到的图钉顶/左侧」 */
    const pinTopY = pinB.y
    const pinLeft = pinB.x
    /** 倍数块局部 y=0 与图钉可视顶边对齐（文案 anchor 顶对齐，非相对图钉垂直居中） */
    const labelTopY = pinTopY
    const labelCenterX = pinLeft - gap - bw * 0.5
    _selfEscapeGroupLeftLocal = pinLeft - gap - bw
    selfEscapeLabelBlock.position.set(labelCenterX, labelTopY)
}

function buildSelfEscapeMarkerVisuals(tex: Texture) {
    if (!selfEscapeMarkerLayer || selfEscapeMarkerInner) return
    const inner = new Container()
    selfEscapeMarkerInner = inner
    const pin = new Sprite(tex)
    pin.anchor.set(0.5, SELF_ESCAPE_PIN_TIP_ANCHOR_Y)
    // 初始尺寸会在 updateSelfEscapeLabelLayout 里按 H5/PC + 当前 _scale 动态校正
    const isH5 = _isH5Layout
    const pinBaseRaw = isH5 ? Math.max(18, 22 * _scale) : Math.max(22, 26 * _scale)
    const pinBase = isH5 ? pinBaseRaw : pinBaseRaw * 0.75
    pin.scale.set(pinBase / Math.max(tex.width, 1))
    selfEscapePin = pin

    const fsRaw = isH5 ? Math.max(10, Math.round(9 * _scale)) : Math.max(11, Math.round(10 * _scale))
    const fs = isH5 ? fsRaw : Math.max(8, Math.round(fsRaw * 0.75))
    const labelText = new Text({
        text: "0.00x",
        style: {
            fontFamily: "Manrope, system-ui, sans-serif",
            fontSize: fs,
            fontWeight: "700" as const,
            fill: 0x4ade80,
        },
    })
    labelText.anchor.set(0.5, 0)
    selfEscapeLabelText = labelText

    const bg = new Graphics({ roundPixels: false })
    selfEscapeLabelBg = bg
    const lb = new Container()
    lb.addChild(bg)
    lb.addChild(labelText)
    selfEscapeLabelBlock = lb

    inner.addChild(lb)
    inner.addChild(pin)
    selfEscapeMarkerLayer.addChild(inner)
}

function showSelfEscapeCashoutMarker(mult: number) {
    if (!app || isDisposed || !selfEscapeMarkerLayer || !Number.isFinite(mult) || mult < 1.001) return
    selfEscapeCashoutActive = true
    selfEscapeCashoutTSec = Math.max(0, elapsedMsFromMultiplier(mult)) / 1000
    selfEscapeCashoutAnimStartMs = performance.now()
    _selfEscapeOverlayCurvePts = null
    _selfEscapeLeftFrozen = false
    if (selfEscapeMarkerInner) {
        selfEscapeMarkerInner.scale.set(0.15)
        selfEscapeMarkerInner.alpha = 0
    }
    void ensureSelfEscapeMarkTextureLoaded().then((tex) => {
        if (isDisposed || !selfEscapeCashoutActive || !tex || !selfEscapeMarkerLayer) return
        if (!selfEscapeMarkerInner) buildSelfEscapeMarkerVisuals(tex)
        updateSelfEscapeLabelLayout(mult)
        selfEscapeMarkerLayer.visible = true
        layoutSelfEscapeCashoutMarker()
    })
}

function getSelfEscapedMultiplierFromState(): number | null {
    const s = crashRoomState.value
    const pid = crashSelfPlayerId.value
    if (!s || pid == null) return null
    const b = s.round_bets?.find((x) => String(x.player_id) === String(pid))
    if (b?.status !== "cashed") return null
    const mult = Number(b.multiplier)
    return Number.isFinite(mult) && mult >= 1.001 ? mult : null
}

function syncSelfEscapeCashoutMarkerFromState() {
    const mult = getSelfEscapedMultiplierFromState()
    if (mult != null) {
        showSelfEscapeCashoutMarker(mult)
    } else {
        hideSelfEscapeCashoutMarker()
    }
}

/** 在 x 单调不减的折线上取 y；该折线与当前帧 Pixi stroke 的中心线同源 */
function yOnSanitizedPolylineAtX(pts: readonly ScreenPoint[], xCanvas: number): number | null {
    const n = pts.length
    if (n < 2) return null
    const p0 = pts[0]!
    const p1 = pts[n - 1]!
    if (xCanvas <= p0.x) return p0.y
    if (xCanvas >= p1.x) return p1.y
    let lo = 0
    let hi = n - 1
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1
        if (pts[mid]!.x < xCanvas) lo = mid
        else hi = mid
    }
    const a = pts[lo]!
    const b = pts[hi]!
    const dx = b.x - a.x
    const t = dx > 1e-6 ? (xCanvas - a.x) / dx : 0
    return a.y + t * (b.y - a.y)
}

function layoutSelfEscapeCashoutMarker() {
    if (!selfEscapeCashoutActive || !selfEscapeMarkerLayer?.visible || !selfEscapeMarkerInner) return
    /**
     * 纵轴「鼓形」、CURVE_PLOT_UPWARD_NUDGE 均在 `toPixel`→`multToPlotNy` 内，与描边一致，图钉并未少算一步。
     * 易错点：`appendCurveSegmentPoints` 段内用 `plotMultAtElapsedMsForCurve` 采样倍率；若此处仍用服务端
     * 服务端逃离倍数与同 t 的画布曲线不一致（早段尤甚）→ 与折线取样也对不齐。
     * 锚点用画布倍率；胶囊文案在 showSelfEscapeCashoutMarker 时用服务端倍率写入。
     */
    const escMs = Math.max(0, selfEscapeCashoutTSec * 1000)
    const mCurve = plotMultAtElapsedMsForCurve(escMs)
    const multForPos = mCurve > 1 ? mCurve : 1
    const p = toPixel(selfEscapeCashoutTSec, multForPos)
    const px = clampBetChipAnchorX(p.x)
    // 上边界仍保留安全边距；下边界不能用 bottomPad 夹紧，否则 1.01x 附近曲线在 bottomPad 下方时针尖会被抬离曲线。
    const topPad = Math.max(28, 36 * _scale)
    let pyCanvas = p.y
    const ov = _selfEscapeOverlayCurvePts
    if (ov && ov.length >= 2) {
        const yLine = yOnSanitizedPolylineAtX(ov, px)
        if (yLine !== null && Number.isFinite(yLine)) pyCanvas = yLine
    }
    const pyAnchor = Math.max(_plotT + topPad, pyCanvas)
    const py = pyAnchor + SELF_ESCAPE_GROUP_NUDGE_Y_PX * _scale
    const age = performance.now() - selfEscapeCashoutAnimStartMs
    const u = Math.min(1, age / SELF_ESCAPE_MARK_ANIM_MS)
    const ease = 1 - (1 - u) ** 3
    const sc = 0.18 + 0.82 * ease
    let worldX = px
    let worldY = py
    if (_selfEscapeLeftFrozen) {
        worldX = _selfEscapeFrozenX
        worldY = _selfEscapeFrozenY
    } else {
        /** 用最终 scale=1 预留宽度，避免弹出动画放大后又被左缘裁掉 */
        const leftLimit = 3 * _scale
        const minVisibleX = leftLimit - _selfEscapeGroupLeftLocal
        if (px < minVisibleX) {
            _selfEscapeLeftFrozen = true
            worldX = minVisibleX
            worldY = py
            _selfEscapeFrozenX = worldX
            _selfEscapeFrozenY = worldY
        }
    }
    selfEscapeMarkerLayer.position.set(worldX, worldY)
    selfEscapeMarkerInner.scale.set(sc)
    selfEscapeMarkerInner.alpha = Math.min(1, age / 140)
}

/** 当前火箭在屏幕上的位置（仅用于下落起点 Y：头像/火箭下方） */
function getRocketScreenPositionForFallChip(): { x: number; y: number } | null {
    // 优先用主循环写入的尖端坐标：`draw()` 偶发早退时 gfx/avatar 可能一帧未同步，避免下落昵称永远等不到 pos
    if (_lastRocketX >= 0 && _lastRocketY >= 0) return { x: _lastRocketX, y: _lastRocketY }
    if (rocketGfx?.visible) return { x: rocketGfx.x, y: rocketGfx.y }
    if (rocketAvatarRoot?.visible) return { x: rocketAvatarRoot.x, y: rocketAvatarRoot.y }
    return null
}

/**
 * 下注逃离人员掉落：起点 Y 取当前火箭下方，横坐标绑定开落瞬间的火箭时间锚点。
 * 不能用逃离倍数反推位置，否则会从曲线中段/画布中间出现。
 */
function getFallChipScreenAnchorTm(): { tSec: number; m: number } {
    return { tSec: liveTipTime, m: liveTipMult }
}

/**
 * 是否已在本局成功兑现（逃离）。
 */
function isRoundBetEscapedForExplosion(b: {
    player_id: string | number
    status: "pending" | "cashed" | "busted"
}): boolean {
    if (b.status === "cashed") return true
    const s = crashRoomState.value
    const gid = s?.game_id
    if (typeof gid !== "number") return false
    if (escapedForExplosionGameId !== gid) return false
    return escapedForExplosionPids.has(String(b.player_id))
}

function resetCashoutFallChipTracking() {
    escapedForExplosionGameId = null
    escapedForExplosionPids.clear()
}

/**
 * 下注列表里谁兑现（pending→cashed）谁触发昵称下落；新进飞行段会先 seed 当前状态，避免重连快照误播。
 */
function onRoundBetsCashoutFall(s: NonNullable<typeof crashRoomState.value>) {
    if (s.phase !== "flying" || s.crashed) return
    const gid = s.game_id
    if (typeof gid !== "number") return
    const bets = s.round_bets
    if (!Array.isArray(bets)) {
        return
    }
}

function resetCurveViewportState() {
    curveData = []
    lastSampleTime = -1
    liveTipTime = 0
    liveTipMult = 1
    liveTipRaw = 1
    _crashFrozenCurvePts = null
    _crashFrozenCurveDrawn = false
    cachedParametricBaseRows.length = 0
    cachedParametricVersion = -1
    cachedParametricCrashKey = ""
    cachedParametricRelaxKey = -1
    curveGeometryVersion++
    currentRocketAngle = -Math.PI / 4
    viewMaxX = MIN_VIEW_TIME_SPAN_SEC
    smoothViewMaxX = MIN_VIEW_TIME_SPAN_SEC
    targetMaxX = MIN_VIEW_TIME_SPAN_SEC
    currentRawMult = 1
    lastPlotMultForDraw = 1
    currentPlotCrashPoint = null
    plotElapsedMsFrozen = 0
    lastPlotElapsedMs = 0
    lastMonotonicPlotElapsedMs = 0
    lastKeyframeWallMs = 0
    _hudMultSmooth = 1
    _smoothedAxisTop = 2.0
    _plotAxisTopForFrame = 2.0
    _gridDirty = true
    _ticksDirty = true
    _lastBaseCurveHash = 0
    _lastFlyingHadLiveTip = null
    _lastRocketX = -1
    _lastRocketY = -1
    _lastRocketCrashTint = false
    // 控制器内部会在半径/配色变化时自行重绘矢量/头像几何，这里仅需重置位置缓存即可
    // 重置新增缓存
    _lastGridViewMaxX = -1
    _lastGridAxisTop = -1
    _lastTicksSignature = ""
    invalidateScreenPtsCache()
}

const FLYING_REBUILD_MIN_ELAPSED_MS = 1000
const FLYING_REBUILD_MAX_KEYFRAMES = 240
/** 恢复/切窗后如果权威飞行时间领先画布太多，直接重建，避免曲线和倍数慢慢追几秒。 */
const FLYING_AUTHORITATIVE_REBUILD_GAP_MS = 650

/** 从房间快照恢复飞行时间；窗口恢复时 elapsed_ms 可能旧于 multiplier，取两者能表达的最大飞行时间。 */
function resolveFlyingElapsedMsFromState(s: NonNullable<typeof crashRoomState.value>): number {
    /** 服务端直接下发的飞行毫秒数，可能在窗口恢复首帧仍是旧值。 */
    const el = Number(s.elapsed_ms)
    /** 服务端倍率反推的飞行毫秒数，用于弥补 elapsed_ms 滞后。 */
    const m = Number(s.multiplier)
    const fromElapsed = Number.isFinite(el) && el >= 0 ? el : 0
    const fromMultiplier = Number.isFinite(m) && m > 1.001 ? elapsedMsFromMultiplier(m) : 0
    return fromElapsed > fromMultiplier ? fromElapsed : fromMultiplier
}

/**
 * 初次进房已在高倍飞行中，或浏览器从后台恢复时，curveData 会缺一大段历史点。
 * 直接按当前 elapsed 重建曲线，并让横轴/纵轴立即对齐，避免右上角被 clamp 挤压变形。
 */
function rebuildFlyingCurveFromState(s: NonNullable<typeof crashRoomState.value>): boolean {
    if (s.phase !== "flying" || s.crashed) return false
    const elapsedMs = resolveFlyingElapsedMsFromState(s)
    if (!Number.isFinite(elapsedMs) || elapsedMs < FLYING_REBUILD_MIN_ELAPSED_MS) return false

    resetCurveViewportState()
    currentPlotCrashPoint = null

    const safeElapsedMs = Math.max(0, elapsedMs)
    const seconds = safeElapsedMs / 1000
    const stepMs = Math.max(80, Math.ceil(safeElapsedMs / FLYING_REBUILD_MAX_KEYFRAMES))

    curveData.push({ time: 0, mult: 1, rawMult: 1 })
    for (let e = stepMs; e < safeElapsedMs; e += stepMs) {
        const m = plotMultForCanvas({ elapsedMs: e, crashPoint: null })
        curveData.push({ time: e / 1000, mult: m, rawMult: m })
    }

    const curMult = plotMultForCanvas({ elapsedMs: safeElapsedMs, crashPoint: null })
    curveData.push({ time: seconds, mult: curMult, rawMult: curMult })

    const rawMult = Math.max(1, Number(s.multiplier) || curMult)
    currentRawMult = rawMult
    lastPlotMultForDraw = curMult
    liveTipTime = seconds
    liveTipMult = curMult
    liveTipRaw = rawMult
    lastSampleTime = seconds
    plotElapsedMsFrozen = safeElapsedMs
    lastPlotElapsedMs = safeElapsedMs
    lastMonotonicPlotElapsedMs = safeElapsedMs
    lastKeyframeWallMs = performance.now()
    _hudMultSmooth = curMult

    const target = Math.max(MIN_VIEW_TIME_SPAN_SEC, seconds / X_AXIS_TIP_TARGET_RATIO)
    targetMaxX = target
    smoothViewMaxX = target
    viewMaxX = target

    _smoothedAxisTop = Math.max(2, curMult * PLOT_AXIS_TOP_HEADROOM_RATIO)
    _plotAxisTopForFrame = _smoothedAxisTop

    flyingClockState.wsElapsedMs = safeElapsedMs
    flyingClockState.lastWsTickWall = performance.now()
    flyingClockState.lastWsVersion = Number(s.version) || 0
    flyingClockState.curWsMult = rawMult
    flyingClockState.lastRenderedElapsedMs = safeElapsedMs
    flyingClockState.lastAuthoritativeElapsedMs = safeElapsedMs
    flyingClockState.clockCorrectionMs = 0
    flyingClockState.lastRenderWall = flyingClockState.lastWsTickWall

    bumpCurveGeometry()
    invalidateScreenPtsCache()
    _lastGridViewMaxX = -1
    _lastGridAxisTop = -1
    _lastTicksSignature = ""
    _gridDirty = true
    return true
}

/** 当前画布已经展示到的飞行时间，用于判断新 WS 快照是否已经大幅领先。 */
function getCurrentVisualFlyingElapsedMs(): number {
    return Math.max(
        0,
        lastMonotonicPlotElapsedMs,
        lastPlotElapsedMs,
        plotElapsedMsFrozen,
        flyingClockState.lastRenderedElapsedMs,
    )
}

/** 新 WS 快照大幅领先时立即对齐，修复切回浏览器后倍数和曲线幅度延迟追赶。 */
function rebuildFlyingCurveIfAuthoritativeJump(s: NonNullable<typeof crashRoomState.value>): boolean {
    if (s.phase !== "flying" || s.crashed) return false
    const authoritativeElapsedMs = resolveFlyingElapsedMsFromState(s)
    if (!Number.isFinite(authoritativeElapsedMs)) return false
    const visualElapsedMs = getCurrentVisualFlyingElapsedMs()
    if (authoritativeElapsedMs - visualElapsedMs < FLYING_AUTHORITATIVE_REBUILD_GAP_MS) return false
    return rebuildFlyingCurveFromState(s)
}

function deactivateFlyingClockState() {
    flyingClockState.lastWsVersion = -1
    flyingClockState.curWsMult = 1
}

function handleFlyingPhase() {
    gamePhase.value = "flying"
    showCountdown.value = false
    if (lastRoomPhase !== "flying") {
        crashBoomSoundEmittedThisCrashEdge = false
        resetCurveViewportState()
        resetFlyingClockState(flyingClockState)
        crashFlashActive.value = false
        resetCashoutFallChipTracking()
        stopAllChips()
        fallChipsCtl?.start()
        const sInit = crashRoomState.value
        if (sInit) rebuildFlyingCurveFromState(sInit)
        if (sInit) onRoundBetsCashoutFall(sInit)
        const raw0 = sInit ? Math.max(1, Number(sInit.multiplier) || 1) : 1
        // 中央倍数与闪烁均以 socket 的 multiplier 为准，仅同步档位避免首帧误闪
        _lastHudFlashStep = hudFlashStep(raw0)
        hudFlashPlaying.value = false
    }
}

function handleBettingPhase(s: NonNullable<typeof crashRoomState.value>) {
    gamePhase.value = "countdown"
    showCountdown.value = true
    if (lastRoomPhase !== "betting") {
        resetRound()
    }
    const ms = Number(s.countdown_ms)
    if (!Number.isFinite(ms) || ms < 0) return
    const tickMs = Math.max(1, Number(s.tick_interval_ms) || 100)
    const total = Math.max(0, Number(s.betting_ticks_left) || 0) * tickMs
    if (lastRoomPhase !== "betting") cdTotalMs = Math.max(total, ms, 1)
    cdRemainMs = ms
    cdWall = performance.now()
    countdownTime.value = (ms / 1000).toFixed(1)
}

function handleCrashedPhase() {
    gamePhase.value = "crashed"
    showCountdown.value = false
    if (lastRoomPhase === "flying") {
        if (crashFlashTimer) clearTimeout(crashFlashTimer)
        crashFlashActive.value = true
        crashFlashTimer = setTimeout(() => {
            crashFlashActive.value = false
            crashFlashTimer = null
        }, 600)
    }
    stopAllChips()
    // 爆炸音只在本客户端见到「flying -> crashed」边沿时播放；进房首包/早包为 crashed 不应误播。
    if (
        lastRoomPhase === "flying" &&
        soundState.isClickSoundEnabled &&
        !shouldDeferCrashRendering() &&
        !crashBoomSoundEmittedThisCrashEdge
    ) {
        crashBoomSoundEmittedThisCrashEdge = true
        playCrashBoomSound()
    }
}

// ═════════════════════════════════════════════════════════════════
// RESET
// ═════════════════════════════════════════════════════════════════

function resetRound() {
    hideSelfEscapeCashoutMarker()
    clearCrashEscapedQueue()
    resetCashoutFallChipTracking()
    resetCrashBoomPixiRound()
    crashBoomSoundEmittedThisCrashEdge = false
    stopAllChips()
    resetCurveViewportState()
    resetFlyingClockState(flyingClockState)
    _deferGraphicsCleared = false
    _syncDeferCrashRendering = false
    cdTotalMs = 0
    cdRemainMs = 0
    cdWall = 0
    isGameOver.value = false
    crashFlashActive.value = false
    curveGfx?.clear(); staticCurveGfx?.clear(); tipCurveGfx?.clear()
    if (rocketMarkerCtl) rocketMarkerCtl.reset()
    else {
        rocketGfx?.clear()
        hideRocketRipplesCompletely()
    }
    _lastHudFlashStep = -1
    _lastHudFlashPingWallMs = 0
    hudFlashPlaying.value = false
    _lastRocketCrashTint = false
    releaseRocketAvatarIfAny()
    refreshPlotAxisTopForFrame()
    syncTicks()
    _gridDirty = true
    drawGrid()
}

/** 1x / 极低倍瞬坠没有有效 elapsed 时，给爆炸一个靠近曲线起点的可见锚点，而不是落到画布中心或直接不播。 */
const MIN_CRASH_ANCHOR_ELAPSED_MS = 180

function getCrashAnchorElapsedMs(m: number, elapsedForPlot: number): number {
    if (elapsedForPlot === elapsedForPlot && elapsedForPlot > 0) return elapsedForPlot
    const fromMultiplier = elapsedMsFromMultiplier(m)
    if (fromMultiplier > 0) return fromMultiplier
    return MIN_CRASH_ANCHOR_ELAPSED_MS
}

function ensureCrashCurveDataForAnchor(anchorElapsedMs: number, anchorPlotMult: number): void {
    const tipSec = Math.max(0.001, anchorElapsedMs / 1000)
    const tipMult = anchorPlotMult > 1 ? anchorPlotMult : 1
    if (curveData.length === 0) {
        curveData.push({ time: 0, mult: 1, rawMult: 1 })
        curveData.push({ time: tipSec, mult: tipMult, rawMult: currentRawMult })
        lastSampleTime = tipSec
        bumpCurveGeometry()
        return
    }
    if (curveData.length === 1) {
        const last = curveData[0]
        const nextTime = tipSec > last.time + 0.0001 ? tipSec : last.time + 0.001
        curveData.push({ time: nextTime, mult: tipMult, rawMult: currentRawMult })
        lastSampleTime = nextTime
        bumpCurveGeometry()
    }
}

function getCrashBoomAnchor(pts: ScreenPoint[]): { x: number; y: number; angle: number } | null {
    const pose = getRocketPose(pts)
    if (pose) return pose
    if (pts.length > 0) {
        const last = pts[pts.length - 1]!
        return { x: last.x, y: last.y, angle: currentRocketAngle }
    }
    if (_lastRocketX >= 0 && _lastRocketY >= 0) {
        return { x: _lastRocketX, y: _lastRocketY, angle: currentRocketAngle }
    }
    return null
}

/**
 * 坠毁段：根据 crash_point / elapsed_ms 重算冻结屏幕曲线（供爆炸锚点与静态红线）。
 * 低倍/1x 即使服务端 elapsed 为 0，也会合成一个最小曲线锚点，保证爆炸落在曲线起点附近。
 */
function rebuildCrashFrozenScreenCurveGeometry(m: number, plotMultCrashed: number, elapsedForPlot: number): void {
    currentPlotCrashPoint = (m >= 1 && m === m) ? m : null
    currentRawMult = m > 1 ? m : 1
    const anchorElapsedMs = getCrashAnchorElapsedMs(m, elapsedForPlot)
    const anchorPlotMult = plotMultForCanvas({ elapsedMs: anchorElapsedMs, crashPoint: m })
    const resolvedPlotMult = plotMultCrashed > 1 ? plotMultCrashed : anchorPlotMult
    lastPlotMultForDraw = resolvedPlotMult > 1 ? resolvedPlotMult : 1
    refreshPlotAxisTopForFrame()

    ensureCrashCurveDataForAnchor(anchorElapsedMs, lastPlotMultForDraw)

    let tipSec = anchorElapsedMs / 1000
    const lastKf = curveData.length > 0 ? curveData[curveData.length - 1] : null
    if (lastKf && tipSec > lastKf.time + 0.001) {
        const plotAtLastKf = plotMultForCanvas({ elapsedMs: lastKf.time * 1000, crashPoint: m })
        const capTol = Math.max(1e-7, 1e-9 * m)
        const bothAtCrashCap =
            Math.abs(plotAtLastKf - m) < capTol &&
            Math.abs(plotMultCrashed - m) < capTol
        const multPlateau =
            Math.abs(plotMultCrashed - plotAtLastKf) < Math.max(5e-6, 5e-8 * m)
        if (
            bothAtCrashCap ||
            multPlateau ||
            isCurveTipScreenFlat(lastKf, tipSec, currentRawMult, toPixel, plotMultAtElapsedMsForCurve)
        ) {
            tipSec = lastKf.time
        }
    }
    liveTipTime = tipSec
    liveTipMult = lastPlotMultForDraw
    liveTipRaw = currentRawMult

    updateViewTargets(tipSec)
    lerpView()
    syncTicks()
    drawGrid()

    const crashedSanitizedPts = sanitizeCurveScreenPointsInPlace(curveToScreenPts())
    _crashFrozenCurvePts = crashedSanitizedPts.map((pt) => ({ x: pt.x, y: pt.y }))
    _crashFrozenCurveDrawn = false
}

/** 布局变化（ResizeObserver / visibility）后：坠毁态下立刻用新 plot 尺寸重算冻结曲线，避免爆炸 GIF 落到整画布中心 */
function maybeRebuildCrashFrozenAfterLayout(): void {
    // defer 模式下不重建（避免切 Tab / resize 时触发曲线+火箭绘制）
    if (shouldDeferCrashRendering()) return
    const stateSnap = crashRoomState.value
    const gameOverSnap = !!(
        stateSnap &&
        (stateSnap.crashed || stateSnap.phase === "crashed" || stateSnap.phase === "settling")
    )
    // 已移除 `curveData.length === 0` 的提前返回：
    // rebuildCrashFrozenScreenCurveGeometry 内部已能在 curveData 为空时自动预填最小有效锚点，
    // 此处若因空数组跳过，resize / 切 Tab 后坠毁曲线将永远无法重建。
    if (!gameOverSnap || !stateSnap) return
    const m = Number(stateSnap.crash_point ?? stateSnap.multiplier) || 1
    const el = Number(stateSnap.elapsed_ms)
    const elapsedForPlot = (el === el && el >= 0) ? el : lastPlotElapsedMs
    const plotMultCrashed = plotMultForCanvas({ elapsedMs: elapsedForPlot, crashPoint: m })
    rebuildCrashFrozenScreenCurveGeometry(m, plotMultCrashed, elapsedForPlot)
}

// ═════════════════════════════════════════════════════════════════
// MAIN GAME LOOP
// ═════════════════════════════════════════════════════════════════

function updateGame() {
    // ★ 极早退出：defer 模式下跳过 95%+ 的每帧工作（对象池/布局缓存/WebGL渲染全部省掉）
    if (shouldDeferCrashRendering()) {
        _frameCounter++
        if (_frameCounter % IDLE_FRAME_SKIP !== 0) return
        // 首次进入时清除竞态期间可能已绘制的残留图形
        if (!_deferGraphicsCleared) {
            _deferGraphicsCleared = true
            clearAllGameGraphics()
        }
        fallChipsCtl?.tick({
            nowWallMs: performance.now(),
            moveMs: props.nameFallMoveMs,
            dwellMs: props.nameOnAxisMs,
            fadeRatio: props.nameOnAxisFadeRatio,
        })
        return
    }

    tickCrashBoomPixi()
    if (app) explosionNamesCtl?.tick(app.ticker.deltaMS)
    const s = crashRoomState.value
    if (!s) {
        tickRocketMarkerGlows()
        return
    }

    syncTickerFpsWithPhase()

    _frameCounter++

    // 每帧开始时重置对象池索引
    resetScreenPointPool()

    // 刷新布局缓存
    refreshFrameLayoutCache()
    _selfEscapeOverlayCurvePts = null

    if (s.phase === "betting") {
        // betting 阶段帧跳过：仅每 IDLE_FRAME_SKIP 帧更新一次
        if (_frameCounter % IDLE_FRAME_SKIP !== 0) {
            tickRocketMarkerGlows()
            return
        }

        const tickMs = Math.max(1, Number(s.tick_interval_ms) || 100)
        const msSnap = Number(s.countdown_ms)
        if (Number.isFinite(msSnap) && msSnap >= 0) {
            const now = performance.now()
            if (cdWall <= 0 || Math.abs(msSnap - cdRemainMs) > tickMs * 1.5) {
                cdTotalMs = Math.max(cdTotalMs, msSnap, 1)
                cdRemainMs = msSnap; cdWall = now
            }
        }
        const remain = cdWall > 0 ? Math.max(0, cdRemainMs - (performance.now() - cdWall)) : cdRemainMs
        countdownTime.value = (remain / 1000).toFixed(1)
        const pct = cdTotalMs > 0 ? Math.min(100, (remain / cdTotalMs) * 100) : 0
        if (countdownProgressRef.value) countdownProgressRef.value.style.width = `${pct}%`

    } else if (s.phase === "flying" && !s.crashed) {
        // ─── FLYING：全速渲染 ───
        currentPlotCrashPoint = null
        rebuildFlyingCurveIfAuthoritativeJump(s)
        const rawMult = Number(s.multiplier) || 1
        const safeRawMult = rawMult > 1 ? rawMult : 1
        const wsOk = crashWsConnected.value && !crashWsSocketError.value

        let plotElapsedMs: number
        if (wsOk) {
            plotElapsedMs = getFlyingMs(flyingClockState, s)
            plotElapsedMsFrozen = plotElapsedMs
        } else {
            plotElapsedMs = plotElapsedMsFrozen
        }

        if (plotElapsedMs > lastMonotonicPlotElapsedMs) {
            lastMonotonicPlotElapsedMs = plotElapsedMs
        } else {
            plotElapsedMs = lastMonotonicPlotElapsedMs
        }

        lastPlotElapsedMs = plotElapsedMs
        const seconds = plotElapsedMs / 1000

        bridgeCurveTimeGap(plotElapsedMs)

        const targetPlotMult = plotMultForCanvas({ elapsedMs: plotElapsedMs, crashPoint: null })

        currentRawMult = safeRawMult
        lastPlotMultForDraw = targetPlotMult

        refreshPlotAxisTopForFrame()

        maybePushKeyframe(seconds)

        liveTipTime = seconds
        liveTipMult = targetPlotMult
        liveTipRaw = safeRawMult

        updateViewTargets(seconds)
        snapViewIfLiveTipWouldClamp(seconds)
        lerpView()

        // 生产可开关曲线 debug：确认低倍顿挫来自时钟、base 重绘还是 tip 命中率。
        if (isCrashCurveDebugEnabled()) {
            _curveDbg.framesFlying++
            _curveDbg.lastSeenPlotMult = lastPlotMultForDraw
            if (_curveDbg.lastSeenPlotElapsedMs >= 0 && plotElapsedMs - _curveDbg.lastSeenPlotElapsedMs < 0.5) {
                _curveDbg.nearStallFrames++
            }
            _curveDbg.lastSeenPlotElapsedMs = plotElapsedMs
            const serverElapsedForDbg = Number(s.elapsed_ms)
            if (Number.isFinite(serverElapsedForDbg) && serverElapsedForDbg >= 0) {
                const visualAhead = plotElapsedMs - serverElapsedForDbg
                if (visualAhead > _curveDbg.maxVisualAheadServerMs) {
                    _curveDbg.maxVisualAheadServerMs = visualAhead
                }
            }
            if (_curveDbg.lastSeenGeomVer !== curveGeometryVersion) {
                _curveDbg.geomBumps += Math.max(0, curveGeometryVersion - _curveDbg.lastSeenGeomVer)
                _curveDbg.lastSeenGeomVer = curveGeometryVersion
            }
            // live tip 命中率（按“实际 drawCurve 里 hasLiveTip”计数在 drawCurve 内做；这里不累加）

            const now = performance.now()
            if (_curveDbg.lastPrintWall <= 0) _curveDbg.lastPrintWall = now
            if (now - _curveDbg.lastPrintWall >= 2000) {
                const sec = (now - _curveDbg.lastPrintWall) / 1000
                const fps = _curveDbg.framesFlying / Math.max(1e-6, sec)
                const baseHz = _curveDbg.baseRedraws / Math.max(1e-6, sec)
                const tipHz = _curveDbg.tipRedraws / Math.max(1e-6, sec)
                const bumpHz = _curveDbg.geomBumps / Math.max(1e-6, sec)
                const tipFrameRate = _curveDbg.framesWithLiveTip / Math.max(1, _curveDbg.framesFlying)
                // eslint-disable-next-line no-console
                console.log("[CrashCurveDbg] flying cadence", {
                    fps: Math.round(fps * 10) / 10,
                    plotMult: Math.round(_curveDbg.lastSeenPlotMult * 100) / 100,
                    baseRedrawHz: Math.round(baseHz * 10) / 10,
                    tipRedrawHz: Math.round(tipHz * 10) / 10,
                    curveGeometryBumpHz: Math.round(bumpHz * 10) / 10,
                    liveTipFrameRate: Math.round(tipFrameRate * 1000) / 1000,
                    nearStallFrames: _curveDbg.nearStallFrames,
                    maxVisualAheadServerMs: Math.round(_curveDbg.maxVisualAheadServerMs * 10) / 10,
                    clockCorrectionMs: Math.round(flyingClockState.clockCorrectionMs * 10) / 10,
                    baseRedrawReasons: { ..._curveDbg.baseRedrawReasons },
                    hint: "nearStallFrames > 0 means visual elapsed barely advanced; maxVisualAheadServerMs shows WS/server lag behind local clock.",
                })
                _curveDbg.lastPrintWall = now
                _curveDbg.framesFlying = 0
                _curveDbg.framesWithLiveTip = 0
                _curveDbg.baseRedraws = 0
                _curveDbg.tipRedraws = 0
                _curveDbg.geomBumps = 0
                _curveDbg.nearStallFrames = 0
                _curveDbg.maxVisualAheadServerMs = 0
                _curveDbg.baseRedrawReasons.geomVer = 0
                _curveDbg.baseRedrawReasons.viewQ = 0
                _curveDbg.baseRedrawReasons.axisQ = 0
                _curveDbg.baseRedrawReasons.crashQ = 0
                _curveDbg.baseRedrawReasons.rocketBit = 0
                _curveDbg.baseRedrawReasons.unknown = 0
            }
        }

        // 中央倍数：以 elapsed_ms 外推的连续倍数为准（自然增长、越大越快）
        const dtSec = Math.max(0, Number(app?.ticker?.deltaMS ?? 0) / 1000)
        let smoothRate = HUD_MULT_SMOOTH_RATE_PER_SEC
        if (targetPlotMult > 500) smoothRate = HUD_MULT_SMOOTH_RATE_HIGH_MULT
        else if (targetPlotMult > 120) smoothRate = HUD_MULT_SMOOTH_RATE_MID_MULT
        const alpha = 1 - Math.exp(-smoothRate * dtSec)
        const nextHud = _hudMultSmooth + (targetPlotMult - _hudMultSmooth) * alpha
        _hudMultSmooth = nextHud > _hudMultSmooth ? nextHud : _hudMultSmooth
        const hudStr = _hudMultSmooth.toFixed(2)
        if (displayMultiplier.value !== hudStr) displayMultiplier.value = hudStr

        const flashStep = hudFlashStep(safeRawMult)
        // 多数帧 flashStep === _lastHudFlashStep 属正常（同档内）；仅当档位上升时才会 triggerHudFlashPing
        if (flashStep > _lastHudFlashStep) {
            _lastHudFlashStep = flashStep
            const nowWall = performance.now()
            const h5ThrottleMs =
                _isH5Layout && safeRawMult >= 800
                    ? 520
                    : _isH5Layout && safeRawMult >= 200
                        ? 400
                        : _isH5Layout
                            ? 260
                            : 0
            if (h5ThrottleMs > 0 && nowWall - _lastHudFlashPingWallMs < h5ThrottleMs) {
                /* 跳过本次 ping：高倍窄机上连续 scale 动画易与 Pixi 抢 GPU */
            } else {
                _lastHudFlashPingWallMs = nowWall
                triggerHudFlashPing()
            }
        } else if (flashStep < _lastHudFlashStep) {
            _lastHudFlashStep = flashStep
        }

        // 飞行阶段每帧同步刻度 + 画网格：与 TICKER_MAX_FPS_FLYING 同频；若再「每 N 帧才 syncTicks」，
        // 在 30fps 下底部时间刻度会呈明显阶梯感（10 帧一次 ≈ 每秒仅 3 次更新）。
        syncTicks()
        drawGrid()

        const tipPtsForFrame = getCurveTipScreenPoints({
            curveData,
            liveTipTime,
            liveTipMult,
            liveTipRaw,
            toPixel,
            plotMultAtElapsedMs: plotMultAtElapsedMsForCurve,
            screenSegmentOpts: getFlyingTipScreenOpts(),
        })
        const basePtsForFrame = getCachedCurveBasePts()
        drawCurve(false, undefined, true, basePtsForFrame, tipPtsForFrame)
        if (selfEscapeCashoutActive) {
            const mFull = _selfEscapeFullMergePts
            mFull.length = 0
            for (let bi = 0; bi < basePtsForFrame.length; bi++) {
                mFull.push(basePtsForFrame[bi]!)
            }
            for (let ti = 0; ti < tipPtsForFrame.length; ti++) {
                mFull.push(tipPtsForFrame[ti]!)
            }
            _selfEscapeOverlayCurvePts = mFull
        } else {
            _selfEscapeOverlayCurvePts = null
        }
        let sanitizedPtsForRocket: ScreenPoint[]
        if (tipPtsForFrame.length > 0) {
            const base = basePtsForFrame
            const poseMergeBaseStart = base.length > 50 ? base.length - 50 : 0
            const m = _rocketPoseMergePts
            m.length = 0
            for (let bi = poseMergeBaseStart; bi < base.length; bi++) m.push(base[bi]!)
            for (let ti = 0; ti < tipPtsForFrame.length; ti++) m.push(tipPtsForFrame[ti]!)
            sanitizedPtsForRocket = sanitizeCurveScreenPointsInPlace(m)
        } else {
            sanitizedPtsForRocket = sanitizeCurveScreenPointsInPlace(basePtsForFrame)
        }
        const rocketPose = getRocketPose(sanitizedPtsForRocket)
        if (rocketPose) {
            drawRocketMarker(rocketPose.x, rocketPose.y, rocketPose.angle, getTopPendingBetAvatarUrl())
            _lastRocketX = rocketPose.x
            _lastRocketY = rocketPose.y
            applyRocketMarkerPatFromPose(rocketPose, safeRawMult)
        }

    } else if (s.crashed || s.phase === "crashed" || s.phase === "settling") {
        // ─── CRASHED：降帧渲染 ───
        // defer 模式已在函数入口极早退出，此处无需重复检查

        // 爆炸 GIF/音效 在 startCrashBoomPixi 触发：若与降帧共用模运算，首几帧可能被 return，
        // WS 很快进下一局时整段 crashed 都跑不到 startCrashBoomPixi（尤其 iOS 掉帧时更明显）。
        const skipCrashedHeavy =
            crashBoomRoundStarted && (_frameCounter % IDLE_FRAME_SKIP !== 0)
        if (skipCrashedHeavy) {
            // 降帧：只更新已在飞的昵称位置/淡出；不传 `escapedSamplerDeltaMs`，避免坠毁段误抽逃离队列
            fallChipsCtl?.tick({
                nowWallMs: performance.now(),
                moveMs: props.nameFallMoveMs,
                dwellMs: props.nameOnAxisMs,
                fadeRatio: props.nameOnAxisFadeRatio,
            })
            tickRocketMarkerGlows()
            return
        }

        const m = Number(s.crash_point ?? s.multiplier) || 1
        currentPlotCrashPoint = (m >= 1 && m === m) ? m : null
        currentRawMult = m > 1 ? m : 1
        const el = Number(s.elapsed_ms)
        const elapsedForPlot = (el === el && el >= 0) ? el : lastPlotElapsedMs // el === el 替代 isFinite
        const plotMultCrashed = plotMultForCanvas({ elapsedMs: elapsedForPlot, crashPoint: m })

        // crashed 以后中央倍数固定显示爆点；同时同步平滑状态，避免下一局残留
        _hudMultSmooth = m > 1 ? m : 1
        const crashedHudStr = m.toFixed(2)
        if (displayMultiplier.value !== crashedHudStr) displayMultiplier.value = crashedHudStr

        if (!_crashFrozenCurvePts) {
            rebuildCrashFrozenScreenCurveGeometry(m, plotMultCrashed, elapsedForPlot)
        }

        const crashedSanitizedPts = _crashFrozenCurvePts ?? []
        _selfEscapeOverlayCurvePts = crashedSanitizedPts
        if (!_crashFrozenCurveDrawn) {
            drawCurve(true, crashedSanitizedPts)
            _crashFrozenCurveDrawn = true
        }
        const boomPt = getCrashBoomAnchor(crashedSanitizedPts)
        if (boomPt) {
            if (!crashBoomRoundStarted) {
                startCrashBoomPixi(boomPt.x, boomPt.y)
            }
            drawRocketMarker(boomPt.x, boomPt.y, boomPt.angle, null)
            _lastRocketX = boomPt.x
            _lastRocketY = boomPt.y
        }
    }

    // 逃离昵称：`moveMs`/`dwellMs`/`fadeRatio` 对应 props；仅 flying 传入 `escapedSamplerDeltaMs` 驱动队列抽样
    fallChipsCtl?.tick({
        nowWallMs: performance.now(),
        moveMs: props.nameFallMoveMs,
        dwellMs: props.nameOnAxisMs,
        fadeRatio: props.nameOnAxisFadeRatio,
        escapedSamplerDeltaMs:
            s.phase === "flying" && !s.crashed ? Math.max(0, Number(app?.ticker?.deltaMS ?? 0)) : undefined,
    })
    layoutSelfEscapeCashoutMarker()
    // 必须在 drawRocketMarker / applyRocketMarkerPatFromPose 之后，否则光晕会沿用上一帧（或首帧 0,0）的锚点
    tickRocketMarkerGlows()
}

/** 在 canvas 重新显示前同步绘制一帧，避免恢复时先闪出旧的曲线帧。 */
function renderCrashFrameBeforeResumePaint() {
    if (!app || isDisposed) return
    updateGame()
    try {
        const appWithRender = app as unknown as { render?: () => void }
        if (typeof appWithRender.render === "function") {
            appWithRender.render()
            return
        }
        const rendererWithRender = app.renderer as unknown as { render?: (options: unknown) => void }
        if (typeof rendererWithRender.render === "function") {
            rendererWithRender.render({ container: app.stage })
        }
    } catch (e) {
        if (import.meta.dev) console.warn("[GameCanvas] resume pre-render failed", e)
    }
}

/** 聚焦/可见恢复时统一重建曲线、同步 frozen 曲线，并在显示 canvas 前完成一次渲染。 */
function syncCrashCanvasBeforeShowing() {
    if (!app || isDisposed) {
        setPixiCanvasHiddenDuringResume(false)
        return
    }
    const s = crashRoomState.value
    const shouldRebuildFrozen = isGameOver.value && !shouldDeferCrashRendering()
    measureCanvas()
    if (s?.phase === "flying" && !s.crashed) {
        if (!rebuildFlyingCurveFromState(s)) {
            /** 重建失败时仍用 elapsed/multiplier 的最大值同步时钟，避免从 1x 重新追赶。 */
            const elapsedMs = resolveFlyingElapsedMsFromState(s)
            if (Number.isFinite(elapsedMs) && elapsedMs >= 0) {
                flyingClockState.wsElapsedMs = elapsedMs
                flyingClockState.lastWsTickWall = performance.now()
                flyingClockState.lastWsVersion = Number(s.version) || 0
                flyingClockState.lastRenderedElapsedMs = Math.max(flyingClockState.lastRenderedElapsedMs, flyingClockState.wsElapsedMs)
                flyingClockState.lastAuthoritativeElapsedMs = flyingClockState.wsElapsedMs
                flyingClockState.clockCorrectionMs = 0
                flyingClockState.lastRenderWall = flyingClockState.lastWsTickWall
            }
            lastKeyframeWallMs = performance.now()
            bumpCurveGeometry()
        }
    }
    _lastTickerFlyingPhase = null
    syncTickerFpsWithPhase()
    if (shouldRebuildFrozen) {
        maybeRebuildCrashFrozenAfterLayout()
    }
    renderCrashFrameBeforeResumePaint()
    setPixiCanvasHiddenDuringResume(false)
    if (!app.ticker.started) app.ticker.start()
}

// ═════════════════════════════════════════════════════════════════
// INIT / RESIZE / LIFECYCLE
// ═════════════════════════════════════════════════════════════════

function measureCanvas() {
    const el = canvasWrapper.value || gameContainer.value
    if (!el) return
    const w = el.clientWidth, h = el.clientHeight
    if (w > 0 && h > 0) {
        _canvasW = w
        _canvasH = h
        recalcLayoutConsts()
    }
}

function resizeCanvas() {
    if (isDisposed || !app?.renderer) return
    measureCanvas()
    try {
        app.renderer.resize(_canvasW, _canvasH)
        if (pixiCanvasEl) {
            pixiCanvasEl.style.width = `${_canvasW}px`
            pixiCanvasEl.style.height = `${_canvasH}px`
        }
        updatePlotMask()
        _gridDirty = true
        // scale / 布局变化后强制各类缓存失效（火箭几何重绘由控制器内部处理）
        _lastTicksSignature = ""
        invalidateScreenPtsCache()
        const stateSnapR = crashRoomState.value
        const gameOverSnapR = !!(
            stateSnapR &&
            (stateSnapR.crashed || stateSnapR.phase === "crashed" || stateSnapR.phase === "settling")
        )
        // 非坠毁态才清空冻结曲线；坠毁态清空后首帧 curve 常为空 → 爆炸锚点误用整画布中心（resize / 切 Tab 易复现）
        if (!gameOverSnapR) {
            _crashFrozenCurvePts = null
            _crashFrozenCurveDrawn = false
        }
        refreshPlotAxisTopForFrame()
        syncTicks()
        drawGrid()
        resetScreenPointPool()
        const s = crashRoomState.value
        const isFlyingNow = s?.phase === "flying" && !s?.crashed
        if (isFlyingNow) {
            if (curveData.length > 0) {
                _lastBaseCurveHash = 0
                _lastFlyingHadLiveTip = null
                drawCurve(false, undefined, true)
            }
        } else if (isGameOver.value && !shouldDeferCrashRendering()) {
            // 坠毁态允许 curveData 为空；rebuild 会为低倍/1x 合成最小锚点。
            maybeRebuildCrashFrozenAfterLayout()
            const crashedSanitizedPts = _crashFrozenCurvePts
            if (crashedSanitizedPts && crashedSanitizedPts.length > 0) {
                drawCurve(true, crashedSanitizedPts)
                _crashFrozenCurveDrawn = true
            }
            const boomPt = crashedSanitizedPts ? getCrashBoomAnchor(crashedSanitizedPts) : null
            if (boomPt) {
                drawRocketMarker(boomPt.x, boomPt.y, boomPt.angle, null)
                _lastRocketX = boomPt.x
                _lastRocketY = boomPt.y
            }
        } else {
            // defer 或非坠毁态：清除所有游戏图形（曲线+火箭+光晕），避免残留
            clearAllGameGraphics()
        }
    } catch (e) {
        if (import.meta.dev) console.warn("[GameCanvas] resizeCanvas failed", e)
    }
}

/**
 * 等 `pixiHost` 挂载且外层已有非零布局尺寸（flex/calc 首帧常为 0×0，直接 `app.init` 易失败或长期挂起）。
 */
async function waitForChartLayoutReady(maxRaf = 120): Promise<void> {
    await nextTick()
    for (let i = 0; i < maxRaf; i++) {
        if (isDisposed) return
        const host = pixiHost.value
        const box = canvasWrapper.value || gameContainer.value
        if (host && box && box.clientWidth > 2 && box.clientHeight > 2) return
        await new Promise<void>((r) => requestAnimationFrame(() => r()))
    }
}

function getPixiResolution(): number {
    const dpr = window.devicePixelRatio || 1
    const narrow = typeof window !== "undefined" && window.innerWidth > 0 && window.innerWidth < 768
    // 窄屏降低像素比上限，减轻部分机型 WebGL 显存压力；不再强行 floor 到 1.5
    if (narrow) return Math.min(Math.max(dpr, 1), isAppleTouchDevice() ? 3 : 2.5)
    return Math.min(Math.max(dpr, 1.5), 3)
}

async function initGame() {
    await waitForChartLayoutReady(160)
    for (let attempt = 0; attempt < 2; attempt++) {
        if (isDisposed) return
        if (!pixiHost.value) {
            if (import.meta.dev) console.warn("[GameCanvas] pixiHost missing after layout wait")
            if (attempt === 0) {
                await new Promise<void>((r) => setTimeout(() => r(), 100))
                await waitForChartLayoutReady(60)
            }
            if (!pixiHost.value) return
        }
        try {
            while (pixiHost.value.firstChild) pixiHost.value.removeChild(pixiHost.value.firstChild)
            const canvas = document.createElement("canvas")
            canvas.className = "game-pixi-canvas"
            canvas.style.display = "block"; canvas.style.width = "100%"; canvas.style.height = "100%"
            pixiHost.value.appendChild(canvas)
            pixiCanvasEl = canvas

            measureCanvas()
            app = new Application()
            // 部分 H5 WebView 对 WebGPU 探测慢/失败；固定 webgl 更稳（见 pixi autoDetectRenderer preference）
            // 不设人为超时：首帧 WebGL 管线/驱动编译偶发 >15s，race 会先 reject 导致误失败且 init 仍在后台进行
            await app.init({
                canvas,
                width: _canvasW,
                height: _canvasH,
                backgroundColor: 0x0f172a,
                autoDensity: true,
                preference: "webgl",
                resolution: getPixiResolution(),
                antialias: true,
            })
            if (isDisposed) { app.destroy(false); app = null; canvas.remove(); pixiCanvasEl = null; return }

            gridGfx = new Graphics(); app.stage.addChild(gridGfx)
            plotMaskGfx = new Graphics(); app.stage.addChild(plotMaskGfx)
            curveGfx = new Graphics({ roundPixels: false }); app.stage.addChild(curveGfx)
            staticCurveGfx = new Graphics({ roundPixels: false }); app.stage.addChild(staticCurveGfx)
            tipCurveGfx = new Graphics({ roundPixels: false }); app.stage.addChild(tipCurveGfx)
            rocketVectorGlowGfx = new Graphics()
            rocketVectorGlowGfx.eventMode = "none"
            rocketVectorGlowGfx.visible = false
            app.stage.addChild(rocketVectorGlowGfx)
            rocketGfx = new Graphics(); app.stage.addChild(rocketGfx)
            rocketAvatarRoot = new Container()
            rocketAvatarGlowGfx = new Graphics()
            rocketAvatarGlowGfx.eventMode = "none"
            rocketAvatarSprite = new Sprite()
            rocketAvatarSprite.anchor.set(0.5)
            rocketAvatarMaskGfx = new Graphics()
            rocketAvatarBorderGfx = new Graphics({ roundPixels: false })
            rocketAvatarBorderGfx.eventMode = "none"
            rocketAvatarRoot.addChild(rocketAvatarGlowGfx)
            rocketAvatarRoot.addChild(rocketAvatarSprite)
            rocketAvatarRoot.addChild(rocketAvatarMaskGfx)
            rocketAvatarRoot.addChild(rocketAvatarBorderGfx)
            rocketAvatarSprite.mask = rocketAvatarMaskGfx
            rocketAvatarRoot.visible = false
            app.stage.addChild(rocketAvatarRoot)
            // 初始化火箭控制器：把火箭/头像/光晕细节从 GameCanvas.vue 抽离出去
            rocketMarkerCtl = createRocketMarkerController(
                {
                    rocketGfx,
                    rocketVectorGlowGfx: rocketVectorGlowGfx!,
                    rocketAvatarRoot: rocketAvatarRoot!,
                    rocketAvatarGlowGfx: rocketAvatarGlowGfx!,
                    rocketAvatarSprite: rocketAvatarSprite!,
                    rocketAvatarMaskGfx: rocketAvatarMaskGfx!,
                    rocketAvatarBorderGfx: rocketAvatarBorderGfx!,
                },
                {
                    crashBodyColor: ROCKET_CRASH_BODY,
                    avatarFixedRotationRad: ROCKET_AVATAR_FIXED_ROTATION_RAD,
                    avatarBorderPx: ROCKET_AVATAR_BORDER_PX,
                    isCrashTintPhase: isCrashRocketTintPhase,
                    shouldDrawRipples: shouldDrawRocketRipples,
                    getAvatarRadiusPx: getRocketMarkerRadiusPx,
                    getVectorRadiusPx: getRocketVectorDrawRadiusPx,
                    paintRippleGlowRing,
                },
            )
            await loadCrashBoomPixiAssets()
            // 初始化下落昵称控制器：负责逃离队列采样 + chip 池 + 每帧动画（调参说明见 `canvas/fallChips.ts` 顶部与 `FallChipsOptions`）
            fallChipsCtl = createFallChipsController(
                {
                    getEscapedQueue: () => crashEscapedQueue.value,
                    setEscapedQueue: (next) => { crashEscapedQueue.value = next },
                    stage: app.stage,
                    getRocketScreenPosition: getRocketScreenPositionForFallChip,
                    getRocketRadiusPx: getRocketMarkerRadiusPx,
                    getLandY: getBetChipLandY,
                    toPixel: (tSec, mult) => toPixel(tSec, mult),
                    clampX: clampBetChipAnchorX,
                    getAnchorTm: getFallChipScreenAnchorTm,
                    onPicked: (e) => {
                        const gid = Number(e?.game_id)
                        if (!Number.isFinite(gid) || gid <= 0) return
                        if (escapedForExplosionGameId !== gid) {
                            escapedForExplosionGameId = gid
                            escapedForExplosionPids.clear()
                        }
                        escapedForExplosionPids.add(String(e.player_id))
                    },
                    isH5: () => _isH5Layout,
                    getScale: () => _scale,
                },
                {
                    /** Text/Container 池容量，建议 ≥ fallingChipsMax */
                    chipPoolSize: 60,
                    /** 同屏下落昵称条数上限 */
                    fallingChipsMax: 40,
                    /**
                     * 逃离抽样间隔中心值（ms）；实际每次在约 `0.35×~1.9×` 间随机。要更密/更疏可改此值或传
                     * `escapedSampleIntervalMinMs` / `escapedSampleIntervalMaxMs` 覆盖推导。
                     */
                    escapedSampleIntervalMs: 1200,
                    /** 每次只从队列尾部最近 N 条里抽 2~6 条 */
                    escapedLatestWindow: 12,
                    /**
                     * 同波相邻两条「开落」间隔的中心值（ms）；实际每条在约 `0.16×~1.12×` 间随机。
                     * 要更整齐可收窄 `fallChipStaggerMinMs`/`MaxMs`（在 fallChips 的 opts 类型里有说明）。
                     */
                    fallChipStaggerMs: 600,
                    /** 已排队但未开落的 chip 最长保留（ms），防异常堆积 */
                    fallChipMaxQueueMs: 180_000,
                },
            )
            selfEscapeMarkerLayer = new Container()
            selfEscapeMarkerLayer.eventMode = "none"
            selfEscapeMarkerLayer.visible = false
            app.stage.addChild(selfEscapeMarkerLayer)
            // H5 Pixi 初始化可能晚于 WS join 快照；若刷新时本人已经 cashed，补同步一次逃离标记。
            syncSelfEscapeCashoutMarkerFromState()
            curveGfx.mask = plotMaskGfx
            staticCurveGfx.mask = plotMaskGfx
            tipCurveGfx.mask = plotMaskGfx
            // 本人逃离标记（图钉+倍数）必须「浮在曲线之上」且不可被 plotMask 裁剪
            // 否则靠近边缘时会出现被切割/遮盖。
            plotMaskGfx.eventMode = "none"

            isReady.value = true
            await nextTick()
            measureCanvas()
            app.renderer.resize(_canvasW, _canvasH)
            if (pixiCanvasEl) {
                pixiCanvasEl.style.width = `${_canvasW}px`
                pixiCanvasEl.style.height = `${_canvasH}px`
            }
            updatePlotMask()
            refreshPlotAxisTopForFrame()
            syncTicks()
            _gridDirty = true
            drawGrid()
            app.ticker.add(updateGame)
            app.ticker.maxFPS = TICKER_MAX_FPS_DEFAULT
            _lastTickerFlyingPhase = null
            syncTickerFpsWithPhase()
            app.ticker.start()
            return
        } catch (e) {
            console.error("Init game error:", e)
            try { app?.destroy?.(false) } catch { /**/ }
            app = null
            if (pixiCanvasEl?.parentNode) pixiCanvasEl.remove()
            pixiCanvasEl = null
            if (attempt === 0 && !isDisposed) {
                await new Promise<void>((r) => setTimeout(() => r(), 150))
            }
        }
    }
}

onMounted(async () => {
    isDisposed = false
    await nextTick()
    // 在 initGame 完成前即可响应任意点击音手势，避免「必须先点下注」才解锁爆炸 HTMLAudio（iOS/WebKit）
    registerCrashBoomPoolGestureUnlock(() => {
        tryUnlockCrashBoomAudioFromGesture()
    })
    attachCrashBoomAudioUnlockListeners()
    await initGame()
    const target = canvasWrapper.value || gameContainer.value
    if (target && !isDisposed) {
        resizeObserver = new ResizeObserver(() => {
            if (isDisposed) return
            cancelAnimationFrame(resizeRafId)
            resizeRafId = requestAnimationFrame(() => { resizeRafId = 0; resizeCanvas() })
        })
        resizeObserver.observe(target)
    }
    visibilityHandler = () => {
        if (document.visibilityState === "hidden") {
            // 先隐藏 canvas，避免切回瞬间浏览器展示后台前缓存的旧 WebGL 帧。
            setPixiCanvasHiddenDuringResume(true)
            // 页面不可见时完全停止渲染循环，避免后台持续消耗 CPU/GPU
            if (app?.ticker.started) {
                app.ticker.stop()
            }
        } else {
            syncCrashCanvasBeforeShowing()
        }
    }
    document.addEventListener("visibilitychange", visibilityHandler)
    windowBlurHandler = () => {
        // 浏览器失焦但页面仍可见时不隐藏 canvas；例如被其他应用窗口覆盖会触发 blur，但不代表需要清空曲线。
    }
    windowFocusHandler = () => {
        syncCrashCanvasBeforeShowing()
    }
    pageShowHandler = () => {
        syncCrashCanvasBeforeShowing()
    }
    window.addEventListener("blur", windowBlurHandler)
    window.addEventListener("focus", windowFocusHandler)
    window.addEventListener("pageshow", pageShowHandler)
    await nextTick()
    // init 后 canvasWrapper 已挂，补绑容器上的监听（document 已在首帧绑定）
    attachCrashBoomAudioUnlockListeners()
})

onUnmounted(() => {
    isDisposed = true
    registerCrashBoomPoolGestureUnlock(null)
    _curveFillGradNormal?.destroy()
    _curveFillGradCrashed?.destroy()
    _curveFillGradNormal = null
    _curveFillGradCrashed = null
    crashBoomAudioUnlockCleanup?.()
    stopAndReleaseCrashBoomAudioPool()
    if (bangGifHideTimer) {
        clearTimeout(bangGifHideTimer)
        bangGifHideTimer = null
    }
    if (bangNameParticleTimer) {
        clearTimeout(bangNameParticleTimer)
        bangNameParticleTimer = null
    }
    if (crashFlashTimer) {
        clearTimeout(crashFlashTimer)
        crashFlashTimer = null
    }
    crashFlashActive.value = false
    bangGifVisible.value = false
    bangGifReadyPromise = null
    explosionNamesCtl?.destroy()
    explosionNamesCtl = null
    // 下落昵称控制器内部会释放 chip view（此处只需 stop）
    fallChipsCtl?.stopAll()
    fallChipsCtl = null
    hideSelfEscapeCashoutMarker()
    selfEscapeMarkerLayer = null
    selfEscapeMarkerInner = null
    selfEscapePin = null
    selfEscapeLabelBlock = null
    selfEscapeLabelBg = null
    selfEscapeLabelText = null
    selfEscapeMarkTexture = null
    selfEscapeMarkTexturePromise = null
    cancelAnimationFrame(resizeRafId)
    if (visibilityHandler) { document.removeEventListener("visibilitychange", visibilityHandler); visibilityHandler = null }
    if (windowBlurHandler) { window.removeEventListener("blur", windowBlurHandler); windowBlurHandler = null }
    if (windowFocusHandler) { window.removeEventListener("focus", windowFocusHandler); windowFocusHandler = null }
    if (pageShowHandler) { window.removeEventListener("pageshow", pageShowHandler); pageShowHandler = null }
    stopAllChips()
    resizeObserver?.disconnect(); resizeObserver = null
    // 释放头像纹理（Assets 缓存卸载）由控制器统一处理
    rocketMarkerCtl?.releaseAvatarIfAny()
    rocketMarkerCtl = null
    if (app) {
        try { app.ticker?.stop?.(); app.ticker?.remove?.(updateGame) } catch { /**/ }
        try { rocketAvatarRoot?.destroy({ children: true }) } catch { /**/ }
        rocketAvatarRoot = null
        rocketAvatarGlowGfx = null
        rocketVectorGlowGfx = null
        rocketAvatarSprite = null
        rocketAvatarMaskGfx = null
        rocketAvatarBorderGfx = null
        try { app.destroy(false) } catch { /**/ }; app = null
    }
    pixiCanvasEl?.remove(); pixiCanvasEl = null
})

// ═════════════════════════════════════════════════════════════════
// WATCHERS
// ═════════════════════════════════════════════════════════════════

watch(
    () => soundState.isClickSoundEnabled,
    (enabled) => {
        if (!enabled) crashBoomAudioIosUnlocked = false
    }
)

watch(
    crashJoinSnapshotApplied,
    (applied, prev) => {
        if (!applied) {
            initialJoinSnapshotWasCrashedRound.value = false
            hasSeenBettingPhaseSinceWsConnect.value = false
            // ★ L4 防线：WS 断连/重置时不解除同步 defer 标志。
            // 原因：断连后重连的首包可能仍是 crashed 态；若在此处清除 _syncDeferCrashRendering，
            // 则下一个 RAF 帧可能在 crashJoinSnapshotApplied 重新变为 true 之前就读到 false，
            // 导致已坠毁态的爆炸/曲线绘制到画布中央。
            // 此标志仅由两个安全入口清除：(1) phase===betting watcher (2) resetRound() / game_id 变化。
            // 不在此处清除。
            return
        }
        // 从 false/undefined → true，或 immediate 首帧：记录本连接 join 时是否为「已坠毁」快照（重连会再走一次）
        if (prev !== true) {
            const snap = crashRoomState.value
            const isCrashedSnap = !!(
                snap &&
                (snap.crashed || snap.phase === "crashed" || snap.phase === "settling")
            )
            initialJoinSnapshotWasCrashedRound.value = isCrashedSnap
            // ★ 同步设置非响应式标志：绕过 Vue 微任务调度，Pixi RAF 立即可见
            _syncDeferCrashRendering = isCrashedSnap && !hasSeenBettingPhaseSinceWsConnect.value
        }
    },
    { immediate: true },
)

watch(deferInitialCrashPresentation, (defer) => {
    if (defer) {
        // 清除 watcher 竞态期间可能已绘制到 Pixi 上的曲线+火箭等残留图形
        clearAllGameGraphics()
        resetCrashBoomPixiRound()
        // 降到极低帧率：defer 模式下几乎不需要任何渲染，4fps 仅维持 ticker 存活
        if (app?.ticker) app.ticker.maxFPS = TICKER_MAX_FPS_DEFER
    } else {
        // 恢复正常帧率
        if (app?.ticker) syncTickerFpsWithPhase()
    }
})

watch(
    [
        () => crashRoomState.value?.phase ?? null,
        () => !!crashRoomState.value?.crashed,
    ],
    ([phase, crashed]) => {
        const s = crashRoomState.value
        if (!s || !phase) {
            resetRound()
            gamePhase.value = "waiting"
            displayMultiplier.value = "—"
            showCountdown.value = false
            lastRoomPhase = ""
            return
        }

        if (phase === "betting") {
            hasSeenBettingPhaseSinceWsConnect.value = true
            // 进入 betting 后同步解除 defer（不等 Vue flush 下一个微任务周期）
            _syncDeferCrashRendering = false
        }

        isGameOver.value = crashed || phase === "crashed" || phase === "settling"

        if (phase === "flying" && !crashed) {
            handleFlyingPhase()
        } else if (phase === "betting") {
            handleBettingPhase(s)
        } else if (crashed || phase === "crashed" || phase === "settling") {
            handleCrashedPhase()
        }

        if (phase !== "flying" || crashed) {
            deactivateFlyingClockState()
        }
        lastRoomPhase = phase
    },
)

watch(() => crashRoomState.value?.game_id, (id, prev) => {
    if (prev != null && id != null && id !== prev) resetRound()
})

/** 本局本人 round_bets 变为 cashed 时，在对应倍数点展示图钉 + 逃离倍数 */
watch(
    () => {
        const s = crashRoomState.value
        const pid = crashSelfPlayerId.value
        if (!s || pid == null) return ""
        const bets = s.round_bets
        if (!Array.isArray(bets)) return ""
        const b = bets.find((x) => String(x.player_id) === String(pid))
        if (!b) return `${s.game_id}|none`
        return `${s.game_id}|${b.status}|${Number(b.multiplier) || 0}`
    },
    syncSelfEscapeCashoutMarkerFromState,
)
</script>

<style scoped>
.game-container {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    width: 100%;
    min-height: 300px;
    background: radial-gradient(120% 80% at 50% 0%, #1e293b 0%, #0f172a 45%, #020617 100%);
    box-sizing: border-box;
    border-radius: 12px;
    overflow: hidden;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 12px 40px rgba(0, 0, 0, 0.45);
    pointer-events: none;
}

.game-container::after {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: radial-gradient(circle at 50% 30%, rgba(34, 211, 238, 0.08), transparent 55%);
    opacity: 0;
    transition: opacity 0.12s ease-out;
    z-index: 5;
}

.game-container.crash-flash-active::after {
    opacity: 1;
    background: radial-gradient(circle at 50% 40%, rgba(255, 51, 85, 0.35), transparent 60%);
}

.crash-hud {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 14px 6px;
    z-index: 8;
    pointer-events: none;
}

.crash-hud-left {
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
}

.crash-phase-pill {
    display: inline-flex;
    align-items: center;
    width: fit-content;
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.12em;
    color: #e2e8f0;
    background: rgba(15, 23, 42, 0.65);
    border: 1px solid rgba(148, 163, 184, 0.25);
}

.crash-phase-pill[data-phase="flying"] {
    border-color: rgba(34, 211, 238, 0.45);
    color: #a5f3fc;
}

.crash-phase-pill[data-phase="crashed"] {
    border-color: rgba(255, 51, 85, 0.55);
    color: #fecaca;
}

.crash-phase-pill[data-phase="countdown"] {
    border-color: rgba(251, 191, 36, 0.5);
    color: #fde68a;
}

.crash-phase-pill[data-phase="waiting"] {
    border-color: rgba(148, 163, 184, 0.35);
    color: #94a3b8;
}

.crash-hud-sub {
    font-size: 11px;
    color: #94a3b8;
    font-weight: 500;
    margin-left: 20px;
}

.canvas-wrapper {
    position: relative;
    flex: 1;
    min-height: 200px;
    width: 100%;
    overflow: visible;
    isolation: isolate;
}

.pixi-host {
    position: absolute;
    inset: 0;
    z-index: 0;
    /* 与 app.init backgroundColor 一致，避免刷新后 WebGL 就绪前 canvas 默认白底闪一下 */
    background-color: #0f172a;
}

.bang-gif {
    position: absolute;
    z-index: 2;
    pointer-events: none;
    user-select: none;
    width: 220px;
    height: 220px;
    image-rendering: auto;
    -webkit-backface-visibility: hidden;
    backface-visibility: hidden;
    will-change: transform, opacity;
}

.game-pixi-canvas {
    display: block;
    width: 100% !important;
    height: 100% !important;
    border-radius: 0 0 8px 8px;
    background-color: #0f172a;
}

.axis-frame-overlay {
    position: absolute;
    z-index: 1;
    pointer-events: none;
    box-sizing: border-box;
    border-left: 1px solid rgba(148, 163, 184, 0.22);
    border-bottom: 1px solid rgba(148, 163, 184, 0.22);
    border-bottom-left-radius: 14px;
}

.y-axis-overlay {
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
    z-index: 1;
    pointer-events: none;
    box-sizing: border-box;
    /* width 与 Pixi _plotL 同步（模板内联），整块区域在竖向网格线左侧 */
    padding-right: 5px;
    min-width: 0;
}

.y-label {
    position: absolute;
    left: 0;
    width: 100%;
    color: #64748b;
    font-size: clamp(10px, 1.4vw, 12px);
    display: flex;
    align-items: center;
    justify-content: center;
    transform: translateY(-50%);
}

.x-axis-overlay {
    position: absolute;
    bottom: 6px;
    left: 0;
    width: 100%;
    height: 28px;
    z-index: 1;
    pointer-events: none;
}

.x-label {
    position: absolute;
    color: #64748b;
    font-size: clamp(10px, 1.4vw, 12px);
    transform: translateX(-50%);
    will-change: left;
    transition: left 0.14s linear;
}

.multiplier-display {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -58%);
    z-index: 10;
    pointer-events: none;
    display: block;
    width: max-content;
    max-width: 100%;
    text-align: center;
    font-feature-settings: "tnum" 1;
    font-variant-numeric: tabular-nums lining-nums;
}

.multiplier-value-wrap {
    display: inline-flex;
    align-items: baseline;
    justify-content: center;
    gap: 0.08em;
    font-size: clamp(55px, 5vw, 85px);
    font-weight: 800;
    line-height: 1;
    letter-spacing: -0.03em;
    transform-origin: 50% 55%;
    text-shadow: 0 0 40px rgba(34, 211, 238, 0.15);
    font-family: "FixelText-ExtraBold";
}

.multiplier-value-wrap.multiplier-flash-ping {
    animation: multiplier-flash-ping 0.42s cubic-bezier(0.34, 1.45, 0.64, 1) 1 both;
}

.multiplier-value {
    font-weight: bold;
}

.multiplier-value,
.multiplier-suffix {
    background: linear-gradient(180deg, #fff 0%, #fff 40%, #fff 100%);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
}

.multiplier-display.crashed .multiplier-value,
.multiplier-display.crashed .multiplier-suffix {
    background: linear-gradient(180deg, #fff1f2 0%, #fb7185 45%, #f43f5e 100%);
    -webkit-background-clip: text;
    background-clip: text;
}

.multiplier-display.crashed .multiplier-value-wrap {
    text-shadow: none;
    filter: none;
}

.multiplier-suffix {
    font-size: clamp(35px, 5vw, 65px);
}


@keyframes multiplier-flash-ping {
    0% {
        transform: scale(1);
        /* filter: drop-shadow(0 0 12px rgba(34, 211, 238, 0.25)); */
    }

    45% {
        transform: scale(1.26);
        /* filter: drop-shadow(0 0 32px rgba(34, 211, 238, 0.65)); */
    }

    100% {
        transform: scale(1);
        /* filter: drop-shadow(0 0 12px rgba(34, 211, 238, 0.25)); */
    }
}

/* 窄屏：减弱 HUD 缩放幅度与时长，减轻与 Pixi/WebGL 同帧争 GPU（高倍时「停-跳-停」观感多源于此） */
@keyframes multiplier-flash-ping-h5 {
    0% {
        transform: scale(1);
    }

    45% {
        transform: scale(1.12);
    }

    100% {
        transform: scale(1);
    }
}

.crash-h5 .multiplier-value-wrap.multiplier-flash-ping {
    animation: multiplier-flash-ping-h5 0.3s cubic-bezier(0.34, 1.2, 0.55, 1) 1 both;
}

.multiplier-display.crashed .multiplier-value-wrap.multiplier-flash-ping {
    animation: multiplier-flash-ping-crashed 0.42s cubic-bezier(0.34, 1.45, 0.64, 1) 1 both;
}

@keyframes multiplier-flash-ping-crashed {
    0% {
        transform: scale(1);
    }

    45% {
        transform: scale(1.12);
    }

    100% {
        transform: scale(1);
    }
}

@keyframes multiplier-flash-ping-crashed-h5 {
    0% {
        transform: scale(1);
    }

    45% {
        transform: scale(1.06);
    }

    100% {
        transform: scale(1);
    }
}

.crash-h5 .multiplier-display.crashed .multiplier-value-wrap.multiplier-flash-ping {
    animation: multiplier-flash-ping-crashed-h5 0.28s cubic-bezier(0.34, 1.15, 0.55, 1) 1 both;
}

.crashed-label {
    position: absolute;
    left: 50%;
    top: 80%;
    margin-top: 12px;
    transform: translateX(-50%);
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: clamp(13px, 2.4vw, 18px);
    font-weight: 600;
    color: #fb7185;
    /* background: rgba(244, 63, 94, 0.18); */
    padding: 8px 18px;
    border-radius: 999px;
    white-space: nowrap;
    /* border: 1px solid rgba(244, 63, 94, 0.4); */
}

.loading {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    align-items: center;
    gap: 10px;
    color: #94a3b8;
    font-size: 14px;
    z-index: 20;
}

.loading-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #22d3ee;
    animation: load-pulse 0.9s ease-in-out infinite;
}

/* 首屏坠毁竞态：盖住画布/刻度，避免用户看到中央误爆与矛盾 HUD */
.loading.loading-ws.loading-ws-cover {
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    transform: none;
    justify-content: center;
    align-items: center;
    background: rgba(15, 23, 42, 0.92);
    backdrop-filter: blur(10px);
    z-index: 35;
}

@keyframes load-pulse {

    0%,
    100% {
        opacity: 0.35;
        transform: scale(0.85);
    }

    50% {
        opacity: 1;
        transform: scale(1.1);
    }
}

.countdown-overlay {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 100;
    pointer-events: none;
}

.countdown-pill {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 12px 28px;
    background: rgba(15, 23, 42, 0.82);
    border-radius: 999px;
    overflow: hidden;
    border: 1px solid rgba(148, 163, 184, 0.2);
    backdrop-filter: blur(12px);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.countdown-progress {
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
    background: linear-gradient(90deg, rgba(34, 211, 238, 0.2), rgba(34, 211, 238, 0.08));
    border-radius: 0 999px 999px 0;
    z-index: 1;
    transition: width 0.05s linear;
}

.countdown-text {
    position: relative;
    z-index: 2;
    font-size: clamp(12px, 2vw, 16px);
    font-weight: 600;
    color: #e2e8f0;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.04em;
}

.canvas-wrapper.h5-canvas-layout .y-axis-overlay {
    left: 0;
}

.canvas-wrapper.h5-canvas-layout .x-axis-overlay {
    bottom: 0;
    height: 26px;
    z-index: 4;
    box-sizing: border-box;
    padding-bottom: 0;
}

.canvas-wrapper.h5-canvas-layout .axis-frame-overlay {
    border-bottom-left-radius: 12px;
}

.canvas-wrapper.h5-canvas-layout .y-axis-overlay .y-text {
    font-size: clamp(10px, 3.2vw, 12px);
}

.canvas-wrapper.h5-canvas-layout .x-axis-overlay .x-text {
    font-size: clamp(10px, 3.2vw, 12px);
    line-height: 1.2;
    text-shadow: 0 1px 2px rgba(15, 23, 42, 0.85);
}

/* H5：时间刻度与曲线同帧更新，禁用 left 过渡，避免右缘新刻度与邻近刻度短暂重叠闪现 */
.canvas-wrapper.h5-canvas-layout .x-label {
    transition: none;
}

@media (max-width: 768px) {
    .game-container {
        margin-top: 5px;
    }

    .crash-hud {
        flex-direction: column;
        align-items: stretch;
    }

    .multiplier-display {
        transform: translate(-50%, -52%);
    }

    .countdown-pill {
        padding: 8px 16px;
    }
}
</style>
