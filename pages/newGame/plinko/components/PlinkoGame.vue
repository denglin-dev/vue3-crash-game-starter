<template>
	<div class="plinko-game" :style="{ height: props.canvasHeight }">
		<!-- 游戏主体 -->
		<div class="game-body">
			<!-- 游戏画布 -->
			<div class="game-canvas-container" ref="gameContainer">
				<!-- 倍数显示 -->
				<div class="multipliers-display" :class="{ 'multipliers-display--hidden': multipliersHidden }" :style="{
					top: `${multipliersTop}px`,
					left: `${lastRowStartX}px`,
					width: `${displayedMultipliers.length * pegSpacing}px`
				}">
					<div v-for="(mult, index) in displayedMultipliers" :key="index" class="multiplier-slot-wrapper">
						<div class="multiplier-slot" :class="{ landed: landedSlotIndex === index }" :style="{
							width: `${Math.max(17, pegSpacing * 0.8)}px`,
							height: `${Math.max(18, 24 * scale)}px`,
							fontSize: `${Math.max(7, 11 * scale)}px`,
							background: `linear-gradient(180deg, ${getMultiplierColor(index)} 0%, ${getMultiplierColor(index)} 100%)`
						}">
							{{ formatMultiplier(mult) }}
						</div>
					</div>
				</div>
			</div>
		</div>

	</div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from "vue"
import { currentMultipliers, isFastGamePlinko } from "../composables/usePlinkoState" // ✅ 添加 isFastGamePlinko
import { useDebounceFn } from "@vueuse/core" // ✅ 添加这行
import * as PIXI from "pixi.js"
import { loadTextures } from "pixi.js"

// Pixi 8 默认在 blob Worker 里解码纹理；正式站 CSP 未显式允许 blob: 时 worker-src 回退 script-src，创建 Worker 会被拦截，画布无法初始化。
if (import.meta.client) {
	loadTextures.config.preferWorkers = false
}

import { deviceAdvanced } from "~/utils/hook/hook"
import { useGame } from "~/composables/GameHook"
import { ShortSfxWebAudioController } from "~/utils/sound/shortSfxWebAudio"
import { createDeferGameSfxController } from "~/utils/sound/deferGameSfx"
import plinkoSfxStart from "/sounds/plinko/start-f78c8e648a.mp3"
import plinkoSfxPin from "/sounds/plinko/pin-ed412fca53.mp3"
import plinkoSfxWin from "/sounds/plinko/win-8dcb8a6ce6.mp3"

const { soundState } = useGame()

/** Plinko 三轨短音效：Web Audio 单上下文 + 解码缓存，避免多路 HTMLAudio 与主循环争用 */
const PLINKO_SFX = { pin: "pin", start: "start", win: "win" } as const
const plinkoWebSfx = new ShortSfxWebAudioController([
	{ key: PLINKO_SFX.pin, url: plinkoSfxPin },
	{ key: PLINKO_SFX.start, url: plinkoSfxStart },
	{ key: PLINKO_SFX.win, url: plinkoSfxWin }
])

/** 是否已在用户手势内完成 `AudioContext.resume`（与解码可分开：挂载后会尝试预解码） */
const plinkoWebSfxUnlocked = ref(false)
let plinkoSfxUnlockListenersCleanup: (() => void) | null = null

/** 卸载/销毁场景时禁止播放；每实例独立，避免离页后仍 `play` */
const plinkoSfxPlaybackDisabled = ref(false)

/** 撞钉音：轻量节流，避免极短间隔内叠过多 BufferSource（听感糊、仍占混音） */
let lastPlinkoPinSfxScheduledMs = 0

const plinkoPinSfxMinIntervalMs = () => {
	const mobile = deviceAdvanced.value === "mobile"
	if (isFastGamePlinko.value) return mobile ? 40 : 22
	return mobile ? 30 : 18
}

/** 落槽/开局音效略晚于 Pixi 建球与首帧物理，减轻与 ticker 同帧争用（撞钉 pin 仍即时） */
const plinkoBallSfxDefer = createDeferGameSfxController()

const playPlinkoPinSfx = () => {
	if (plinkoSfxPlaybackDisabled.value || !soundState.isClickSoundEnabled) return
	const now = performance.now()
	if (now - lastPlinkoPinSfxScheduledMs < plinkoPinSfxMinIntervalMs()) return
	lastPlinkoPinSfxScheduledMs = now
	plinkoWebSfx.play(PLINKO_SFX.pin)
}

const playPlinkoStartSfx = () => {
	if (plinkoSfxPlaybackDisabled.value || !soundState.isClickSoundEnabled) return
	plinkoBallSfxDefer.schedule(() => {
		if (plinkoSfxPlaybackDisabled.value || !soundState.isClickSoundEnabled) return
		plinkoWebSfx.play(PLINKO_SFX.start)
	}, isFastGamePlinko.value ? 22 : 34)
}

const playPlinkoWinSfx = () => {
	if (plinkoSfxPlaybackDisabled.value || !soundState.isClickSoundEnabled) return
	plinkoBallSfxDefer.schedule(() => {
		if (plinkoSfxPlaybackDisabled.value || !soundState.isClickSoundEnabled) return
		plinkoWebSfx.play(PLINKO_SFX.win)
	}, isFastGamePlinko.value ? 20 : 32)
}

/** 手势内 resume；解码已在挂载后后台尝试，缩短首点延迟 */
const tryUnlockPlinkoWebSfxFromGesture = async () => {
	if (plinkoWebSfxUnlocked.value || !soundState.isClickSoundEnabled || !import.meta.client) return
	const ok = await plinkoWebSfx.unlockFromGesture()
	plinkoWebSfxUnlocked.value = ok
}

const attachPlinkoSfxGestureUnlockListeners = () => {
	if (plinkoSfxUnlockListenersCleanup || !import.meta.client) return
	const onFirstGesture = () => {
		// 同步 resume 钉在手势栈上；解码在 unlock 内 await，避免 WebKit 整段无声
		plinkoWebSfx.syncResumeFromUserGesture()
		void tryUnlockPlinkoWebSfxFromGesture()
	}
	const docOpts: AddEventListenerOptions = { capture: true, passive: true }
	document.addEventListener("pointerdown", onFirstGesture, docOpts)
	document.addEventListener("touchstart", onFirstGesture, docOpts)
	const root = gameContainer.value
	const localOpts: AddEventListenerOptions = { passive: true }
	if (root) {
		root.addEventListener("pointerdown", onFirstGesture, localOpts)
		root.addEventListener("touchstart", onFirstGesture, localOpts)
	}
	plinkoSfxUnlockListenersCleanup = () => {
		document.removeEventListener("pointerdown", onFirstGesture, docOpts)
		document.removeEventListener("touchstart", onFirstGesture, docOpts)
		if (root) {
			root.removeEventListener("pointerdown", onFirstGesture, localOpts)
			root.removeEventListener("touchstart", onFirstGesture, localOpts)
		}
		plinkoSfxUnlockListenersCleanup = null
	}
}

const detachPlinkoSfxGestureUnlockListeners = () => {
	plinkoSfxUnlockListenersCleanup?.()
}
const props = defineProps({
	canvasHeight: {
		type: String,
		default: "750px"
	},
	// ✅ 新增 props
	rows: {
		type: Number,
		default: 8
	},
	risk: {
		type: Number,
		default: 0
	},
	// 当前激活的槽位索引（用于高亮）
	activeSlotIndex: {
		type: Number,
		default: -1
	}
})
/** 430px 宽的 iPhone Pro Max 仍属于窄屏手机；不要走平板式左右 60px 安全边距。 */
const PLINKO_PHONE_FULL_WIDTH_MAX = 480
/**
 * 最后一排两端钉子的安全边距按行数动态调整：
 * - 16 行槽位多，需要尽量铺开，避免倍数槽挤在一起；
 * - 8 行槽位少，需要留更多边距，避免钉子墙太贴手机边缘。
 */
