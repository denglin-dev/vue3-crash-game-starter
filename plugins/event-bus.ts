import { bus } from '~/utils/bus'

/** 全局事件总线：与线上一致，组件内可直接 `bus.emit` */
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.provide('bus', bus)
})
