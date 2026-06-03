import { nextTick, onMounted, watch, toValue } from "vue"
import type { MaybeRefOrGetter } from "vue"

/**
 * Anjouan 牌照徽章（第三方 anj-seal.js）
 * - 脚本只注入一次
 * - Footer 每次挂载 / PC↔H5 切换后需手动 init()，否则徽章空白
 */
export const ANJ_SEAL_ELEMENT_ID = "anj-896997b0-cb66-4c04-a875-1fb8b797bb57"

const ANJ_SEAL_SCRIPT_SRC =
	"https://896997b0-cb66-4c04-a875-1fb8b797bb57.snippet.anjouangaming.org/anj-seal.js"

const SCRIPT_MARKER = "data-anj-seal-script"
const ANJ_INIT_GLOBAL = "anj_896997b0_cb66_4c04_a875_1fb8b797bb57"

type AnjSealApi = { init: () => void }

let scriptLoadPromise: Promise<void> | null = null

const getAnjSealApi = (): AnjSealApi | null => {
	if (typeof window === "undefined") return null
	const w = window as Window & {
		anj_896997b0_cb66_4c04_a875_1fb8b797bb57?: AnjSealApi
		ANJ?: AnjSealApi
	}
	const api = w[ANJ_INIT_GLOBAL] ?? w.ANJ
	return api && typeof api.init === "function" ? api : null
}

const waitForAnjSealApi = (timeoutMs = 8000): Promise<AnjSealApi | null> =>
	new Promise((resolve) => {
		const started = Date.now()
		const tick = () => {
			const api = getAnjSealApi()
			if (api) {
				resolve(api)
				return
			}
			if (Date.now() - started >= timeoutMs) {
				resolve(null)
				return
			}
			requestAnimationFrame(tick)
		}
		tick()
	})

/** 全局只插入一次 script 标签 */
export const loadAnjSealScript = (): Promise<void> => {
	if (!import.meta.client) return Promise.resolve()
	if (getAnjSealApi()) return Promise.resolve()
	if (scriptLoadPromise) return scriptLoadPromise

	scriptLoadPromise = new Promise<void>((resolve, reject) => {
		const existing = document.querySelector(
			`script[${SCRIPT_MARKER}="1"]`
		) as HTMLScriptElement | null

		if (existing) {
			existing.addEventListener("load", () => {
				void waitForAnjSealApi().then(() => resolve())
			})
			existing.addEventListener("error", () => reject(new Error("anj-seal.js load failed")))
			if (getAnjSealApi()) resolve()
			return
		}

		const el = document.createElement("script")
		el.src = ANJ_SEAL_SCRIPT_SRC
		el.defer = true
		el.async = true
		el.setAttribute(SCRIPT_MARKER, "1")
		el.onload = () => {
			void waitForAnjSealApi().then(() => resolve())
		}
		el.onerror = () => reject(new Error("anj-seal.js load failed"))
		document.head.appendChild(el)
	})

	return scriptLoadPromise
}

/** DOM 中已有 seal 占位时重新渲染（PC/H5 Footer 切换后必调） */
export const refreshAnjSeal = async (): Promise<boolean> => {
	if (!import.meta.client) return false
	const host = document.getElementById(ANJ_SEAL_ELEMENT_ID)
	if (!host) return false

	try {
		await loadAnjSealScript()
		await nextTick()
		const api = getAnjSealApi() ?? (await waitForAnjSealApi())
		if (!api) return false
		api.init()
		return true
	} catch {
		return false
	}
}

/** 业务侧用本地图替换第三方注入图（init 后 img 才存在，需短轮询） */
export const applyAnjSealLocalImage = (localSrc = "/img/footer/ci.svg") => {
	if (!import.meta.client) return

	let attempts = 0
	const maxAttempts = 30

	const tryApply = () => {
		const img = document
			.getElementById(ANJ_SEAL_ELEMENT_ID)
			?.getElementsByTagName("img")
		if (img?.[0]) {
			img[0].src = localSrc
			return
		}
		attempts++
		if (attempts < maxAttempts) {
			window.setTimeout(tryApply, 100)
		}
	}

	tryApply()
}

const mountAnjSeal = async (enabled: boolean) => {
	if (!enabled) return
	const ok = await refreshAnjSeal()
	if (ok) applyAnjSealLocalImage()
}

/** Footer 内使用：挂载 + 开关变化时刷新徽章 */
export const useAnjSealFooter = (enabled: MaybeRefOrGetter<boolean> = true) => {
	if (import.meta.server) return

	const run = () => void mountAnjSeal(toValue(enabled))

	onMounted(run)
	watch(() => toValue(enabled), (v) => {
		if (v) run()
	})
}

/** @deprecated 请用 useAnjSealFooter */
export const useAnjSealScript = (enabled: MaybeRefOrGetter<boolean> = true) => {
	useAnjSealFooter(enabled)
}
