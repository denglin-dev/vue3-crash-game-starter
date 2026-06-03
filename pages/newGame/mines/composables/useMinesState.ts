// pages/newGame/mines/composables/useMinesState.ts
import { ref, reactive, computed, watch, effectScope } from "vue"
import { useGameConfigStore } from "~/stores/gameConfig"
import type { MinesGameConfig, MinesProfit, MinesCommonSet } from "../types"
import { GAME_CODE } from "~/pages/newGame/common/composables/newGameCodes"
import { isBetAmountPositive } from "~/pages/newGame/common/fastModeBetGate"
import { autoBetData } from "./useAutoBet"
import { floorToDecimal } from "~/utils/common"
import {
  getDefailtImg,
  getDefailtSymbol,
  getFiatDisplaySymbolByCode,
  userInfo,
  coinType,
  legalType
} from "~/utils/hook/hook"

/** 顶部钱包切换后，在 enter/结算等完成前，侧栏与棋盘仍展示切换前的币种图标与前缀 */
export type MinesUiWalletSnapshot = {
  currencyType: "COIN" | "FAIT"
  coinCode: string
  fiatSymbol: string
  leftImgUrl: string
}

export const minesUiWalletSnapshot = ref<MinesUiWalletSnapshot | null>(null)

/** 本局下注展示冻结（BetInput 用）：由 `minesRoundCurrencyFreeze` 同步，勿单独写入 */
export const minesBetInputLockedSnapshot = ref<MinesUiWalletSnapshot | null>(null)

/** 本局币种冻结：自首次下注成功或 `getBetInfo` 恢复在局起生效，结算/无在局后清空；与顶栏法币/虚拟币切换无关 */
export type MinesRoundCurrencyFreeze = {
  kind: "FAIT" | "COIN"
  /** 法币 ISO（如 USD），虚拟币局为空 */
  fiatCode: string
  /** 虚拟币代码，法币局为空 */
  coinCode: string
  /** 法币展示前缀（如 $）；虚拟币局为空 */
  fiatDisplayPrefix: string
  leftImgUrl: string
  decimals: 2 | 6
}

export const minesRoundCurrencyFreeze = ref<MinesRoundCurrencyFreeze | null>(null)

/** 棋盘/结算模板用：与 `minesRoundCurrencyFreeze` 同步，勿直接赋值 */
export const minesRoundDisplayUseFiatSymbol = ref<boolean | null>(null)
export const minesRoundFiatSymbolFrozen = ref("")

/** `/v1/InfoHsGame/getBetInfo` 可能包一层 `data`/`result`，且常见 `{ success, code, data: { currencyType, faitType, ... } }` 双层；只取外层会丢币种字段 → kind 判空 → 冻结被清空、整页跟成虚拟币 */
export function minesUnwrapBetInfoPayload(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  const r = raw as Record<string, unknown>

  const mergeNestedDataBetFields = (o: Record<string, unknown>): Record<string, unknown> => {
    let cur: Record<string, unknown> = { ...o }
    for (let d = 0; d < 5; d++) {
      const nested = cur.data
      if (!nested || typeof nested !== "object" || Array.isArray(nested)) break
      const n = nested as Record<string, unknown>
      const innerHasCurrency =
        (typeof n.currencyType === "string" && n.currencyType.trim() !== "") ||
        (typeof n.faitType === "string" && n.faitType.trim() !== "") ||
        (typeof n.accountType === "string" && n.accountType.trim() !== "")
      if (!innerHasCurrency) break
      cur = { ...cur, ...n }
    }
    return cur
  }

  const candidates = [r.data, r.result, r.info, r.payload]
  for (const inner of candidates) {
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      const o = inner as Record<string, unknown>
      if (Object.keys(o).length > 0) return mergeNestedDataBetFields(o)
    }
  }
  return mergeNestedDataBetFields(r)
}

function strTrimUnknown(v: unknown): string {
  if (v == null || v === "") return ""
  return typeof v === "string" ? v.trim() : String(v).trim()
}

/** `getBetInfo` 法币 ISO 字段名固定为 `faitType`（与站内一致） */
export function minesBetFiatIsoFromBetInfoRecord(rec: Record<string, unknown>): string {
  return strTrimUnknown(rec.faitType)
}

