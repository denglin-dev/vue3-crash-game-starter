<template>
	<div class="plinkoBox">
		<SeoBody />
		<GameTemplate :game-id="GAME_CODE.PLINKO" :table-bet-amount="reqData.bet">
			<template #gameControl>
				<TabBar v-model="tabbarActive" :tabbar-data="tabbarData" type="tabTag"
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
				<div class="gameCanvasBox">
					<ClientOnly>
						<PlinkoIndex class="PlinkoGameIndex2" />
					</ClientOnly>
				</div>
			</template>
		</GameTemplate>
	</div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { loginStatus } from '~/utils/hook/hook'
import { useGameConfigStore } from '~/stores/gameConfig'
import { useGameSeo } from '~/pages/newGame/common/composables/useGameSeo'
import {
	useGameRuleAsyncData,
	useRuleBackendGameIdFromRoute
} from '~/pages/newGame/common/composables/useGameRuleAsyncData'
import { usePlinkoGame } from '~/pages/newGame/plinko/composables/usePlinkoGame'
import { plinkoAutoBetData } from '~/pages/newGame/plinko/composables/usePlinkoAutoBet'

import GameTemplate from '~/components/GameTemplate/GameTemplate.vue'
import TabBar from '~/components/GameComponents/TabBar.vue'
import ManualComponent from '~/pages/newGame/plinko/components/ManualComponent.vue'
import AutoComponent from '~/pages/newGame/plinko/components/AutoComponent.vue'
import PlinkoIndex from '~/pages/newGame/plinko/components/PlinkoIndex.vue'
import SeoBody from '~/pages/newGame/plinko/components/SeoBody.vue'
import { GAME_CODE } from '~/pages/newGame/common/composables/newGameCodes'
import { useStopNewGameAutoBetOnWalletChange } from '~/pages/newGame/common/composables/useStopNewGameAutoBetOnWalletChange'

const GAME_ID = GAME_CODE.PLINKO
const { t: $t } = useI18n()

const ruleBackendGameId = useRuleBackendGameIdFromRoute()
useGameRuleAsyncData(ruleBackendGameId)

const gameConfigStore = useGameConfigStore()
const gameConfig = computed(() => gameConfigStore.gameConfig?.[GAME_ID])
const gameConfigSignature = computed(() => {
	const c = gameConfig.value
	if (!c) return ''
	return [
		c.bet,
		c.defaultNum,
		c.defaultRows,
		c.speed,
		c.gameCode,
		c.gameId,
		c.maxBetAmount,
	].join('|')
})
const { reqData, isFastGamePlinko, toGameFast, CyGameConfigSetData, initPlinkoEvents, cleanupPlinko, handleStopBet } =
	usePlinkoGame()

if (import.meta.client) {
	useStopNewGameAutoBetOnWalletChange(
		() => plinkoAutoBetData.start,
		() => handleStopBet(),
	)
}

const tabbarActive = ref(0)
const tabbarData = ref([
	{ label: $t('game.tabs.manual'), value: 'Manual' },
	{ label: $t('game.tabs.auto'), value: 'Auto' }
])

/** 小球下落/单局进行中、或自动连投：禁止切换 Tab */
const tabbarChangeLocked = computed(() => reqData.isStart || plinkoAutoBetData.start)

const { setSeoMeta } = useGameSeo({
	id: GAME_ID,
	name: 'Plinko',
	description:
		'Experience the excitement of Plinko, a classic arcade-style and provably fair online casino game on Cybet.',
	keywords: ['Plinko game', 'Crypto Plinko', 'Provably Fair', 'online casino game', 'cryptocurrency game'],
	image: 'https://dk5un8wzg63bl.cloudfront.net/imgs/4b44b174cad640a6bfa90a99f8b3bbe0.jpeg',
	minPrice: 0.00001,
	maxPrice: 1.2
})

setSeoMeta(
	'Plinko Game Online - Play Plinko Game Online with CYBET CRYPTO CASINO',
	'Play plinko game online at CYBET CRYPTO CASINO. Enjoy multiplayer modes, virtual betting, and exciting rewards.'
)

onMounted(() => {
	initPlinkoEvents()
	CyGameConfigSetData()
})

onUnmounted(() => {
	cleanupPlinko()
})

/** Plinko 单例（含 reqData.isStart）：留在本页登出须 cleanup，否则 Tab 切换等仍锁在上一会话 */
if (import.meta.client) {
	watch(
		() => loginStatus.value,
		(loggedIn, wasLoggedIn) => {
			if (loggedIn === wasLoggedIn) return
			if (!loggedIn) {
				cleanupPlinko()
			} else if (wasLoggedIn === false) {
				initPlinkoEvents()
				CyGameConfigSetData()
			}
		}
	)
}

watch(
	() => gameConfigSignature.value,
	(signature) => {
		if (!signature) return
		CyGameConfigSetData()
	}
)

watch(
	() => gameConfigStore.isFastGame,
	(newVal) => {
		isFastGamePlinko.value = newVal
		toGameFast()
	}
)
</script>

<style lang="scss">
@use '~/pages/newGame/common/styles/game-common.scss';

.gameCanvasBox {
	position: relative;
	height: 100%;
	overflow: hidden;

	.PlinkoGameIndex2 {
		height: 100%;
	}
}
</style>
