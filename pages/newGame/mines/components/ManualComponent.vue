<template>
	<div key="tab-0" class="diceClassicContent">
		<div class="diceFrom">
			<MinesCommon />
		</div>
		<div class="submit">
			<!-- v-sound：与 Dice 一致，下注/兑现主按钮点按反馈音；pointerdown 在插件内 capture，先于 v-throttle -->
			<div v-sound v-throttle="handleBetClick" class="btn betBtn Cy_font_SemiBold userSelectNone"
				:class="{ green: buttonText === 0 && gameRuleReady, gray: buttonText === 1 || !gameRuleReady, yellow: buttonText === 2, 'not-allowed': isBetAndNoRes || !gameRuleReady }">
				<span v-if="buttonText === 0">{{ $t("game.buttons.bet") }}</span>
				<span v-else-if="buttonText === 1"> {{ $t("game.buttons.cashOut") }}</span>
				<span v-else>{{ $t("game.buttons.cashOut") }} {{ minesProfitSymbol }}{{
					formatMinesProfitAmount(profit.current) }}</span>
			</div>
			<div v-if="buttonText !== 0" class="nextMoney">
				{{ $t("game.mines.next_coin") }}:
				<span>{{ minesProfitSymbol }} {{ formatMinesProfitAmount(profit.next) }}</span>
			</div>
			<div v-sound v-throttle="random" class="btn betBtn Cy_font_SemiBold userSelectNone" style="margin-top: 10px;"
				:class="{
				green: buttonText !== 0,
				gray: buttonText === 0,
				'not-allowed': isBetAndNoRes || buttonText === 0
			}">
				<span>{{ $t("dialog.random") }}</span>
			</div>
		</div>
	</div>
</template>
<script setup lang="ts">
import { useI18n } from "vue-i18n"
import MinesCommon from "./MinesCommon.vue"
import { useMinesGame, useMinesGameConfigSync } from "../composables/useMinesGame"
import {
	buttonText,
	profit,
	isBetAndNoRes,
	gameContentRef,
	getCashOut,
	userBetInfo,
	minesSnapshotDisplaySymbol,
	minesBetResolvedKindFromBetInfo,
	minesRoundCurrencyFreeze,
	minesBetFiatIsoFromBetInfoRecord,
} from "../composables/useMinesState"
import { getFiatDisplaySymbolByCode, loginStatus } from "~/utils/hook/hook"
import formatPrice from "~/utils/ts/formatPrice"
import { GAME_CODE } from "~/pages/newGame/common/composables/newGameCodes"
import { useGameRuleReady } from "~/pages/newGame/common/composables/useGameRuleAsyncData"

const { t: $t } = useI18n()
const { toBet, CyGameConfigSetData } = useMinesGame(useI18n())
useMinesGameConfigSync(CyGameConfigSetData)
const gameRuleReady = useGameRuleReady(GAME_CODE.MINES)

function strField(v: unknown): string {
	return typeof v === "string" ? v.trim() : ""
}
const betInputCurrencySymbol = computed(() => {
	const info = userBetInfo.value as Record<string, unknown>
	if (!info || typeof info !== "object") return ""
	if (minesBetResolvedKindFromBetInfo(info as Record<string, unknown>) !== "FAIT") return ""
	const fiat = minesBetFiatIsoFromBetInfoRecord(info as Record<string, unknown>)
	if (fiat) return getFiatDisplaySymbolByCode(fiat)
	return strField(info.symbol)
})

function minesUserBetInfoHasData(): boolean {
	const info = userBetInfo.value
	return !!(info && typeof info === "object" && !Array.isArray(info) && Object.keys(info as object).length > 0)
}

/** 有本局下注信息且为法币：法币展示符号；虚拟币：不展示符号；否则用法币快照或空（与下注框一致） */
const minesProfitSymbol = computed(() => {
	const fz = minesRoundCurrencyFreeze.value
	if (fz?.kind === "FAIT") return fz.fiatDisplayPrefix
	if (fz?.kind === "COIN") return ""
	if (!minesUserBetInfoHasData()) return minesSnapshotDisplaySymbol.value
	const info = userBetInfo.value as Record<string, unknown>
	const kind = minesBetResolvedKindFromBetInfo(info as Record<string, unknown>)
	if (kind === "COIN") return ""
	if (kind === "FAIT") return betInputCurrencySymbol.value || minesSnapshotDisplaySymbol.value
	return minesSnapshotDisplaySymbol.value
})

const handleBetClick = () => {
	if (!gameRuleReady.value) return
	toBet()
}

/**
 * 有 userBetInfo：法币 2 位小数；虚拟币 6 位小数且无符号（符号单独由 minesProfitSymbol 控制）。
 * 无 userBetInfo：getDefailtSymbol + formatPrice 逻辑（与钱包币种一致）。
 */
function formatMinesProfitAmount(n: string | number): string {
	const fz = minesRoundCurrencyFreeze.value
	if (fz) {
		if (fz.decimals === 2) return Number(formatPrice(n)).toFixed(2)
		const v = Number(n)
		return Number.isFinite(v) ? v.toFixed(6) : "0.000000"
	}
	if (!minesUserBetInfoHasData()) return String(formatPrice(n))
	const info = userBetInfo.value as Record<string, unknown>
	const kind = minesBetResolvedKindFromBetInfo(info as Record<string, unknown>)
	if (kind === "FAIT") return Number(formatPrice(n)).toFixed(2)
	if (kind === "COIN") {
		const v = Number(n)
		return Number.isFinite(v) ? v.toFixed(6) : "0.000000"
	}
	return String(formatPrice(n))
}

// 随机挑选功能
const random = () => {
	// 只有在下注后(buttonText !==0 )才能使用随机挑选
	if (buttonText.value === 0) return
	if (!loginStatus.value) return bus.emit("openGlobalDialog", { type: "Login" })

	// 调用 GameContent 的随机翻转方法
	const success = gameContentRef.value?.randomFlipCard()
	if (success) {
		getCashOut()
	}
}
</script>
<style lang="scss">
.diceInputContentFlex {
	display: flex;
	align-items: center;
	justify-content: space-between;

	div {
		margin: 15px 0 10px;
		display: flex;
		align-items: center;
		color: #20ce2e;
		font-size: 14px;
		font-weight: 500;
		line-height: 16px;
		gap: 5px;
	}

	img {
		width: 16px;
		height: 16px;
	}
}
</style>
<style lang="scss" scoped>
.diceClassicContent {
	width: 100%;
	// height: 100%;
	transition: all 0.3s ease;

	@media screen and (max-width: 768px) {
		display: flex;
		flex-direction: column-reverse;
		/* 反转垂直方向排列 */
	}
}

.betBtn.not-allowed {
	cursor: not-allowed;
}

.gray {
	background: #202b50 !important;
}

.submit {
	margin-top: 15px;
	position: relative;

	@media screen and (max-width: 768px) {
		margin-top: 0;
	}

	.classicManualPayout {
		width: 100%;
		position: absolute;
		top: -55px;
		display: flex;
		justify-content: center;
	}

	.betBtn:hover {
		opacity: 0.8;
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

	.nextMoney {
		margin-top: 15px;
		display: block;
		text-align: center;
		color: #ffffff;
		font-size: 15px;
		font-style: normal;
		font-weight: 600;

		span {
			color: #20ce2e;
			font-size: 15px;
			font-style: normal;
			font-weight: 600;
			line-height: 17px;
		}
	}
}
</style>
