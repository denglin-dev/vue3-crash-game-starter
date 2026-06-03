import { defineStore } from "pinia"
import Storage from "~/utils/ts/storage"
export const useLayoutStore = defineStore("layout", () => {
	// 提供默认值，确保初始化时不是 undefined/null
	const sideChildActiveName = ref(Storage.getItem("sideChildActiveName") || "")
	const sideChildActiveId = ref(Storage.getItem("sideChildActiveId") || "")
	const searchGameTitle = ref(Storage.getItem("searchGameTitle") || "")

	//当前是打开聊天窗口还是消息窗口
	const isLiveWindow = ref(true)

	const updateSideChildActiveName = (name: string) => {
		sideChildActiveName.value = name
		Storage.setItem("sideChildActiveName", name)
		name && updateSearchGameTitle(name)
	}

	const updateSideChildActiveId = (id: string) => {
		sideChildActiveId.value = id
		Storage.setItem("sideChildActiveId", id)
		// 假设 $t 是 i18n 的翻译函数，确保它返回的是字符串
		id && updateSearchGameTitle($t(`InternationalConfig.${id}.typeName`))
	}

	const updateSearchGameTitle = (name: string) => {
		searchGameTitle.value = name
		Storage.setItem("searchGameTitle", name)
	}
	const updateIsLiveWindow = (bol: boolean) => {
		isLiveWindow.value = bol
	}
	return {
		sideChildActiveName,
		updateSideChildActiveName,
		sideChildActiveId,
		updateSideChildActiveId,
		updateIsLiveWindow,
		isLiveWindow,
		searchGameTitle,
		updateSearchGameTitle
	}
})
