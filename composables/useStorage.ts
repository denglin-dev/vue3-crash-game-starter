const localKey = "cybet-"
const isLocalStorageKey = [
	"InternationalConfig",
	"InternationalSysConfig",
	"language",
	"InternationalLevelConfig",
	"InternationalPrivilegeConfig"
]

export const useStorage = () => {
	const isClient = typeof window !== "undefined"

	const buildKey = (key: string) => `${localKey}${key}`

	const setItem = (key: string, value: any) => {
		if (!isClient) return

		const fullKey = buildKey(key)
		const stringValue = typeof value === "string" ? value : JSON.stringify(value)

		if (isLocalStorageKey.includes(key)) {
			localStorage.setItem(fullKey, stringValue)
		} else {
			sessionStorage.setItem(fullKey, stringValue)
		}
	}

	const getItem = (key: string) => {
		if (!isClient) return null

		const fullKey = buildKey(key)

		const raw = isLocalStorageKey.includes(key) ? localStorage.getItem(fullKey) : sessionStorage.getItem(fullKey)

		try {
			return JSON.parse(raw as string)
		} catch {
			return raw
		}
	}

	const removeItem = async (key: string) => {
		if (!isClient) return

		const fullKey = buildKey(key)

		if (isLocalStorageKey.includes(key)) {
			localStorage.removeItem(fullKey)
		} else {
			sessionStorage.removeItem(fullKey)
		}
	}

	const clear = () => {
		if (!isClient) return

		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i)
			if (key && isLocalStorageKey.some((k) => buildKey(k) === key)) {
				localStorage.removeItem(key)
			}
		}
		sessionStorage.clear()
	}

	return {
		setItem,
		getItem,
		removeItem,
		clear
	}
}
