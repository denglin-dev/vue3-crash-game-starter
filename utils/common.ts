/** Demo subset — only helpers used by game modules */

export const floorToDecimal = (num: number, decimals: number = 2, divisor: number = 1): number => {
  const factor = Math.pow(10, decimals)
  return Math.floor((num * factor) / divisor) / factor
}

export function formatNumberWithCommas(num: number): string {
  const number = Number(num)
  if (!Number.isFinite(number)) return String(number)
  const parts = number.toFixed(2).split('.')
  const intPart = parts[0] ?? '0'
  const decPart = (parts[1] ?? '00').padStart(2, '0').slice(0, 2)
  const sign = number < 0 ? '-' : ''
  const absInt = intPart.replace(/^-/, '')
  const withComma = absInt.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${sign}${withComma}.${decPart}`
}

export const scrollToTop = () => {
  if (import.meta.client) window.scrollTo(0, 0)
}

export const scrollToTopSmooth = () => {
  if (import.meta.client) window.scrollTo({ top: 0, behavior: 'smooth' })
}

export const debounce = (func: (...args: unknown[]) => void, wait = 300) => {
  let timeout: ReturnType<typeof setTimeout>
  return (...args: unknown[]) => {
    clearTimeout(timeout)
    timeout = setTimeout(() => func(...args), wait)
  }
}

export const encodeProductId = (originalId: string) => originalId
