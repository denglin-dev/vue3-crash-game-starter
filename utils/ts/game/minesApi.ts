/**
 * Mines API mock — local deterministic game logic for demo.
 */
import { mockApiOk } from '~/utils/ts/game/mockApiSuccess'

let roundId = 0
let minePositions = new Set<number>()
let openedCells = new Set<number>()
let gridSize = 25
let mineCount = 3
let betAmountMicro = 0
let isInRound = false

function pickMines(total: number, mines: number, exclude: number[] = []) {
  const set = new Set<number>(exclude)
  while (set.size < mines + exclude.length) {
    set.add(Math.floor(Math.random() * total))
  }
  exclude.forEach((i) => set.delete(i))
  return set
}

function payoutMultiplier(opened: number, mines: number, total: number) {
  if (opened <= 0) return 1
  let mult = 1
  for (let i = 0; i < opened; i++) {
    mult *= (total - i) / (total - mines - i)
  }
  return Math.max(1, Number((1 / mult * 0.97).toFixed(4)))
}

export const useMinesApi = () => ({
  enterMines: async () => {
    if (!isInRound) {
      return mockApiOk({ box: Array(gridSize).fill(0), mines: mineCount, grid: Math.sqrt(gridSize) })
    }
    const box = Array.from({ length: gridSize }, (_, i) => {
      if (minePositions.has(i)) return openedCells.has(i) ? 2 : 0
      return openedCells.has(i) ? 1 : 0
    })
    return mockApiOk({
      box,
      mines: mineCount,
      grid: Math.sqrt(gridSize),
      bet_amount: betAmountMicro / 1e6,
      payout: payoutMultiplier(openedCells.size, mineCount, gridSize),
    })
  },

  bet: async (params: Record<string, unknown>) => {
    roundId++
    gridSize = Number(params.grid_num ?? params.grid_size ?? params.grid ?? 25)
    mineCount = Number(params.mines ?? 3)
    betAmountMicro = Math.floor(Number(params.bet ?? params.amount ?? 10000))
    isInRound = true
    openedCells = new Set()
    minePositions = pickMines(gridSize, mineCount)
    return mockApiOk({
      round_id: roundId,
      bet_id: `demo-mines-${roundId}`,
      box: Array(gridSize).fill(0),
      mines: mineCount,
      bet_amount: betAmountMicro / 1e6,
    })
  },

  autoBet: async (params: Record<string, unknown>) => {
    return useMinesApi().bet(params)
  },

  pickTile: async (params: Record<string, unknown>) => {
    const index = Number(params.index ?? params.card_index ?? 0)
    if (!isInRound) throw new Error('No active round')
    if (openedCells.has(index)) {
      return mockApiOk({ index, status: minePositions.has(index) ? 2 : 1, game_over: false })
    }
    openedCells.add(index)
    const isMine = minePositions.has(index)
    if (isMine) {
      isInRound = false
      const box = Array.from({ length: gridSize }, (_, i) => {
        if (minePositions.has(i)) return 2
        return openedCells.has(i) ? 1 : 0
      })
      return mockApiOk({
        index,
        status: 2,
        game_over: true,
        box,
        payout: 0,
        profit: 0,
        multplier: 0,
        is_win: 0,
      })
    }
    const mult = payoutMultiplier(openedCells.size, mineCount, gridSize)
    const profitMicro = Math.floor(betAmountMicro * mult)
    return mockApiOk({
      index,
      status: 1,
      game_over: false,
      payout: mult,
      multplier: mult,
      total_profit_gold: profitMicro,
      profit: profitMicro / 1e6,
      is_win: 1,
    })
  },

  cashout: async () => {
    if (!isInRound || openedCells.size === 0) throw new Error('Nothing to cash out')
    const mult = payoutMultiplier(openedCells.size, mineCount, gridSize)
    const profitMicro = Math.floor(betAmountMicro * mult)
    isInRound = false
    return mockApiOk({
      payout: mult,
      multplier: mult,
      total_profit_gold: profitMicro,
      profit: profitMicro / 1e6,
      game_over: true,
      is_win: 1,
    })
  },

  getHistory: async () => [
    { multplier: 2.5, bet_amount: 0.01, profit: 0.015, bet_id: 'm1' },
    { multplier: 0, bet_amount: 0.01, profit: -0.01, bet_id: 'm2' },
    { multplier: 1.8, bet_amount: 0.05, profit: 0.04, bet_id: 'm3' },
  ],

  getBetInfo: async () =>
    mockApiOk({
      currency_type: 'COIN',
      coin_code: 'USDT',
      decimal_places: 6,
    }),
})
