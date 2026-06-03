<template>
  <div class="crashBox">
    <GameTemplate :game-id="GAME_CODE.CRASH" :table-bet-amount="betAmount">
      <template #gameControl>
        <!-- SEO 内容 -->
        <CrashSeoContent />
        <ClassicIndex />
      </template>
      <template #gameCanvas>
        <GameComponent />
      </template>
    </GameTemplate>
  </div>
</template>

<script setup lang="ts">
/**
 * Crash 新游戏页入口：
 * - 注册壳层全局回调、应用商店配置；
 * - 客户端启动/停止 WS 单例（经典主链路）；
 * - 卸载时清理本地公平缓存与 composable 状态。
 */
import { onMounted, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGameConfigStore } from '~/stores/gameConfig'
import Storage from '~/utils/ts/storage'
import { loginStatus } from '~/utils/hook/hook'
import { useCrashBet } from '~/pages/newGame/crash/composables/useCrashBet'
import { betAmount } from '~/pages/newGame/crash/composables/useCrashState'
import { useGameSeo } from '~/pages/newGame/common/composables/useGameSeo'
import {
  useGameRuleAsyncData,
  useRuleBackendGameIdFromRoute
} from '~/pages/newGame/common/composables/useGameRuleAsyncData'
import GameTemplate from '~/components/GameTemplate/GameTemplate.vue'
import ClassicIndex from './components/ClassicIndex.vue'
import GameComponent from './components/GameComponent.vue'
import CrashSeoContent from './components/SeoBody.vue'
import { GAME_CODE } from '~/pages/newGame/common/composables/newGameCodes'
import { useStopNewGameAutoBetOnWalletChange } from '~/pages/newGame/common/composables/useStopNewGameAutoBetOnWalletChange'
import { exitAutoGame } from '~/pages/newGame/crash/composables/useCrashBet'
import { isStart } from '~/pages/newGame/crash/composables/useCrashState'
import {
  isCrashWsControllerStarted,
  restartCrashWsController,
  startCrashWsController,
  stopCrashWsController
} from './ws/crashWsController'

const GAME_ID = GAME_CODE.CRASH
const router = useRouter()

const ruleBackendGameId = useRuleBackendGameIdFromRoute()
useGameRuleAsyncData(ruleBackendGameId)

const { CyGameConfigSetData, initCrashGame, initCrashData } = useCrashBet(useI18n())
const gameConfigStore = useGameConfigStore()

if (import.meta.client) {
  useStopNewGameAutoBetOnWalletChange(
    () => isStart.value,
    () => exitAutoGame(),
  )
}

const { setSeoMeta } = useGameSeo({
  id: GAME_ID,
  name: 'Crash',
  description: 'Play Crash, a thrilling and provably fair online casino game hosted on Cybet. This game has been independently tested and certified for fairness, offering a secure crypto gaming experience.',
  keywords: [
    'Crash game',
    'Provably Fair',
    'online casino game',
    'cryptocurrency game',
    'crypto casino',
    'Cybet Crash',
    'online betting game'
  ],
  image: 'https://dk5un8wzg63bl.cloudfront.net/imgs/d7ee663015b949e1a04a358302cd695d.jpeg',
  minPrice: 0.00001,
  maxPrice: 1.0
})

setSeoMeta(
  'Best Crash Gambling & Casino Games - Play Crash Casino Game | CYBET ORIGINAL - Bitcoin Crash Games - Bet the Multiplier to Win',
  'Play exciting crash casino games and WIN BIG at CYBET CASINO. Enjoy fair crypto betting, slots, and live casino with the best casino strategy for the top online gaming experience.'
)

/**
 * 登录/登出：WS 握手 URL 变化需 restart；单例状态须在留在本页登出时 reset，否则换号仍像上一局在飞/已下注。
 */
if (import.meta.client) {
  watch(loginStatus, (loggedIn, prev) => {
    if (prev === undefined) return
    if (loggedIn === prev) return
    if (!loggedIn) {
      initCrashData()
    } else if (prev === false) {
      initCrashGame()
    }
    if (isCrashWsControllerStarted()) restartCrashWsController()
  })
}

onMounted(() => {
  initCrashGame()
  CyGameConfigSetData()

  if (import.meta.client) startCrashWsController()
})

/** 与 Limbo 一致：store 中 Crash 规则晚于首帧合并时再同步一次；`applyGameConfig` 在本局已下注或自动策略进行中时不覆盖金额/倍数 */
if (import.meta.client) {
  watch(
    () => gameConfigStore.gameConfig,
    (cfg) => {
      if (cfg === false || cfg == null || typeof cfg !== 'object') return
      if (!(String(GAME_ID) in cfg)) return
      CyGameConfigSetData()
    },
    { deep: true }
  )
}

onUnmounted(() => {
  if (import.meta.client) stopCrashWsController()
  initCrashData()
  Storage.removeItem('gameFair')
})
</script>

<style lang="scss">
@use '~/pages/newGame/common/styles/game-common.scss';

.crashBox {
  .crashTabbar {
    @media screen and (max-width: 768px) {
      background: #111933;
      border-radius: 10px;
    }
  }

  .mt15 {
    margin-top: 15px;
  }
}

.crashRight {
  max-height: 500px;
}

.crashBox .crashLeft {
  /* 与左右 10px 对称，避免下注表区域贴底（与星标/底部栏过近） */
  padding: 0 10px 10px !important;

  @media (max-width: 768px) {
    padding: unset !important;
  }
}
</style>
