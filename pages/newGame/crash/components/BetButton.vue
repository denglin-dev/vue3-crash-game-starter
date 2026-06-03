<template>
	<div class="betBtn" @click="manualBet"
		:class="[betButtonState, { graybet: disabled && (betButtonState === 'green' || betButtonState === 'graybet') }]">
		{{ buttonText }}
	</div>
</template>

<script setup lang="ts">
/**
 * 主操作按钮：根据 `betButtonState` 切换文案（下注 / 兑现「逃离」/ 取消预约等）。
 * 飞行阶段点击会和 Pixi 曲线/火箭同帧竞争；本组件手动控制点击音，避免 `v-sound`
 * 在 pointerdown capture 里同步触发 HTMLAudio/解锁逻辑造成一帧卡顿。
 */
import { computed } from "vue"
import { useI18n } from "vue-i18n"
import { handleBetButtonDown } from "../composables/useCrashBet"
import { betButtonState, gameState } from "../composables/useCrashState"
import { loginStatus } from "~/utils/hook/hook"
import { useGame } from "~/composables/GameHook"
import { playClickSoundDeferred, playClickSoundOnce } from "~/utils/sound/clickSound"

const { t: $t } = useI18n()
const props = defineProps({
	name: {
		type: String,
		required: true
	},
	data: {
		type: Object,
		required: true
	},
	disabled: {
		type: Boolean,
		default: false
	}
})

const emiter = defineEmits(["checkSubmit"])
const { soundState } = useGame()

/** 与 Manual 的「先校验再真正下注」配合：余额不足时由父组件触发 input 抖动 */
const buttonText = computed(() => {
	let str = $t("game.buttons.bet")
	switch (betButtonState.value) {
		case "red":
			str = $t("game.buttons.loadingCancel")
			break
		case "gray":
			str = $t("game.buttons.loading")
			break
		case "yellow":
			str = $t("game.buttons.cashOut")
			break
	}
	return str
})

/** 未登录弹窗；余额不足则交给父组件校验输入；否则进入经典下注状态机 */
const manualBet = () => {
	if (!loginStatus.value) return bus.emit("openGlobalDialog", { type: "Login" })
	const state = betButtonState.value
	if (props.disabled && (state === "green" || state === "graybet")) return
	// 飞行中（兑现/预约下一局）错峰播放点击音，避免与 Pixi 曲线/火箭同帧抢主线程。
	if (soundState.isClickSoundEnabled) {
		if (gameState.value === 2) {
			playClickSoundDeferred()
		} else {
			playClickSoundOnce()
		}
	}
	const bet = Number(props.data.bet)
	if ((state === "green" || state === "graybet") && (!Number.isFinite(bet) || bet < 0)) {
		emiter("checkSubmit")
		return
	}
	handleBetButtonDown(props.name, props.data as { bet: number; double: number; type: string }, state)
}
</script>
<style scoped lang="scss">
.betBtn {
	width: 273px;
	height: 50px;
	border-radius: 10px;
	background: #20ce2e;
	text-align: center;
	line-height: 50px;
	margin-top: 15px;
	color: #fff;
	font-size: 15px;
	font-style: normal;
	font-weight: 600;
	cursor: pointer;

	@media screen and (max-width: 768px) {
		width: 100% !important;
		margin-top: 0;
	}
}

.red {
	background: #f00 !important;
}

.green {
	background: #20ce2e !important;
}

.yellow {
	background: #ffb039 !important;
}

.gray {
	background: #202b50 !important;
}

.graybet {
	background: #202b50 !important;
}
</style>
