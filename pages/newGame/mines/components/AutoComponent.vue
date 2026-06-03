<template>
	<div class="classicContent">
		<div class="from">
			<div v-if="!autoBetData.start">
				<MinesCommon :auto="true"></MinesCommon>
				<div class="cashOutMount">
					<span> {{ $t("game.mines.cash_out_amount") }} </span>
					<img :src="minesSnapshotDisplayImg" alt="" />
					<span>
						{{ minesSnapshotDisplaySymbol }}
						{{ minesAutoIdleCashOutDisplay }}
					</span>
				</div>
				<div class="inputContent">
					<p class="label">{{ $t("game.form.numberOfBetsAuto") }}</p>
					<CommonInput v-model="autoBetData.betBigNumber" :decimalLength="0" type="defaultInput"
						:disabled="autoBetData.start" :isShowLabel="false" class-name="wuQiong"></CommonInput>
				</div>
			</div>
			<template v-if="autoBetData.start">
				<div class="inputContent" :class="{ inlineBlock: deviceAdvanced === 'mobile' }">
					<p class="label">{{ $t("game.form.basicBetAmount") }}</p>
					<CommonInput v-model="autoBetData.defaultBetAmount"
						:decimalLength="!userInfoCurrencyTypeisFait ? 6 : 2" :disabled="true" type="xInput"
						:isShowLabel="false" :showDefailtImg="false"></CommonInput>
				</div>
				<div class="inputContent" :class="{ inlineBlock: deviceAdvanced === 'mobile' }">
					<p class="label">{{ $t("game.form.currentBetAmount") }}</p>
					<CommonInput v-model="betAmount" :disabled="true" :isShowLabel="false" type="xInput"
						:showDefailtImg="false" :decimalLength="!userInfoCurrencyTypeisFait ? 6 : 2"></CommonInput>
				</div>
				<div class="inputContent" :class="{ inlineBlock: deviceAdvanced === 'mobile' }">
					<p class="label"> {{ $t("game.limbo.pay_out") }}</p>
					<CommonInput v-model="cashOutAmount" :disabled="true" :isShowLabel="false" type="xInput"
						:show-x-btn="false" style="color: #20ce2e" :decimalLength="!userInfoCurrencyTypeisFait ? 6 : 2">
					</CommonInput>
				</div>
				<div class="inputContent" :class="{ inlineBlock: deviceAdvanced === 'mobile' }">
					<p class="label Cy_font_SemiBold">{{ $t("game.form.numberOfBetsAuto") }}</p>
					<CommonInput :model-value="autoBetRoundProgressText" :disabled="true" type="defaultInput"
						inputValueType="text" :isShowLabel="false" />
				</div>
			</template>
			<template v-if="!autoBetData.start">
				<div class="inputContent">
					<p class="label">{{ $t("game.crash.on_win") }}</p>
					<CommonInput type="selectInput" @changeIptTags="handleChangeTags($event, 'win')"
						:tag-index="winIsReset" v-model="autoBetData.win" :isShowLabel="false"></CommonInput>
				</div>
				<div class="inputContent">
					<p class="label"> {{ $t("game.crash.on_loss") }}</p>
					<CommonInput type="selectInput" @changeIptTags="handleChangeTags($event, 'loss')"
						:tag-index="lossIsReset" v-model="autoBetData.lose" :isShowLabel="false"></CommonInput>
				</div>
				<div class="inputContent">
					<p class="label Cy_font_SemiBold">
						{{ $t("game.form.stopOnLoss") }}
						<span class="desc Cy_font_Regular">({{ $t("game.crash.amount_exceeds") }})</span>
					</p>
					<CommonInput type="defaultInput" :isShowLabel="false" v-model="autoBetData.stop"
						inputValueType="number"></CommonInput>
				</div>
			</template>
			<div class="inputContent" v-if="autoBetData.start">
				<p class="label Cy_font_SemiBold">
					{{ $t("game.form.rule") }}
					<span class="desc Cy_font_Regular"></span>
				</p>
				<div class="stopShowInfo">
					<div class="infoItem">
						<span class="label"> {{ $t("game.crash.victory_multiplier") }}</span>
						<span class="value">{{ autoBetData.win ? autoBetData.win + "%" : "--" }}</span>
					</div>
					<div class="infoItem">
						<span class="label"> {{ $t("game.form.increasedFailureMultiplier") }}</span>
						<span class="value">{{ autoBetData.lose ? autoBetData.lose + "%" : "--" }}</span>
					</div>
					<div class="infoItem">
						<span class="label">{{ $t("game.form.stopOnLossShort") }}</span>
						<span class="value">
							{{ autoBetData.stop ? minesSnapshotDisplaySymbol : "" }}{{ autoBetData.stop ?
								autoBetData.stop : "--"
							}}
						</span>
					</div>
				</div>
			</div>
		</div>
		<div class="submit">
			<div v-sound v-if="autoBetData.start" class="btn betBtn Cy_font_SemiBold"
				:class="{ red: autoBetData.start }" @click="handleStopGame">
				{{ $t("game.buttons.stop") }}
			</div>
			<div v-sound v-else class="btn betBtn green Cy_font_SemiBold" :class="{ gray: !gameRuleReady }"
				@click="handleCheckSubmit">
				{{ $t("game.buttons.start") }}
			</div>
		</div>
	</div>
