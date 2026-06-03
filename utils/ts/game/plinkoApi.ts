/**
 * Plinko API mock — returns route + slot for canvas animation.
 */
import { getPlinkoMultipliersForRiskRow } from '~/pages/newGame/plinko/composables/usePlinkoState'
import { mockApiOk } from '~/utils/ts/game/mockApiSuccess'

function buildRoute(rows: number): number[] {
  const route: number[] = []
  for (let i = 0; i < rows; i++) {
    route.push(Math.random() > 0.5 ? 1 : 0)
  }
  return route
}

function buildPathFromRoute(route: number[], rows: number) {
  let col = 0
  const path: { row: number; column: number }[] = [{ row: 1, column: 0 }]
  for (let i = 0; i < rows - 1 && i < route.length; i++) {
    col += route[i] > 0.5 ? 1 : 0
    path.push({ row: i + 2, column: Math.min(i + 1, col) })
  }
  return path
}

export const usePlinkoApi = () => ({
  bet: async (params: Record<string, unknown>) => {
    const rows = Number(params.row ?? params.rows ?? 16)
    const risk = Number(params.risk ?? 0)
    const amountMicro = Number(params.bet ?? params.amount ?? 10000)
    const amount = amountMicro / 1e6
    const route = buildRoute(rows)
    const rightCount = route.reduce((a, v) => a + (v > 0.5 ? 1 : 0), 0)
    const slot = Math.max(0, Math.min(rows, rightCount))
    const mults = getPlinkoMultipliersForRiskRow(risk, rows)
    const mult = mults[slot] ?? 1
    const payoutMicro = Math.floor(amountMicro * mult)
    const betId = `demo-plinko-${Date.now()}`

    return mockApiOk({
      bet_id: betId,
      round_id: betId,
      row: rows,
      risk,
      route,
      slot_index: slot,
      multplier: mult,
      bet_amount: amount,
      profit: (payoutMicro - amountMicro) / 1e6,
      payout: payoutMicro,
      max_profit: payoutMicro,
      path: buildPathFromRoute(route, rows),
    })
  },

  getHistory: async () => [
    { multplier: 5.6, bet_amount: 0.01, bet_id: 'h1', row: 16, risk: 0 },
    { multplier: 0.2, bet_amount: 0.01, bet_id: 'h2', row: 16, risk: 1 },
    { multplier: 1.1, bet_amount: 0.05, bet_id: 'h3', row: 12, risk: 2 },
  ],
})
