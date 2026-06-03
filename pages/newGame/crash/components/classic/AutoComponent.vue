<template>
  <div class="classicContent" key="tab-1">
    <div class="classicContent-top">
      <div class="from">
        <div class="inputContent" v-if="!isStart">
          <p class="label">{{ $t('game.form.betAmount') }}</p>
          <BetInput v-model="betAmount" ref="refIpt" />
        </div>
        <template v-if="isStart">
          <div class="inputContent" :class="{ inlineBlock: deviceAdvanced === 'mobile' }">
            <p class="label">{{ $t('game.form.basicBetAmount') }}</p>
            <CommonInput v-model="autoBetData.startMoney" :disabled="true" :isShowLabel="false" />
          </div>
          <div class="inputContent" :class="{ inlineBlock: deviceAdvanced === 'mobile' }">
            <p class="label">{{ $t('game.form.currentBetAmount') }}</p>
            <CommonInput v-model="betAmount" :disabled="true" :isShowLabel="false"
              :decimalLength="!userInfoCurrencyTypeisFait ? 6 : 2" />
          </div>
        </template>
        <div class="inputContent">
          <p class="label">{{ $t('game.form.autoCashout') }}</p>
          <CommonInput v-model="multiplier" type="xInput" input-value-type="number" @blur="handleBlur"
            :isClickX="!isStart" :disabled="isStart" :isShowLabel="false"
            :maxlength="CRASH_MULTIPLIER_INPUT_MAX_LENGTH" :decimalLength="2" />
        </div>
        <template v-if="!isStart">
          <div class="inputContent">
            <p class="label">{{ $t('game.form.onWin') }}</p>
            <CommonInput type="selectInput" placeholder="0" @changeIptTags="handleChangeTags($event, 'win')"
              v-model="autoBetData.winCount" :tag-index="winIsReset" :isShowLabel="false" />
          </div>
          <div class="inputContent">
            <p class="label">{{ $t('game.form.onLoss') }}</p>
            <CommonInput type="selectInput" placeholder="0" @changeIptTags="handleChangeTags($event, 'loss')"
              v-model="autoBetData.lossCount" :tag-index="lossIsReset" :isShowLabel="false" />
          </div>
          <div class="inputContent">
            <p class="label">
              {{ $t('game.form.stopOnLoss') }}
              <span class="desc Cy_font_Regular">{{ $t('game.form.stopOnLossDesc') }}</span>
            </p>
            <CommonInput type="defaultInput" :isShowLabel="false" v-model="autoBetData.lossEndMoney"
              inputValueType="number" />
          </div>
        </template>
        <div class="inputContent" v-if="isStart">
          <p class="label">{{ $t('game.form.rule') }}</p>
          <div class="stopShowInfo">
            <div class="infoItem">
              <span class="label">{{ $t('game.form.victoryIncreasesByMultiple') }}</span>
              <span class="value">{{ autoBetData.winCount ? autoBetData.winCount + '%' : '--' }}</span>
            </div>
            <div class="infoItem">
              <span class="label">{{ $t('game.form.increasedFailureMultiplier') }}</span>
              <span class="value">{{ autoBetData.lossCount ? autoBetData.lossCount + '%' : '--' }}</span>
            </div>
            <div class="infoItem">
              <span class="label">{{ $t('game.form.stopOnLossShort') }}</span>
              <span class="value">{{ autoBetData.lossEndMoney ? autoBetData.lossEndMoney : '--' }}</span>
            </div>
          </div>
        </div>
      </div>
      <div class="submit">
        <PayoutIndex :value="autoBetData.winMoney" class="classicManualPayout" v-if="autoBetData.winMoney"
          :ambient-spin="deviceAdvanced !== 'mobile'" />
        <div v-if="isStart && !(autoBetData.isBet && !gameStart)" v-sound class="btn betBtn Cy_font_SemiBold red"
          @click="handleStopGame">
          {{ $t('game.buttons.stop') }}
        </div>
        <div v-if="!isStart && !autoBetData.isBet" v-sound class="btn betBtn green Cy_font_SemiBold userSelectNone"
          :class="{ gray: !gameRuleReady }" @click="handleCheckSubmit">
          {{ $t('game.buttons.start') }}
        </div>
        <div v-if="autoBetData.isBet && !gameStart && isStart" class="btn betBtn gray Cy_font_SemiBold">
          {{ $t('game.buttons.loading') }}
        </div>
      </div>
    </div>
    <div class="classicContent-auto-totalbet">
      <TotalBetComponent :tableTitle="tableTitle" />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 经典 — 自动：配置输赢比例、停损、起始金额后循环下注。
 * 按钮三态：开始（绿）/ 等待本局结束（灰）/ 停止（红，未持有注单时）。
 */