/**
 * 与站内 `currencyType` 枚举一致：接口若仍带 `"FIAT"` 则规范为 `"FAIT"`。
 */
export function minesCanonicalizeBetInfoCurrencyFields(rec: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...rec }
  const ct = strTrimUnknown(out.currencyType)
  if (/^FIAT$/i.test(ct)) out.currencyType = "FAIT"
  return out
}

/** 钱包接口下发的法币列表（`faits`），用于判断某代码是否为法币，避免硬编码 ISO */
function minesFiatCodesUpperFromWallet(): Set<string> {
  const list = (legalType.value || []) as { fiat?: string }[]
  const s = new Set<string>()
  for (const row of list) {
    const f = strTrimUnknown(row?.fiat).toUpperCase()
    if (f) s.add(f)
  }
  return s
}

/** 钱包接口下发的虚拟币列表（`allCoins`），用于判断本局是否为链上币 */
function minesCoinCodesUpperFromWallet(): Set<string> {
  const list = (coinType.value || []) as { coin?: string }[]
  const s = new Set<string>()
  for (const row of list) {
    const c = strTrimUnknown(row?.coin).toUpperCase()
    if (c) s.add(c)
  }
  return s
}

/** 与 `GameContent` 一致：多字段解析币代码；勿用 `symbol`（法币常为 $） */
export function minesBetCoinCodeFromBetInfoRecord(rec: Record<string, unknown>): string {
  const keys = [
    "accountType",
    "currency",
    "coinSymbol",
    "coin",
    "userCoin",
    "crypto",
    "coin_code",
    "balanceCoin"
  ] as const
  for (const k of keys) {
    const s = strTrimUnknown(rec[k])
    if (s) return s
  }
  return ""
}

/**
 * 根据 `getBetInfo`/下注返回体判断本局为法币还是虚拟币。
 * 法币代码集合来自 `legalType`（后台配置），虚拟币来自 `coinType`；配置未加载时尽量保守（有 `faitType` 则偏法币）。
 */
export function minesBetResolvedKindFromBetInfo(rec: Record<string, unknown>): "FAIT" | "COIN" | "" {
  const ctRaw = strTrimUnknown(rec.currencyType)
  if (/^COIN$/i.test(ctRaw)) return "COIN"

  const fiatSet = minesFiatCodesUpperFromWallet()
  const coinSet = minesCoinCodesUpperFromWallet()
  const stakeRaw = strTrimUnknown(rec.accountType) || strTrimUnknown(rec.coinSymbol)
  const stakeU = stakeRaw.toUpperCase()
  const fiatRef = minesBetFiatIsoFromBetInfoRecord(rec)

  /**
   * 接口常见：`currencyType: "FAIT"` + `faitType: "USD"` + `accountType: "BTC"`（法币面额、链上币扣款）。
   * 本局仍为法币口径（小数位/符号跟 faitType），不得因 accountType 在 coin 表就判 COIN，否则换顶栏法币再进局会整段变成「虚拟币局」。
   */

  /** 显式 FAIT、无 faitType：仅当 stake 在虚拟币表才判 COIN（勿因「不在法币表」误判，legalType 未含该法币时会错） */
  if (/^(FAIT|FIAT)$/i.test(ctRaw) && stakeRaw && !fiatRef) {
    if (coinSet.size > 0 && coinSet.has(stakeU)) return "COIN"
  }

  if (/^(FAIT|FIAT)$/i.test(ctRaw)) return "FAIT"
  if (fiatRef) return "FAIT"

  const tail = minesBetCoinCodeFromBetInfoRecord(rec)
  if (!tail) return ""
  const t = tail.toUpperCase()
  if (fiatSet.size > 0 && fiatSet.has(t)) return "FAIT"
  if (coinSet.size > 0 && coinSet.has(t)) return "COIN"
  /** 配置已加载仍无法归类：不猜 COIN，避免法币局闪成虚拟币图标 */
  if (fiatSet.size > 0 || coinSet.size > 0) return ""
  /** legalType/coinType 均未下发时沿用旧逻辑，避免整局无 freeze */
  return "COIN"
}

