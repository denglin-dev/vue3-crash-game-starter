/**
 * 移动端弹窗锁滚动时，避免 body overflow 切换导致页面滚回顶部。
 * DialogIndex / NewDialogIndex 可能同时存在弹窗：用「来源」布尔合并成是否需要锁，只 acquire/release 一次。
 */
let savedScrollY = 0
let lockApplied = false

const isMobileScrollViewport = (): boolean => {
	if (typeof window === "undefined") return false
	return window.matchMedia("(max-width: 768px)").matches
}

let lockFromGlobalDialog = false
let lockFromNewDialog = false

const recomputeMobileScrollLock = (): void => {
	if (!import.meta.client || !isMobileScrollViewport()) return
	const needLock = lockFromGlobalDialog || lockFromNewDialog
	if (needLock && !lockApplied) {
		savedScrollY = window.scrollY || document.documentElement.scrollTop || 0
		const body = document.body
		body.style.position = "fixed"
		body.style.top = `-${savedScrollY}px`
		body.style.left = "0"
		body.style.right = "0"
		body.style.width = "100%"
		lockApplied = true
		return
	}
	if (!needLock && lockApplied) {
		const body = document.body
		body.style.position = ""
		body.style.top = ""
		body.style.left = ""
		body.style.right = ""
		body.style.width = ""
		window.scrollTo(0, savedScrollY)
		lockApplied = false
	}
}

/** DialogIndex：是否存在任一 openGlobalDialog 弹窗 */
export const setMobileScrollLockFromGlobalDialog = (hasAnyOpen: boolean): void => {
	lockFromGlobalDialog = hasAnyOpen
	recomputeMobileScrollLock()
}

/** NewDialogIndex：是否存在任一 new 弹窗 */
export const setMobileScrollLockFromNewDialog = (hasAnyOpen: boolean): void => {
	lockFromNewDialog = hasAnyOpen
	recomputeMobileScrollLock()
}

/** 布局卸载等兜底：清空来源并解除锁定 */
export const resetMobileBackgroundScrollLock = (): void => {
	lockFromGlobalDialog = false
	lockFromNewDialog = false
	if (!import.meta.client || !lockApplied) return
	const body = document.body
	body.style.position = ""
	body.style.top = ""
	body.style.left = ""
	body.style.right = ""
	body.style.width = ""
	window.scrollTo(0, savedScrollY)
	lockApplied = false
}
