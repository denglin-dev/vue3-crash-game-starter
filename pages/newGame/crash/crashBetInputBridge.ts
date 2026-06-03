import { shallowRef } from 'vue'
import type { BetAmountInputExpose } from '../common/betAmountSubmitGuard'

/** 当前 Crash 经典手动/自动区的赌注 `BetInput`，供 BetButton 与 `useCrashBet` 拦截 */
export const crashBetAmountInputExpose = shallowRef<BetAmountInputExpose>(null)