export function minesBetCoinImgUrlFromCode(code: string): string {
  const c = String(code ?? "").trim()
  if (!c) return "/img/monyimg/USDT.svg"
  const list = (coinType.value || []) as { coin?: string; imgUrl?: string }[]
  const row = list.find((item) => item.coin === c)
  return row?.imgUrl || "/img/monyimg/USDT.svg"
}

/** 法币 ISO → 左侧图标 URL（`legalType`） */
export function minesFiatBetLeftImgUrlFromCode(fiatCode: string): string {
  const code = String(fiatCode ?? "").trim().toUpperCase()
  if (!code) return ""
  const list = (legalType.value || []) as { fiat?: string; imgUrl?: string }[]
  const row = list.find((item) => String(item.fiat ?? "").trim().toUpperCase() === code)
  const url = row?.imgUrl
  return typeof url === "string" && url.trim() !== "" ? url.trim() : ""
}

function buildMinesRoundCurrencyFreezeFromBetInfo(rec: Record<string, unknown>): MinesRoundCurrencyFreeze | null {
  const kind = minesBetResolvedKindFromBetInfo(rec)
  if (kind === "FAIT") {
    const fiatSet = minesFiatCodesUpperFromWallet()
    const fi = minesBetFiatIsoFromBetInfoRecord(rec)
    const ac = strTrimUnknown(rec.accountType)
    const fiatCode = fi || (ac && fiatSet.has(ac.toUpperCase()) ? ac : "")
    const prefix = fiatCode
      ? getFiatDisplaySymbolByCode(fiatCode)
      : strTrimUnknown(rec.symbol) || getDefailtSymbol.value
    const coinSet = minesCoinCodesUpperFromWallet()
    const acU = ac.toUpperCase()
    const railListed = ac && coinSet.size > 0 && coinSet.has(acU)
    /** 法币本局：左侧用扣款链币种图（如 BTC），与顶栏选币一致；不用法币旗标 */
    const leftFromRail = railListed ? minesBetCoinImgUrlFromCode(ac) : ""
    const leftFromWallet = String(getDefailtImg.value ?? "").trim()
    const leftImgUrl =
      leftFromRail || leftFromWallet || (fiatCode ? minesFiatBetLeftImgUrlFromCode(fiatCode) : "")
    return {
      kind: "FAIT",
      fiatCode: fiatCode || "",
      coinCode: "",
      fiatDisplayPrefix: prefix,
      leftImgUrl,
      decimals: 2
    }
  }
  if (kind === "COIN") {
    const coinCode = minesBetCoinCodeFromBetInfoRecord(rec)
    if (!coinCode) return null
    return {
      kind: "COIN",
      fiatCode: "",
      coinCode,
      fiatDisplayPrefix: "",
      leftImgUrl: minesBetCoinImgUrlFromCode(coinCode),
      decimals: 6
    }
  }
  return null
}

/** 与 `GameContent` / `MinesCommon` 旧 ref 对齐，避免一次改全模板 */
function syncLegacyMinesRoundDisplayRefsFromFreeze() {
  const f = minesRoundCurrencyFreeze.value
  if (!f) {
    minesRoundDisplayUseFiatSymbol.value = null
    minesRoundFiatSymbolFrozen.value = ""
    minesBetInputLockedSnapshot.value = null
    return
  }
  if (f.kind === "FAIT") {
    minesRoundDisplayUseFiatSymbol.value = true
    minesRoundFiatSymbolFrozen.value = f.fiatDisplayPrefix
    minesBetInputLockedSnapshot.value = {
      currencyType: "FAIT",
      coinCode: "",
      fiatSymbol: f.fiatDisplayPrefix,
      leftImgUrl: f.leftImgUrl
    }
    return
  }
  minesRoundDisplayUseFiatSymbol.value = false
  minesRoundFiatSymbolFrozen.value = ""
  minesBetInputLockedSnapshot.value = {
    currencyType: "COIN",
    coinCode: f.coinCode,
    fiatSymbol: "",
    leftImgUrl: f.leftImgUrl
  }
}

