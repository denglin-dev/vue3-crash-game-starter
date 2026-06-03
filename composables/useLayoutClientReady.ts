/**
 * 替代 layout 内 ClientOnly + #fallback，避免 SSR 水合时 renderSlot 在
 * currentRenderingInstance 为 null 时读 `.ce` 导致崩溃（Vue 3.5+ 常见）。
 * SSR 与首屏客户端均为 false，onMounted 后为 true。
 */
export function useLayoutClientReady() {
	const layoutClientReady = useState("cy-layout-client-ready", () => false)

	if (import.meta.client) {
		onMounted(() => {
			layoutClientReady.value = true
		})
	}

	return { layoutClientReady }
}
