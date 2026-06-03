/**
 * 短文音效（游戏内高频 SFX）用 Web Audio API：
 * - `fetch` + `decodeAudioData` 各素材只解码一次，结果放在 `AudioBuffer`；
 * - 每次播放 `createBufferSource()` + `start(when)`，无 HTMLAudio 的 pause/seek/解码争用，主线程更轻；
 * - iOS/WebKit：须在用户手势栈内 `AudioContext.resume()`，否则 `start` 易被静默忽略。
 *
 * 能耗：相对多实例 HTMLAudio，通常更少重复解码与 DOM 媒体管线开销；但 `AudioContext` 常驻时仍有底噪级 CPU，
 * 页面卸载时应 `dispose()` 释放（`close()`）。
 */

export type ShortSfxClipDef = { key: string; url: string }

/** `play` 可选：Web Audio 无法在本轮启动 BufferSource 时回调（例如上下文未解锁、解码失败） */
export type ShortSfxPlayOptions = {
	onPlaybackImpossible?: () => void
}

export class ShortSfxWebAudioController {
	private disposed = false
	private ctx: AudioContext | null = null
	private masterGain: GainNode | null = null
	private readonly buffers = new Map<string, AudioBuffer>()
	private decodeAllPromise: Promise<void> | null = null
	/** 正在播放的源节点：stopAll 时统一打断，避免卸载后仍出声 */
	private readonly activeSources = new Set<AudioBufferSourceNode>()

	constructor(private readonly clips: ShortSfxClipDef[]) {}

	private ensureContext(): AudioContext {
		if (this.disposed) {
			throw new Error("ShortSfxWebAudioController: used after dispose")
		}
		if (this.ctx) return this.ctx
		if (typeof window === "undefined") {
			throw new Error("ShortSfxWebAudioController: no window")
		}
		const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
		if (!AC) {
			throw new Error("ShortSfxWebAudioController: AudioContext unsupported")
		}
		// interactive：降低默认输出延迟，适合短音效连发
		this.ctx = new AC({ latencyHint: "interactive" })
		this.masterGain = this.ctx.createGain()
		this.masterGain.gain.value = 1
		this.masterGain.connect(this.ctx.destination)
		return this.ctx
	}

	/**
	 * 必须在 `pointerdown` / `touchstart` 同步栈最前调用（不要包在 async 里再调）。
	 * 与 `unlockFromGesture` 里 await 解码配合：先「钉住」手势解锁，再后台 decode。
	 */
	syncResumeFromUserGesture(): void {
		if (!import.meta.client || this.disposed) return
		try {
			const ctx = this.ensureContext()
			if (ctx.state === "suspended") {
				void ctx.resume()
			}
		} catch {
			/* ignore */
		}
	}

	/** 并行拉取并解码全部 clip（可重复 await，只解码一次） */
	async preloadAll(): Promise<void> {
		if (!import.meta.client || this.disposed) return
		if (this.decodeAllPromise) return this.decodeAllPromise
		this.decodeAllPromise = this.doDecodeAll()
		return this.decodeAllPromise
	}

	private async doDecodeAll(): Promise<void> {
		const ctx = this.ensureContext()
		const tasks = this.clips.map(async ({ key, url }) => {
			if (this.disposed) return
			if (this.buffers.has(key)) return
			const res = await fetch(url)
			if (this.disposed) return
			if (!res.ok) throw new Error(`ShortSfxWebAudio: fetch failed ${key} ${res.status}`)
			const raw = await res.arrayBuffer()
			if (this.disposed) return
			// 部分引擎 decode 后会接管/清零传入的 ArrayBuffer，拷贝一份避免偶发异常
			const copy = raw.slice(0)
			const buf = await ctx.decodeAudioData(copy)
			if (this.disposed) return
			this.buffers.set(key, buf)
		})
		const results = await Promise.allSettled(tasks)
		const failed = results.filter((r) => r.status === "rejected")
		if (import.meta.dev && failed.length > 0) {
			console.warn("[ShortSfxWebAudio] decode failures", failed)
		}
	}

	/**
	 * 在用户点击/触摸栈内调用：`resume` 尽量靠前，再解码。
	 * （若先 `await decode` 再 `resume`，WebKit 常判定已脱离手势，`resume` 永远不生效 → 接口返回后的 `play` 全哑。）
	 */
	async unlockFromGesture(): Promise<boolean> {
		if (!import.meta.client || this.disposed) return false
		try {
			const ctx = this.ensureContext()
			if (ctx.state === "suspended") {
				await ctx.resume()
			}
			await this.preloadAll()
			return ctx.state === "running"
		} catch (e) {
			if (import.meta.dev) console.warn("[ShortSfxWebAudio] unlock failed", e)
			return false
		}
	}

