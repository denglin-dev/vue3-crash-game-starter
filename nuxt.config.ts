export default defineNuxtConfig({
  compatibilityDate: '2024-11-01',
  devtools: { enabled: true },
  modules: ['@pinia/nuxt'],
  css: ['~/public/style/public.scss', '~/assets/css/main.scss'],
  imports: {
    imports: [{ name: 'bus', from: '~/utils/bus' }],
  },
  build: {
    transpile: ['decimal.js-light'],
  },
  hooks: {
    'pages:extend'(pages) {
      for (let i = pages.length - 1; i >= 0; i--) {
        const file = pages[i]?.file || ''
        if (!file.endsWith('.vue')) pages.splice(i, 1)
      }
    },
  },
  vite: {
    css: {
      preprocessorOptions: {
        scss: {
          additionalData: ''
        }
      }
    }
  },
  app: {
    head: {
      title: 'Cy Games Demo',
      meta: [
        { name: 'description', content: 'Mines, Plinko & Crash — Nuxt 3 demo with mock data hooks' }
      ]
    }
  }
})