const PLINKO_PHONE_SIDE_SAFE_MIN_PX = 16
const PLINKO_PHONE_SIDE_SAFE_MAX_PX = 52
const PLINKO_TABLET_SIDE_SAFE_MIN_PX = 32
const PLINKO_TABLET_SIDE_SAFE_MAX_PX = 72
const PLINKO_PC_SIDE_SAFE_PX = 100
// ✅ 添加 emit 定义（在 script 标签后）
const emit = defineEmits<{
	(e: "onResult", binIndex: number, multiplier: number, roundId: string): void
}>()

/**
 * 倍数槽配色表（按行数区分）。
 * 键：rows，值：每个槽位的颜色数组（从左到右）。
 */
const betColorMap: Record<number, string[]> = {
	8: ["#F83557", "#F85858", "#FF7956", "#FF8F5D", "#FFB250", "#FF8F5D", "#FF7956", "#F85858", "#F83557"],
	9: ["#F83557", "#F85858", "#FF7956", "#FF8F5D", "#FFB250", "#FFB250", "#FF8F5D", "#FF7956", "#F85858", "#F83557"],
	10: [
		"#F83557",
		"#F85858",
		"#FF7559",
		"#EB7C4F",
		"#F89A52",
		"#FFB745",
		"#F89A52",
		"#EB7C4F",
		"#FF7559",
		"#F85858",
		"#F83557"
	],
	11: [
		"#F83557",
		"#F85858",
		"#FF7559",
		"#EB7C4F",
		"#F89A52",
		"#FFB745",
		"#FFB745",
		"#F89A52",
		"#EB7C4F",
		"#FF7559",
		"#F85858",
		"#F83557"
	],
	12: [
		"#F83557",
		"#FF4566",
		"#FA5551",
		"#FF7559",
		"#FB9058",
		"#FFA54D",
		"#FBC354",
		"#FFA54D",
		"#FB9058",
		"#FF7559",
		"#FA5551",
		"#FF4566",
		"#F83557"
	],
	13: [
		"#F83557",
		"#FF4566",
		"#FA5551",
		"#FF7559",
		"#FB9058",
		"#FFA54D",
		"#FBC354",
		"#FBC354",
		"#FFA54D",
		"#FB9058",
		"#FF7559",
		"#FA5551",
		"#FF4566",
		"#F83557"
	],
	14: [
		"#F83557",
		"#FF4566",
		"#EC575D",
		"#FF6E56",
		"#F8895B",
		"#FF9855",
		"#FFAE5A",
		"#FBC354",
		"#FFAE5A",
		"#FF9855",
		"#F8895B",
		"#FF6E56",
		"#EC575D",
		"#FF4566",
		"#F83557"
	],
	15: [
		"#F83557",
		"#FF4566",
		"#EC575D",
		"#FF6E56",
		"#F8895B",
		"#FF9855",
		"#FFAE5A",
		"#FBC354",
		"#FBC354",
		"#FFAE5A",
		"#FF9855",
		"#F8895B",
		"#FF6E56",
		"#EC575D",
		"#FF4566",
		"#F83557"
	],
	16: [
		"#F83557",
		"#FF4566",
		"#EC575D",
		"#FF6E56",
		"#F8895B",
		"#FF9855",
		"#FFAE5A",
		"#FBC354",
		"#FFE54F",
		"#FBC354",
		"#FFAE5A",
		"#FF9855",
		"#F8895B",
		"#FF6E56",
		"#EC575D",
		"#FF4566",
		"#F83557"
	]
}

/**
 * 视觉/物理常量（统一从这里调）。
 * - BALL_RADIUS：弹珠半径（基础值，最终会乘 scale）。
 * - PEG_RADIUS：可控物理里用于命中几何计算的钉子半径。
 * - PEG_RENDER_RADIUS：Pixi 视觉钉子半径（可与物理半径不同）。
 */
const BALL_RADIUS = 6
const PEG_RADIUS = 8 // ✅ 增大：7 -> 8（物理碰撞半径）
const PEG_RENDER_RADIUS = 6 // 渲染半径保持不变

// 基准尺寸（用于计算缩放）
const BASE_PEG_SPACING = 40

/**
 * iPhone / iPad（含 iPadOS 桌面模式）：WebKit + TBDR GPU 上「多路 rAF + 高 resolution」极易掉帧；
 * 与 `deviceAdvanced === 'mobile'` 区分开：安卓 mobile 不必吃同一套上限。
 */
const isAppleTouchDevice = (): boolean => {
	if (!import.meta.client || typeof navigator === "undefined") return false
	const ua = navigator.userAgent || ""
	if (/iP(hone|ad|od)/i.test(ua)) return true
	return navigator.platform === "MacIntel" && (navigator.maxTouchPoints ?? 0) > 1
}

/**
 * Pixi 画布分辨率倍数（配合 autoDensity）。
 * iPhone 常见 DPR=3，若 resolution 顶到 3 会显著增加片元与带宽压力；移动端统一更严上限。
 * 桌面端普通模式仍允许略高以保锐利。
 */
const getPixiResolution = (lite: boolean) => {
	const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1
	// const apple = isAppleTouchDevice()
	// if (apple) {
	// 	// Apple：仍低于 DPR=3 以省带宽，但用较「整」的上限，避免过小 + 非整数倍缩放导致圆贴图被拉成椭圆观感
	// 	return Math.min(dpr, lite ? 1.6 : 2)
	// }
	const mobile = deviceAdvanced.value === "mobile"
	if (mobile) {
		return Math.min(dpr, lite ? 2 : 2.5)
	}
	return Math.min(dpr, lite ? 2 : 3)
}

// ==================== 运行时状态（UI坐标/缩放） ====================
const gameContainer = ref<HTMLElement | null>(null)
const multipliersTop = ref(0)
const lastRowStartX = ref(0)

// 动态尺寸（根据容器缩放）
const scale = ref(1)
const pegSpacing = computed(() => BASE_PEG_SPACING * scale.value)
const ballRadius = computed(() => BALL_RADIUS * scale.value)
const pegRadius = computed(() => PEG_RADIUS * scale.value)
const pegRenderRadius = computed(() => PEG_RENDER_RADIUS * scale.value)

let resizeTimer: ReturnType<typeof setTimeout> | null = null
// ==================== 定时器和动画帧管理 ====================
// 在变量声明区添加缓存
let cachedGameDimensions: ReturnType<typeof calculateGameDimensions> | null = null
type ActiveBallLayout = {
	width: number
	height: number
	startY: number
	finalPegSpacingY: number
}
type ActiveBallSim = {
	multiplier: number
	path: PlinkoPathPoint[]
	rows: number
	safeBin: number
	x: number
	y: number
	vx: number
	vy: number
	prevTs: number
	rotVel: number
	prevX: number
	pegHitSet: Set<number>
	rowPaths: ActiveBallRowPath[]
	layout: ActiveBallLayout
	targetX: number
	targetY: number
	done: boolean
	/** 与 usePlinkoState.registerPendingPlinkoRound 的 key 一致 */
	roundId: string
}

type ActiveBallRowPath = {
	slotX: number
	hitPegIdx: number
	hitPegX: number
	pegY: number
	rowStartX: number
	pegsInRow: number
	direction: number
}
/** 多颗弹珠并行掉落：物理统一走 `pixiApp.ticker`（单回调），避免 iOS 上每球独立 requestAnimationFrame 的调度与合成开销 */
type ActiveBallEntry = {
	graphic: PIXI.Container
	sim: ActiveBallSim
}
const activeBalls: ActiveBallEntry[] = []

let resizeObserver: ResizeObserver | null = null