/**
 * 顶栏换法币后 `getBetInfo` 偶发省略 `faitType`/`currencyType`，仅留 `accountType`（BTC），会把本局误判成虚拟币并清空冻结。
 * 若仍在同一 `betId` 且当前冻结为法币局，则从上一帧 `userBetInfo` 补回面额字段再展示。
 */
export function minesAugmentBetInfoIfRoundFiatFieldLoss(incoming: Record<string, unknown>): Record<string, unknown> {
  const fz = minesRoundCurrencyFreeze.value
  if (fz?.kind !== "FAIT" || !InGame.value) return incoming

  const prev = userBetInfo.value as Record<string, unknown>
  const prevBet =
    prev && typeof prev === "object" && Object.keys(prev).length > 0
      ? strTrimUnknown(prev.betId) || strTrimUnknown(prev.bet_id)
      : ""
  const nextBet = strTrimUnknown(incoming.betId) || strTrimUnknown(incoming.bet_id)
  if (prevBet && nextBet && prevBet !== nextBet) return incoming

  const out: Record<string, unknown> = { ...incoming }
  if (prev && typeof prev === "object" && Object.keys(prev).length > 0) {
    for (const k of ["faitType", "currencyType", "symbol"] as const) {
      if (!strTrimUnknown(incoming[k]) && strTrimUnknown(prev[k])) {
        out[k] = prev[k]
      }
    }
  }
  if (!strTrimUnknown(out.faitType) && fz.fiatCode) {
    out.faitType = fz.fiatCode
  }
  if (!strTrimUnknown(out.currencyType)) {
    out.currencyType = "FAIT"
  } else if (fz.fiatCode && /^COIN$/i.test(strTrimUnknown(out.currencyType))) {
    out.currencyType = "FAIT"
    if (!strTrimUnknown(out.faitType)) out.faitType = fz.fiatCode
  }
  return out
}

/**
 * 本局「首次下注成功」或 `getBetInfo` 恢复在局：写入 `minesRoundCurrencyFreeze` 并同步 BetInput/棋盘用 ref。
 */
export function minesRoundApplyDisplayFromBetInfo(info: unknown) {
  if (!info || typeof info !== "object" || Array.isArray(info)) return
  if (Object.keys(info as object).length === 0) return
  const rec = minesCanonicalizeBetInfoCurrencyFields(info as Record<string, unknown>)
  const built = buildMinesRoundCurrencyFreezeFromBetInfo(rec)
  const prev = minesRoundCurrencyFreeze.value
  /** 在局时勿用「解析失败 → null」覆盖已有法币冻结，否则下注框/格子会跟顶栏钱包变成 6 位虚拟币样式 */
  if (!built && prev && InGame.value) {
    return
  }
  minesRoundCurrencyFreeze.value = built
  syncLegacyMinesRoundDisplayRefsFromFreeze()
}

export function minesRoundClearFrozenDisplay() {
  minesRoundCurrencyFreeze.value = null
  minesRoundDisplayUseFiatSymbol.value = null
  minesRoundFiatSymbolFrozen.value = ""
  minesBetInputLockedSnapshot.value = null
}

export function resolveWalletCoinCodeForSnapshot(): string {
  const u = userInfo.value
  if (!u) return ""
  if (u.amountType === "DEPOSIT") return String(u.selectedCoinType ?? "").trim()
  if (u.amountType === "BONUS") return `${String(u.selectedBonusCoinType ?? "").trim()}.b`
  const ab = u.allBalance
  if (ab && typeof ab === "object" && Object.keys(ab).length > 0) {
    return String(Object.keys(ab)[0] ?? "").trim()
  }
  return ""
}

/**
 * 将当前全局钱包展示写入快照。在「无本局 userBetInfo」时，Mines 侧栏/棋盘用此数据而非实时 `getDefailtSymbol`。
 * 调用时机：`resetState`、结算清空 `userBetInfo`、`enterMines` 无在局注单后等。
 */
