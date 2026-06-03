<template>
	<div class="payoutBox">
		<!-- Dice 等场景可整层去掉光晕图：不旋转仍会解码大图并占合成层，久玩易发热 -->
		<img
			v-if="!prop.hideEmitLight"
			src="/img/gamepage/emitLight.webp"
			alt=""
			class="emitLightImg"
			:class="{ 'emitLightImg--noSpin': !emitAmbientSpin }"
			:style="emitLightDynamicStyle" />
		<NumberComponent class="numberComponentBox" @loadedOver="loadedOver" :value="prop.value"></NumberComponent>
	</div>
</template>

<script setup lang="ts">
import NumberComponent from "~/components/PayoutAnimation/NumberComponent.vue"
import { watch, ref, onMounted, computed } from "vue"
// import { soundState } from "~/utils/hook/GameHook";
import { useGame } from "~/composables/GameHook"
import soundUrl from "/sounds/win.mp3"
const { soundState } = useGame()

/** 派彩胜利音单例：避免每局中一次 `new Audio` 触发重复解码与 GC（Dice 等高频局尤其明显） */
let payoutWinAudioSingleton: HTMLAudioElement | null = null

function getPayoutWinAudio(): HTMLAudioElement | null {
	if (typeof window === "undefined" || typeof (globalThis as any).Audio === "undefined") return null
	if (payoutWinAudioSingleton) return payoutWinAudioSingleton
	const a = new Audio(soundUrl)
	a.preload = "auto"
	try {
		;(a as any).playsInline = true
	} catch {
		/* ignore */
	}
	try {
		a.load()
	} catch {
		/* ignore */
	}
	payoutWinAudioSingleton = a
	return payoutWinAudioSingleton
}

const prop = defineProps({
	value: {
		type: [String, Number],
		default: ""
	},
	/** false：关闭光晕无限旋转（Dice 老 iPhone lite 用，减轻 GPU 持续合成） */
	ambientSpin: {
		type: Boolean,
		default: true
	},
	/** 光晕一圈时长（秒）；移动端 Dice 可放慢以降低久玩发热 */
	spinPeriodSec: {
		type: Number,
		default: 8
	},
	/** true：不渲染光晕图（仅数字派彩）；Dice 等久玩场景可显著降 GPU 持续负载 */
	hideEmitLight: {
		type: Boolean,
		default: false
	},
	/** false：只展示派彩视觉，不额外播放 PayoutIndex 内置 win.mp3 */
	playWinSound: {
		type: Boolean,
		default: true
	}
})

const emitAmbientSpin = computed(() => prop.ambientSpin !== false)

const emitLightDynamicStyle = computed(() => {
	if (!emitAmbientSpin.value) return {}
	const s = Number(prop.spinPeriodSec)
	const sec = Number.isFinite(s) && s > 0 ? s : 8
	return { animationDuration: `${sec}s` }
})

const isShowAnimation = ref(false)
const loadedOver = () => {
	isShowAnimation.value = true
}

let _mounted = false
const playWinSoundOnce = () => {
	if (!prop.playWinSound || !soundState.isClickSoundEnabled) return
	const audio = getPayoutWinAudio()
	if (!audio) return
	try {
		audio.pause()
	} catch {
		/* ignore */
	}
	try {
		audio.currentTime = 0
	} catch {
		/* ignore */
	}
	audio.play().catch((err) => console.error("Audio playback failed:", err))
}

onMounted(() => {
	_mounted = true
	if ((Number(prop.value) || 0) > 0) playWinSoundOnce()
})

/**
 * 只在“派彩金额从 0/空 → 正数”时播放一次胜利音效。
 * 这样可以避免：
 * - 首次进入页面（组件 mount）就误播一次
 * - v-show 场景下组件始终挂载导致每次进页都响
 */
watch(
	() => Number(prop.value) || 0,
	(v, oldV) => {
		if (!_mounted) return
		const prev = Number(oldV) || 0
		if (v > 0 && prev <= 0 && soundState.isClickSoundEnabled) {
			playWinSoundOnce()
		}
	},
)
</script>

<style lang="scss" scoped>
.payoutBox {
	//scale: .3;
	// width: 122px;
	// height: 122px;

	.numberComponentBox {
		position: absolute;
		top: 50%;
		width: 100%;
		display: flex;
		justify-content: center;
		scale: 0.4;
		z-index: 49;
		margin-top: -34px;

	}

	.start {
		position: absolute;
		animation: blink 1s infinite;
		scale: 0.4;
		z-index: 49;
	}

	.start1 {
		width: 10px;
		height: 10px;
		top: 70px;
		left: 116px;
	}

	.start2 {
		width: 34px;
		height: 34px;
		top: 106px;
		left: 210px;
	}

	.start3 {
		width: 24px;
		height: 24px;
		top: 198px;
		left: 64px;
	}

	.start4 {
		width: 22px;
		height: 22px;
		bottom: 36px;
		left: 162px;
	}
}

@keyframes blink {

	0%,
	100% {
		opacity: 1;
		/* 元素完全可见 */
	}

	50% {
		opacity: 0;
		/* 元素完全消失 */
	}
}

.emitLightImg {
	width: 122px;
	height: 122px;
	animation-name: spin;
	animation-timing-function: linear;
	animation-iteration-count: infinite;
	animation-duration: 8s;
	transform-origin: center;
}

.emitLightImg--noSpin {
	animation: none;
}

@keyframes spin {
	0% {
		transform: rotate(0deg);
	}

	100% {
		transform: rotate(360deg);
	}
}
</style>