import { watch } from "vue"
import detectDeviceAdvanced from "~/utils/detectDeviceAdvanced"
import {
	readPcChatPanelPersist,
	writePcChatPanelPersist
} from "~/utils/chatPanelPersistStorage"
import { changeRight, rightIsClose } from "~/utils/hook/sideHook"
import { useLayoutStore } from "~/stores/layout"
import { useDeviceAdvanced } from "~/composables/useDeviceAdvanced"

export {
	readPcChatPanelPersist,
	writePcChatPanelPersist,
	clearPcChatPanelPersist
} from "~/utils/chatPanelPersistStorage"

/** 进站恢复：仅 PC/平板宽屏，恢复为聊天模式右侧栏展开 */
export const restorePcChatPanelIfPersisted = () => {
	if (!import.meta.client) return
	if (detectDeviceAdvanced() === "mobile") return
	if (!readPcChatPanelPersist()) return

	const layoutStore = useLayoutStore()
	layoutStore.updateIsLiveWindow(true)
	changeRight(false)
}

/** 右侧栏开关与聊天/消息模式变化时同步 localStorage */
export const useSyncPcChatPanelPersist = () => {
	if (import.meta.server) return

	const layoutStore = useLayoutStore()
	const { deviceAdvanced } = useDeviceAdvanced()

	watch(
		() =>
			[
				rightIsClose.value,
				layoutStore.isLiveWindow,
				deviceAdvanced.value
			] as const,
		([closed, isLive, device]) => {
			if (!import.meta.client || device === "mobile") return
			writePcChatPanelPersist(!closed && isLive)
		}
	)
}