export const syncMinesUiWalletSnapshotFromWallet = () => {
  const u = userInfo.value
  const currencyType = u?.currencyType === "FAIT" ? "FAIT" : "COIN"
  minesUiWalletSnapshot.value = {
    currencyType,
    coinCode: resolveWalletCoinCodeForSnapshot(),
    fiatSymbol: getDefailtSymbol.value,
    leftImgUrl: getDefailtImg.value
  }
}

/** 无本局 `userBetInfo` 时：与盘口金额前缀一致（法币符号 / 虚拟币代码） */
export const minesIdleAmountPrefix = computed(() => {
  const snap = minesUiWalletSnapshot.value
  if (!snap) {
    if (userInfo.value?.currencyType === "COIN") return resolveWalletCoinCodeForSnapshot()
    return getDefailtSymbol.value
  }
  if (snap.currencyType === "COIN") return snap.coinCode
  return snap.fiatSymbol || "$"
})

export const minesIdlePrefixNeedsGapBeforeAmount = computed(() => {
  const snap = minesUiWalletSnapshot.value
  if (snap?.currencyType === "COIN" && String(snap.coinCode || "").length > 0) return true
  if (!snap && userInfo.value?.currencyType === "COIN") return resolveWalletCoinCodeForSnapshot().length > 0
  return false
})

const GAME_ID = GAME_CODE.MINES

// 格子大小映射
export const gridSizeBox = [25, 36, 49, 64]

// ===== 单例状态 (直接定义为 ref) =====
export const betAmount = ref(0.01)

let minesFastBetGuardRegistered = false
function registerMinesFastBetGuardOnce() {
  if (!import.meta.client || minesFastBetGuardRegistered) return
  minesFastBetGuardRegistered = true
  const store = useGameConfigStore()
  effectScope(true).run(() => {
    watch(betAmount, () => {
      if (!isBetAmountPositive(betAmount.value) && store.isFastGame) {
        store.changeIsFastGame(false)
      }
      // 预估兑现额 = f(下注额, 格子数, 雷数)；改 betAmount 须重算（自动 Tab 的 cashOutAmount 展示）
      if (!autoBetData.start) {
        getCashOut()
      }
    })
  })
}
export const buttonText = ref(0) // 0 未下注 / 1 在局但未翻开任何格 / 2 在局且盘面已有翻开（可兑）
export const InGame = ref(false) // 进入游戏后游戏方返回当前是否正在游戏中
export const isPick = ref(0) // 下注后，是否进行开雷，开雷了几个
export const minesCanvasKey = ref(1)
export const isAutoModel = ref(false)
export const isBetAndNoRes = ref(false) // 已经点击了下注，但是没有接收到返回
export const rtp = ref()
export const predictrewards = ref(0)
export const multplier = ref(0)
export const cashOutAmount = ref<number>(0)
export const userBetInfo = ref<any>({}) //用户下注信息

/** 空闲且无本局 betInfo、无本局币种冻结：自动区「Cash out」等跟顶栏实时钱包，避免二次进页后仍读旧 `minesUiWalletSnapshot` */
function minesSnapshotFollowLiveWallet(): boolean {
  if (InGame.value) return false
  if (minesRoundCurrencyFreeze.value) return false
  const v = userBetInfo.value
  if (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length > 0) return false
  return true
}

/**
 * 无 `userBetInfo` 时侧栏/自动模式预估用的法币符号或空字符串（虚拟币仅左侧图标）。
 * 有 `userBetInfo` 时不应使用本计算属性展示局内金额（请走 `getBetInfo` 字段）。
 */
export const minesSnapshotDisplaySymbol = computed(() => {
  if (minesSnapshotFollowLiveWallet()) {
    const u = userInfo.value
    if (u?.currencyType === "FAIT") {
      const code = String(u.selectedBalanceType ?? "").trim()
      if (code) return getFiatDisplaySymbolByCode(code)
      return String(getDefailtSymbol.value ?? "").trim()
    }
    return ""
  }
  const snap = minesUiWalletSnapshot.value
  if (!snap) return getDefailtSymbol.value
  return snap.currencyType === "FAIT" ? snap.fiatSymbol : ""
})

