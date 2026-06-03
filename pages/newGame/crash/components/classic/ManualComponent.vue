<template>
  <div class="classicContent" key="tab-0">
    <div class="classicContent-top">
      <div class="from">
        <div class="inputContent">
          <p class="label">{{ $t('game.form.betAmount') }}</p>
          <BetInput v-model="betAmount" :disabled="isBetting" :isQuicklyBetBtn="!isBetting" ref="refIpt" />
        </div>
        <div class="inputContent">
          <p class="label">{{ $t('game.form.autoCashout') }}</p>
          <CommonInput v-model="multiplier" @blur="handleBlur" type="xInput" input-value-type="number"
            :isClickX="!isBetting" :disabled="isBetting" :isShowLabel="false"
            :maxlength="CRASH_MULTIPLIER_INPUT_MAX_LENGTH" :decimalLength="2" />
        </div>
      </div>
      <div class="submit">
        <PayoutIndex :value="classicMoney" class="classicManualPayout" v-if="classicMoney"
          :ambient-spin="deviceAdvanced !== 'mobile'" />
        <BetButton :name="btnTxt" @checkSubmit="handleCheckSubmit" :data="reqData" :disabled="!gameRuleReady" />
      </div>
    </div>
    <TotalBetComponent :tableTitle="tableTitle" />
  </div>
</template>

<script setup lang="ts">
/**
 * 经典 — 手动：金额/自动兑现倍数 + 主按钮（BetButton）+ 下方实时下注表。
 * 主按钮音效由 `BetButton` 内部手动控制；飞行中错峰播放，避免与 Pixi 曲线/火箭同帧抢主线程。
 */
import { ref, computed, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import { crashBetAmountInputExpose } from '../../crashBetInputBridge'
import TotalBetComponent from '../TotalBetComponent.vue'
import CommonInput from '~/components/CommonInput/CommonInput.vue'
import BetButton from '~/pages/newGame/crash/components/BetButton.vue'
import PayoutIndex from '~/components/PayoutAnimation/PayoutIndex.vue'
import BetInput from '~/components/CommonInput/BetInput.vue'
import {
  isBetting,
  betAmount,
  multiplier,
  classicMoney,
  betButtonState,
  clampMultiplierValue,
  CRASH_MULTIPLIER_INPUT_MAX_LENGTH,
} from '../../composables/useCrashState'
import { deviceAdvanced } from '~/utils/hook/hook'
import { GAME_CODE } from '~/pages/newGame/common/composables/newGameCodes'
import { useGameRuleReady } from '~/pages/newGame/common/composables/useGameRuleAsyncData'

const { t: $t } = useI18n()
const gameRuleReady = useGameRuleReady(GAME_CODE.CRASH)

const props = withDefaults(
  defineProps<{ panelActive?: boolean }>(),
  { panelActive: true }
)

/** BetInput 实例：提交前做金额校验 */
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
/** 传入 BetButton → `handleBetButtonDown` 的当前 bet/double */
const reqData = computed(() => ({
  bet: betAmount.value,
  double: multiplier.value,
  type: 'carshsendBetReq'
}))

/** 决定 BetButton 内部模式：classic / cancel / cashout */
const btnTxt = computed(() => {
  if (betButtonState.value === 'yellow') return 'cashout'
  if (betButtonState.value === 'red') return 'cancel'
  return 'classic'
})

// 下注校验
const handleCheckSubmit = () => {
  if (!gameRuleReady.value) return
  refIpt.value?.checkedinputFail()
}

/** 自动兑现倍数边界：下限为配置 multiple，上限为 `DEFAULT_MULTIPLIER_MAX`（固定，不读 cashOut） */
const handleBlur = (value: string) => {
  multiplier.value = clampMultiplierValue(Number(value))
}
</script>

<style lang="scss" scoped>
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

  :deep(.bettingStatistics) {
    flex: 1 1 0%;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  @media screen and (max-width: 768px) {
    height: unset;
    min-height: unset;
    display: block;

    :deep(.bettingStatistics) {
      flex: unset;
      min-height: unset;
      display: block;
    }
  }
}

.moneyNotEnough {
  color: #ffba53;
  font-size: 12px;
  margin-top: 10px;
}

.inputContent {
  .label {
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

.mb-15 {
  margin-bottom: 15px;
}
</style>
