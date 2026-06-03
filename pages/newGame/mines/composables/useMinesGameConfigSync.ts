import { effectScope, watch } from 'vue'
import { useGameConfigStore } from '~/stores/gameConfig'
import { GAME_CODE } from '~/pages/newGame/common/composables/newGameCodes'

/**
 * Manual / Auto 两侧都曾各自调用本函数，会对 **整棵** `store.gameConfig` 各挂一个 `deep` watch，
 * 任意游戏配置抖动会触发 **双倍** `apply`（iOS 主线程上更明显）。此处整页只注册一次。
 */
let minesGameConfigDeepWatchRegistered = false
let latestMinesGameConfigApply: ((config: unknown) => void) | null = null

function minesConfigSignature(config: unknown): string {
  if (!config || typeof config !== 'object') return ''
  const minesConfig = (config as Record<string, unknown>)[GAME_CODE.MINES]
  if (!minesConfig || typeof minesConfig !== 'object') return ''
  const c = minesConfig as Record<string, unknown>
  return [
    c.bet,
    c.speed,
    c.defaultNum,
    c.defaultRows,
    c.maxBetAmount,
  ].join('|')
}

/** store 从「未就绪」变为对象或后续更新时应用 Mines 配置（避免挂载时 gameConfig 仍为 false） */
export function useMinesGameConfigSync(apply: (config: unknown) => void) {
  const store = useGameConfigStore()
  latestMinesGameConfigApply = apply
  if (minesGameConfigDeepWatchRegistered) {
    if (store.gameConfig && typeof store.gameConfig === 'object') apply(store.gameConfig)
    return
  }
  minesGameConfigDeepWatchRegistered = true
  effectScope(true).run(() => {
    watch(
      () => minesConfigSignature(store.gameConfig),
      (v) => {
        if (v && store.gameConfig && typeof store.gameConfig === 'object') {
          latestMinesGameConfigApply?.(store.gameConfig)
        }
      },
      { immediate: true }
    )
  })
}
