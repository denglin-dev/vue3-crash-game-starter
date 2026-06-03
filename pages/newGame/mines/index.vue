<template>
	<div>
		<SeoBody />
		<GameTemplate :game-id="GAME_CODE.MINES" :table-bet-amount="betAmount">
			<template #gameControl>
				<TabBar ref="refTabbar" v-model="tabbarActive" :tabbar-data="tabbarData" type="tabTag"
					:tabbar-can-change="tabbarChangeLocked">
					<template #tab-0>
						<ManualComponent v-if="tabbarActive === 0" :status="false" />
					</template>
					<template #tab-1>
						<AutoComponent v-if="tabbarActive === 1" :status="false" />
					</template>
				</TabBar>
			</template>
			<template #gameCanvas>
				<MinesGameIndex style="position: relative" />
			</template>
		</GameTemplate>
	</div>
</template>

<script setup lang="ts">
import { ref, watch, onBeforeUnmount, computed } from "vue"
import { useI18n } from "vue-i18n"
import { loginStatus } from "~/utils/hook/hook"
import {
	useMinesGame,
	InGame,
	autoBetData,
	isBetAndNoRes,
	isAutoModel,
	gameContentRef,
	betAmount
} from "./composables/useMinesGame"
import {
	useGameRuleAsyncData,
	useRuleBackendGameIdFromRoute
} from "~/pages/newGame/common/composables/useGameRuleAsyncData"
import GameTemplate from "~/components/GameTemplate/GameTemplate.vue"
import SeoBody from "./components/SeoBody.vue"
import ManualComponent from "./components/ManualComponent.vue"
import AutoComponent from "./components/AutoComponent.vue"
import MinesGameIndex from "./components/MinesGameIndex.vue"
import TabBar from "~/components/GameComponents/TabBar.vue"
import { GAME_CODE } from "~/pages/newGame/common/composables/newGameCodes"
import { useStopNewGameAutoBetOnWalletChange } from "~/pages/newGame/common/composables/useStopNewGameAutoBetOnWalletChange"

const { t: $t } = useI18n()

const ruleBackendGameId = useRuleBackendGameIdFromRoute()
useGameRuleAsyncData(ruleBackendGameId)

// 使用新的 composables
const { setAutoBet, changeAutoStart, initMinesData, initGame } = useMinesGame(useI18n())

if (import.meta.client) {
	useStopNewGameAutoBetOnWalletChange(
		() => autoBetData.start,
		() => changeAutoStart(false, gameContentRef.value),
	)
}

/**
 * Mines 状态为模块单例：离开/登出不会随组件卸载。
 * 登出或换号后须清空「下注中 / 等接口」等 UI，否则仍显示上一账号的局中态。
 */
if (import.meta.client) {
	watch(
		() => loginStatus.value,
		async (loggedIn, wasLoggedIn) => {
			if (loggedIn === wasLoggedIn) return
			if (!loggedIn) {
				setAutoBet(false)
				initMinesData()
				gameContentRef.value?.initGridList(true, true)
			} else if (wasLoggedIn === false) {
				await initGame()
			}
		}
	)
}

const tabbarActive = ref(0)

const tabbarData = ref([
	{ label: $t("game.tabs.manual"), value: "Manual" },
	{ label: $t("game.tabs.auto"), value: "Auto" }
])

/** 对局中、自动扫雷、下注已点待接口：禁止切换 Tab */
const tabbarChangeLocked = computed(
	() => InGame.value || autoBetData.start || isBetAndNoRes.value
)

watch(
	() => tabbarActive.value,
	() => {
		gameContentRef.value?.initGridList()
		gameContentRef.value?.clearAutoIndex()

		isAutoModel.value = tabbarActive.value === 1
	}
)

onBeforeUnmount(() => {
	setAutoBet(false)
	isAutoModel.value = false
	initMinesData()
})

const minesSchema = {
	"@context": "https://schema.org",
	"@id": "#cybet",
	"@type": "Casino",
	name: "Cybet.com",
	alternateName: "Cybet",
	url: "https://cybet.com",
	currenciesAccepted: ["BTC", "ETH", "USDT", "SOL", "DOGE", "XRP", "TRX", "BNB"],
	paymentAccepted: ["Cryptocurrency", "Digital Wallet"],
	address: "https://schema.org/VirtualLocation",
	mainEntityOfPage: "https://cybet.com",
	logo: "https://cybet.com/img/headerLogo.0f9b7680.svg",
	description: "Cybet.com is a crypto online casino games platform.",
	sameAs: ["https://x.com/cybetcom"]
}

useHead({
	script: [
		{
			type: "application/ld+json",
			innerHTML: JSON.stringify(minesSchema)
		}
	]
})
useSeoMeta({
	title:
		"Mines Betting Game - Mines Earning, Minesweeper Crypto Games | Best Crypto Gambling - Cybet.com Crypto Casino - Mines Game Earning App - Play Online Casino Games with USDT, Bitcoin,Ethereum,XRP, DOGE, TRX, BNB, and SOL",
	description:
		"Play Mines Betting Game Today at Cybet Casino! Exciting online crypto casinos, slots and live casino games at Cybet.com. Enjoy Crash, Dice, Limbo, Plinko Games, Mines, slots games, Live Casinos, and fast withdrawals today!"
})
</script>

<style lang="scss">
@use '~/pages/newGame/common/styles/game-common.scss';
</style>
