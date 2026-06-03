export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.directive('throttle', {
    mounted(el, binding) {
      const delay = parseInt(binding.arg as string) || 1000
      const callback = binding.value

      if (typeof callback !== 'function') {
        throw new Error('v-throttle directive requires a function as value')
      }

      let lastExecTime = 0
      let timeoutId: ReturnType<typeof setTimeout> | null = null

      const handler = function (this: unknown, ...args: unknown[]) {
        const now = Date.now()
        const remaining = delay - (now - lastExecTime)

        if (remaining <= 0) {
          lastExecTime = now
          callback.apply(this, args)
        } else if (!timeoutId) {
          timeoutId = setTimeout(() => {
            lastExecTime = Date.now()
            timeoutId = null
            callback.apply(this, args)
          }, remaining)
        }
      }

      ;(el as HTMLElement & { _throttleHandler?: typeof handler })._throttleHandler = handler
      el.addEventListener('click', handler)
    },
    unmounted(el) {
      const handler = (el as HTMLElement & { _throttleHandler?: (ev: Event) => void })._throttleHandler
      if (handler) {
        el.removeEventListener('click', handler)
        ;(el as HTMLElement & { _throttleHandler?: unknown })._throttleHandler = undefined
      }
    },
  })
})
