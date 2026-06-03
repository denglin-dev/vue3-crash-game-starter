import { reactive, ref, watch, onMounted, onBeforeUnmount, getCurrentInstance } from "vue"
import nprogress from "nprogress"
import "nprogress/nprogress.css"
import { decimal_mul, decimal_add } from "~/utils/decimal"
import { loginStatus } from "~/utils/hook/hook"

export const soundState = reactive({
	isClickSoundEnabled: false // 控制按钮是否允许播放音效
})

/** 通知内嵌 iframe 等同步音效开关；抽成模块级单例，避免每个 `useGame()` 各注册一个 watch 导致切换时重复 postMessage */
export function playSound() {
	if (typeof window === "undefined") return
	window.postMessage(JSON.stringify({ type: "carshsound", isopen: soundState.isClickSoundEnabled }), "*")
	window.postMessage(JSON.stringify({ type: "limbosound", isopen: soundState.isClickSoundEnabled }), "*")
	window.postMessage(JSON.stringify({ type: "plinkosound", isopen: soundState.isClickSoundEnabled }), "*")
}

if (import.meta.client) {
	watch(
		() => soundState.isClickSoundEnabled,
		() => {
			playSound()
		},
	)
}

/**
 * 与 `setBetAmount` 共享的全局 ref。各游戏页里 `AutoComponent` 与 `*GameIndex` 会各调一次 `useGame()`，
 * 若此处每调新建一套 ref，则 UI 改的「重置/保留」与 `handleBetEnd` 里用的不是同一状态，当前注额不会按策略变化。
 */
const winIsReset = ref(1)
const lossIsReset = ref(1)

const truncateTo6Decimals = (val: number): number => {
	return Math.floor(val * 1e6) / 1e6
}

export const setBetAmount = (
	isLoss: boolean,
	amount: number,
	lose: number | undefined,
	win: number | undefined,
	startBetMoney: number
) => {
	let result: number

	if (isLoss && lose && Number(lose) !== 0) {
		result = decimal_add(Number(amount), decimal_mul(amount, lose / 100))
	} else if (!isLoss && win && Number(win) !== 0) {
		result = decimal_add(Number(amount), decimal_mul(amount, win / 100))
	} else {
		// 输赢处于reset状态时重置下注金额
		if ((isLoss && lossIsReset.value === 1) || (!isLoss && winIsReset.value === 1)) {
			result = startBetMoney
		} else {
			result = Number(amount)
		}
	}

	return truncateTo6Decimals(result)
}

export function useGame() {
	// 是否允许播放点击音效
	// 是否开启快速游戏
	const isFastGame = ref(false)

	// 游戏配置，登录状态变化时清空
	const cygGameConfig = ref<any>(null)

	// 游戏在线离线状态
	const gameOnline = ref(true)
	const gameOffline = ref(false)

	// 监听登录状态变化，未登录时清空游戏配置
	watch(
		() => loginStatus.value,
		(newVal) => {
			if (!newVal) cygGameConfig.value = null
		}
	)

	// 网络状态监听事件回调
	const onOnline = () => {
		gameOnline.value = true
		gameOffline.value = false
		nprogress.done()
	}

	const onOffline = () => {
		gameOnline.value = false
		gameOffline.value = true
		nprogress.start()
	}
	// 在 setup 生命周期注册事件监听
	if (getCurrentInstance()) {
		onMounted(() => {
			window.addEventListener("online", onOnline)
			window.addEventListener("offline", onOffline)
		})

		onBeforeUnmount(() => {
			window.removeEventListener("online", onOnline)
			window.removeEventListener("offline", onOffline)
		})
	}
	return {
		soundState,
		isFastGame,
		winIsReset,
		lossIsReset,
		cygGameConfig,
		gameOnline,
		gameOffline,
		setBetAmount,
		playSound
	}
}
