<template>
	<div class="classicContent" key="tab-0">
		<div class="from">
			<template v-if="!reqData.isStart && !reqData.isAuto">

				<div class="inputContent">
					<p class="label"> {{ $t("game.form.betAmount") }}</p>

					<BetInput v-model="reqData.bet" :disabled="reqData.isStart" :isQuicklyBetBtn="!reqData.isStart"
						ref="refIpt"></BetInput>
				</div>
				<div class="inputContent">
					<p class="label"> {{ $t("game.plinko.difficulty") }}</p>
					<ChangeModel @change-model="handleModelChange" :tabbar-data="tabbarData"
						:tabbar-active="reqData.risk" :can-change="!reqData.isStart" />
				</div>
				<div class="inputContent">
					<p class="label"> {{ $t("game.plinko.number_rows") }}</p>
					<GameStep :min="8" :max="16" :step="3" @update:step="handleStepChange"
						:default-value="Number(reqData.row)" :disabled="reqData.isStart" />
				</div>
				<div class="inputContent">
					<p class="label"> {{ $t("game.form.numberOfBetsAuto") }}</p>
					<CommonInput v-model="reqData.gameNum" :decimal-length="0" type="xInput" :isShowLabel="false"
						class-name="wuQiong"></CommonInput>
				</div>
			</template>
			<template v-else>
				<div class="inputContent">
					<p class="label"> {{ $t("game.form.basicBetAmount") }}</p>
					<CommonInput v-model="reqData.bet" :disabled="true" :isShowLabel="false" :showDefailtImg="false"
						:decimalLength="!userInfoCurrencyTypeisFait ? 6 : 2"></CommonInput>
				</div>
				<div class="inputContent">
					<p class="label"> {{ $t("game.plinko.number_bets_placed") }}</p>
					<CommonInput :model-value="reqData.gameNow + '/' + (reqData.gameNum ? reqData.gameNum : '--')"
						:disabled="true" type="defaultInput" input-value-type="text" :isShowLabel="false" />
				</div>
				<div class="inputContent">
					<p class="label"> {{ $t("game.form.rule") }}</p>
					<div class="stopShowInfo">
						<div class="infoItem">
							<span class="label"> {{ $t("game.plinko.difficulty") }}</span>
							<span class="value">{{ textValue(reqData.risk) }}</span>
						</div>
						<div class="infoItem">
							<span class="label"> {{ $t("game.plinko.number_rows") }}</span>
							<span class="value">{{ reqData.row }}</span>
						</div>
					</div>
				</div>
			</template>
		</div>
		<div class="submit">
			<div v-if="!reqData.isStart" v-sound class="btn betBtn green Cy_font_Bold userSelectNone"
				:class="{ gray: !gameRuleReady }" @click="handleCheckSubmit">
				{{ $t("game.buttons.start") }}
			</div>
			<div v-if="reqData.isStart && reqData.isAuto" v-sound class="btn betBtn red Cy_font_Bold userSelectNone"
				@click="handleStopClick">
				{{ $t("game.buttons.stop") }}
			</div>
			<div v-if="!reqData.isAuto && reqData.isStart" class="btn betBtn gray Cy_font_Bold userSelectNone">
				{{ $t("game.buttons.loading") }}...
			</div>
		</div>
	</div>
</template>
<script setup lang="ts">
import CommonInput from '~/components/CommonInput/CommonInput.vue'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import ChangeModel from './ChangeModel.vue'
import GameStep from '~/components/GameStep/GameStep.vue'
import { usePlinkoGame } from '~/pages/newGame/plinko/composables/usePlinkoGame'
import BetInput from '~/components/CommonInput/BetInput.vue'
import { loginStatus, userInfoCurrencyTypeisFait } from '~/utils/hook/hook'
import { useClickDebounce } from '~/pages/newGame/common/composables/useClickDebounce'
import { GAME_CODE } from '~/pages/newGame/common/composables/newGameCodes'
import { useGameRuleReady } from '~/pages/newGame/common/composables/useGameRuleAsyncData'
const { t: $t } = useI18n()
const { reqData, handlePinkoBetReq, handleStopBet, refIpt } = usePlinkoGame()
const gameRuleReady = useGameRuleReady(GAME_CODE.PLINKO)
const { runWithClickDebounce } = useClickDebounce(1000)

const props = defineProps({
	status: {
		default: true
	}
})
const tabbarData = ref([
	{ label: $t("game.plinko.easy"), value: 0 },
	{ label: $t("game.plinko.normal"), value: 1 },
	{ label: $t("game.plinko.hard"), value: 2 }
])
const textValue = (value: number) => {
	let str = ''
	tabbarData.value.forEach((item) => {
		if (item.value === value) {
			str = item.label
		}
	})
	return str
}
// 下注校验，并下注
const doCheckSubmit = () => {
	if (!loginStatus.value) return bus.emit("openGlobalDialog", { type: "Login" })
	if (!gameRuleReady.value) return
	const betNum = Number(reqData.bet)
	if (!Number.isFinite(betNum) || betNum < 0) return refIpt.value?.checkedinputFail?.()
	handlePinkoBetReq("auto")
}
const handleCheckSubmit = () => {
	runWithClickDebounce(doCheckSubmit)
}
const handleStopClick = () => {
	runWithClickDebounce(handleStopBet)
}
//行数改变
const handleStepChange = (step: number) => {
	reqData.row = step
}
// 难度改变
const handleModelChange = (value: number) => {
	reqData.risk = value
}
</script>
<style lang="scss" scoped>
.classicContent {
	width: 100%;
	// height: 100%;
	transition: all 0.3s ease;

	@media screen and (max-width: 768px) {
		// 手机端 第五步
		display: flex;
		flex-direction: column-reverse;
		/* 反转垂直方向排列 */
	}
}

.moneyNotEnough {
	color: #ffba53;
	font-size: 12px;
	margin-top: 10px;
}

.gray {
	background: #202b50 !important;
	cursor: not-allowed !important;
}

.inputContent {
	>.label {
		color: #94a1ba;
		font-size: 15px;
		margin: 15px 0 10px;

		@media screen and (max-width: 768px) {
			margin-top: 10px;
		}

		.desc {
			font-size: 12px;
			color: var(--notification-time-color);
		}
	}

	>.pri_input {
		height: 50px;
	}

	.desc {
		font-size: 12px;
		color: #456c99;
	}

	.winValue {
		display: flex;
		align-items: center;
		position: relative;
		width: 100%;

		.winValueInput {
			flex: 1;
		}

		.descValue {
			position: absolute;
			right: 10px;
			top: 14px;
			color: white;
			font-size: 14px;
		}
	}
}

.submit {
	margin-top: 15px;
	position: relative;

	@media screen and (max-width: 768px) {
		margin-top: 0px;
	}

	.classicManualPayout {
		width: 100%;
		position: absolute;
		top: -55px;
		display: flex;
		justify-content: center;
	}

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

		@media screen and (max-width: 768px) {
			width: 100%;
		}
	}
}

.stopShowInfo {
	width: 273px;
	/* height: 60px; */
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
</style>