// Pixi.js（实际可视化层）
let pixiApp: PIXI.Application | null = null
let plinkoGameDisposed = false
let plinkoInitVersion = 0
let pegsContainer: PIXI.Container | null = null
let ballsContainer: PIXI.Container | null = null
let effectsContainer: PIXI.Container | null = null
type PegRenderable = PIXI.Sprite | PIXI.Graphics
const pegGraphics: PegRenderable[] = []
let pegTexture: PIXI.Texture | null = null
let ballTexture: PIXI.Texture | null = null
let activeRippleEffects = 0
/** 钉子碰撞光晕 + 落槽粒子共用 Pixi ticker，避免大量 requestAnimationFrame */
/** 光晕第一段径向厚度约 5px（内缘贴紧钉子外沿，不留缝） */
const HALO_RADIAL_PX = 5
/** 弹珠离开后，在上一段基础上再径向扩散约 5px 并淡出（合计约 10px，比原先 10+10 更细） */
const HALO_LEAVE_EXTRA_PX = 5
/** 碰撞后光晕从 0「扩散」到满幅的时长 */
const HALO_APPEAR_DURATION_MS = 220
/** 离开阶段：再扩散 + 淡化 */
const HALO_EXPAND_DURATION_MS = 320
/** 单层浅紫色光晕（#6d4aa9） */
const HALO_COLOR = 0x6d4aa9
/** 光晕整体透明度系数（越小越淡） */
const HALO_OPACITY = 0.32

type RippleEntry = {
	root: PIXI.Container
	halo: PIXI.Graphics
	pegX: number
	pegY: number
	phase: "appear" | "hold" | "expand"
	appearStartMs: number
	expandStartMs: number
	/** 创建时钉子可视半径，用于内缘对齐 */
	pegR: number
}
const rippleEntries: RippleEntry[] = []

/**
 * 单层贴钉圆环光晕：仅一道 stroke，中心线在 pegR + thick/2，内缘 = pegR，无空白。
 */
const drawPegCollisionHalo = (g: PIXI.Graphics, pegR: number, thick: number, alpha: number) => {
	g.clear()
	if (thick < 0.08 || alpha < 0.008) return
	const pathR = pegR + thick / 2
	const a = Math.min(1, Math.max(0, alpha)) * HALO_OPACITY
	g.circle(0, 0, pathR)
	g.stroke({ color: HALO_COLOR, width: thick, alpha: a })
}

type ParticleFx = {
	graphic: PIXI.Graphics
	vx: number
	vy: number
	alpha: number
	drag: number
	rot: number
	rotV: number
	scale: number
	scaleV: number
}
const particleBursts: ParticleFx[][] = []

let effectsTickerAttached = false

const updateEffectsTicker = () => {
	if (!pixiApp) return

	const now = performance.now()
	const baseThick = HALO_RADIAL_PX * scale.value
	const leaveExtra = HALO_LEAVE_EXTRA_PX * scale.value
	const holdDurationMs = isFastGamePlinko.value ? 120 : 180

	for (let i = rippleEntries.length - 1; i >= 0; i--) {
		const e = rippleEntries[i]

		if (e.phase === "appear") {
			const ta = Math.min(1, (now - e.appearStartMs) / HALO_APPEAR_DURATION_MS)
			// 扩散：厚度由小变大 + 透明度跟上，避免「突然出现」
			const easeSpread = 1 - (1 - ta) * (1 - ta)
			const thick = baseThick * easeSpread
			const alpha = 0.35 + 0.65 * easeSpread
			drawPegCollisionHalo(e.halo, e.pegR, thick, alpha)
			if (ta >= 1) {
				e.phase = "hold"
			}
			continue
		}

		if (e.phase === "hold") {
			drawPegCollisionHalo(e.halo, e.pegR, baseThick, 1)
			if (now - e.appearStartMs > HALO_APPEAR_DURATION_MS + holdDurationMs) {
				e.phase = "expand"
				e.expandStartMs = now
			}
			continue
		}

		// expand：在满幅 5px 基础上再径向加宽约 5px，同时淡化
		const te = Math.min(1, (now - e.expandStartMs) / HALO_EXPAND_DURATION_MS)
		const ease = te * (2 - te)
		const thick = baseThick + leaveExtra * ease
		const fade = 1 - te
		drawPegCollisionHalo(e.halo, e.pegR, thick, fade)

		if (te >= 1) {
			e.root.destroy({ children: true })
			activeRippleEffects = Math.max(0, activeRippleEffects - 1)
			rippleEntries.splice(i, 1)
		}
	}

	const k = Math.min(3, Math.max(0.25, pixiApp.ticker.deltaMS / 16.67))
	for (let b = particleBursts.length - 1; b >= 0; b--) {
		const burst = particleBursts[b]
		let allDead = true
		for (const p of burst) {
			if (p.alpha <= 0) continue
			allDead = false
			p.vx *= Math.pow(p.drag, k)
			p.vy = p.vy * Math.pow(p.drag, k) + 0.1 * k
			p.graphic.position.x += p.vx * k
			p.graphic.position.y += p.vy * k
			p.rot += p.rotV * k
			p.graphic.rotation = p.rot
			p.scale = Math.max(0, p.scale + p.scaleV * k)
			p.graphic.scale.set(p.scale)
			p.alpha -= 0.055 * k
			p.graphic.alpha = p.alpha
		}
		if (allDead) {
			burst.forEach((p) => p.graphic.destroy())
			particleBursts.splice(b, 1)
		}
	}

	if (rippleEntries.length === 0 && particleBursts.length === 0 && effectsTickerAttached) {
		pixiApp.ticker.remove(updateEffectsTicker)
		effectsTickerAttached = false
	}
}

const ensureEffectsTicker = () => {
	if (!pixiApp || effectsTickerAttached) return
	pixiApp.ticker.add(updateEffectsTicker)
	effectsTickerAttached = true
}

const clearAllEffects = () => {
	for (const e of rippleEntries) {
		e.root.destroy({ children: true })
	}
	rippleEntries.length = 0
	activeRippleEffects = 0
	for (const burst of particleBursts) {
		burst.forEach((p) => p.graphic.destroy())
	}
	particleBursts.length = 0
	if (pixiApp && effectsTickerAttached) {
		pixiApp.ticker.remove(updateEffectsTicker)
		effectsTickerAttached = false
	}
}

const landedSlotIndex = ref(-1)
let slotAnimResetTimer: ReturnType<typeof setTimeout> | null = null

/**
 * rows 切换时：`currentMultipliers` 会先变，但画布/peg 布局是 debounce 后才重建，
 * 会出现「旧布局 + 新倍数」短暂错位。这里冻结显示，等布局更新后再切换倍数并淡入。
 */
const displayedRows = ref(props.rows)
const displayedMultipliers = ref<number[]>([])
const multipliersHidden = ref(false)

const triggerSlotLandingAnimation = (index: number) => {
	const slotCount = currentMultipliers.value.length
	const safe = Math.max(0, Math.min(slotCount - 1, index))
	landedSlotIndex.value = -1
	requestAnimationFrame(() => {
		landedSlotIndex.value = safe
	})
	if (slotAnimResetTimer) {
		clearTimeout(slotAnimResetTimer)
	}
	slotAnimResetTimer = setTimeout(() => {
		landedSlotIndex.value = -1
		slotAnimResetTimer = null
	}, 460)
}

/**
 * 根据槽位索引返回该槽位颜色。
 * 如果 rows 不在 betColorMap 中，回退默认红色。
 */
const getMultiplierColor = (index: number): string => {
	const colors = betColorMap[displayedRows.value]
	return colors?.[index] || "#F83557"
}

/**
 * 倍数文本格式化：
 * - 1000 及以上使用 K 简写（如 1000 -> 1K）
 * - 整数直接显示（如 2）
 * - 非整数保留 1 位小数（如 1.2）
 */
const formatMultiplier = (mult: number): string => {
	if (mult >= 1000) {
		const k = mult / 1000
		return Number.isInteger(k) ? `${k}K` : `${k.toFixed(1)}K`
	}
	// 如果是整数，直接显示整数
	if (Number.isInteger(mult)) return mult.toString()
	// 否则保留一位小数
	return mult.toFixed(1)
}