	/**
	 * 在下注 HTTP 的 `await fetch` 之前调用：把 `resume`（及已缓存的 preload）尽量放在点击触发的 async 函数前半段，
	 * 避免仅首局有声、后续局上下文再次 `suspended` 且结果回调里 `play` 哑火。
	 */
	async resumeRunningAndPreloadFromBetStack(): Promise<void> {
		if (!import.meta.client || this.disposed) return
		try {
			const ctx = this.ensureContext()
			if (ctx.state === "suspended") {
				await ctx.resume()
			}
			await this.preloadAll()
		} catch {
			/* ignore */
		}
	}

	/** 启动 BufferSource；`connect`/`start` 失败时返回 false，便于 `play` 走 HTML 等兜底（避免误判已播） */
	private startBufferSource(buf: AudioBuffer): boolean {
		if (!this.ctx || !this.masterGain || this.disposed) return false
		const src = this.ctx.createBufferSource()
		src.buffer = buf
		try {
			src.connect(this.masterGain)
		} catch {
			return false
		}
		this.activeSources.add(src)
		src.onended = () => {
			this.activeSources.delete(src)
			try {
				src.disconnect()
			} catch {
				/* ignore */
			}
		}
		try {
			src.start(this.ctx.currentTime)
			return true
		} catch {
			this.activeSources.delete(src)
			try {
				src.disconnect()
			} catch {
				/* ignore */
			}
			return false
		}
	}

	/**
	 * 立即播放某一 key。
	 * - 解码未完成：等 `preloadAll` 后再播一次（接口异步返回后的 `dropBall` 常早于首帧解码）；
	 * - 上下文仍 `suspended`：再 `resume()` 后试播（部分环境离开手势栈后仍可恢复）；
	 * - 若仍无法 `start`：可选 `onPlaybackImpossible`（例如 Dice 用 HTMLAudio 兜底，避免上下文未跑起时整段哑音）。
	 */
	play(key: string, options?: ShortSfxPlayOptions): void {
		if (!import.meta.client || this.disposed) return
		let fallbackFired = false
		const fireFallback = () => {
			if (fallbackFired || this.disposed) return
			fallbackFired = true
			options?.onPlaybackImpossible?.()
		}

		const buf = this.buffers.get(key)
		if (!buf) {
			void this.preloadAll()
				.then(() => {
					if (this.disposed) return
					if (!this.buffers.get(key)) {
						fireFallback()
						return
					}
					this.play(key, options)
				})
				.catch(() => {
					fireFallback()
				})
			return
		}
		if (!this.ctx || !this.masterGain) {
			fireFallback()
			return
		}

		const tryRun = (): boolean => {
			if (this.disposed || !this.ctx || !this.masterGain) return false
			const b = this.buffers.get(key)
			if (!b) return false
			if (this.ctx.state !== "running") return false
			return this.startBufferSource(b)
		}

		if (tryRun()) return

		if (this.ctx.state === "suspended") {
			void this.ctx
				.resume()
				.then(() => {
					if (tryRun()) return
					// resume 微任务后仍短暂非 running 时多试两帧，减少「整段无声」
					queueMicrotask(() => {
						if (tryRun()) return
						requestAnimationFrame(() => {
							if (tryRun()) return
							fireFallback()
						})
					})
				})
				.catch(() => {
					fireFallback()
				})
			return
		}

		fireFallback()
	}

	/** 打断当前所有已 `start`、尚未 `ended` 的片段（切页、关音效瞬时静音） */
	stopAll(): void {
		for (const s of [...this.activeSources]) {
			try {
				s.stop(0)
			} catch {
				/* ignore */
			}
			try {
				s.disconnect()
			} catch {
				/* ignore */
			}
			this.activeSources.delete(s)
		}
	}

	/** 释放解码缓冲与上下文；组件卸载时必须调用，便于 GC 与省电 */
	dispose(): void {
		if (this.disposed) return
		this.disposed = true
		this.stopAll()
		this.buffers.clear()
		this.decodeAllPromise = null
		if (this.masterGain) {
			try {
				this.masterGain.disconnect()
			} catch {
				/* ignore */
			}
			this.masterGain = null
		}
		if (this.ctx) {
			const c = this.ctx
			this.ctx = null
			void c.close().catch(() => {
				/* ignore */
			})
		}
	}
}
