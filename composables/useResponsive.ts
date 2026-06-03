export const useResponsive = (options?: { selector?: string; breakpoint?: number; immediate?: boolean }) => {
	const { selector = ".page-container", breakpoint = 768, immediate = true } = options || {}
	const isMobile = ref(false)
	const containerWidth = ref(0)
	const isReady = ref(false)

	let resizeObserver: ResizeObserver | null = null

	const updateMobileStatus = (width: number) => {
		containerWidth.value = width
		isMobile.value = width <= breakpoint
		if (!isReady.value) {
			isReady.value = true
		}
	}

	const initObserver = () => {
		const targetElement = document.querySelector(selector)

		if (!targetElement) {
			console.warn(`元素 "${selector}" 未找到`)
			return false
		}

		resizeObserver = new ResizeObserver((entries) => {
			for (const entry of entries) {
				const { width } = entry.contentRect
				updateMobileStatus(width)
			}
		})

		resizeObserver.observe(targetElement)

		if (immediate) {
			const rect = targetElement.getBoundingClientRect()
			updateMobileStatus(rect.width)
		}

		return true
	}

	const cleanup = () => {
		if (resizeObserver) {
			resizeObserver.disconnect()
			resizeObserver = null
		}
		isReady.value = false
	}

	const refresh = () => {
		const targetElement = document.querySelector(selector)
		if (targetElement) {
			const rect = targetElement.getBoundingClientRect()
			updateMobileStatus(rect.width)
		}
	}

	onMounted(() => {
		nextTick(() => {
			initObserver()
		})
	})

	onUnmounted(() => {
		cleanup()
	})

	return {
		isMobile: readonly(isMobile),
		containerWidth: readonly(containerWidth),
		isReady: readonly(isReady),

		breakpoint,
		selector,

		refresh,
		cleanup
	}
}

export const useBreakpoints = () => {
	const { containerWidth } = useResponsive()

	const breakpoints = {
		xs: 480,
		sm: 768,
		md: 992,
		lg: 1200,
		xl: 1920
	}

	const isXs = computed(() => containerWidth.value < breakpoints.xs)
	const isSm = computed(() => containerWidth.value >= breakpoints.xs && containerWidth.value < breakpoints.sm)
	const isMd = computed(() => containerWidth.value >= breakpoints.sm && containerWidth.value < breakpoints.md)
	const isLg = computed(() => containerWidth.value >= breakpoints.md && containerWidth.value < breakpoints.lg)
	const isXl = computed(() => containerWidth.value >= breakpoints.lg && containerWidth.value < breakpoints.xl)
	const isXxl = computed(() => containerWidth.value >= breakpoints.xl)

	const isMobile = computed(() => containerWidth.value < breakpoints.sm)
	const isTablet = computed(() => containerWidth.value >= breakpoints.sm && containerWidth.value < breakpoints.md)
	const isDesktop = computed(() => containerWidth.value >= breakpoints.md)

	return {
		isXs,
		isSm,
		isMd,
		isLg,
		isXl,
		isXxl,
		isMobile,
		isTablet,
		isDesktop,
		containerWidth,
		breakpoints
	}
}
