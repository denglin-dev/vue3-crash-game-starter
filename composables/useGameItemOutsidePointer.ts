import { deviceAdvanced } from "~/utils/hook/hook"

type OutsideEntry = {
	getRoot: () => HTMLElement | null | undefined
	onOutside: () => void
}

const entries: OutsideEntry[] = []

let documentListenerAttached = false

/** 清掉部分 WebView 里残留的 :hover 粘滞 */
const clearStickyHover = () => {
	if (!import.meta.client) return
	const html = document.documentElement
	const prev = html.style.pointerEvents
	html.style.pointerEvents = "none"
	void html.offsetWidth
	html.style.pointerEvents = prev
}

let stickyHoverClearPending = false
const scheduleStickyHoverClear = () => {
	if (stickyHoverClearPending) return
	stickyHoverClearPending = true
	requestAnimationFrame(() => {
		stickyHoverClearPending = false
		clearStickyHover()
	})
}

/**
 * 首页等场景会挂载大量 gameItem；若每个实例都在 document 上注册 capture 的 pointerdown，
 * 每次触摸会执行数百次回调，主线程被占满，表现为纵向滚动不跟手、松手后「跳帧」。
 * 此处改为全局单例，一次监听、统一分发。
 */
const onDocumentPointerDown = (e: PointerEvent) => {
	if (deviceAdvanced.value !== "mobile") return
	const target = e.target as Node | null
	if (!target) return
	let anyOutside = false
	for (const entry of entries) {
		const root = entry.getRoot()
		if (!root) continue
		if (!root.contains(target)) {
			entry.onOutside()
			anyOutside = true
		}
	}
	if (anyOutside) scheduleStickyHoverClear()
}

const ensureDocumentListener = () => {
	if (documentListenerAttached) return
	documentListenerAttached = true
	document.addEventListener("pointerdown", onDocumentPointerDown, true)
}

const releaseDocumentListenerIfIdle = () => {
	if (entries.length > 0) return
	document.removeEventListener("pointerdown", onDocumentPointerDown, true)
	documentListenerAttached = false
}

export const registerGameItemOutsidePointer = (entry: OutsideEntry) => {
	ensureDocumentListener()
	entries.push(entry)
	return () => {
		const i = entries.indexOf(entry)
		if (i >= 0) entries.splice(i, 1)
		releaseDocumentListenerIfIdle()
	}
}
