<template>
	<div class="diceFrom">
		<div class="diceInputContent">
			<p class="label"> {{ $t("game.form.betAmount") }}</p>
			<BetInput v-model="betAmount" :disabled="disable" ref="MinesBetRef"
				:currency-symbol="betInputCurrencySymbolResolved"
				:currency-coin="betInputCurrencyCoinResolved"
				:wallet-snapshot-left-img-url="betInputWalletSnapshotLeftImgUrl"
				:isQuicklyBetBtn="!disable" @change="inputChange"></BetInput>

		</div>
		<div class="diceInputContent">
			<p class="label">{{ $t("fairness.form.mines") }}</p>
			<GameStep :min="1" :max="stepMax" :step="1" @update:step="stepValueChange" :disabled="disable"
				ref="minesStepRef" :defaultValue="minesCommonSet.bombNumber"></GameStep>
			<div v-if="predictrewards && props.auto" class="predictRewards Cy_font_Regular">

				<span class="predictRewards-text1">{{ $t("game.mines.cash_out_amount") }}:</span>

				<img :src="minesPredictDisplayImg" alt="" />

				<span class="predictRewards-text1 predictRewards-text2 Cy_font_Medium">
					{{ minesPredictDisplaySymbol }}
				</span>

				<span class="predictRewards-text1 predictRewards-text2 predictRewards-text3 Cy_font_Regular">
					{{ minesPredictRewardsFormatted }}
				</span>
			</div>
		</div>
	</div>
</template>

<script setup lang="ts">
import { computed } from "vue"
import { useI18n } from "vue-i18n"
import {
	betAmount,
	predictrewards,
	changeBombSize,
	disable,
	minesCommonSet,
	inputChange,
	getStepMax,
	getMinesMoneyDecimalPlaces,
	userBetInfo,
	InGame,
	minesUiWalletSnapshot,
	minesBetInputLockedSnapshot,
	minesSnapshotDisplayImg,
	minesSnapshotDisplaySymbol,
	minesBetCoinCodeFromBetInfoRecord,
	minesBetCoinImgUrlFromCode,
	minesBetResolvedKindFromBetInfo,
	minesFiatBetLeftImgUrlFromCode,
	minesRoundCurrencyFreeze,
	minesBetFiatIsoFromBetInfoRecord,
	resolveWalletCoinCodeForSnapshot,
} from "../composables/useMinesState"
import { formatPoint } from "~/utils/ts/formatPoint"
import { getDefailtImg, getDefailtSymbol, userInfo, getFiatDisplaySymbolByCode } from "~/utils/hook/hook"
import GameStep from "~/components/GameStep/GameStep.vue"
import BetInput from "~/components/CommonInput/BetInput.vue"
const props = defineProps(["auto"])
const { t: $t } = useI18n()
const stepMax = computed(() => getStepMax())
function strField(v: unknown): string {
	return typeof v === "string" ? v.trim() : ""
}

const minesUserBetInfoHasKeys = () => {
	const info = userBetInfo.value
	return !!(info && typeof info === "object" && !Array.isArray(info) && Object.keys(info as object).length > 0)
}

/**
 * `getBetInfo`：法币用 `faitType` → 符号等。
 * 在局或有本局 `userBetInfo`：冻结 / 快照与接口一致。
 * **空闲且无本局信息**：直接跟顶栏 `userInfo`（勿再读 `minesBetInputLockedSnapshot` / `minesUiWalletSnapshot`），避免结算后换法币仍显示上一局的 `$`。
 */
const betInputCurrencySymbolResolved = computed(() => {
	const inGame = InGame.value
	const hasInfo = minesUserBetInfoHasKeys()

	if (inGame || hasInfo) {
		const fz = minesRoundCurrencyFreeze.value
		if (fz?.kind === "FAIT") {
			const p = String(fz.fiatDisplayPrefix ?? "").trim()
			if (p) return p
			if (fz.fiatCode) return getFiatDisplaySymbolByCode(fz.fiatCode)
		}
		const info = userBetInfo.value as Record<string, unknown>
		if (hasInfo) {
			if (minesBetResolvedKindFromBetInfo(info) !== "FAIT") return ""
			const fiat = minesBetFiatIsoFromBetInfoRecord(info)
			if (fiat) return getFiatDisplaySymbolByCode(fiat)
			return strField(info.symbol)
		}
		const locked = minesBetInputLockedSnapshot.value
		if (locked?.currencyType === "FAIT" && locked.fiatSymbol) return locked.fiatSymbol
		const snap = minesUiWalletSnapshot.value
		if (!snap || snap.currencyType !== "FAIT") return ""
		return snap.fiatSymbol
	}

	const u = userInfo.value
	if (u?.currencyType === "FAIT") {
		const code = String(u.selectedBalanceType ?? "").trim()
		if (code) return getFiatDisplaySymbolByCode(code)
		return String(getDefailtSymbol.value ?? "").trim()
	}
	return ""
})