import { ref, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import { crashBetAmountInputExpose } from '../../crashBetInputBridge'
import { blockBetIfAmountInvalid } from '~/pages/newGame/common/betAmountSubmitGuard'
import TotalBetComponent from '../TotalBetComponent.vue'
import CommonInput from '~/components/CommonInput/CommonInput.vue'
import PayoutIndex from '~/components/PayoutAnimation/PayoutIndex.vue'
import BetInput from '~/components/CommonInput/BetInput.vue'
import { deviceAdvanced, userInfoCurrencyTypeisFait, loginStatus } from '~/utils/hook/hook'
import { useGame } from '~/composables/GameHook'
import {
  betAmount,
  multiplier,
  isStart,
  autoBetData,
  gameStart,
  gameState,
  clampMultiplierValue,
  CRASH_MULTIPLIER_INPUT_MAX_LENGTH,
} from '../../composables/useCrashState'
import { startAutoBet, exitAutoGame } from '../../composables/useCrashBet'
import { playClickSoundDeferred, playClickSoundOnce } from '~/utils/sound/clickSound'
import { useClickDebounce } from '~/pages/newGame/common/composables/useClickDebounce'
import { GAME_CODE } from '~/pages/newGame/common/composables/newGameCodes'
import { useGameRuleReady } from '~/pages/newGame/common/composables/useGameRuleAsyncData'

const { t: $t } = useI18n()
const { winIsReset, lossIsReset, soundState } = useGame()
const gameRuleReady = useGameRuleReady(GAME_CODE.CRASH)
const { runWithClickDebounce } = useClickDebounce(1000)

const props = withDefaults(
  defineProps<{ panelActive?: boolean }>(),
  { panelActive: true }
)

const refIpt = ref<any>(null)
watchEffect(() => {
  if (!props.panelActive) return
  crashBetAmountInputExpose.value = refIpt.value
})
const tableTitle = ref([
  $t('game.table.player'),
  $t('game.table.x'),
  $t('game.table.amount'),
  $t('game.table.win')
])

const playCrashAutoButtonSound = () => {
  if (!soundState.isClickSoundEnabled) return
  if (gameState.value === 2) playClickSoundDeferred()
  else playClickSoundOnce()
}
/** 与 useGame 的 winIsReset/lossIsReset 同步，驱动 CommonInput 标签 */
const handleChangeTags = (value: number, type: string) => {
  if (type === 'win') {
    winIsReset.value = value
  } else {
    lossIsReset.value = value
  }
}

/**
 * 与 `ManualComponent.vue` 的 `handleBlur` 一致：自动兑现倍数限制在 `clampMultiplierValue` 区间内。
 * `blur` 参数为 `CommonInput` 失焦时的字符串；未传则从当前 `multiplier` ref 解析（用于点「开始」前未失焦的场景）。
 */
const applyClassicAutoCashoutMultiplierClamp = (blurValue?: string) => {
  const n =
    blurValue !== undefined && blurValue !== null
      ? Number(blurValue)
      : typeof multiplier.value === 'string'
        ? Number(String(multiplier.value).trim())
        : Number(multiplier.value)
  multiplier.value = clampMultiplierValue(n)
}

/** 登录校验 → 余额校验 → 与手动同口径 clamp 倍数 → `startAutoBet` */
const doCheckSubmit = () => {
  if (!loginStatus.value) {
    bus.emit('openGlobalDialog', { type: 'Login' })
    return
  }
  if (!gameRuleReady.value) return
  playCrashAutoButtonSound()

  const bet = Number(betAmount.value)
  if (!Number.isFinite(bet) || bet < 0) {
    refIpt.value?.checkedinputFail()
    return
  }
  if (blockBetIfAmountInvalid(crashBetAmountInputExpose.value, bet)) return

  applyClassicAutoCashoutMultiplierClamp()
  startAutoBet()
}

const handleCheckSubmit = () => {
  runWithClickDebounce(doCheckSubmit)
}

const handleBlur = (value: string) => {
  applyClassicAutoCashoutMultiplierClamp(value)
}

/** 用户主动结束自动策略（可能仅暂停下一局，见 `exitAutoGame`） */
const doStopGame = () => {
  playCrashAutoButtonSound()
  exitAutoGame()
}

const handleStopGame = () => {
  runWithClickDebounce(doStopGame)
}
</script>

<style lang="scss" scoped>
.red {
  background: #f00;
}

.gray {
  background: #202b50 !important;
}

.moneyNotEnough {
  color: #ffba53;
  font-size: 12px;
  margin-top: 10px;
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

.stopShowInfo {
  width: 273px;
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
      font-size: 13px;
      font-style: normal;
      font-weight: 500;
    }

    .value {
      color: #fff;
      text-align: right;
      font-size: 13px;
      font-style: normal;
      font-weight: 500;
    }
  }
}

.classicContent {
  width: 100%;
  flex: 1 1 0%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  transition: all 0.3s ease;

  .classicContent-top {
    flex-shrink: 0;

    @media screen and (max-width: 768px) {
      display: flex;
      flex-direction: column-reverse;
      padding: 0 10px !important;
    }
  }

  .classicContent-auto-totalbet {
    flex: 1 1 0%;
    min-height: clamp(200px, 30vh, 480px);
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  :deep(.bettingStatistics) {
    flex: 1 1 0%;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .submit {
    margin-bottom: 8px;
  }

  @media screen and (max-width: 768px) {
    height: unset;
    min-height: unset;
    display: block;

    .classicContent-auto-totalbet {
      flex: unset;
      min-height: unset;
      display: block;
    }

    :deep(.bettingStatistics) {
      flex: unset;
      min-height: unset;
      display: block;
    }
  }
}

.inputContent {
  &.inlineBlock {
    display: inline-block;
    width: calc(50% - 7px);
  }

  &.inlineBlock:nth-child(2) {
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
