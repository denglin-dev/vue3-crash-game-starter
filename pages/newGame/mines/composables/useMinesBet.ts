// pages/newGame/mines/composables/useMinesBet.ts
/**
 * Mines（扫雷）下注与对局流程组合式函数。
 *
 * 职责概览：
 * - 封装 HTTP：下注、自动下注、开格、兑现、历史记录刷新；
 * - 与 `useMinesState` 共享对局 UI 状态（是否在局、按钮文案、收益等）；
 * - 与 `useAutoBet` 协作完成自动下注循环与止损/局数限制。
 */
import { nextTick, watch } from 'vue'
import { useGame } from '~/composables/GameHook'
import { useGameConfigStore } from '~/stores/gameConfig'
import { MessageService } from '~/utils/MessageService'
import { getDefailtSymbol, loginStatus, userInfo } from '~/utils/hook/hook'
import { useMinesApi } from '~/utils/ts/game/minesApi'
import { gameMessages } from '~/pages/newGame/common/composables/useMessage'
import { GAME_CODE } from '~/pages/newGame/common/composables/newGameCodes'
import { waitForGameUserToken } from '~/pages/newGame/common/composables/waitForGameUserToken'
import { floorToDecimal } from "~/utils/common"
import { pickDisplayPayoutMicroAmount } from "~/pages/newGame/common/pickDisplayPayoutMicroAmount"
import { blockBetIfAmountInvalid } from '~/pages/newGame/common/betAmountSubmitGuard'
import { autoBetRoundCap } from '~/pages/newGame/common/autoBetRoundCap'
import {
  useMinesState,
  betAmount,
  isBetAndNoRes,
  InGame,
  buttonText,
  profit,
  minesCommonSet,
  gameContentRef,
  MinesBetRef,
  getCashOut,
  isPick,
  minesHistory,
  changeGridSize,
  cashOutAmount,
  userBetInfo,
  getMinesMoneyDecimalPlaces,
  minesDecimalPlacesFromBetInfo,
  syncMinesUiWalletSnapshotFromWallet,
  minesRoundApplyDisplayFromBetInfo,
  minesRoundClearFrozenDisplay,
  minesUnwrapBetInfoPayload,
  resolveWalletCoinCodeForSnapshot,
  minesAugmentBetInfoIfRoundFiatFieldLoss,
  minesCanonicalizeBetInfoCurrencyFields
} from './useMinesState'
import { useAutoBet, autoBetData } from './useAutoBet'
import {
  awaitMinesSfxResumeBeforeHttpBet,
  runMinesBetUserGestureSfxHook,
} from '../minesSfxGestureBridge'
import {
  resolveFastModeFromConfigSpeed,
  shouldBlockFastModeManualBetBurst
} from '~/pages/newGame/common/fastModeBetGate'

/**
 * 与 `pickTile` / `profit.current` 同源：`total_profit_gold` 为微单位累计可兑现额。
 * 若接口未带该字段再退回 `pickDisplayPayoutMicroAmount(payout, max_profit)`（避免 `max_profit` 与 `payout` 口径不一致时错误取 min，出现按钮 1.03、结算 1.000002）。
 */
function floorMinesPayoutFromApiResult(result: Record<string, unknown>, dec: 2 | 6): number {
  const gold = result['total_profit_gold']
  if (gold != null && gold !== '') {
    const n = Number(gold)
    if (Number.isFinite(n)) return floorToDecimal(n, dec, 1000000)
  }
  const micro = pickDisplayPayoutMicroAmount(result['payout'], result['max_profit'])
  return floorToDecimal(micro, dec, 1000000)
}

/** 本地保留的最近历史条数上限（与 Dice 一致），避免 `minesHistory.list` 无限增长 */
const MAX_MINES_HISTORY = 15

/** `pickTileFun`：同一格连续触发时合并为一次请求；按 index 分桶，互不影响其它格 */
const MINES_PICK_TILE_DEBOUNCE_MS = 300
const minesPickTileDebounceTimers = new Map<number, ReturnType<typeof setTimeout>>()

function clearMinesPickTileDebounceTimers() {
  for (const t of minesPickTileDebounceTimers.values()) {
    clearTimeout(t)
  }
  minesPickTileDebounceTimers.clear()
}

