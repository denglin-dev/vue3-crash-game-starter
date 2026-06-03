import { useLocalStorage, useSessionStorage } from "@vueuse/core"

const localKey = "cybet-"

const isLocalStorageKey = [
	"InternationalConfig",
	"InternationalSysConfig",
	"language",
	"InternationalLevelConfig",
	"sideChildActiveId",
	"InternationalPrivilegeConfig"
]

const Storage = {
	getItem(key: string) {
		const storageKey = localKey + key
		if (isLocalStorageKey.includes(key)) {
			return useLocalStorage(storageKey, null).value
		}
		return useSessionStorage(storageKey, null).value
	},

	setItem(key: string, value: any) {
		const storageKey = localKey + key
		if (isLocalStorageKey.includes(key)) {
			useLocalStorage(storageKey, value).value = value
		} else {
			useSessionStorage(storageKey, value).value = value
		}
	},

	removeItem(key: string) {
		const storageKey = localKey + key
		if (isLocalStorageKey.includes(key)) {
			useLocalStorage(storageKey, null).value = null
		} else {
			useSessionStorage(storageKey, null).value = null
		}
	},

	clear() {
		isLocalStorageKey.forEach((key) => {
			useLocalStorage(localKey + key, null).value = null
		})
	}
}

export default Storage
