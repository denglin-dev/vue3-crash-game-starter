import { GAME_CODE } from '~/pages/newGame/common/composables/newGameCodes'

/** Demo game table config — no API fetch */
const MOCK_CONFIG: Record<string, Record<string, unknown>> = {
  [GAME_CODE.MINES]: {
    name: 'Mines',
    bet: 0.01,
    maxBetAmount: 1000,
    speed: 1,
    gameCode: GAME_CODE.MINES,
    gameId: 'demo-mines',
    maintainState: 0,
  },
  [GAME_CODE.PLINKO]: {
    name: 'Plinko',
    bet: 0.01,
    maxBetAmount: 1000,
    speed: 1,
    defaultRows: 16,
    defaultNum: 8,
    gameCode: GAME_CODE.PLINKO,
    gameId: 'demo-plinko',
    maintainState: 0,
  },
  [GAME_CODE.CRASH]: {
    name: 'Crash',
    bet: 0.01,
    maxBetAmount: 1000,
    speed: 1,
    multiple: 1.01,
    cashOut: 1000000,
    gameCode: GAME_CODE.CRASH,
    gameId: 'demo-crash',
    maintainState: 0,
  },
}

export const useGameConfigStore = defineStore('gameConfig', {
  state: () => ({
    gameConfig: { ...MOCK_CONFIG } as Record<string, unknown>,
    gameLoadingOver: true,
    isFastGame: false,
  }),
  actions: {
    changeIsFastGame(bol: boolean) {
      this.isFastGame = bol
    },
    changeGameLoadingOver(bol: boolean) {
      this.gameLoadingOver = bol
    },
    ensureGameConfigObject() {
      if (this.gameConfig === false) {
        this.gameConfig = { ...MOCK_CONFIG }
      }
    },
    async fetchGameConfigData() {
      this.gameConfig = { ...MOCK_CONFIG }
      return this.gameConfig
    },
    async fetchGameConfigByGameId(_backendGameId: string) {
      this.gameConfig = { ...MOCK_CONFIG }
      return this.gameConfig
    },
  },
})
