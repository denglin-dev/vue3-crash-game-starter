/**
 * 按钮级防抖：第一次点击立即执行，随后 waitMs 内忽略重复点击。
 * 用于自动下注开始/停止，避免重复请求且不延迟用户操作。
 */
export const useClickDebounce = (waitMs = 200) => {
	const locked = ref(false)

	const run = (handler: () => void) => {
		if (locked.value) return
		locked.value = true
		handler()
		window.setTimeout(() => {
			locked.value = false
		}, waitMs)
	}

	return {
		isClickDebouncing: locked,
		runWithClickDebounce: run,
	}
}