const getAvailableGameWidth = (width: number) => {
	const MAX_GAME_WIDTH = 600
	const rowT = Math.max(0, Math.min(1, (props.rows - 8) / 8))
	const phoneSafe = PLINKO_PHONE_SIDE_SAFE_MAX_PX -
		(PLINKO_PHONE_SIDE_SAFE_MAX_PX - PLINKO_PHONE_SIDE_SAFE_MIN_PX) * rowT
	const tabletSafe = PLINKO_TABLET_SIDE_SAFE_MAX_PX -
		(PLINKO_TABLET_SIDE_SAFE_MAX_PX - PLINKO_TABLET_SIDE_SAFE_MIN_PX) * rowT
	if (width <= PLINKO_PHONE_FULL_WIDTH_MAX) {
		return Math.max(1, width - phoneSafe)
	}
	if (width <= 768) {
		return Math.max(1, width - tabletSafe)
	}
	return Math.max(1, Math.min(MAX_GAME_WIDTH, width - PLINKO_PC_SIDE_SAFE_PX))
}
// ==================== 初始化主流程 ====================
/**
 * 初始化游戏场景（组件首次挂载 / rows 变化重建时调用）。
 * 副作用：
 * - 创建 Pixi 应用与容器层
 * - 绘制钉子布局
 */
const initGame = async () => {
	const initVersion = plinkoInitVersion
	if (!gameContainer.value) return

	const container = gameContainer.value
	const width = container.clientWidth
	const height = container.clientHeight
	/** Apple 触摸端关 MSAA：Safari/WebKit TBDR 上 MSAA 合成成本显著；安卓 mobile 仍开以保观感 */
	const lowGpuMsaaOff = isAppleTouchDevice()

	// 计算缩放比例（基于宽度）
	const availableWidth = getAvailableGameWidth(width)

	// 使用当前行数计算缩放，让最后一排钉子靠近画布边缘
	const pegsInLastRow = props.rows + 2
	const requiredWidth = (pegsInLastRow - 1) * BASE_PEG_SPACING
	scale.value = availableWidth / requiredWidth

	// 创建 Pixi 应用
	const appInstance = new PIXI.Application()
	pixiApp = appInstance
	const litePixi = isFastGamePlinko.value
	await appInstance.init({
		width,
		height,
		backgroundColor: 0x111933,
		backgroundAlpha: 1, // 关键：透明
		antialias: !lowGpuMsaaOff,
		resolution: getPixiResolution(litePixi),
		autoDensity: true
	})
	if (plinkoGameDisposed || initVersion !== plinkoInitVersion || pixiApp !== appInstance) {
		try {
			appInstance.destroy(true, { children: true })
		} catch {
			/* ignore */
		}
		if (pixiApp === appInstance) pixiApp = null
		return
	}

	// 钉子 / 弹珠贴图（public：/img/plinko/peg.png、/img/plinko/ball.png）
	// 任一加载失败会降级为 Graphics（不影响玩法）
	pegTexture = null
	ballTexture = null
	const [pegRes, ballRes] = await Promise.allSettled([
		PIXI.Assets.load("/img/plinko/peg.png"),
		PIXI.Assets.load("/img/plinko/ball.png")
	])
	if (pegRes.status === "fulfilled") pegTexture = pegRes.value
	if (ballRes.status === "fulfilled") ballTexture = ballRes.value
	if (plinkoGameDisposed || initVersion !== plinkoInitVersion || pixiApp !== appInstance) {
		try {
			appInstance.destroy(true, { children: true })
		} catch {
			/* ignore */
		}
		if (pixiApp === appInstance) pixiApp = null
		return
	}

	try {
		container.appendChild(appInstance.canvas)
	} catch (error) { }

	// 创建容器
	pegsContainer = new PIXI.Container()
	ballsContainer = new PIXI.Container()
	effectsContainer = new PIXI.Container()
	appInstance.stage.addChild(pegsContainer)
	// 弹珠层放在钉子层上方；通过几何约束避免两者重叠
	appInstance.stage.addChild(ballsContainer)
	appInstance.stage.addChild(effectsContainer)

	// 创建钉子
	createPegs(width, height)

	// 场景就绪后再允许音效（与 `cleanup` 成对；用 ref 保证每实例独立）
	plinkoSfxPlaybackDisabled.value = false
}

const computeScaleForWidth = (width: number) => {
	const availableWidth = getAvailableGameWidth(width)
	const pegsInLastRow = props.rows + 2
	const requiredWidth = (pegsInLastRow - 1) * BASE_PEG_SPACING
	return availableWidth / requiredWidth
}

const resizeInPlace = useDebounceFn(() => {
	const container = gameContainer.value
	if (!container || !pixiApp) return
	const width = container.clientWidth
	const height = container.clientHeight
	if (!width || !height) return

	const oldScale = scale.value
	scale.value = computeScaleForWidth(width)
	cachedGameDimensions = null

	// 1) 原地 resize renderer（同步 DPR / 极速模式，避免缩放窗口后变糊）
	try {
		pixiApp.renderer.resolution = getPixiResolution(isFastGamePlinko.value)
		pixiApp.renderer.resize(width, height)
	} catch (e) {
		// ignore
	}

	// 2) 重绘钉子/倍数条
	createPegs(width, height)

	// 3) 重绘所有掉落中的弹珠并尽量保持各自位置
	if (activeBalls.length > 0 && ballsContainer) {
		const dims = cachedGameDimensions || calculateGameDimensions(width, height, props.rows)
		const newLayoutBase: ActiveBallLayout = { width, height, startY: dims.startY, finalPegSpacingY: dims.finalPegSpacingY }

		for (const entry of activeBalls) {
			const sim = entry.sim
			const old = sim.layout

			const xRatio = old.width > 0 ? sim.x / old.width : 0.5
			const yRel = sim.y - old.startY
			const yScale = old.finalPegSpacingY > 0 ? newLayoutBase.finalPegSpacingY / old.finalPegSpacingY : 1

			sim.x = xRatio * width
			sim.y = newLayoutBase.startY + yRel * yScale
			sim.vx *= oldScale > 0 ? scale.value / oldScale : 1
			sim.vy *= oldScale > 0 ? scale.value / oldScale : 1
			sim.prevX = sim.x
			sim.layout = { ...newLayoutBase }

			const pathByRow = new Map<number, PlinkoPathPoint>()
			sim.path.forEach((p) => pathByRow.set(p.row, p))
			const rowPaths: ActiveBallRowPath[] = []
			let prevColumn = 0
			for (let rowIdx = 0; rowIdx < sim.rows; rowIdx++) {
				const pathPoint = pathByRow.get(rowIdx + 1)
				const pegsInRow = rowIdx + 3
				const rowWidth = (pegsInRow - 1) * pegSpacing.value
				const rowStartX = (width - rowWidth) / 2
				const pegY = newLayoutBase.startY + rowIdx * newLayoutBase.finalPegSpacingY
				const currentColumn = pathPoint?.column ?? prevColumn
				const slotX = rowStartX + currentColumn * pegSpacing.value + pegSpacing.value / 2
				const direction = currentColumn > prevColumn ? 1 : -1
				const hitPegIdx = Math.min(Math.max(prevColumn + 1, 0), pegsInRow - 1)
				const hitPegX = rowStartX + hitPegIdx * pegSpacing.value
				rowPaths.push({ slotX, hitPegIdx, hitPegX, pegY, rowStartX, pegsInRow, direction })
				prevColumn = currentColumn
			}
			sim.rowPaths = rowPaths
			sim.targetX = rowPaths[sim.rows - 1]?.slotX ?? width / 2
			sim.targetY = multipliersTop.value

			entry.graphic.destroy()
			const g = createBallGraphic()
			g.position.set(sim.x, sim.y)
			g.rotation = 0
			ballsContainer.addChild(g)
			entry.graphic = g
		}
	}
}, 80)

const settleAndDestroyActiveBalls = () => {
	for (const entry of activeBalls) {
		const sim = entry.sim
		try {
			entry.graphic.destroy()
		} catch {
			/* ignore */
		}
		if (sim?.roundId) {
			emit("onResult", sim.safeBin, sim.multiplier, sim.roundId)
		}
	}
	activeBalls.length = 0
	detachPlinkoBallPhysicsTickerIfAny()
}

