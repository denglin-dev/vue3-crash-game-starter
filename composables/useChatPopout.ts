import { nextTick, ref } from "vue"
import { withBase } from "ufo"
import detectDeviceAdvanced from "~/utils/detectDeviceAdvanced"
import { changeRight } from "~/utils/hook/sideHook"
import {
	CHAT_POPOUT_ENTRY_QUERY_KEY,
	CHAT_POPOUT_ENTRY_QUERY_VALUE
} from "~/utils/chatPopoutEntryQuery"

const STORAGE_KEY = "cybet_chat_popout_hidden"

const chatPopoutHidden = ref(false)
let popupWindow: Window | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null

const stopPolling = () => {
	if (pollTimer != null) {
		clearInterval(pollTimer)
		pollTimer = null
	}
}

export const restoreEmbeddedChat = () => {
	stopPolling()
	try {
		if (popupWindow != null && !popupWindow.closed) {
			popupWindow.close()
		}
	} catch {
		/* ignore */
	}
	popupWindow = null
	chatPopoutHidden.value = false
	changeRight(false)
	try {
		sessionStorage.removeItem(STORAGE_KEY)
	} catch {
		/* ignore */
	}
	nextTick(() => {
		const bus = useEventBus()
		bus.emit("updateChatList")
	})
}

const startPolling = () => {
	stopPolling()
	pollTimer = setInterval(() => {
		if (popupWindow != null && popupWindow.closed) {
			popupWindow = null
			restoreEmbeddedChat()
		}
	}, 400)
}

/** 刷新后主站始终以嵌入式聊天为准，不计独立窗状态：复位 UI 并清除标记（避免误判前置） */
if (import.meta.client) {
	queueMicrotask(() => {
		try {
			sessionStorage.removeItem(STORAGE_KEY)
			chatPopoutHidden.value = false
		} catch {
			/* ignore */
		}
	})
}

export const useChatPopout = () => {
	const router = useRouter()
	const hrefFromResolved = (r: { href: string }) => {
		const h = r.href
		if (h.startsWith("http://") || h.startsWith("https://")) return h
		return new URL(h, window.location.origin).href
	}

	/** Vue Router 在「无匹配」时会 throw，不能裸调 resolve({ name }) */
	const resolveChatPopoutWindowUrl = (): string => {
		const tryLoc = (loc: Parameters<typeof router.resolve>[0]) => {
			try {
				const r = router.resolve(loc)
				if (r.matched.length) return hrefFromResolved(r)
			} catch {
				/* 路由未注册或名称不一致 */
			}
			return null
		}

		return (
			tryLoc({
				path: "/",
				query: { [CHAT_POPOUT_ENTRY_QUERY_KEY]: CHAT_POPOUT_ENTRY_QUERY_VALUE }
			}) ??
			tryLoc({ path: "/chat/popout" }) ??
			tryLoc({ name: "chat-popout-window" }) ??
			(() => {
				const path = withBase(
					`/?${CHAT_POPOUT_ENTRY_QUERY_KEY}=${CHAT_POPOUT_ENTRY_QUERY_VALUE}`,
					import.meta.env.BASE_URL || "/"
				)
				return new URL(path, window.location.origin).href
			})()
		)
	}

	/**
	 * 独立聊天窗仍打开时：前置该窗口；同一 SPA 生命周期内若丢失 Window 引用可凭 session 同名夺回。
	 * 整页刷新后会清空 session，主站仅展示嵌入式聊天，此时直到再次打开弹窗前不走夺回逻辑。
	 * @returns 已处理前置则 true，调用方应跳过后续打开右侧栏等逻辑
	 */
	const focusChatPopoutIfOpen = (): boolean => {
		if (!import.meta.client) return false
		if (detectDeviceAdvanced() === "mobile") return false

		if (popupWindow != null && !popupWindow.closed) {
			try {
				popupWindow.focus()
			} catch {
				/* ignore */
			}
			startPolling()
			return true
		}

		let sessionOk = false
		try {
			sessionOk = sessionStorage.getItem(STORAGE_KEY) === "1"
		} catch {
			return false
		}
		if (!sessionOk) return false

		const url = resolveChatPopoutWindowUrl()
		const features =
			"width=350,height=720,left=0,top=0,menubar=no,toolbar=no,location=yes,resizable=yes,scrollbars=yes"
		const w = window.open(url, "cybetChatPopout", features)
		if (w == null) return false
		popupWindow = w
		try {
			w.focus()
		} catch {
			/* ignore */
		}
		startPolling()
		return true
	}

	const openChatPopout = () => {
		if (!import.meta.client) return
		if (detectDeviceAdvanced() === "mobile") return
		if (popupWindow != null && !popupWindow.closed) {
			popupWindow.focus()
			return
		}
		const url = resolveChatPopoutWindowUrl()
		const features =
			"width=350,height=720,left=0,top=0,menubar=no,toolbar=no,location=yes,resizable=yes,scrollbars=yes"
		const w = window.open(url, "cybetChatPopout", features)
		if (w == null) return
		popupWindow = w
		chatPopoutHidden.value = true
		changeRight(true)
		try {
			sessionStorage.setItem(STORAGE_KEY, "1")
		} catch {
			/* ignore */
		}
		startPolling()
	}

	return {
		chatPopoutHidden,
		openChatPopout,
		focusChatPopoutIfOpen,
		restoreEmbeddedChat
	}
}
