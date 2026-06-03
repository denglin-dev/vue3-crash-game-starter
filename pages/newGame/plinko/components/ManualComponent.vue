<template>
	<div class="classicContent" key="tab-0">
		<div class="from">

			<div class="inputContent">
				<p class="label Cy_font_Bold"> {{ $t("game.form.betAmount") }}</p>

				<BetInput v-model="reqData.bet" :disabled="reqData.isStart" :isQuicklyBetBtn="!reqData.isStart"
					ref="refIpt" />
			</div>
			<div class="inputContent">
				<p class="label Cy_font_Bold"> {{ $t("game.plinko.difficulty") }}</p>
				<ChangeModel :tabbar-data="tabbarData" :tabbar-active="reqData.risk" @change-model="handleModelChange"
					:can-change="!reqData.isStart" />
			</div>
			<div class="inputContent">
				<p class="label Cy_font_Bold"> {{ $t("game.plinko.number_rows") }}</p>

				<GameStep :min="8" :max="16" :step="3" @update:step="handleStepChange"
					:default-value="Number(reqData.row)" :disabled="reqData.isStart" />
			</div>
		</div>
		<!-- gray  :class="{ gray: isLoading }"-->
		<div class="submit">
			<div v-sound class="btn betBtn green Cy_font_Bold userSelectNone" :class="{ gray: !gameRuleReady }"
				@click="handleCheckSubmit">
				{{ $t("game.buttons.bet") }}
			</div>
		</div>
	</div>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import ChangeModel from './ChangeModel.vue'
import GameStep from '~/components/GameStep/GameStep.vue'
import BetInput from '~/components/CommonInput/BetInput.vue'
import { loginStatus } from '~/utils/hook/hook'

import { usePlinkoGame } from '~/pages/newGame/plinko/composables/usePlinkoGame'
import { GAME_CODE } from '~/pages/newGame/common/composables/newGameCodes'
import { useGameRuleReady } from '~/pages/newGame/common/composables/useGameRuleAsyncData'

const { t: $t } = useI18n()
const { reqData, handlePinkoBetReq, refIpt } = usePlinkoGame()
const gameRuleReady = useGameRuleReady(GAME_CODE.PLINKO)

const tabbarData = ref([
	{ label: $t('game.buttons.Easy'), value: 0 },
	{ label: $t('game.buttons.Normal'), value: 1 },
	{ label: $t('game.buttons.Hard'), value: 2 }
])

const handleStepChange = (step: number) => {
	reqData.row = step
}

const handleModelChange = (value: number) => {
	reqData.risk = value
}

const handleCheckSubmit = () => {
	if (!loginStatus.value) return bus.emit("openGlobalDialog", { type: "Login" })
	if (!gameRuleReady.value) return
	refIpt.value?.checkedinputPass?.()
	handlePinkoBetReq()
}

</script>
<style lang="scss" scoped>
.classicContent {
	width: 100%;
	// height: 100%;
	transition: all 0.3s ease;
}

.moneyNotEnough {
	color: #ffba53;
	font-size: 12px;
	margin-top: 10px;
}

.inputContent {
	.label {
		color: #acbcd0;
		font-size: 14px;
		margin: 15px 0 10px;

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
	}
}

@media screen and (max-width: 768px) {
	.classicContent {
		display: flex;
		flex-direction: column-reverse;
	}

	.inputContent .label {
		margin-top: 10px;
	}

	.submit {
		margin-top: 0px;
	}

	.submit .btn {
		width: 100%;
	}
}

.gray {
	background: #202b50 !important;
}
</style>
