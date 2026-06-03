// export default function detectDeviceAdvanced(): "mobile" | "tablet" | "pc" {
// 	const ua = navigator.userAgent
// 	const width = window.innerWidth

// 	const isMobile = /Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)
// 	const isTablet = /iPad|Tablet|PlayBook|Kindle|Silk|Android 3.0|Xoom|SCH-I800|Nexus 7|Nexus 10/i.test(ua)

// 	if (isMobile || width <= 768) {
// 		return "mobile"
// 	} else if (isTablet || (width > 768 && width <= 1200)) {
// 		return "tablet"
// 	} else {
// 		return "pc"
// 	}
// }
// /**
//  * 判断适配端口的设备类型
//  * @returns {string} 'mobile' | 'tablet' | 'pc'
//  * */

/**
 * 仅依据 UA 判断是否手持设备，**不使用视口宽度**。
 * 用于 `/chat/popout` 等窄窗口：桌面浏览器弹窗宽度常 ≤768，不应被当成 H5。
 */
/** 仅 UA（无 window），供 SSR / hydration 首屏与客户端对齐 */
export function detectDeviceAdvancedFromUserAgent(
	ua: string
): "mobile" | "tablet" | "pc" {
	const isMobile = /Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)
	const isTablet =
		/iPad|Tablet|PlayBook|Kindle|Silk|Android 3.0|Xoom|SCH-I800|Nexus 7|Nexus 10/i.test(ua)
	if (isMobile) return "mobile"
	if (isTablet) return "tablet"
	return "pc"
}

export const isHandheldUserAgent = (): boolean => {
	if (!import.meta.client) return false
	const ua = navigator.userAgent
	return detectDeviceAdvancedFromUserAgent(ua) !== "pc"
}

export default function detectDeviceAdvanced(): "mobile" | "tablet" | "pc" {
	if (!import.meta.client) {
		return "pc"
	}

	const ua = navigator.userAgent
	const width = window.innerWidth
	const fromUa = detectDeviceAdvancedFromUserAgent(ua)

	if (fromUa === "mobile" || width <= 768) {
		return "mobile"
	}
	if (fromUa === "tablet" || (width > 768 && width <= 1200)) {
		return "tablet"
	}
	return "pc"
}
