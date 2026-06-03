import { computed } from "vue"

/** 正式环境仅在这些主机上展示 Anjouan 验证徽章（含 www 以免生产仅绑 www 时不显示） */
const ANJ_SEAL_ALLOWED_HOSTNAMES = new Set(["cybet.com", "www.cybet.com"])

/**
 * 正式环境：仅 cybet.com / www.cybet.com 显示牌照徽章；非正式环境保持显示便于本地调试
 */
export const useAnjSealVisibility = () => {
	const requestURL = useRequestURL()

	const showAnjSeal = computed(() => {
		if (!import.meta.env.PROD) {
			return true
		}
		const host = import.meta.client
			? window.location.hostname.toLowerCase()
			: requestURL.hostname.toLowerCase()
		return ANJ_SEAL_ALLOWED_HOSTNAMES.has(host)
	})

	return { showAnjSeal }
}
