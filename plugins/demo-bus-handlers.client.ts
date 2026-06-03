import { bus } from '~/utils/bus'
import { MessageService } from '~/utils/MessageService'

/**
 * Demo：无登录/公平性弹窗时，避免 bus.emit 无监听器；历史列表点击给出提示。
 */
export default defineNuxtPlugin(() => {
  bus.on('openGlobalDialog', (payload: { type?: string; betId?: string }) => {
    if (payload?.type === 'FairnessDetail') {
      MessageService.info(
        payload.betId
          ? `Demo fairness — bet ${payload.betId}`
          : 'Demo fairness detail (no backend)',
      )
      return
    }
    if (payload?.type === 'Login') {
      MessageService.info('Demo mode: already logged in')
    }
  })
})
