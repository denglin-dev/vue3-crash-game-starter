import { onMounted } from "vue"

export type H5MobileMenuActiveMemory = {
	activeMenus: string[]
	activeChooseId: string | number | null
	activeNames: string[]
	parentActive: string | number | null
	selectSportsType: string | null
	activeTabId: string | number | null
}

const createDefaultMobileMenuMemory = (): H5MobileMenuActiveMemory => ({
	activeMenus: [],
	activeChooseId: null,
	activeNames: [],
	parentActive: null,
	selectSportsType: null,
	activeTabId: null
})

const USER_CENTER_ACTIVE_KEY = "h5-user-center-active-key"
const MOBILE_MENU_ACTIVE_KEY = "h5-mobile-menu-active"

const readSessionValue = <T>(key: string, defaultValue: T): T => {
	if (!import.meta.client) return defaultValue
	try {
		const raw = sessionStorage.getItem(key)
		if (!raw) return defaultValue
		return JSON.parse(raw) as T
	} catch {
		return defaultValue
	}
}

const writeSessionValue = <T>(key: string, value: T) => {
	if (!import.meta.client) return
	try {
		sessionStorage.setItem(key, JSON.stringify(value))
	} catch {
		// Ignore storage failures so menu navigation is never blocked.
	}
}

export function useH5RouteActiveMemory() {
	const userCenterActiveKey = useState<string>(USER_CENTER_ACTIVE_KEY, () =>
		readSessionValue<string>(USER_CENTER_ACTIVE_KEY, "")
	)
	const mobileMenuActive = useState<H5MobileMenuActiveMemory>(MOBILE_MENU_ACTIVE_KEY, () =>
		readSessionValue<H5MobileMenuActiveMemory>(MOBILE_MENU_ACTIVE_KEY, createDefaultMobileMenuMemory())
	)

	onMounted(() => {
		userCenterActiveKey.value = readSessionValue<string>(USER_CENTER_ACTIVE_KEY, userCenterActiveKey.value)
		mobileMenuActive.value = {
			...createDefaultMobileMenuMemory(),
			...readSessionValue<H5MobileMenuActiveMemory>(MOBILE_MENU_ACTIVE_KEY, mobileMenuActive.value)
		}
	})

	const rememberUserCenterActive = (activeKey?: string) => {
		userCenterActiveKey.value = activeKey || ""
		writeSessionValue(USER_CENTER_ACTIVE_KEY, userCenterActiveKey.value)
	}

	const rememberMobileMenuActive = (payload: Partial<H5MobileMenuActiveMemory>) => {
		mobileMenuActive.value = {
			...mobileMenuActive.value,
			...payload,
			activeMenus: payload.activeMenus ? [...payload.activeMenus] : mobileMenuActive.value.activeMenus,
			activeNames: payload.activeNames ? [...payload.activeNames] : mobileMenuActive.value.activeNames
		}
		writeSessionValue(MOBILE_MENU_ACTIVE_KEY, mobileMenuActive.value)
	}

	const restoreMobileMenuActive = () => {
		mobileMenuActive.value = {
			...createDefaultMobileMenuMemory(),
			...readSessionValue<H5MobileMenuActiveMemory>(MOBILE_MENU_ACTIVE_KEY, mobileMenuActive.value)
		}
		return mobileMenuActive.value
	}

	const getMobileMenuActiveSnapshot = () => ({
		...createDefaultMobileMenuMemory(),
		...readSessionValue<H5MobileMenuActiveMemory>(MOBILE_MENU_ACTIVE_KEY, mobileMenuActive.value)
	})

	const clearMobileMenuActive = () => {
		mobileMenuActive.value = createDefaultMobileMenuMemory()
		writeSessionValue(MOBILE_MENU_ACTIVE_KEY, mobileMenuActive.value)
	}

	return {
		userCenterActiveKey,
		mobileMenuActive,
		rememberUserCenterActive,
		rememberMobileMenuActive,
		restoreMobileMenuActive,
		getMobileMenuActiveSnapshot,
		clearMobileMenuActive
	}
}
