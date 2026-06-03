import type { Directive } from 'vue'

/** 服务端注册自定义指令占位，避免 SSR 时 getSSRProps 报错 */
const ssrDirectiveStub: Directive = {
  getSSRProps() {
    return {}
  },
}

const SSR_DIRECTIVE_NAMES = ['sound', 'throttle', 'cyLoading', 'track', 'cy-loading'] as const

export default defineNuxtPlugin((nuxtApp) => {
  for (const name of SSR_DIRECTIVE_NAMES) {
    nuxtApp.vueApp.directive(name, ssrDirectiveStub)
  }
})
