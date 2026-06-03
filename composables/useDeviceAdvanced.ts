// composables/useDeviceAdvanced.ts
import type { Ref } from "vue"
import { getCurrentInstance, ref } from "vue"
import detectDeviceAdvanced, {
	detectDeviceAdvancedFromUserAgent,
} from "~/utils/detectDeviceAdvanced"

export type DeviceAdvanced = "mobile" | "tablet" | "pc"

/**
 * 模块级 ref：`hook.ts` / `DialogIndex`（若在 setup 外读）使用。
 * layout 内请用 `useDeviceAdvanced()` 的 useState，并通过 `applyDeviceAdvanced` 与模块 ref 同步。
 */
export const deviceAdvanced = ref<DeviceAdvanced>("pc")

/** 同时写入模块 ref 与 layout 的 useState，避免底栏已是 mobile、弹窗仍按 pc 不渲染 */
export const applyDeviceAdvanced = (
	value: DeviceAdvanced,
	state?: Ref<DeviceAdvanced>
) => {
	deviceAdvanced.value = value
	if (state) state.value = value
}

export function detectDeviceFromSsrUserAgent(ua: string): DeviceAdvanced {
	if (!ua) return "pc"
	return detectDeviceAdvancedFromUserAgent(ua)
}

/**
 * 组件 setup 内：返回与 SSR 对齐的 `useState`。
 * setup 外（如 `hook.ts` 模块加载）：仅返回模块级 `deviceAdvanced` ref。
 */
export function useDeviceAdvanced() {
	const inst = getCurrentInstance()
	if (!inst) {
		return { deviceAdvanced }
	}
	const state = useState<DeviceAdvanced>("cy-device-advanced", () => deviceAdvanced.value)
	return { deviceAdvanced: state }
}