/**
 * 行数变化时只重算 scale + 重绘钉子，不销毁 Pixi 实例，避免画布重建导致白底闪烁。
 * 掉落中的弹珠与路径依赖行数，需一并终止。
 */
const refreshPegLayoutForRowChange = async () => {
	const initVersion = plinkoInitVersion
	if (!gameContainer.value) return
	const container = gameContainer.value
	const width = container.clientWidth
	const height = container.clientHeight
	if (!width || !height) return

	if (!pixiApp) {
		await initGame()
		if (plinkoGameDisposed || initVersion !== plinkoInitVersion) return
		return
	}

	cachedGameDimensions = null
	clearAllEffects()
	landedSlotIndex.value = -1
	if (slotAnimResetTimer) {
		clearTimeout(slotAnimResetTimer)
		slotAnimResetTimer = null
	}
	settleAndDestroyActiveBalls()

	scale.value = computeScaleForWidth(width)
	try {
		pixiApp.renderer.resolution = getPixiResolution(isFastGamePlinko.value)
		pixiApp.renderer.resize(width, height)
	} catch (e) {
		// ignore
	}
	createPegs(width, height)
}

// ==================== 公共计算函数 ====================
/**
 * 计算游戏尺寸（宽高、纵向间距、自适应压缩）
 * 返回值会被缓存到 cachedGameDimensions，给 createPegs/dropBall 复用。
 */
const calculateGameDimensions = (width: number, height: number, currentRows: number) => {
	const startY = width <= 500 && deviceAdvanced.value === "mobile" ? 20 : 50
	const basePegSpacingY = BASE_PEG_SPACING * 1.15
	const pegSpacingY = basePegSpacingY * scale.value
	const requiredHeight = startY + currentRows * pegSpacingY + 60 * scale.value
	const availableHeight = height - 10 * scale.value
	const heightScale = availableHeight > requiredHeight ? 1 : availableHeight / requiredHeight

	return {
		startY,
		pegSpacingY,
		heightScale,
		finalPegSpacingY: pegSpacingY * Math.min(1, heightScale)
	}
}

/**
 * 将 Sprite 等比缩放到「外接圆直径」= diameter。
 * 禁止对非正方形贴图分别写 width/height=d：会不等比拉伸，手机上钉子/球易呈椭圆。
 */
const applySpriteUniformDiameter = (sp: PIXI.Sprite, diameter: number) => {
	const tex = sp.texture
	const fw = Math.max(Number(tex.frame?.width ?? tex.width) || 1, 0.001)
	const fh = Math.max(Number(tex.frame?.height ?? tex.height) || 1, 0.001)
	const s = diameter / Math.max(fw, fh)
	sp.scale.set(s)
}

/**
 * 创建单个钉子的 Pixi 图形（外发光 + 主体 + 高光）。
 */
const createPegGraphic = (x: number, y: number): PegRenderable => {
	// 优先用贴图（最接近设计稿/截图效果）
	if (pegTexture) {
		const sp = new PIXI.Sprite(pegTexture)
		sp.anchor.set(0.5)
		sp.position.set(x, y)
		applySpriteUniformDiameter(sp, pegRenderRadius.value * 2)
		return sp
	}

	// 贴图未加载成功时降级：用 Graphics 画一个简洁渐变圆点
	const graphic = new PIXI.Graphics()
	const r = pegRenderRadius.value
	graphic.circle(0, 0, r)
	graphic.fill({ color: 0x6d4aa9, alpha: 1 })
	// graphic.circle(-r * 0.22, -r * 0.28, r * 0.95)
	// graphic.fill({ color: 0xa982e6, alpha: 0.38 })
	// graphic.circle(-r * 0.34, -r * 0.42, r * 0.52)
	// graphic.fill({ color: 0xd7c6ff, alpha: 0.16 })
	// graphic.circle(r * 0.12, r * 0.18, r * 0.98)
	// graphic.fill({ color: 0x3c1b66, alpha: 0.10 })
	graphic.position.set(x, y)
	return graphic
}

/**
 * 生成全量钉子（仅 Pixi 图形）。
 * 同时计算：
 * - `lastRowStartX`：最后一排起始 x（用于底部槽位和最终 targetX）
 * - `multipliersTop`：倍数条纵向位置
 */
const createPegs = (width: number, height: number) => {
	if (!pegsContainer) return

	// 清除旧钉子
	pegGraphics.forEach((g) => g.destroy())
	pegGraphics.length = 0

	// 小屏整体更靠近顶部，PC 稍微下移一点（使用固定像素，避免被 scale 抵消）
	const startY = width <= 500 && deviceAdvanced.value === "mobile" ? 20 : 50
	const currentRows = props.rows // ✅ 改用 props.rows
	// 统一小幅拉大竖直间距，让三角形略高，但保证所有行都能挤进画布
	const basePegSpacingY = BASE_PEG_SPACING * 1.15
	const pegSpacingY = basePegSpacingY * scale.value

	// 计算实际需要的高度，如果容器高度不够则进一步缩放
	const requiredHeight = startY + currentRows * pegSpacingY + 60 * scale.value
	const availableHeight = height - 10 * scale.value
	// 所有端统一按高度自适应，保证不会只显示部分行
	const heightScale = availableHeight > requiredHeight ? 1 : availableHeight / requiredHeight
	const finalPegSpacingY = pegSpacingY * Math.min(1, heightScale)

	for (let row = 0; row < currentRows; row++) {
		const pegsInRow = row + 3
		const rowWidth = (pegsInRow - 1) * pegSpacing.value
		// 每一排居中显示
		const startX = (width - rowWidth) / 2

		if (row === currentRows - 1) {
			lastRowStartX.value = startX
		}

		for (let col = 0; col < pegsInRow; col++) {
			const x = startX + col * pegSpacing.value
			const y = startY + row * finalPegSpacingY

			// Pixi 图形
			const graphic = createPegGraphic(x, y)
			pegsContainer.addChild(graphic)
			pegGraphics.push(graphic)
		}
	}

	// 倍数条在最后一排钉子「下方」留出适度间距，并限制在画布可见范围内
	const extraOffset = 25 * scale.value
	const calculatedTop = startY + (currentRows - 1) * finalPegSpacingY + pegRenderRadius.value + extraOffset
	const maxTop = height - 40 * scale.value
	multipliersTop.value = Math.min(calculatedTop, maxTop)
}

/**
 * 创建弹珠显示对象：优先使用贴图（public/img/plinko/ball.png），失败则用 Graphics 绘制。
 */
const createBallGraphic = (): PIXI.Container => {
	if (ballTexture) {
		const sp = new PIXI.Sprite(ballTexture)
		sp.anchor.set(0.5)
		applySpriteUniformDiameter(sp, ballRadius.value * 2)
		return sp
	}

	const root = new PIXI.Container()
	const r = ballRadius.value
	const s = scale.value

	// 主体：多层同心圆模拟“3D 球体”明暗（无光晕）
	const body = new PIXI.Graphics()
	const stops =
		isFastGamePlinko.value ? 6 : isAppleTouchDevice() ? 4 : deviceAdvanced.value === "mobile" ? 5 : 9
	for (let i = 0; i < stops; i++) {
		const t = i / Math.max(1, stops - 1)
		const rr = r * (1 - t * 0.9)
		const alpha = 0.98 - t * 0.9
		// 顶部偏亮，往外逐渐变暗，强调球面深度
		const col = i < 2 ? 0x7affd9 : i < 5 ? 0x00ff88 : 0x00b660
		body.circle(0, 0, Math.max(0.1, rr))
		body.fill({ color: col, alpha })
	}
	// 外圈暗边（更像“厚度/体积”）
	body.circle(0, 0, r)
	body.stroke({ color: 0x06462c, width: 1.3 * s, alpha: 0.9 })
	root.addChild(body)

	// 高光：左上角强高光 + 次高光（不使用 ADD 光晕）
	const spec = new PIXI.Graphics()
	spec.ellipse(-r * 0.32, -r * 0.34, r * 0.46, r * 0.30)
	spec.fill({ color: 0xffffff, alpha: 0.45 })
	spec.ellipse(-r * 0.12, -r * 0.12, r * 0.22, r * 0.16)
	spec.fill({ color: 0xffffff, alpha: 0.18 })
	root.addChild(spec)

	// 底右暗部（假环境光遮蔽，让球更 3D）
	const shade = new PIXI.Graphics()
	shade.ellipse(r * 0.18, r * 0.22, r * 0.82, r * 0.68)
	shade.fill({ color: 0x00381f, alpha: 0.18 })
	root.addChild(shade)

	// 微弱投影（让球从背景里“抠出来”一点，非光晕）
	const shadow = new PIXI.Graphics()
	shadow.y = r * 0.22
	shadow.circle(0, 0, r * 0.88)
	shadow.fill({ color: 0x001a10, alpha: 0.08 })
	root.addChildAt(shadow, 0)

	return root
}

