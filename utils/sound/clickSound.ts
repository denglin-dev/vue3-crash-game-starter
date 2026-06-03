import { notifyCrashBoomPoolUserGestureIfRegistered } from "~/utils/sound/crashBoomGestureBridge"

let _clickAudio: HTMLAudioElement | null = null
let _clickCtx: AudioContext | null = null
let _clickGain: GainNode | null = null
let _clickBuffer: AudioBuffer | null = null
let _clickDecodePromise: Promise<void> | null = null
let _lastPlayAt = 0
const CLICK_SOUND_URL = "/sounds/click.mp3"

function canUseAudio() {
	// SSR/Node 环境没有 window/Audio
	return typeof window !== "undefined" && typeof (globalThis as any).Audio !== "undefined"
}

function ensureClickAudioContext(): AudioContext | null {
	if (typeof window === "undefined") return null
	const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
	if (!AC) return null
	if (_clickCtx) return _clickCtx
	_clickCtx = new AC({ latencyHint: "interactive" })
	_clickGain = _clickCtx.createGain()
	_clickGain.gain.value = 1
	_clickGain.connect(_clickCtx.destination)
	return _clickCtx
}

function preloadClickBuffer(): Promise<void> {
	if (typeof window === "undefined") return Promise.resolve()
	if (_clickBuffer) return Promise.resolve()
	if (_clickDecodePromise) return _clickDecodePromise
	const ctx = ensureClickAudioContext()
	if (!ctx) return Promise.resolve()
	_clickDecodePromise = fetch(CLICK_SOUND_URL)
		.then((res) => {
			if (!res.ok) throw new Error(`click sound fetch failed: ${res.status}`)
			return res.arrayBuffer()
		})
		.then((raw) => ctx.decodeAudioData(raw.slice(0)))
		.then((buf) => {
			_clickBuffer = buf
		})
		.catch(() => {
			_clickDecodePromise = null
		})
	return _clickDecodePromise
}

function syncResumeClickAudioContext() {
	const ctx = ensureClickAudioContext()
	if (!ctx) return
	if (ctx.state === "suspended") {
		void ctx.resume()
	}
}

function playClickWithWebAudio(): boolean {
	const ctx = _clickCtx
	const gain = _clickGain
	const buf = _clickBuffer
	if (!ctx || !gain || !buf || ctx.state !== "running") return false
	try {
		const src = ctx.createBufferSource()
		src.buffer = buf
		src.connect(gain)
		src.start(ctx.currentTime)
		src.onended = () => {
			try {
				src.disconnect()
			} catch {
				/* ignore */
			}
		}
		return true
	} catch {
		return false
	}
}

function getAudio() {
	if (!canUseAudio()) return null
	if (_clickAudio) return _clickAudio
	const a = new Audio(CLICK_SOUND_URL)
	a.preload = "auto"
	// iOS/Safari/WebView 兼容：部分环境需要显式 load + playsInline 才更稳定
	try { (a as any).playsInline = true } catch { /* ignore */ }
	try { a.load() } catch { /* ignore */ }
	_clickAudio = a
	return a
}

/**
 * 播放一次点击音效（尽量在用户手势回调内调用）
 *
 * 说明：
 * - 移动端 WebView 偶发“吞音”，pause + currentTime=0 再 play() 更稳。
 * - 做一个很短的去重窗口，避免 pointerdown + click 双触发导致重复播放。
 */
export function playClickSoundOnce(opts: { allowHtmlFallback?: boolean } = {}) {
	if (!canUseAudio()) return
	// 与 Crash 爆炸池解锁同栈：任意页面点击音路径均可「顺带」解锁，避免强依赖画布晚挂载
	notifyCrashBoomPoolUserGestureIfRegistered()
	syncResumeClickAudioContext()
	void preloadClickBuffer()

	const now = Date.now()
	if (now - _lastPlayAt < 250) return
	_lastPlayAt = now

	if (playClickWithWebAudio()) return
	const allowHtmlFallback = opts.allowHtmlFallback !== false
	if (!allowHtmlFallback) {
		void _clickDecodePromise?.then(() => {
			if (!playClickWithWebAudio()) {
				requestAnimationFrame(() => {
					playClickWithWebAudio()
				})
			}
		})
		return
	}

	const a = getAudio()
	if (!a) return
	try { a.pause() } catch { /* ignore */ }
	try { a.currentTime = 0 } catch { /* ignore */ }
	// 不要 await，避免影响业务点击响应；失败直接吞掉
	a.play().catch(() => {})
}

/**
 * 动画高压场景（如 Crash 飞行中）使用：手势栈内先解锁，点击音延后到下一帧后播放，
 * 避免 HTMLAudio pause/seek/play 与 Pixi 本帧曲线/火箭绘制抢主线程。
 */
export function playClickSoundDeferred(delayMs = 32) {
	if (!canUseAudio()) return
	notifyCrashBoomPoolUserGestureIfRegistered()
	syncResumeClickAudioContext()
	void preloadClickBuffer()
	requestAnimationFrame(() => {
		window.setTimeout(() => playClickSoundOnce({ allowHtmlFallback: false }), delayMs)
	})
}

/**
 * 预热/解锁（可选）：在用户第一次手势时调用一次，有助于后续播放稳定。
 */
export function warmupClickSound() {
	getAudio()
	void preloadClickBuffer()
}

