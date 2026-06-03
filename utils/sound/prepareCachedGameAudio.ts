/**
 * 游戏内高频 HTMLAudio 音效：首次 `new Audio` 后做 preload / playsInline / load，
 * 重播前 pause + 归零，减轻移动端重复解码、GC 与 `play()` 被拒后的异常态。
 * （Crash 爆炸音使用独立池化逻辑，见 `GameCanvas.vue`；Plinko 短音效已迁 `shortSfxWebAudio.ts`；Dice / Mines / Limbo 主轨 Web Audio + HTML 兜底见各 `*GameIndex` / `gameContent`。）
 */

export function ensurePreparedAudioInCache(
	cache: Map<string, HTMLAudioElement>,
	src: string,
): HTMLAudioElement {
	const existing = cache.get(src)
	if (existing) return existing
	const a = new Audio(src)
	a.preload = "auto"
	// 属性 + attribute 双写：部分 WebKit 对 in-line 内联播放只认其一
	a.setAttribute("playsinline", "true")
	a.setAttribute("webkit-playsinline", "true")
	try {
		;(a as any).playsInline = true
	} catch {
		/* ignore */
	}
	try {
		a.load()
	} catch {
		/* ignore */
	}
	cache.set(src, a)
	return a
}

/** 单路音效池用：与 `ensurePreparedAudioInCache` 相同预热，但不写入共享 Map，避免多实例争同一 key */
export function createPreparedAudioElement(src: string): HTMLAudioElement {
	const a = new Audio(src)
	a.preload = "auto"
	a.setAttribute("playsinline", "true")
	a.setAttribute("webkit-playsinline", "true")
	try {
		;(a as any).playsInline = true
	} catch {
		/* ignore */
	}
	try {
		a.load()
	} catch {
		/* ignore */
	}
	return a
}

export function replayAudioFromStart(
	audio: HTMLAudioElement,
	onPlayRejected?: (reason: unknown) => void,
) {
	try {
		audio.pause()
	} catch {
		/* ignore */
	}
	try {
		audio.currentTime = 0
	} catch {
		/* ignore */
	}
	void audio.play().catch((e) => {
		onPlayRejected?.(e)
	})
}

/** 动画高压帧的 HTMLAudio 兜底：延后一帧再 pause/seek/play，避免和 Pixi/CSS 关键帧抢主线程。 */
export function replayAudioFromStartDeferred(
	audio: HTMLAudioElement,
	onPlayRejected?: (reason: unknown) => void,
	delayMs = 24,
) {
	if (typeof window === "undefined") return
	requestAnimationFrame(() => {
		window.setTimeout(() => replayAudioFromStart(audio, onPlayRejected), delayMs)
	})
}