/**
 * 创建钉子碰撞光晕：先径向扩散出现约 5px 浅紫环（内缘贴钉）；弹珠离开后再扩散约 5px 并淡出。
 * 约定：应在"确认为命中钉子"的时机调用，避免无意义触发导致视觉噪声。
 *
 * @returns 是否已创建光晕（或当前根本无法渲染，应视为「已消费」本次撞击，避免每帧反复检测）。
 *          若因 `maxRipples` 上限未创建，返回 `false`，调用方不得写入 `pegHitSet`，以便槽位释放后补画。
 */
const createRippleEffect = (x: number, y: number): boolean => {
	if (!effectsContainer || !pixiApp) return true
	const maxRipples = isAppleTouchDevice()
		? 8
		: deviceAdvanced.value === "mobile"
			? 12
			: 14
	// 同时存活的光晕上限：极速模式不再单独压低（原先 Apple+极速仅 2 路，光晕淡出慢于撞钉频率，槽位长期占满 → 动画大量缺失）
	if (activeRippleEffects >= maxRipples) return false
	activeRippleEffects++
	playPlinkoPinSfx()

	const rippleRoot = new PIXI.Container()
	rippleRoot.position.set(x, y)

	const halo = new PIXI.Graphics()
	rippleRoot.addChild(halo)
	effectsContainer.addChild(rippleRoot)

	const t0 = performance.now()
	const pegR = pegRenderRadius.value

	rippleEntries.push({
		root: rippleRoot,
		halo,
		pegX: x,
		pegY: y,
		phase: "appear",
		appearStartMs: t0,
		expandStartMs: t0,
		pegR
	})
	ensureEffectsTicker()
	return true
}

/**
 * 创建落槽后的粒子爆炸效果。
 * 颜色会根据 multiplier 大小切换（高倍数更亮/更热色）。
 */
const createParticleExplosion = (x: number, y: number, multiplier: number) => {
	if (!effectsContainer || !pixiApp) return

	const fast = isFastGamePlinko.value
	const mobileFx = deviceAdvanced.value === "mobile"
	const appleFx = isAppleTouchDevice()
	const baseCount = fast ? 8 : appleFx ? 6 : mobileFx ? 8 : 14
	const extra = multiplier >= 10
		? fast
			? 3
			: appleFx
				? 1
				: mobileFx
					? 2
					: 6
		: multiplier >= 3
			? fast
				? 1
				: appleFx
					? 0
					: mobileFx
						? 1
						: 3
			: 0
	const particleCount = Math.min(fast ? 14 : appleFx ? 8 : mobileFx ? 12 : 22, baseCount + extra)

	// 颜色：统一绿色
	const color = 0x00ff88

	const burst: ParticleFx[] = []

	for (let i = 0; i < particleCount; i++) {
		const particle = new PIXI.Graphics()
		const rr = (fast ? 2.0 : 2.6) * scale.value * (0.7 + Math.random() * 0.8)
		// 简单碎片：圆点 + 小方块混合
		if (i % 2 === 0) {
			particle.circle(0, 0, rr)
			particle.fill({ color, alpha: 0.95 })
		} else {
			const sz = rr * 1.4
			particle.roundRect(-sz / 2, -sz / 2, sz, sz, 1.5 * scale.value)
			particle.fill({ color, alpha: 0.9 })
		}
		particle.position.set(x, y)
		effectsContainer.addChild(particle)

		const angle = Math.random() * Math.PI * 2
		const speed = (fast ? 1.9 : 2.4) * scale.value + Math.random() * (fast ? 2.2 : 3.0) * scale.value
		const upKick = (fast ? 2.2 : 3.0) * scale.value
		const drag = fast ? 0.90 : 0.87
		const rotV = (Math.random() - 0.5) * 0.22
		burst.push({
			graphic: particle,
			vx: Math.cos(angle) * speed,
			vy: Math.sin(angle) * speed - upKick,
			alpha: 1,
			drag,
			rot: 0,
			rotV,
			scale: 1,
			scaleV: -(fast ? 0.02 : 0.028)
		})
	}

	particleBursts.push(burst)
	ensureEffectsTicker()
}

// ✅ dropBall：当前实际出球主入口（后端 path 驱动）
// 执行顺序：
// 1) 校验参数和容器
// 2) 根据 path 逐排生成"命中点路径"
// 3) 计算最终槽位 targetX（仅由 binIndex 决定）
// 4) Pixi 单 ticker 推进所有弹珠物理（避免 iOS 每球独立 requestAnimationFrame）
// 5) 命中钉子时 -> 触发钉子碰撞光晕
// 6) 到终点后触发 onResult
type PlinkoPathPoint = { row: number; column: number }

/** 弹珠物理挂到 Pixi 主 ticker：iOS 上多颗球各起一个 rAF 易与 WebKit 合成抢线程；单回调与渲染同相位更稳 */
let plinkoBallPhysicsTickerAttached = false

function detachPlinkoBallPhysicsTickerIfAny() {
	if (pixiApp && plinkoBallPhysicsTickerAttached) {
		pixiApp.ticker.remove(plinkoBallPhysicsTick)
		plinkoBallPhysicsTickerAttached = false
	}
}

function plinkoBallPhysicsTick() {
	if (!pixiApp || activeBalls.length === 0) {
		detachPlinkoBallPhysicsTickerIfAny()
		return
	}
	const ts = performance.now()
	for (let i = activeBalls.length - 1; i >= 0; i--) {
		stepPlinkoBallFrame(activeBalls[i]!, ts)
	}
	if (activeBalls.length === 0) {
		detachPlinkoBallPhysicsTickerIfAny()
	}
}

function ensurePlinkoBallPhysicsTicker() {
	if (!pixiApp || plinkoBallPhysicsTickerAttached) return
	pixiApp.ticker.add(plinkoBallPhysicsTick)
	plinkoBallPhysicsTickerAttached = true
}