/** 币种 / 法币开关 watch 只注册一次（`useMinesGame` 会在多子组件重复调用） */
let minesWalletReinitWatchRegistered = false
/** 与 `watch` 源字符串对比，避免依赖 `prev === undefined` 导致首次真实变更被跳过 */
let minesWalletWatchLastPack: string | null = null
/** 页面/账号重置代际：晚返回的 HTTP 和延迟任务必须丢弃，避免离页后继续写单例状态 */
let minesRuntimeVersion = 0

function nextMinesRuntimeVersion() {
  minesRuntimeVersion++
  return minesRuntimeVersion
}

function isCurrentMinesRuntime(version: number): boolean {
  return version === minesRuntimeVersion
}

function isMinesRouteActive(): boolean {
  if (!import.meta.client || typeof window === 'undefined') return true
  const path = window.location.pathname.toLowerCase()
  return path.includes('/game/mines') || path.includes('/newgame/mines')
}

/** `watch` 源里五段均为空时表示钱包维度尚未就绪；刷新后常见：先空串再被 getMyInfo 填满，不应再触发一次 initGame（否则与进页 onMounted 重复拉 `/cybet/history`） */
function isBlankWalletWatchPack(packed: string): boolean {
  const parts = packed.split("\x1e")
  return parts.every((p) => !String(p ?? "").trim())
}

/**
 * `enter/mines` 返回的 `box` 与 `GameContent.changeListStatus` 一致：0 未开、1 宝石、2 雷。
 * 仅当盘面上至少有一格已翻开（非 0）时，才视为「已开格」，主按钮才可走兑现态 `buttonText === 2`。
 */
function minesRestoreBoxHasAnyOpenedCell(box: unknown): boolean {
  if (!Array.isArray(box)) return false
  for (let i = 0; i < box.length; i++) {
    const v = Number(box[i])
    if (v === 1 || v === 2) return true
  }
  return false
}

/** 已翻开且为宝石的格数，用于恢复 `isPick` 与 `pickTile` 后逻辑对齐 */
function minesRestoreRevealedGemCount(box: unknown): number {
  if (!Array.isArray(box)) return 0
  let n = 0
  for (let i = 0; i < box.length; i++) {
    if (Number(box[i]) === 1) n++
  }
  return n
}

/**
 * @param i18n - 国际化对象，需提供 `t(key)` 用于错误提示等文案
 * @returns 下注入口、各 HTTP 封装、初始化与配置应用等方法
 */
