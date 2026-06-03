import type { EventBus } from '~/utils/bus'

declare module '#app' {
  interface NuxtApp {
    bus: EventBus
  }
}

declare global {
  const bus: EventBus
}

export {}