function stepPlinkoBallFrame(entry: ActiveBallEntry, ts: number): void {
	const simState = entry.sim
	const ballG = entry.graphic
	if (!simState || !ballG || !ballG.parent) return

	const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))
	const lerp = (a: number, b: number, t: number) => a + (b - a) * t

	const { startY, finalPegSpacingY } = simState.layout
	const nRows = simState.rows

	const fastPlinko = isFastGamePlinko.value
	const simulationCount = 1

	const resolvePegCollisions = () => {
		const currentRow = Math.floor((simState.y - startY) / Math.max(1, finalPegSpacingY) + 0.5)
		if (currentRow < 0 || currentRow >= nRows) return

		const pathInfo = simState.rowPaths[currentRow]
		if (!pathInfo) return

		const { pegsInRow, rowStartX, pegY, hitPegIdx, hitPegX, direction } = pathInfo

		const contactDist = ballRadius.value + pegRadius.value
		const contactDistSq = contactDist * contactDist
		const pegKey = currentRow * 100 + hitPegIdx

		// The backend path already tells us which peg this row should hit.
		// Trigger visual/audio feedback from that path instead of relying on repeated geometric checks.
		if (
			!simState.pegHitSet.has(pegKey) &&
			simState.y >= pegY - contactDist * 0.45 &&
			simState.y <= pegY + contactDist * 0.85
		) {
			if (createRippleEffect(hitPegX, pegY)) {
				simState.pegHitSet.add(pegKey)
			}
		}

		let targetPegIdx = hitPegIdx
		let pegX = hitPegX
		let dx = simState.x - pegX
		let dy = simState.y - pegY
		let distSq = dx * dx + dy * dy

		if (distSq >= contactDistSq) {
			const colBase = Math.floor((simState.x - rowStartX) / pegSpacing.value + 0.5)
			let bestCc: number | null = null
			let bestDistSq = Infinity
			let bestPegX = 0

			for (let cc = Math.max(0, colBase - 1); cc <= Math.min(pegsInRow - 1, colBase + 1); cc++) {
				const px = rowStartX + cc * pegSpacing.value
				const ddx = simState.x - px
				const ddy = simState.y - pegY
				const dSq = ddx * ddx + ddy * ddy

				if (dSq < contactDistSq && dSq > 0.01 && dSq < bestDistSq) {
					bestDistSq = dSq
					bestCc = cc
					bestPegX = px
				}
			}

			if (bestCc !== null) {
				targetPegIdx = bestCc
				pegX = bestPegX
				dx = simState.x - pegX
				dy = simState.y - pegY
				distSq = bestDistSq
			} else {
				return
			}
		}

		if (distSq >= contactDistSq || distSq < 0.01) return

		const dist = Math.sqrt(distSq)
		const nx = dx / dist
		const ny = dy / dist

		const penetration = contactDist - dist
		if (penetration > 0) {
			const bounceExtra = 0.3
			simState.x += nx * penetration * (1 + bounceExtra)
			simState.y += ny * penetration * (1 + bounceExtra)
			simState.x += direction * penetration * 0.5
		}

		const bounceSpeed = 1 * scale.value
		simState.vx = direction * bounceSpeed
		simState.vy = Math.max(simState.vy * 0.3, 0.5 * scale.value)

		simState.rotVel += nx * (fastPlinko ? 0.08 : 0.12)

		const fallbackPegKey = currentRow * 100 + targetPegIdx
		if (!simState.pegHitSet.has(fallbackPegKey)) {
			// Only mark consumed when the ripple is actually created.
			if (createRippleEffect(pegX, pegY)) {
				simState.pegHitSet.add(fallbackPegKey)
			}
		}
	}

	for (let sim = 0; sim < simulationCount; sim++) {
		const dt = clamp((ts - simState.prevTs) / 16.6667, 0.5, 1.5)
		if (sim === 0) simState.prevTs = ts

		const gravity = 0.32 * scale.value //调整弹珠掉落快慢 越大下落越快
		const maxVY = 4.0 * scale.value
		const maxVX = 1.5 * scale.value

		const maxStepY = finalPegSpacingY * 0.35
		const nSubCap = 6
		const nSub = Math.min(
			nSubCap,
			Math.max(1, Math.ceil((Math.abs(simState.vy) * dt + gravity * dt * dt) / maxStepY))
		)
		const h = dt / nSub
		const dragPerSub = Math.pow(0.998, 1 / nSub)

		for (let s = 0; s < nSub; s++) {
			simState.vy = Math.min(maxVY, simState.vy + gravity * h)
			simState.vx *= dragPerSub

			simState.x += simState.vx * h
			simState.y += simState.vy * h

			resolvePegCollisions()
			simState.vx = clamp(simState.vx, -maxVX, maxVX)
			simState.vy = clamp(simState.vy, -maxVY, maxVY)
		}

		const finalZoneStart = simState.targetY - finalPegSpacingY * 2.0
		if (simState.y >= finalZoneStart) {
			const t = clamp((simState.y - finalZoneStart) / Math.max(1, simState.targetY - finalZoneStart), 0, 1)
			if (t > 0.7) {
				simState.vx += (simState.targetX - simState.x) * 0.002 * scale.value * dt
			}
			simState.vy *= 0.995
			if (t > 0.95) {
				simState.x = lerp(simState.x, simState.targetX, 0.08)
			}
		}
	}

	const frameDx = simState.x - simState.prevX
	simState.prevX = simState.x
	simState.rotVel = simState.rotVel * 0.85 + frameDx * 0.008
	simState.rotVel = clamp(simState.rotVel, -0.25, 0.25)
	ballG.rotation += simState.rotVel
	ballG.position.set(simState.x, simState.y)

	const finalizeToTarget = () => {
		playPlinkoWinSfx()
		ballG.position.set(simState.targetX, simState.targetY)
		triggerSlotLandingAnimation(simState.safeBin)
		createParticleExplosion(simState.targetX, simState.targetY, simState.multiplier)
		ballG.destroy()
		const i = activeBalls.indexOf(entry)
		if (i >= 0) activeBalls.splice(i, 1)
		emit("onResult", simState.safeBin, simState.multiplier, simState.roundId)
	}

	if (simState.y >= simState.targetY - ballRadius.value * 0.3) {
		finalizeToTarget()
		return
	}

	if (simState.y >= simState.targetY + ballRadius.value) {
		finalizeToTarget()
		return
	}
}

const dropBall = (multiplier: number, path: PlinkoPathPoint[] = [], roundId = '') => {
	if (!ballsContainer) return false

	const container = gameContainer.value
	if (!container) return false
	const slotCount = currentMultipliers.value.length
	if (slotCount <= 0) return false

	const width = container.clientWidth

	// 计算路径点（与 createPegs 同一套尺寸模型，避免坐标系偏移）
	const { startY, finalPegSpacingY } =
		cachedGameDimensions || calculateGameDimensions(width, container.clientHeight, props.rows)

	const rows = props.rows

	// 路径数据解析规则：
	// - column 表示弹珠在该行落入的槽位编号
	// - 从上一排槽位掉下来一定会砸中下一排的钉子
	// - 碰撞钉子下标 = 上一行 column + 1（钉子交错布局）
	// - column 增加 → 向右掉落
	// - column 不变或减小 → 向左掉落

	const pathByRow = new Map<number, PlinkoPathPoint>()
	path.forEach((p) => pathByRow.set(p.row, p))

	// 预计算每一行的路径信息
	const rowPaths: {
		slotX: number // 槽位中心x坐标
		hitPegIdx: number // 应该碰撞的钉子下标
		hitPegX: number // 应该碰撞的钉子x坐标
		pegY: number // 应该碰撞的钉子y坐标
		rowStartX: number // 本行起始x坐标
		pegsInRow: number // 本行钉子数量
		direction: number // 方向: 1=右, -1=左
	}[] = []

	let prevColumn = 0 // 上一行的 column 值

	for (let rowIdx = 0; rowIdx < rows; rowIdx++) {
		const pathPoint = pathByRow.get(rowIdx + 1) // 后端 row 从 1 开始
		const pegsInRow = rowIdx + 3 // 第 rowIdx 行有 rowIdx+3 个钉子
		const rowWidth = (pegsInRow - 1) * pegSpacing.value
		const rowStartX = (width - rowWidth) / 2
		const pegY = startY + rowIdx * finalPegSpacingY

		const currentColumn = pathPoint?.column ?? prevColumn

		// 槽位 x 坐标：column 对应第 column 个钉子后面的槽位
		const slotX = rowStartX + currentColumn * pegSpacing.value + pegSpacing.value / 2

		// 方向：column 增加 → 右(1)，column 不变或减小 → 左(-1)
		const direction = currentColumn > prevColumn ? 1 : -1

		// 碰撞钉子下标 = 上一行 column + 1（钉子交错布局决定）
		const hitPegIdx = Math.min(Math.max(prevColumn + 1, 0), pegsInRow - 1)
		const hitPegX = rowStartX + hitPegIdx * pegSpacing.value

		rowPaths.push({ slotX, hitPegIdx, hitPegX, pegY, rowStartX, pegsInRow, direction })
		prevColumn = currentColumn
	}

	// 最终目标：最后一行的槽位位置
	const lastRowData = rowPaths[rows - 1]
	const targetX = lastRowData?.slotX ?? width / 2
	const targetY = multipliersTop.value

	// 计算最终槽位索引（用于回调）
	const lastPathPoint = path.length > 0 ? path[path.length - 1] : null
	const finalColumn = lastPathPoint?.column ?? 0
	const safeBin = Math.max(0, Math.min(slotCount - 1, finalColumn))

	const ballGraphic = createBallGraphic()
	// 出生位置对齐第 1 行槽位
	const x0 = rowPaths[0]?.slotX ?? width / 2
	const y0 = Math.max(10 * scale.value, startY - (pegRadius.value + ballRadius.value + 8 * scale.value))
	const pegHitSet = new Set<number>() // 记录已碰撞的钉子，避免重复触发光晕

	ballGraphic.position.set(x0, y0)
	ballsContainer.addChild(ballGraphic)
	playPlinkoStartSfx()

	const simState: ActiveBallSim = {
		multiplier,
		path,
		rows,
		safeBin,
		x: x0,
		y: y0,
		vx: 0,
		vy: 0,
		prevTs: performance.now(),
		rotVel: 0,
		prevX: x0,
		pegHitSet,
		rowPaths,
		layout: { width, height: container.clientHeight, startY, finalPegSpacingY },
		targetX,
		targetY,
		done: false,
		roundId
	}

	const entry: ActiveBallEntry = { graphic: ballGraphic, sim: simState }
	activeBalls.push(entry)
	ensurePlinkoBallPhysicsTicker()
	return true
}

