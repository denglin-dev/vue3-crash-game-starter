export default defineNuxtPlugin(() => {
  const api = {
    error(msg: string) {
      console.warn('[Message]', msg)
    },
    success(msg: string) {
      console.info('[Message]', msg)
    },
    warning(msg: string) {
      console.warn('[Message]', msg)
    },
    info(msg: string) {
      console.info('[Message]', msg)
    },
  }
  return {
    provide: {
      MessageService: api,
    },
  }
})
