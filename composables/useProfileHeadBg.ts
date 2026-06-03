import { userInfo } from "~/utils/hook/hook"

const DEFAULT_PROFILE_HEAD_COLOR_BG = "/img/newProfile/mb-head-bg14.svg"

export function getProfileHeadColorBg(levelNum: number): string {
	if (levelNum <= 14) {
		return DEFAULT_PROFILE_HEAD_COLOR_BG
	}
	if (levelNum >= 15 && levelNum <= 20) {
		return "/img/newProfile/mb-head-bg20.svg"
	}
	if (levelNum >= 28 && levelNum <= 33) {
		return "/img/newProfile/mb-head-bg33.svg"
	}
	if (levelNum >= 61 && levelNum <= 77) {
		return "/img/newProfile/mb-head-bg77.svg"
	}
	// return DEFAULT_PROFILE_HEAD_COLOR_BG
}

export function getProfileHeadBg(levelNum: number): string {
	return getProfileHeadColorBg(levelNum)
}

export function useProfileHeadBg() {
	const headColorBgUrl = computed(() => getProfileHeadColorBg(Number(userInfo.value.levelNum) || 0))
	const headBgUrl = computed(() => headColorBgUrl.value)

	const headBaseBgStyle = computed(() => ({
		background: "linear-gradient(180deg, rgba(17, 40, 66, 0) 0%, rgba(22, 52, 87, 0.5) 100%)",
		border: "0.75px solid rgba(62, 97, 140, 0.2)"
	}))
	const headBgStyle = headBaseBgStyle

	return {
		headColorBgUrl,
		headBaseBgStyle,
		headBgUrl,
		headBgStyle
	}
}