/** 与 `minesSnapshotDisplaySymbol` 配套的左侧图标（冻结至下次 `syncMinesUiWalletSnapshotFromWallet`） */
export const minesSnapshotDisplayImg = computed(() => {
  if (minesSnapshotFollowLiveWallet()) {
    return String(getDefailtImg.value ?? "").trim()
  }
  return minesUiWalletSnapshot.value?.leftImgUrl ?? getDefailtImg.value
})

/**
 * 根据「本局下注信息」对象（通常为 `getBetInfo` 返回值）决定 `floorToDecimal` 小数位；无有效 `currencyType` 时回退钱包。
 * 在 `await getBetInfo(...)` 之后应使用本函数并传入**本次请求的返回值**，避免仅读 `userBetInfo` ref 时序问题。
 */
export function minesDecimalPlacesFromBetInfo(info: unknown): 2 | 6 {
  const fz = minesRoundCurrencyFreeze.value
  if (fz) return fz.decimals
  if (minesRoundDisplayUseFiatSymbol.value === true) return 2
  if (minesRoundDisplayUseFiatSymbol.value === false) return 6
  if (info && typeof info === "object" && !Array.isArray(info) && Object.keys(info as object).length > 0) {
    const kind = minesBetResolvedKindFromBetInfo(info as Record<string, unknown>)
    if (kind === "FAIT") return 2
    if (kind === "COIN") return 6
  }
  return userInfo.value?.currencyType === "FAIT" ? 2 : 6
}

/** 读当前本局小数位：优先 `minesRoundCurrencyFreeze`（与顶栏切换解耦） */
export function getMinesMoneyDecimalPlaces(): 2 | 6 {
  const fz = minesRoundCurrencyFreeze.value
  if (fz) return fz.decimals
  if (minesRoundDisplayUseFiatSymbol.value === true) return 2
  if (minesRoundDisplayUseFiatSymbol.value === false) return 6
  return minesDecimalPlacesFromBetInfo(userBetInfo.value)
}

function isMinesRouteActiveForState(): boolean {
  if (!import.meta.client || typeof window === "undefined") return true
  const path = window.location.pathname.toLowerCase()
  return path.includes("/game/mines") || path.includes("/newgame/mines")
}

if (import.meta.client) {
  effectScope(true).run(() => watch(
    () =>
      [
        minesRoundCurrencyFreeze.value?.decimals,
        minesRoundDisplayUseFiatSymbol.value,
        InGame.value
      ] as const,
    () => {
      if (!isMinesRouteActiveForState()) return
      if (!InGame.value) return
      const dec = getMinesMoneyDecimalPlaces()
      if (dec !== 2) return
      const v = Number(betAmount.value)
      if (!Number.isFinite(v)) return
      const snapped = Math.round(v * 100) / 100
      if (Math.abs(snapped - v) > 1e-9) {
        betAmount.value = snapped
      }
    }
  ))
}

// 组件引用
export const MinesBetRef = ref()
export const gameContentRef = ref()
export const GridSizeComRef = ref()
export const minesStepRef = ref()

// 利润数据
export const profit = reactive<MinesProfit>({
  current: 0,
  next: 0
})

// 游戏设置（勿在模块顶层读 Pinia；默认值与接口下发后在 applyGameConfig 中同步）
export const minesCommonSet = reactive<MinesCommonSet>({
  gridIndex: 25,
  bombNumber: 1
})

/**
 * 顶部走势条 / GameHistoryDobule 使用的历史列表。
 * 与 Dice 的 diceHistory 一致：由 HTTP `/cybet/history` 拉取并驱动 UI，不通过 window 回调同步。
 */
export const minesHistory = reactive<{ list: Record<string, unknown>[] }>({
  list: []
})

