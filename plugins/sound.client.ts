import type { Directive } from 'vue'
import { useGame } from '~/composables/GameHook'
import { playClickSoundOnce, warmupClickSound } from '~/utils/sound/clickSound'
import { notifyCrashBoomPoolUserGestureIfRegistered } from '~/utils/sound/crashBoomGestureBridge'

export default defineNuxtPlugin((nuxtApp) => {
  const { soundState } = useGame()
  if (import.meta.client) warmupClickSound()

  const soundDirective: Directive = {
    mounted(el: HTMLElement) {
      const playSound = () => {
        if (!soundState.isClickSoundEnabled) return
        notifyCrashBoomPoolUserGestureIfRegistered()
        playClickSoundOnce()
      }

      el.addEventListener('pointerdown', playSound, { capture: true })
      el.addEventListener('click', playSound, { capture: true })

      ;(el as HTMLElement & { _soundCleanup?: () => void })._soundCleanup = () => {
        el.removeEventListener('pointerdown', playSound, { capture: true })
        el.removeEventListener('click', playSound, { capture: true })
      }
    },
    unmounted(el: HTMLElement) {
      ;(el as HTMLElement & { _soundCleanup?: () => void })._soundCleanup?.()
    },
  }

  nuxtApp.vueApp.directive('sound', soundDirective)
})