export function useMinesBet(i18n: { t: (key: string) => string }) {
  /** 解构出的翻译函数，与模板中 `$t` 用法对应 */
  const { t: $t } = i18n
  /** `gameOffline`：游戏是否离线；`setBetAmount`：根据输赢调整下次下注额（与 Dice 共用逻辑） */
  const { gameOffline, setBetAmount } = useGame()
  /** 全局游戏配置 store，此处用于「是否快速游戏」等 */
  const gameConfigStore = useGameConfigStore()
  /** Mines 专用 API 封装（bet / pickTile / cashout / history 等） */
  const minesApi = useMinesApi()
  /** `gameConfig`：当前 Mines 配置；`resetState`：重置对局相关状态 */
  const { gameConfig, resetState } = useMinesState()
  /** 自动下注：开关、累计、重置、启动状态变更 */
  const {
    setAutoBet: setAutoBetInner,
    resetAutoBet,
    resetTotal,
    changeAutoStart: changeAutoStartInner,
    shouldStop
  } = useAutoBet()

  /** 自动下注「下一轮」仅保留一个延迟任务，避免堆叠；停止/卸载后不得再触发 `autoBet` */
  let pendingAutoBetResumeId: ReturnType<typeof setTimeout> | null = null
  const clearPendingAutoBetResume = () => {
    if (pendingAutoBetResumeId != null) {
      clearTimeout(pendingAutoBetResumeId)
      pendingAutoBetResumeId = null
    }
  }
  const setAutoBet = (start: boolean) => {
    if (!start) clearPendingAutoBetResume()
    setAutoBetInner(start)
  }
  const changeAutoStart = (bol: boolean, gameContentRefArg?: any) => {
    if (!bol) clearPendingAutoBetResume()
    changeAutoStartInner(bol, gameContentRefArg)
    if (!bol) {
      void nextTick(() => {
        getCashOut()
      })
    }
  }
  onUnmounted(() => {
    clearPendingAutoBetResume()
  })

  const scheduleAutoBetResume = (delayMs: number) => {
    clearPendingAutoBetResume()
    pendingAutoBetResumeId = setTimeout(() => {
      pendingAutoBetResumeId = null
      autoBet()
    }, delayMs)
  }

  // ---------- 历史记录（HTTP，对齐 Dice：不依赖 window.minesUpdataTrends）----------

  /**
   * 从服务端拉取本局游戏的最近历史，写入 `minesHistory.list`，供 `GameHistoryDobule` 等组件展示。
   * 仅在进入页面等需要与后台对齐时调用；单局结算请用 `pushMinesHistoryFromResult`，避免每局请求 history。
   */
  const refreshMinesHistory = async () => {
    const runtime = minesRuntimeVersion
    if (!loginStatus.value) {
      minesHistory.list = []
      return
    }
    const token = await waitForGameUserToken()
    if (!token) {
      minesHistory.list = []
      return
    }
    /** 从状态里取游戏编码，用于 `game_id`；缺省 Mines */
    const cfg = gameConfig.value as { gameCode?: string } | undefined
    const gameId = cfg?.gameCode != null && cfg.gameCode !== '' ? cfg.gameCode : GAME_CODE.MINES
    try {
      const result = (await minesApi.getHistory({ token, game_id: Number(gameId) })) as unknown
      if (!isCurrentMinesRuntime(runtime)) return
      /** 接口可能直接返回数组或包装结构，统一成数组 */
      const list = Array.isArray(result) ? result : []
      minesHistory.list = ((Array.isArray(list) ? list : []).reverse() || []).slice(-MAX_MINES_HISTORY)
    } catch {
      // 历史失败不阻断对局
    }
  }

  /**
   * 将单局结算接口返回写入顶部走势（与 `GameHistoryDobule`、全量 history 接口字段对齐），与 Dice 的 `diceHistory.list.push` 一致。
   */
  const pushMinesHistoryFromResult = (result: Record<string, unknown> | null | undefined) => {
    if (!result || typeof result !== 'object') return
    /** 接口字段多为 `multplier`，兼容正确拼写 `multiplier` */
    const multRaw = result['multplier'] ?? result['multiplier']
    const multplier = multRaw != null && multRaw !== '' ? Number(multRaw) : 0
    const isWin =
      result.is_win !== undefined && result.is_win !== null
        ? Boolean(result.is_win)
        : Number(result.type) === 2
          ? false
          : Number(result.payout) > 0
    minesHistory.list.push({
      bet_id: result.bet_id,
      is_win: isWin,
      multplier,
      rand_num: result.rand_num,
      time: result.time
    })
    if (minesHistory.list.length > MAX_MINES_HISTORY) {
      minesHistory.list.splice(0, minesHistory.list.length - MAX_MINES_HISTORY)
    }
  }


  /**
   * 手动模式：发起一局下注（HTTP `bet`）。
   * - `amount`：用户输入的下注金额（与 `betAmount` 一致传入）。
   * - 成功后会初始化格子、`InGame`、下一档收益等；失败则走 `handleBetError` 并可能关闭自动下注。
   */
  const betFun = async (amount: number) => {
    const runtime = minesRuntimeVersion
    /** 已在局中则忽略重复下注 */
    if (InGame.value) return

    if (gameOffline.value) {
      // MessageService.error($t('game.dice.network_Error'))
      return
    }

    /** 超过可下注上限时触发输入校验 UI，并关闭自动下注（下注允许 0，但不允许 <0） */
    const bet = Number(amount)
    if (!Number.isFinite(bet) || bet < 0) {
      MinesBetRef.value?.checkedinputFail()
      if (autoBetData.start) setAutoBet(false)
      return
    }
    if (
      blockBetIfAmountInvalid(MinesBetRef.value, bet, () => {
        if (autoBetData.start) setAutoBet(false)
      })
    ) {
      return
    }

    /** 请求已发出、尚未收到响应（用于禁用重复点击等） */
    isBetAndNoRes.value = true
    /** 炸弹数不能 ≥ 格子总数，否则服务端会拒绝；这里钳到 `gridIndex - 1` */
    minesCommonSet.bombNumber > minesCommonSet.gridIndex ? (minesCommonSet.bombNumber = minesCommonSet.gridIndex - 1) : ''

    try {
      // 音效预热不能阻塞下注请求；iOS WebKit 上 resume/decode 偶发慢或挂起。
      void awaitMinesSfxResumeBeforeHttpBet()
      clearMinesPickTileDebounceTimers()
      gameContentRef.value?.initGridList()
      const result = await minesApi.bet({
        /** 服务端以「微单位」存储金额，故 × 1e6 并取整 */
        bet: amount * 1000000,
        mines: minesCommonSet.bombNumber,
        grid_num: minesCommonSet.gridIndex,
        token: sessionStorage.getItem('Game_User_Token')
      }) as any
      // 检查组件是否已卸载
      if (!isCurrentMinesRuntime(runtime) || !gameContentRef.value) {
        isBetAndNoRes.value = false
        return
      }
      isBetAndNoRes.value = false
      if (result.is_suc !== 0) {
        gameMessages(result)
        if (autoBetData.start) setAutoBet(false)
        return
      }

      const betInfoRes =
        result.bet_id != null && String(result.bet_id) !== ""
          ? await getBetInfo(String(result.bet_id))
          : {}
      if (!isCurrentMinesRuntime(runtime) || !gameContentRef.value) return
      if (betInfoRes != null && typeof betInfoRes === "object" && Object.keys(betInfoRes).length > 0) {
        /** `getBetInfo` 内已对非空结果执行 `minesRoundApplyDisplayFromBetInfo`，此处勿重复，避免与 `userBetInfo` 一帧不同步导致图标闪变 */
      } else {
        const u = userInfo.value
        if (u?.currencyType === "FAIT") {
          minesRoundApplyDisplayFromBetInfo({
            currencyType: "FAIT",
            faitType: String(u.selectedBalanceType ?? ""),
            symbol: getDefailtSymbol.value
          })
        } else {
          minesRoundApplyDisplayFromBetInfo({
            currencyType: "COIN",
            accountType: resolveWalletCoinCodeForSnapshot()
          })
        }
      }
      const dec = minesDecimalPlacesFromBetInfo(betInfoRes)
      /** 下一格若点开可获得的收益（服务端给的档位）；小数位用本次 `getBetInfo` 返回值，避免读 ref 时序问题 */
      profit.next = floorToDecimal(result.next_profit_gold, dec, 1000000)
      /** `buttonText`：0/1/2 等，与主按钮「下注 / 游戏中 / 兑现」等态对应 */
      buttonText.value = 1
      InGame.value = true
    } catch (error) {
      isBetAndNoRes.value = false
      // MessageService.error($t('game.dice.network_Error'))
      if (autoBetData.start) setAutoBet(false)
    }
  }

  /**
   * 自动模式：整局由服务端一次算完（HTTP `autoBet`），前端只负责展示结果与更新累计、下一局下注额。
   * `amount` 当前局使用的下注金额（与 `betAmount` 一致）。
   */
  const autoBetFun = async (amount: number) => {
    const runtime = minesRuntimeVersion
    if (InGame.value) {
      if (autoBetData.start) {
        setAutoBet(false)
        MessageService.error($t('game.mines.finish_round_before_auto'))
      }
      return
    }
    const bet = Number(amount)
    if (!Number.isFinite(bet) || bet < 0) {
      MinesBetRef.value?.checkedinputFail()
      if (autoBetData.start) setAutoBet(false)
      return
    }
    if (
      blockBetIfAmountInvalid(MinesBetRef.value, bet, () => {
        if (autoBetData.start) setAutoBet(false)
      })
    ) {
      return
    }
    try {
      // 自动下注同样业务优先，音效预热只做旁路。
      void awaitMinesSfxResumeBeforeHttpBet()
      clearMinesPickTileDebounceTimers()
      gameContentRef.value?.initGridList()
      const result = await minesApi.autoBet({
        bet: Math.floor(amount * 1000000),
        mines: minesCommonSet.bombNumber,
        grid_num: minesCommonSet.gridIndex,
        token: sessionStorage.getItem('Game_User_Token'),
        /** 自动模式下用户预选的开格顺序（由棋盘组件提供） */
        index: gameContentRef.value?.getAutoIndexArr() || []
      }) as any
      // 检查组件是否已卸载或自动下注已停止
      if (!isCurrentMinesRuntime(runtime) || !gameContentRef.value || !autoBetData.start) return
      if (result.is_suc !== 0) {
        gameMessages(result)
        if (autoBetData.start) {
          setAutoBet(false)
          gameContentRef.value?.clearAutoIndex()
        }
        return
      }
      if (result.bet_id != null && String(result.bet_id) !== "") {
        await getBetInfo(String(result.bet_id))
        if (!isCurrentMinesRuntime(runtime) || !gameContentRef.value || !autoBetData.start) return
      } else {
        const u = userInfo.value
        if (u?.currencyType === "FAIT") {
          minesRoundApplyDisplayFromBetInfo({
            currencyType: "FAIT",
            faitType: String(u.selectedBalanceType ?? ""),
            symbol: getDefailtSymbol.value
          })
        } else {
          minesRoundApplyDisplayFromBetInfo({
            currencyType: "COIN",
            accountType: resolveWalletCoinCodeForSnapshot()
          })
        }
      }
      const dec = getMinesMoneyDecimalPlaces()
      const payout = floorMinesPayoutFromApiResult(result as Record<string, unknown>, dec)
      /** 自动下注累计盈亏：`result.result` 为本局结算金额，减去本局下注 */
      autoBetData.total = autoBetData.total + payout - betAmount.value
      gameContentRef.value?.UserCashOut(result.is_suc, payout, result.box, result.multplier, result.is_win)

      InGame.value = false

      pushMinesHistoryFromResult(result as Record<string, unknown>)
      userBetInfo.value = {}
      minesRoundClearFrozenDisplay()
      syncMinesUiWalletSnapshotFromWallet()
      /** 必须先写本局派彩，再调 setBetAmount：否则 getCashOut 会用「下一局下注额」算预估，出现先闪 107.x 再变 1.07 */
      cashOutAmount.value = payout
      betAmount.value = setBetAmount(
        result.payout === 0,
        betAmount.value,
        autoBetData.lose,
        autoBetData.win,
        autoBetData.defaultBetAmount
      )
      if (autoBetData.start) {
        scheduleAutoBetResume(2000)
      }
    } catch (error) {
      // MessageService.error($t('game.dice.network_Error'))
      if (autoBetData.start) setAutoBet(false)
    }
  }

  /**
   * 手动模式：点开某一格（HTTP `pickTile`），实际请求经防抖按格合并。
   * @param index - 格子下标（与棋盘组件一致）
   */
  const pickTileFunCore = async (index: number) => {
    const runtime = minesRuntimeVersion
    if (!InGame.value) return

    try {
      // 开格请求不等待音效，避免开启声音时点格反馈/请求被拖住。
      void awaitMinesSfxResumeBeforeHttpBet()
      const result = await minesApi.pickTile({ index, token: sessionStorage.getItem('Game_User_Token') }) as any
      // 检查组件是否已卸载
      if (!isCurrentMinesRuntime(runtime) || !gameContentRef.value) return
      if (result.is_suc !== 0) {
        gameMessages(result)
        return
      }
      /** `total_profit * betAmount`：展示用乘上本局投注的数值；`type` 区分安全格/雷等 */
      gameContentRef.value?.UserPickTileReq(floorToDecimal(result.total_profit_gold, getMinesMoneyDecimalPlaces(), 1000000), index, result.type, Number(result.total_profit * betAmount.value))
      /** 每次成功开格递增，用于驱动 UI；注意与下面 `isPick.value === 0` 的判断需结合历史逻辑理解 */
      isPick.value++
      profit.current = floorToDecimal(result.total_profit_gold, getMinesMoneyDecimalPlaces(), 1000000)
      profit.next = floorToDecimal(result.next_profit_gold, getMinesMoneyDecimalPlaces(), 1000000)
      isPick.value === 0 ? (buttonText.value = 1) : (buttonText.value = 2)

      // 踩雷结束本局：同步服务端状态并刷新顶部走势
      /** `type === 2`：踩雷，本局结束 */
      if (result.type === 2) {
        clearMinesPickTileDebounceTimers()
        const board = result.box
        if (Array.isArray(board) && gameContentRef.value?.changeListStatus) {
          gameContentRef.value.changeListStatus(board)
        }
        InGame.value = false
        buttonText.value = 0
        profit.current = 0
        profit.next = 0
        pushMinesHistoryFromResult(result as Record<string, unknown>)
        userBetInfo.value = {}
        minesRoundClearFrozenDisplay()
        syncMinesUiWalletSnapshotFromWallet()
      }
    } catch (error) {
      // MessageService.error($t('game.dice.network_Error'))
    }
  }

  const pickTileFun = (index: number) => {
    if (!InGame.value) return
    /** debounce 之前同步 resume：与点格同一手势栈，避免定时器回调里上下文仍挂起 */
    runMinesBetUserGestureSfxHook()
    const prev = minesPickTileDebounceTimers.get(index)
    if (prev != null) clearTimeout(prev)
    const timer = setTimeout(() => {
      minesPickTileDebounceTimers.delete(index)
      void pickTileFunCore(index)
    }, MINES_PICK_TILE_DEBOUNCE_MS)
    minesPickTileDebounceTimers.set(index, timer)
  }

  /**
   * 手动模式：提前兑现（HTTP `cashout`），结算本局并更新历史；若自动下注仍开启，延迟后继续下一轮。
   */
  const reqCashOut = async () => {
    const runtime = minesRuntimeVersion
    try {
      // 兑现请求不等待音效，避免声音开关影响主业务。
      void awaitMinesSfxResumeBeforeHttpBet()
      const result = await minesApi.cashout({ token: sessionStorage.getItem('Game_User_Token') }) as any
      // 检查组件是否已卸载
      if (!isCurrentMinesRuntime(runtime) || !gameContentRef.value) return

      if (result.is_suc !== 0) {
        gameMessages(result)
        return
      }
      clearMinesPickTileDebounceTimers()
      buttonText.value = 0
      const dec = getMinesMoneyDecimalPlaces()
      const lastShownProfit = profit.current
      let payoutCo = floorMinesPayoutFromApiResult(result as Record<string, unknown>, dec)
      const hasGold =
        result?.total_profit_gold != null && String(result.total_profit_gold).trim() !== ''
      if (
        !hasGold &&
        Number.isFinite(lastShownProfit) &&
        lastShownProfit > 0 &&
        Number.isFinite(payoutCo) &&
        payoutCo < lastShownProfit - 1e-9
      ) {
        payoutCo = lastShownProfit
      }
      profit.current = 0
      profit.next = 0
      gameContentRef.value?.UserCashOut(result.is_suc, payoutCo, result.box, result.multplier, result.is_win)
      cashOutAmount.value = payoutCo
      InGame.value = false
      pushMinesHistoryFromResult(result as Record<string, unknown>)
      userBetInfo.value = {}
      minesRoundClearFrozenDisplay()
      syncMinesUiWalletSnapshotFromWallet()

      if (autoBetData.start) {
        scheduleAutoBetResume(2000)
      }
    } catch (error) {
      console.log(error, 'error');
      // MessageService.error($t('game.dice.network_Error'))
    }
  }

  /**
   * 主按钮点击：`buttonText === 0` 且未处于「已请求未响应」时下注；
   * `buttonText === 2` 时触发兑现。
   */
  const toBet = () => {
    /** 与下注/兑现点击同帧预热 Web Audio（`ManualComponent` 已加 `v-sound` 点按音） */
    runMinesBetUserGestureSfxHook()
    if (!loginStatus.value) return bus.emit('openGlobalDialog', { type: 'Login' })
    if (buttonText.value === 0 && !isBetAndNoRes.value) {
      if (shouldBlockFastModeManualBetBurst()) return
      betFun(betAmount.value)
    } else if (buttonText.value === 2) {
      reqCashOut()
    }
  }

  /**
   * 自动下注单轮调度：检查离线、局数上限、止损，通过后递增 `betNumber` 并调用 `autoBetFun`。
   */
  function autoBet() {
    if (!autoBetData.start) return
    if (gameOffline.value) {
      // MessageService.error($t('game.dice.network_Error'))
      changeAutoStart(false, gameContentRef.value)
      return
    }
    /** 正整数局数上限；0 / 空 / null 为无限局 */
    const cap = autoBetRoundCap(autoBetData.betBigNumber)
    if (cap != null && autoBetData.betNumber >= cap) {
      changeAutoStart(false, gameContentRef.value)
      betAmount.value = autoBetData.defaultBetAmount
      return
    }
    /** `stop !== 0` 时表示止损：累计亏损达到阈值则停止 */
    if (shouldStop()) {
      changeAutoStart(false, gameContentRef.value)
      betAmount.value = autoBetData.defaultBetAmount
      return
    }
    autoBetData.betNumber++
    autoBetFun(betAmount.value)
  }

  /**
   * 进入 Mines 页时调用：与 Dice 的 `initDiceData` 类似，预拉历史走势。
   * 未登录不调 `enterMines`；已登录（含在本页登录成功后由 `index` watch 触发）与原先一致：等 token 后拉历史并 enter。
   */
  const initGame = async () => {
    const runtime = minesRuntimeVersion
    await refreshMinesHistory()
    if (!isCurrentMinesRuntime(runtime)) return
    if (!loginStatus.value) return
    const token = await waitForGameUserToken()
    if (!isCurrentMinesRuntime(runtime)) return
    if (!token) return

    const result = await minesApi.enterMines({ token }) as any
    if (!isCurrentMinesRuntime(runtime)) return
    if (result.is_suc !== 0) {
      gameMessages(result)
      return
    }
    //如果存在对局
    if (result.bet_id) {
      clearMinesPickTileDebounceTimers()
      const betInfoRes = await getBetInfo(String(result.bet_id))
      if (!isCurrentMinesRuntime(runtime)) return
      const dec = minesDecimalPlacesFromBetInfo(betInfoRes)
      minesCommonSet.bombNumber = result.mines //地雷数 
      minesCommonSet.gridIndex = result.grid_num //格子数
      gameContentRef.value?.changeGrid(result.grid_num) //初始化格子
      gameContentRef.value?.changeListStatus(result.box) //初始化格子状态 增加已经点开的格子
      InGame.value = true //设置对局状态
      betAmount.value = floorToDecimal(result.bet, dec, 1000000) //下注金额
      profit.current = floorToDecimal(result.total_profit_gold, dec, 1000000) //当前收益
      profit.next = floorToDecimal(result.next_profit_gold, dec, 1000000) //下一档收益
      isBetAndNoRes.value = false //重置下注状态,
      const boxOpened = minesRestoreBoxHasAnyOpenedCell(result.box)
      isPick.value = minesRestoreRevealedGemCount(result.box)
      // 仅依据盘面 box：有翻开才为 2（可兑）；仅下注未翻格则 1。勿用 result.gems，避免与 box 不一致
      buttonText.value = boxOpened ? 2 : 1
    } else {
      clearMinesPickTileDebounceTimers()
      userBetInfo.value = {}
      minesRoundClearFrozenDisplay()
      syncMinesUiWalletSnapshotFromWallet()
    }
  }
  /**
   * 获取用户下注币种信息
   * @param betId 
   * @returns 
   */
  const getBetInfo = async (betId: string): Promise<Record<string, unknown>> => {
    if (!betId) {
      userBetInfo.value = {}
      minesRoundClearFrozenDisplay()
      syncMinesUiWalletSnapshotFromWallet()
      return {}
    }
    try {
      const res = (await minesApi.getBetInfo({ betId })) as any
      const normalizedRaw =
        res != null && typeof res === "object" ? minesUnwrapBetInfoPayload(res) : {}
      const canonicalBeforeAugment = minesCanonicalizeBetInfoCurrencyFields(
        normalizedRaw as Record<string, unknown>
      ) as Record<string, unknown>
      const afterAugment = minesAugmentBetInfoIfRoundFiatFieldLoss(canonicalBeforeAugment) as Record<string, unknown>
      const normalized = minesCanonicalizeBetInfoCurrencyFields(afterAugment) as Record<string, unknown>
      const keys = Object.keys(normalized as object)
      if (keys.length === 0) {
        minesRoundClearFrozenDisplay()
        syncMinesUiWalletSnapshotFromWallet()
      } else {
        /** 先于 `userBetInfo` 写入冻结展示，避免模板一帧读到新 betInfo + 旧 freeze 导致币种图标跳变 */
        minesRoundApplyDisplayFromBetInfo(normalized)
      }
      userBetInfo.value = normalized
      return normalized
    } catch {
      userBetInfo.value = {}
      minesRoundClearFrozenDisplay()
      syncMinesUiWalletSnapshotFromWallet()
      return {}
    }
  }

  /**
   * 应用服务端/父级下发的游戏配置（Mines 配置段）。
   * @param newConfig - 可能为多游戏配置对象，取 `newConfig[GAME_CODE.MINES]`
   */
  const applyGameConfigData = (newConfig?: any) => {
    if (!newConfig) return
    const config = newConfig[GAME_CODE.MINES]
    if (!config) return

    betAmount.value = config.bet
    const wantFast = resolveFastModeFromConfigSpeed(config.speed, betAmount.value)
    gameConfigStore.changeIsFastGame(wantFast)

    /** 后端 content：defaultNum=格子总数(25/36/49/64)，defaultRows=默认雷数 */
    const grid = Number(config.defaultNum)
    const bombs = Number(config.defaultRows)
    if (Number.isFinite(grid) && grid > 0) {
      minesCommonSet.gridIndex = grid
      void nextTick(() => {
        changeGridSize(grid)
      })
    }
    if (Number.isFinite(bombs) && bombs >= 1) {
      const maxM = Math.max(1, (Number.isFinite(grid) && grid > 0 ? grid : minesCommonSet.gridIndex) - 1)
      minesCommonSet.bombNumber = Math.min(Math.max(1, bombs), maxM)
    }
    getCashOut()
  }

  /**
   * 与 Dice 的 `initDiceData` 对齐：重置本地对局与自动下注状态，并在已登录时拉历史。
   */
  const initMinesData = (opts?: { preserveBetDisplayFromPreviousSession?: boolean }) => {
    nextMinesRuntimeVersion()
    clearMinesPickTileDebounceTimers()
    clearPendingAutoBetResume()
    isBetAndNoRes.value = false
    const config = gameConfig.value
    resetState(config?.bet, opts)
    resetAutoBet()
  }

  /**
   * 钱包展示维度变化后重新 enter 与拉历史（与进页 `initGame` 一致）。
   * 须包含 `selectedBalanceType`：仅切换法币种类（USD→EUR）时 `currencyType` / `selectedCoinType` 常不变。
   * 使用 `immediate` + 上次快照，避免 `oldValue === undefined` 误跳过首次有效变更。
   */
  if (import.meta.client && !minesWalletReinitWatchRegistered) {
    minesWalletReinitWatchRegistered = true
    watch(
      () =>
        [
          userInfo.value?.currencyType ?? '',
          userInfo.value?.selectedCoinType ?? '',
          userInfo.value?.selectedBalanceType ?? '',
          userInfo.value?.amountType ?? '',
          userInfo.value?.selectedBonusCoinType ?? ''
        ].join('\x1e'),
      async (packed) => {
        if (!loginStatus.value) {
          minesWalletWatchLastPack = packed
          return
        }
        if (!isMinesRouteActive()) {
          minesWalletWatchLastPack = packed
          return
        }
        if (minesWalletWatchLastPack !== null && packed !== minesWalletWatchLastPack) {
          /** 首次由空快照变为接口下发的钱包字段：视为 hydration，只更新快照，避免重复 initGame → 重复 history */
          if (isBlankWalletWatchPack(minesWalletWatchLastPack) && !isBlankWalletWatchPack(packed)) {
            minesWalletWatchLastPack = packed
            return
          }
          /** 空闲时先刷新快照，避免 `enterMines` 较慢时顶栏已换法币、下注框仍读旧 `minesUiWalletSnapshot` */
          if (!InGame.value) {
            syncMinesUiWalletSnapshotFromWallet()
          }
          await initGame()
          if (!InGame.value && !autoBetData.start) {
            getCashOut()
          }
        }
        minesWalletWatchLastPack = packed
      },
      { deep: true, immediate: true }
    )
  }

  return {
    toBet,
    betFun,
    autoBetFun,
    pickTileFun,
    autoBet,
    reqCashOut,
    initGame,
    refreshMinesHistory,
    initMinesData,
    applyGameConfig: applyGameConfigData,
    CyGameConfigSetData: applyGameConfigData,
    setAutoBet,
    changeAutoStart,
    resetTotal,
  }
}