// 计算赔率
export const getCashOut = () => {
  /** 自动扫雷进行中：派彩只认服务端 `payout`，禁止本地预估覆盖 `cashOutAmount`（否则先闪错误大数再变真派彩） */
  if (autoBetData.start) return
  const dec = getMinesMoneyDecimalPlaces()
  const boxnum = gameContentRef.value?.getAutoIndexArr()?.length || 0
  if (boxnum == 0) {
    const b = Number(betAmount.value)
    cashOutAmount.value = Number.isFinite(b) ? floorToDecimal(b, dec, 1) : 0
    return
  }
  const allbox = minesCommonSet.gridIndex
  const mines = minesCommonSet.bombNumber
  let re = 1
  const max = Number(allbox - mines)
  const num = Number(Math.min(boxnum, max))
  for (let i = 0; i < num; i++) {
    re = ((allbox - i - mines) / (allbox - i)) * re
  }
  if (re == 0) {
    cashOutAmount.value = 0
    return
  }
  const rtpNum = Number(rtp.value)
  /** 返还率：接口/配置为百分数（如 99 = 99%），须先 /100 再参与倍率，否则会当成 99 倍得到 103.x 这类错误值 */
  const rtpBase = Number.isFinite(rtpNum) && rtpNum > 0 ? rtpNum : 99
  const rtpFrac = rtpBase / 100
  /** `re` 为连开存活概率积；倍率 ≈ rtp% / re（与原先 floor 到 2 位小数再乘下注一致，仅修正 RTP 须为百分数） */
  const peilv = Math.floor((rtpFrac / re) * 100) / 100
  const n = Math.floor(peilv * betAmount.value * 1000000) / 1000000
  if (!Number.isFinite(n) || n < 0) {
    cashOutAmount.value = 0
    return
  }
  cashOutAmount.value = floorToDecimal(n, dec, 1)
}

// 切换扫雷布局总数
export const changeGridSize = (size: number) => {
  if (!gameContentRef.value) return
  const s = size < 10 ? gridSizeBox[size] : size
  gameContentRef.value.changeGrid(s)
  minesCommonSet.gridIndex = s
  getCashOut()
}

// 切换总雷数
export const changeBombSize = (size: number) => {
  minesCommonSet.bombNumber = size
  getCashOut()
}

// BetInput @change：与 watch(betAmount) 双保险（部分快捷改额路径）
export const inputChange = () => {
  if (!autoBetData.start) {
    getCashOut()
  }
}

// 是否禁用
export const disable = computed(() => {
  return InGame.value
})

/** `resetState` 可选：进页先 `initMinesData` 再 `await initGame` 时，避免清空在局 `userBetInfo` / 冻结展示导致下注框虚拟币图标在 enter 返回前跟成顶部新钱包 */
export type MinesResetStateOptions = {
  preserveBetDisplayFromPreviousSession?: boolean
}

// 重置状态
export const resetState = (configBet?: number, options?: MinesResetStateOptions) => {
  betAmount.value = configBet ?? 0.01
  InGame.value = false
  isPick.value = 0
  buttonText.value = 0
  isBetAndNoRes.value = false
  cashOutAmount.value = 0
  profit.current = 0
  profit.next = 0
  if (!options?.preserveBetDisplayFromPreviousSession) {
    userBetInfo.value = {}
    minesRoundClearFrozenDisplay()
  }
  syncMinesUiWalletSnapshotFromWallet()
}

/** 当前盘面格数下，雷数滑块上限（与格子总数一致：最多 gridIndex-1 颗雷） */
export const getStepMax = (): number => {
  const g = minesCommonSet.gridIndex
  switch (g) {
    case 25:
      return 24
    case 36:
      return 35
    case 49:
      return 48
    case 64:
      return 63
    default:
      return Math.max(1, g - 1)
  }
}

export function useMinesState() {
  registerMinesFastBetGuardOnce()
  const gameConfigStore = useGameConfigStore()
  const gameConfig = computed(
    () => gameConfigStore.gameConfig?.[GAME_ID] as MinesGameConfig | undefined
  )

  return {
    betAmount,
    buttonText,
    InGame,
    isPick,
    minesCanvasKey,
    isAutoModel,
    isBetAndNoRes,
    rtp,
    predictrewards,
    multplier,
    cashOutAmount,
    profit,
    minesCommonSet,
    MinesBetRef,
    gameContentRef,
    GridSizeComRef,
    minesStepRef,
    minesHistory,
    disable,
    gameConfig,
    getStepMax,
    getCashOut,
    getMinesMoneyDecimalPlaces,
    minesDecimalPlacesFromBetInfo,
    changeGridSize,
    changeBombSize,
    inputChange,
    resetState
  }
}