</template>
<script setup lang="ts">
import { computed } from "vue"
import { useI18n } from "vue-i18n"
import CommonInput from "~/components/CommonInput/CommonInput.vue"
import {
	deviceAdvanced,
	loginStatus,
	userInfoCurrencyTypeisFait
} from "~/utils/hook/hook"
import {
	betAmount,
	cashOutAmount,
	gameContentRef,
	getMinesMoneyDecimalPlaces,
	InGame,
	minesSnapshotDisplayImg,
	minesSnapshotDisplaySymbol,
} from "../composables/useMinesState"
import { formatPoint } from "~/utils/ts/formatPoint"
import { autoBetData } from "../composables/useAutoBet"
import { autoBetRoundCap } from "~/pages/newGame/common/autoBetRoundCap"
import { useMinesGame, useMinesGameConfigSync } from "../composables/useMinesGame"

import MinesCommon from "./MinesCommon.vue"
import { useGame } from "~/composables/GameHook"
import { MessageService } from "~/utils/MessageService"
import { useClickDebounce } from "~/pages/newGame/common/composables/useClickDebounce"
import { GAME_CODE } from "~/pages/newGame/common/composables/newGameCodes"
import { useGameRuleReady } from "~/pages/newGame/common/composables/useGameRuleAsyncData"

const { t: $t } = useI18n()
const { winIsReset, lossIsReset } = useGame()
const { autoBet, changeAutoStart, CyGameConfigSetData } = useMinesGame(useI18n())
useMinesGameConfigSync(CyGameConfigSetData)
const gameRuleReady = useGameRuleReady(GAME_CODE.MINES)
const { runWithClickDebounce } = useClickDebounce(1000)

const props = defineProps({
	status: {
		default: true
	}
})

const autoBetRoundProgressText = computed(() => {
	const cap = autoBetRoundCap(autoBetData.betBigNumber)
	return `${autoBetData.betNumber}/${cap == null ? "--" : cap}`
})

/** 空闲自动 Tab：法币 2 位、虚拟币 6 位，与下注/派彩规则一致 */
const minesAutoIdleCashOutDisplay = computed(() => {
	const dp = getMinesMoneyDecimalPlaces()
	const n = Number(cashOutAmount.value)
	if (!Number.isFinite(n)) return dp === 2 ? "0.00" : "0.000000"
	return formatPoint(n, dp) ?? (dp === 2 ? "0.00" : "0.000000")
})

// 开启自动模式
const doCheckSubmit = () => {
	if (!loginStatus.value) return bus.emit("openGlobalDialog", { type: "Login" })
	if (!gameRuleReady.value) return
	/** 未结束的手动局会保持 `InGame`；`autoBetFun` 首行直接 return，不会调 `auto_bet/mines`，须先兑现或继续手动 */
	if (InGame.value) {
		MessageService.error($t("game.mines.finish_round_before_auto"))
		return
	}
	if (autoBetData.isAutoRandom) return
	const arr = gameContentRef.value?.getAutoIndexArr()
	if (!arr || arr.length === 0) {
		MessageService.error($t("game.mines.please_select_tiles"))
		return
	}
	changeAutoStart(true, gameContentRef.value)
	autoBetData.defaultBetAmount = betAmount.value
	autoBetData.isAutoRandom = false
	autoBet()
}

const handleCheckSubmit = () => {
	runWithClickDebounce(doCheckSubmit)
}

const handleChangeTags = (value: number, type: string) => {
	type === "win" ? (winIsReset.value = value) : (lossIsReset.value = value)
}

// 关闭自动模式
const doStopGame = () => {
	changeAutoStart(false, gameContentRef.value)
}

const handleStopGame = () => {
	runWithClickDebounce(doStopGame)
}
</script>
<style lang="scss" scoped>
.cashOutMount {
	color: #456c99;
	font-size: 12px;
	font-style: normal;
	font-weight: 400;
	line-height: 14px;
	/* 116.667% */
	margin-top: 10px;
	display: flex;

	img {
		margin-left: 13px;
		margin-right: 6px;
		width: 14px;
		height: 14px;
	}

	:last-child {
		color: #20ce2e;
	}
}

.red {
	background: #f00;
}

.gray {
	background: #202b50 !important;
	cursor: not-allowed !important;
}

.submit {
	position: relative;

	.btn {
		width: 273px;
		height: 50px;
		flex-shrink: 0;
		border-radius: 10px;
		background: var(--search-game-active-text);
		color: var(--new-white);
		font-size: 15px;
		text-align: center;
		line-height: 50px;
		cursor: pointer;
		margin-top: 15px;
	}

	.classicManualPayout {
		width: 100%;
		position: absolute;
		top: -55px;
		display: flex;
		justify-content: center;
	}
}

.stopShowInfo {
	width: 273px;
	/* height: 85px; */
	height: auto;
	border-radius: 8px;
	border: 0.5px solid #1c2a46;
	background: #09122b;
	padding: 10px;

	@media screen and (max-width: 768px) {
		width: 100%;
	}

	.infoItem {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 4px;

		.label {
			color: #456c99;
			/* 正文 */
			font-size: 13px;
			font-style: normal;
			font-weight: 500;
			/* 115.385% */
		}

		.value {
			color: #fff;
			text-align: right;

			/* 正文 */
			font-size: 13px;
			font-style: normal;
			font-weight: 500;
			/* 115.385% */
		}
	}
}

.classicContent {
	width: 100%;
	// height: 100%;
	transition: all 0.3s ease;

	@media screen and (max-width: 768px) {
		display: flex;
		flex-direction: column-reverse;
		/* 反转垂直方向排列 */
	}
}

.inputContent {
	&.inlineBlock {
		display: inline-block;
		width: calc(50% - 7px);

		.disabledBox {
			width: 100%;
		}
	}

	&.inlineBlock:nth-child(even) {
		margin-left: 14px;
	}

	>.label {
		color: #94a1ba;
		font-size: 15px;
		margin: 10px 0 10px;

		.desc {
			font-size: 12px;
			color: var(--notification-time-color);
		}
	}

	>.pri_input {
		height: 50px;
	}
}
</style>