const betInputCurrencyCoinResolved = computed(() => {
	const inGame = InGame.value
	const hasInfo = minesUserBetInfoHasKeys()

	if (inGame || hasInfo) {
		const fz = minesRoundCurrencyFreeze.value
		if (fz?.kind === "FAIT") return ""
		if (fz?.kind === "COIN" && fz.coinCode) return fz.coinCode
		const info = userBetInfo.value as Record<string, unknown>
		if (hasInfo) {
			if (minesBetResolvedKindFromBetInfo(info) !== "COIN") return ""
			return minesBetCoinCodeFromBetInfoRecord(info)
		}
		const locked = minesBetInputLockedSnapshot.value
		if (locked?.currencyType === "COIN" && locked.coinCode) return locked.coinCode
		const snap = minesUiWalletSnapshot.value
		if (!snap || snap.currencyType !== "COIN") return ""
		return snap.coinCode
	}

	if (userInfo.value?.currencyType === "COIN") {
		return resolveWalletCoinCodeForSnapshot()
	}
	return ""
})

/**
 * 优先 `minesRoundCurrencyFreeze.leftImgUrl`（下注/恢复在局瞬间已冻结，避免与 `userBetInfo` 不同帧）。
 * 法币面额局：左侧为扣款链币种图（如 BTC），非法币旗标；纯虚拟币局传币种图。
 */
const betInputWalletSnapshotLeftImgUrl = computed(() => {
	const inGame = InGame.value
	const hasInfo = minesUserBetInfoHasKeys()

	if (inGame || hasInfo) {
		const fz = minesRoundCurrencyFreeze.value
		if (fz && String(fz.leftImgUrl ?? "").trim() !== "") return fz.leftImgUrl

		const info = userBetInfo.value as Record<string, unknown>
		if (hasInfo) {
			if (minesBetResolvedKindFromBetInfo(info) === "COIN") {
				const code = minesBetCoinCodeFromBetInfoRecord(info)
				if (code) return minesBetCoinImgUrlFromCode(code)
				return ""
			}
			if (minesBetResolvedKindFromBetInfo(info) === "FAIT") {
				const rail = strField(info.accountType) || strField(info.coinSymbol)
				if (rail) return minesBetCoinImgUrlFromCode(rail)
				const fiat = minesBetFiatIsoFromBetInfoRecord(info)
				return fiat ? minesFiatBetLeftImgUrlFromCode(fiat) : String(getDefailtImg.value ?? "").trim()
			}
			return ""
		}
		const locked = minesBetInputLockedSnapshot.value
		if (locked?.currencyType === "COIN" && locked.leftImgUrl) return locked.leftImgUrl
		if (locked?.currencyType === "FAIT" && locked.leftImgUrl) return locked.leftImgUrl
		const snap = minesUiWalletSnapshot.value
		if (!snap || snap.currencyType !== "FAIT") return ""
		return snap.leftImgUrl
	}

	return String(getDefailtImg.value ?? "").trim()
})

/** 自动 Tab 预估派彩行：空闲时与顶栏一致，避免结算换币后仍显示旧快照 */
const minesPredictDisplaySymbol = computed(() => {
	if (!InGame.value && !minesUserBetInfoHasKeys() && userInfo.value?.currencyType === "FAIT") {
		const code = String(userInfo.value.selectedBalanceType ?? "").trim()
		if (code) return getFiatDisplaySymbolByCode(code)
		return String(getDefailtSymbol.value ?? "").trim()
	}
	return minesSnapshotDisplaySymbol.value
})

const minesPredictDisplayImg = computed(() => {
	if (!InGame.value && !minesUserBetInfoHasKeys()) {
		return String(getDefailtImg.value ?? "").trim()
	}
	return minesSnapshotDisplayImg.value
})

/** 自动 Tab 预估派彩：法币 2 位、虚拟币 6 位 */
const minesPredictRewardsFormatted = computed(() => {
	const v = predictrewards.value
	const n = Number(v)
	if (!Number.isFinite(n) || n === 0) return "--"
	const dp = getMinesMoneyDecimalPlaces()
	return formatPoint(n, dp) ?? (dp === 2 ? "0.00" : "0.000000")
})

const stepValueChange = (step: number) => {
	changeBombSize(step)
}
</script>
<style scoped lang="scss">
.predictRewards {
	display: flex;
	align-items: center;
	margin-top: 10px;

	.predictRewards-text1 {
		color: #456c99;
		text-align: center;
		font-size: 12px;
		font-style: normal;
		font-weight: 400;
		line-height: 14px;
		/* 116.667% */
	}

	img {
		width: 16px;
		height: 16px;
		border-radius: 50%;
		margin-left: 13px;
	}

	.predictRewards-text2 {
		color: #20ce2e;
		margin-left: 6px;
	}

	.predictRewards-text3 {
		margin-left: 5px;
	}
}

.diceInputContent {
	.label {
		color: #94a1ba !important;
	}
}
</style>
