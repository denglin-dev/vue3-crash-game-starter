/**
 * Demo stub — replaces production wallet/auth hook for GitHub showcase.
 * API shape aligned with cy_client_nuxt3 (arrays + computed wallet display).
 */
import { computed, ref } from 'vue'
import { deviceAdvanced } from '~/composables/useDeviceAdvanced'
import { useGameConfigStore } from '~/stores/gameConfig'
import { resolveGameCodeForCurrentPage } from '~/pages/newGame/common/composables/newGameCodes'

export { deviceAdvanced }

export type DemoCoinRow = { coin: string; imgUrl: string }
export type DemoFiatRow = { fiat: string; symbol: string; imgUrl?: string }

const DEMO_COINS: DemoCoinRow[] = [
  { coin: 'USDT', imgUrl: '/img/monyimg/USDT.svg' },
  { coin: 'BTC', imgUrl: '/img/monyimg/BTC.svg' },
  { coin: 'ETH', imgUrl: '/img/monyimg/ETH.svg' },
  { coin: 'BNB', imgUrl: '/img/monyimg/BNB.svg' },
  { coin: 'SOL', imgUrl: '/img/monyimg/SOL.svg' },
  { coin: 'DOGE', imgUrl: '/img/monyimg/DOGE.svg' },
  { coin: 'XRP', imgUrl: '/img/monyimg/XRP.svg' },
  { coin: 'TRX', imgUrl: '/img/monyimg/TRX.svg' },
]

const DEMO_FIATS: DemoFiatRow[] = [
  { fiat: 'USD', symbol: '$' },
]

export const loginStatus = ref(true)

export const userInfo = ref({
  id: 'demo-user',
  userName: 'DemoPlayer',
  currencyType: 'COIN' as 'COIN' | 'FAIT',
  amountType: 'USDT',
  selectedCoinType: 'USDT',
  selectedBonusCoinType: 'USDT',
  selectedBalanceType: 'USDT',
  balance: { USDT: '10000' },
  allBalance: { USDT: '10000' },
  coinRate: { USDT: 1 },
  imgUrl: '/img/monyimg/USDT.svg',
})

/** 与线上一致：虚拟币列表（allCoins），供 BetInput / Mines 等 `.find` */
export const coinType = ref<DemoCoinRow[]>([...DEMO_COINS])
/** 与线上一致：法币列表（faits） */
export const legalType = ref<DemoFiatRow[]>([...DEMO_FIATS])

export const userInfoCurrencyTypeisFait = computed(() => userInfo.value.currencyType === 'FAIT')

export const getMyInfoRoundDoneForWalletUi = ref(true)

export const rateData = ref<Record<string, number>>({ USDT: 1 })

export function isUserWalletBalanceUiReady() {
  return true
}

export function getUserBalanceMax() {
  const code = userInfo.value.amountType || 'USDT'
  const raw = userInfo.value.allBalance?.[code] ?? userInfo.value.balance?.[code] ?? '10000'
  return Number(raw) || 10000
}

export function setRegalRate(amount: number) {
  return Number.isFinite(amount) ? amount : 0
}

export const getDefailtImg = computed(() => {
  const list = coinType.value
  if (!Array.isArray(list) || list.length === 0) return '/img/monyimg/USDT.svg'

  let coin = userInfo.value.amountType || 'USDT'
  if (userInfo.value.amountType === 'BONUS' && coin) {
    coin = `${coin}.b`
  }

  const row = list.find((item) => item.coin === coin)
  return row?.imgUrl || `/img/monyimg/${coin}.svg`
})

export const getDefailtSymbol = computed(() => {
  if (userInfo.value.currencyType === 'COIN' && loginStatus.value) return ''
  if (userInfo.value.selectedBalanceType && legalType.value.length > 0) {
    const row = legalType.value.find(
      (item) => item.fiat === userInfo.value.selectedBalanceType,
    )
    if (row) {
      if (!loginStatus.value) return '$'
      return row.symbol || '$'
    }
    return '$'
  }
  return '$'
})

export function getFiatDisplaySymbolByCode(fiatCode?: string | null): string {
  const code = typeof fiatCode === 'string' ? fiatCode.trim().toUpperCase() : ''
  if (!code) return '$'
  const list = legalType.value
  if (!Array.isArray(list) || list.length === 0) return code === 'USD' ? '$' : code
  const row = list.find((item) => item?.fiat && String(item.fiat).toUpperCase() === code)
  if (!row) return code === 'USD' ? '$' : code
  if (!loginStatus.value) return '$'
  const sym = row.symbol
  return sym != null && String(sym).length > 0 ? String(sym) : '$'
}

export function accuracyNumber(n: number, digits = 2) {
  if (!Number.isFinite(n)) return '0'
  return n.toFixed(digits)
}

export function newVictural(val: number | string) {
  return String(val)
}

export function gameIdGetConfig() {
  const store = useGameConfigStore()
  if (store.gameConfig === false || store.gameConfig == null) return undefined
  const code = resolveGameCodeForCurrentPage()
  if (!code) return undefined
  return (store.gameConfig as Record<string, unknown>)[code] as Record<string, unknown> | undefined
}
