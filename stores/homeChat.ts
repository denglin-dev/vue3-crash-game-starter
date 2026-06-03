import { defineStore } from "pinia"

/** 与 LiveIndex MessageData 结构一致，SSR/客户端共用列表缓存 */
export type HomeChatMessage = Record<string, unknown>

export const useHomeChatStore = defineStore("homeChat", () => {
	const messageList = ref<HomeChatMessage[]>([])
	const chatListLoaded = ref(false)
	const ssrChatListConsumed = ref(false)

	const hydrateChatListFromSsr = (list: HomeChatMessage[]) => {
		messageList.value = list
		chatListLoaded.value = true
		ssrChatListConsumed.value = false
	}

	const invalidateChatList = () => {
		messageList.value = []
		chatListLoaded.value = false
		ssrChatListConsumed.value = false
	}

	/** LiveIndex 首屏消费 SSR 列表，仅生效一次，避免与 getMessageList 重复请求 */
	const consumeSsrChatListIfReady = (): HomeChatMessage[] | null => {
		if (ssrChatListConsumed.value || !chatListLoaded.value || messageList.value.length === 0) {
			return null
		}
		ssrChatListConsumed.value = true
		return [...messageList.value]
	}

	return {
		messageList,
		chatListLoaded,
		hydrateChatListFromSsr,
		invalidateChatList,
		consumeSsrChatListIfReady
	}
})