/**
 * 统一清理函数（重建/卸载都会走这里）。
 * 目的：避免事件、定时器、图形对象泄漏导致卡顿或重复渲染。
 */
const cleanup = () => {
	plinkoGameDisposed = true
	plinkoInitVersion++
	// 先禁止后续播发，再释放 Web Audio，避免与异步回调竞态
	plinkoSfxPlaybackDisabled.value = true
	plinkoBallSfxDefer.invalidate()
	plinkoWebSfx.dispose()
	// ✅ 清除缓存
	cachedGameDimensions = null
	clearAllEffects()
	landedSlotIndex.value = -1
	if (slotAnimResetTimer) {
		clearTimeout(slotAnimResetTimer)
		slotAnimResetTimer = null
	}
	settleAndDestroyActiveBalls()

	try {
		// 清理图形
		pegGraphics.forEach((g) => g.destroy())
		pegGraphics.length = 0

		// 清理 Pixi
		if (pixiApp) {
			pixiApp.destroy(true, { children: true })
			pixiApp = null
		}
	} catch (error) {
		console.error("Cleanup error:", error)
	}
}
// ==================== 生命周期 ====================
// ResizeObserver 监听容器尺寸变化（包含父级 plinkoBox 宽度变化），原地 resize 并重绘钉子/弹珠
const attachResizeObserver = () => {
	const el = gameContainer.value
	if (!el) return
	if (resizeObserver) {
		try {
			resizeObserver.disconnect()
		} catch (e) { }
		resizeObserver = null
	}
	resizeObserver = new ResizeObserver(() => {
		resizeInPlace()
	})
	resizeObserver.observe(el)
}

/**
 * 挂载后初始化场景并监听窗口尺寸变化。
 */
onMounted(async () => {
	plinkoGameDisposed = false
	plinkoInitVersion++
	const initVersion = plinkoInitVersion
	await nextTick()
	await initGame()
	if (plinkoGameDisposed || initVersion !== plinkoInitVersion) return
	// 后台预解码：不依赖手势的部分机型可先就绪；真正出声仍依赖首次 `unlockFromGesture` 内 resume
	void plinkoWebSfx.preloadAll().catch(() => {
		/* ignore */
	})
	// 首次挂载：直接同步展示倍数
	displayedRows.value = props.rows
	displayedMultipliers.value = (currentMultipliers.value || []).slice()
	attachResizeObserver()
	attachPlinkoSfxGestureUnlockListeners()
	if (typeof window !== "undefined") {
		window.addEventListener("resize", resizeInPlace)
	}
})

/**
 * 卸载时释放资源，移除监听器。
 */
onUnmounted(() => {
	detachPlinkoSfxGestureUnlockListeners()
	cleanup()
	if (resizeTimer) {
		clearTimeout(resizeTimer)
		resizeTimer = null
	}
	if (resizeObserver) {
		try {
			resizeObserver.disconnect()
		} catch (e) { }
		resizeObserver = null
	}
	if (typeof window !== "undefined") {
		window.removeEventListener("resize", resizeInPlace)
	}
})

/**
 * 行数变化后重建场景（防抖）。
 * 注意：rows 变化会影响最后一排宽度、缩放、槽位布局。
 */
watch(
	() => props.rows,
	useDebounceFn(async () => {
		if (plinkoGameDisposed) return
		// 先淡出，避免错位闪现
		multipliersHidden.value = true
		await nextTick()
		if (plinkoGameDisposed) return
		await refreshPegLayoutForRowChange()
		if (plinkoGameDisposed) return
		// 布局更新完成后再切换倍数与 rows
		displayedRows.value = props.rows
		displayedMultipliers.value = (currentMultipliers.value || []).slice()
		// 下一帧淡入，避免突兀
		requestAnimationFrame(() => {
			if (plinkoGameDisposed) return
			multipliersHidden.value = false
		})
	}, 300)
)

// risk 变化但 rows 不变：可立即更新倍数展示
watch(
	() => props.risk,
	() => {
		if (displayedRows.value !== props.rows) return
		displayedMultipliers.value = (currentMultipliers.value || []).slice()
	}
)
/**
 * 对父组件暴露的方法：
 * - dropBall：外部下注结果返回后调用，驱动一次掉落流程
 */
defineExpose({
	dropBall
})
</script>

<style scoped>
.plinko-game {
	display: flex;
	flex-direction: column;
	/* 让整个组件高度跟随父级盒子 */
	height: 100%;
	min-height: 0;
	/* background: linear-gradient(135deg, #0f1923 0%, #1a2c42 100%); */
	color: #fff;
	font-family: "Inter", sans-serif;
}

/* 游戏主体：占满除底部控制区外的所有高度 */
.game-body {
	flex: 1;
	padding: 16px;
	min-height: 0;
}

@media (max-width: 768px) {
	.game-body {
		padding: 0;
	}
}

.game-canvas-container {
	width: 100%;
	/* 高度由父级（game-body）撑开，铺满可用空间 */
	height: 100%;
	min-height: 0;
	position: relative;
	border-radius: 12px;
	overflow: hidden;
	background: #111933;
	/* 与 Pixi 背景色一致 */
	/* border: 1px solid rgba(255, 255, 255, 0.1); */
	pointer-events: none;
}

.game-canvas-container :deep(canvas) {
	background: #111933;
	display: block;
}

.multipliers-display {
	position: absolute;
	display: flex;
	z-index: 10;
	transition: opacity 0.16s ease;
	will-change: opacity;
}

.multipliers-display--hidden {
	opacity: 0;
	pointer-events: none;
}

.multiplier-slot-wrapper {
	flex: 1;
	display: flex;
	justify-content: center;
}

.multiplier-slot {
	width: 32px;
	height: 28px;
	display: flex;
	align-items: center;
	justify-content: center;
	border-radius: 4px;
	font-size: 10px;
	font-weight: 700;
	color: #fff;
	box-shadow: 0 2px 0 0 rgba(0, 0, 0, 0.3);
	/* background 改为动态设置 */
}

.multiplier-slot.landed {
	animation: slotDropBounce 0.44s cubic-bezier(0.22, 0.76, 0.25, 1) 1;
}

@keyframes slotDropBounce {

	0%,
	100% {
		transform: translateY(0);
	}

	35% {
		transform: translateY(7px);
	}

	62% {
		transform: translateY(-2px);
	}
}
</style>
