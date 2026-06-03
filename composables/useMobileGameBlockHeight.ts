import { type Ref } from "vue"

/** H5 游戏壳 fixed 定位：顶栏底、底栏顶（实测，与 Tab 无缝衔接） */
export const MOBILE_GAME_SHELL_TOP_VAR = "--cy-mobile-game-shell-top"
export const MOBILE_GAME_SHELL_BOTTOM_VAR = "--cy-mobile-game-shell-bottom"

const getViewportHeight = () => window.visualViewport?.height ?? window.innerHeight

const getTabbarTop = () => {
	const tabbarEl = document.querySelector(".cy-mobile-tabbar")
	return tabbarEl?.getBoundingClientRect().top ?? getViewportHeight()
}

const getHeaderBottom = () => {
	const headerEl = document.querySelector(".header-pair-grid")
	return headerEl?.getBoundingClientRect().bottom ?? 0
}

export const useMobileGameBlockHeight = (isActive: Ref<boolean>) => {
	const syncMobileGameShellInsets = () => {
		if (!import.meta.client || !isActive.value) return
		const viewportHeight = getViewportHeight()
		const tabbarTop = getTabbarTop()
		const headerBottom = getHeaderBottom()
		const bottomInset = Math.max(0, Math.round(viewportHeight - tabbarTop))
		const topInset = Math.max(0, Math.round(headerBottom))
		document.documentElement.style.setProperty(MOBILE_GAME_SHELL_TOP_VAR, `${topInset}px`)
		document.documentElement.style.setProperty(MOBILE_GAME_SHELL_BOTTOM_VAR, `${bottomInset}px`)
	}

	const bindMobileGameBlockHeight = () => {
		if (!import.meta.client) return
		syncMobileGameShellInsets()
		requestAnimationFrame(syncMobileGameShellInsets)
		window.visualViewport?.addEventListener("resize", syncMobileGameShellInsets)
		window.addEventListener("resize", syncMobileGameShellInsets)
		window.addEventListener("orientationchange", syncMobileGameShellInsets)
	}

	const unbindMobileGameBlockHeight = () => {
		if (!import.meta.client) return
		window.visualViewport?.removeEventListener("resize", syncMobileGameShellInsets)
		window.removeEventListener("resize", syncMobileGameShellInsets)
		window.removeEventListener("orientationchange", syncMobileGameShellInsets)
		document.documentElement.style.removeProperty(MOBILE_GAME_SHELL_TOP_VAR)
		document.documentElement.style.removeProperty(MOBILE_GAME_SHELL_BOTTOM_VAR)
	}

	return {
		syncMobileGameBlockHeight: syncMobileGameShellInsets,
		bindMobileGameBlockHeight,
		unbindMobileGameBlockHeight
	}
}
