<template>
	<ClientOnly>
		<div ref="betInputRoot" class="betInputRoot">
			<div class="custom-input1"
				:class="{ isBlur: isBlur, hoverBorder: !disabled, inputCommonStyle: !disabled, redBorder: inputValidationRed }"
				:style="{ width: customWidth, height: customHeight }">	
				<slot name="inputLeftIcon">
					<div class="inputIcom">
						<img v-if="leftCoinImageUrl" :src="leftCoinImageUrl" alt="" />
						<span v-if="leftCurrencyText" class="money Cy_font_Medium">{{ leftCurrencyText }}</span>
					</div>
				</slot>
				<input ref="betAmountInputEl" v-model="inputValue" type="text" class="pri_input gameInput"
					:disabled="disabled" :class="{ redBorder: inputValidationRed, inhibit: !isQuicklyBetBtn }"
					:placeholder="placeholder" maxlength="14" @blur="handleBlur" @focus="handleUsdtInputFocus"
					@change="handleInput" @input="handleInput" />
			</div>
			<div v-if="isShowQuicklyBetBtn" class="quicklyBetBtn Cy_font_Bold" :class="{ disable: !isQuicklyBetBtn }">
				<div v-sound class="betItem userSelectNone" @pointerdown="onQuickBetPointerDown"
					@click="quickBetCallback('1/2', inputValue)">1/2</div>
				<div v-sound class="betItem userSelectNone" @pointerdown="onQuickBetPointerDown"
					@click="quickBetCallback('X2', inputValue)">X2</div>
				<div v-sound class="betItem userSelectNone" @pointerdown="onQuickBetPointerDown"
					@click="quickBetCallback('MAX', inputValue)">MAX</div>
			</div>
			<span v-if="showValidationHintsRow" class="minAmountSpan minAmountSpan--belowQuick">
				<span v-if="tableRangeInvalidWallet && tableGameConfigForHint"
					class="minMaxReference minMaxReference--invalid">
					{{ `${$t('main.min')}: ${minMaxAmountSuffix} ${minBetRangeDisplay}` }},{{
						`${$t('main.max')}: ${minMaxAmountSuffix} ${maxBetRangeDisplay} `
					}}
				</span>
				<span v-else-if="showInsufficientBalanceHint" class="balanceInsufficientHint">{{
					$t('game.messages.insufficientBalance') }}</span>
			</span>
		</div>
	</ClientOnly>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, computed, onMounted, onBeforeUnmount } from "vue"
import { useI18n } from "vue-i18n"
import {
	newVictural,
	userInfo,
	getDefailtImg,
	getDefailtSymbol,
	coinType,
	gameIdGetConfig,
	setRegalRate,
	getUserBalanceMax,
	isUserWalletBalanceUiReady,
	getMyInfoRoundDoneForWalletUi,
	rateData,
} from "~/utils/hook/hook"
import { useRoute } from "vue-router"
import { useGameConfigStore } from "~/stores/gameConfig"
import { resolveGameCodeForCurrentPage } from "~/pages/newGame/common/composables/newGameCodes"
import { decimal_add } from "~/utils/decimal"
import { formatPoint, formatPriceNew } from "~/utils/ts/formatPoint"
import { isBetTableRangeInvalid } from "~/pages/newGame/common/betAmountSubmitGuard"

type TableGameCfg = { bet?: number | string; maxBetAmount?: number | string }
const { t: $t } = useI18n()
const emiter = defineEmits(["update:modelValue", "changeIptTags", "change", "blur"])
const props = defineProps({
	modelValue: {
		type: [String, Number],
		default: ""
	},
	disabled: {
		type: Boolean,
		default: false
	},
	showDefailtImg: {
		type: Boolean,
		default: true
	},
	isQuicklyBetBtn: {
		type: Boolean,
		default: true
	},
	isShowQuicklyBetBtn: {
		type: Boolean,
		default: true
	},
	placeholder: {
		type: String,
		default: "0"
	},
	// 提供外部传值能力，内部默认逻辑使用 computed 替代 default
	decimalLength: {
		type: Number,
		default: 2
	},
	isCoin: {
		type: Boolean,
		default: false
	},
	customWidth: {
		type: String,
		default: "100%"
	},
	customHeight: {
		type: String,
		default: "48px"
	},
	/**
	 * 左侧法币符号；不传或空则用全局 `getDefailtSymbol`。
	 * 与 `currencyCoin` 用于小数位与左侧展示；「余额不足」仅在输入与 `getUserBalanceMax()` 同口径时比较（法币钱包 + 仅传符号可比；顶栏虚拟币且仅法币展示符为法币面额局则跳过，避免错比）。
	 */
	currencySymbol: {
		type: String,
		default: ""
	},
	/**
	 * 虚拟币代码（如 `USDT`、`BTC`，奖金币可为 `ETH.b`），与 `coinType` 列表的 `coin` 对齐；左侧仅图标、不拼币种文字。
	 * 与 `currencySymbol` 共同决定小数位与左侧展示；余额比较见 `skipWalletBalanceCompareWithGlobalMax`。
	 */
	currencyCoin: {
		type: String,
		default: ""
	},
	/**
	 * Mines 等：顶部钱包切换后 enter 完成前冻结左侧图标；有法币 `currencySymbol` 且无 `currencyCoin` 时优先于此值而非实时 `getDefailtImg`。
	 */
	walletSnapshotLeftImgUrl: {
		type: String,
		default: ""
	}
})

/** 使用层传入法币符号优先，否则与钱包一致（虚拟币侧栏由 `currencyCoin` + 图处理，此处可为空） */
const displaySymbol = computed(() => {
	const s = props.currencySymbol
	if (typeof s === "string" && s.trim() !== "") return s.trim()
	return getDefailtSymbol.value
})

const currencyCoinCode = computed(() =>
	typeof props.currencyCoin === "string" ? props.currencyCoin.trim() : ""
)

/** 外部显式传入 `currencySymbol`（非空）→ 按 2 位小数；显式传入 `currencyCoin` → 6 位；均未传则沿用钱包 `userInfo.currencyType` */
const hasExplicitCurrencySymbolProp = computed(
	() => typeof props.currencySymbol === "string" && props.currencySymbol.trim() !== ""
)
const effectiveBetInputDecimals = computed(() => {
	if (currencyCoinCode.value.length > 0) return 6
	if (hasExplicitCurrencySymbolProp.value) return 2
	return userInfo.value.currencyType === "COIN" ? 6 : 2
})

/** 当前选中钱包在 `allBalance` 中的键，与 `currencyCoin` 对齐比较用 */
const walletSelectionKeyForBalanceCompare = computed(() => {
	const amountType = userInfo.value.amountType === "BONUS"
	if (amountType) {
		const c = String(userInfo.value.selectedBonusCoinType ?? "").trim()
		return c ? `${c}.b` : ""
	}
	return String(userInfo.value.selectedCoinType ?? "").trim()
})

/**
 * true：不把输入与 `getUserBalanceMax()` 比较（口径不一致会误报）。
 * - 仅法币展示符、无 `currencyCoin`、且顶栏为法币：可比 → 不跳过。
 * - 显式 `currencyCoin` 与当前钱包选中币一致：可比 → 不跳过。
 */
const skipWalletBalanceCompareWithGlobalMax = computed(() => {
	const coinUi = currencyCoinCode.value
	const symEx = hasExplicitCurrencySymbolProp.value
	if (!symEx && !coinUi) return false

	if (symEx && !coinUi && userInfo.value.currencyType === "FAIT") {
		return false
	}

	if (coinUi) {
		const w = walletSelectionKeyForBalanceCompare.value
		if (!w) return true
		const norm = (s: string) => s.trim()
		const ui = norm(coinUi)
		if (ui === norm(w)) return false
		const baseUi = ui.replace(/\.b$/i, "")
		const baseW = norm(w).replace(/\.b$/i, "")
		if (baseUi !== "" && baseUi === baseW) return false
	}

	return true
})

/** 左侧图标：`currencyCoin` 查表有图则用；否则用法币/本局冻结快照 URL（Mines）；再否则全局图，避免表缺行时跟顶部钱包 */
const leftCoinImageUrl = computed(() => {
	const code = currencyCoinCode.value
	if (code) {
		const list = (coinType.value || []) as { coin?: string; imgUrl?: string }[]
		const row = list.find((item) => item.coin === code)
		const fromList = typeof row?.imgUrl === "string" ? row.imgUrl.trim() : ""
		if (fromList) return fromList
	}
	const snapImg =
		typeof props.walletSnapshotLeftImgUrl === "string" ? props.walletSnapshotLeftImgUrl.trim() : ""
	if (snapImg) return snapImg
	if (code) return "/img/monyimg/USDT.svg"
	/** 仅传法币符号、无快照图时：不回退 `getDefailtImg`（顶栏为虚拟币时会误出 BTC 图标） */
	if (hasExplicitCurrencySymbolProp.value) return ""
	if (props.showDefailtImg) return getDefailtImg.value
	return ""
})

/** 左侧文字：虚拟币模式不展示 USDT 等字符串，仅图标 */
const leftCurrencyText = computed(() => {
	if (currencyCoinCode.value) return ""
	return displaySymbol.value
})

/** min/max 行后缀：虚拟币不写币种字符串 */
const minMaxAmountSuffix = computed(() => {
	if (currencyCoinCode.value) return ""
	return displaySymbol.value
})

const MIN_BET_MICRO_STEP = 0.000001
const MIN_BET_MICRO_BUMP_THRESHOLD = 0.00001
const rateCoinForBetRange = computed(() => currencyCoinCode.value || undefined)

/**
 * 6 位小数时，只有换算后的桌台最小值小于 0.00001 才向上补 1 个微单位。
 * 例如 0.01 不应显示成 0.010001；0.000009 才补成 0.00001。
 */
const resolveMinBetBound = (rawMinBet: unknown) => {
	const n = Number(setRegalRate(rawMinBet as string | number, rateCoinForBetRange.value))
	if (!Number.isFinite(n)) return n
	if (effectiveBetInputDecimals.value !== 6) return n
	return n < MIN_BET_MICRO_BUMP_THRESHOLD ? Number(decimal_add(n, MIN_BET_MICRO_STEP)) : n
}

const tableGameConfigForHint = computed(() => gameIdGetConfig() as TableGameCfg | undefined)
const minBetRangeDisplay = computed(() => resolveMinBetBound(tableGameConfigForHint.value?.bet))
const maxBetRangeDisplay = computed(() =>
	Number(setRegalRate(tableGameConfigForHint.value?.maxBetAmount ?? 0, rateCoinForBetRange.value))
)

const inputValue = ref<string | number>(props.modelValue)
/** 包裹输入框+提示+快捷按钮，用于 Tab 从隐藏切到显示时补算「余额不足」文案（兄弟 Tab 共享 v-model 时不会触发 modelValue watch） */
const betInputRoot = ref<HTMLElement | null>(null)
const betAmountInputEl = ref<HTMLInputElement | null>(null)
const gameConfigStore = useGameConfigStore()
const route = useRoute()

/** `gameIdGetConfig()` 在 route.name 偶发对不齐时用当前 path + store 同步解析，避免 `validateBetRange` 永不写入 `tableRangeInvalidWallet` */
const resolveTableGameConfig = (): TableGameCfg | undefined => {
	const primary = gameIdGetConfig() as TableGameCfg | undefined
	if (primary) return primary
	const raw = gameConfigStore.gameConfig as unknown
	if (raw === false || raw == null || typeof raw !== "object" || Array.isArray(raw)) return undefined
	const code = resolveGameCodeForCurrentPage({
		routeName: route.name,
		path: route.path,
	})
	if (!code) return undefined
	const entry = (raw as Record<string, unknown>)[code]
	if (entry != null && typeof entry === "object" && !Array.isArray(entry)) {
		return entry as TableGameCfg
	}
	return undefined
}

const decimalLengthCommon = ref(props.decimalLength) //小数位数

// 监听 modelValue：无焦点时按币种格式化同步；输入中（isBlur=true）不覆盖展示，避免 0→0.00、1→1.00，截断放到 blur
watch(
	() => props.modelValue,
	(value, oldValue) => {
		const n = Number(value)
		if (value === "" || value === null || value === undefined || (Number.isNaN(n) && value !== 0)) {
			inputValue.value = ""
		} else if (!isBlur.value) {
			const dp = effectiveBetInputDecimals.value
			inputValue.value = formatPoint(n, dp) || ""
		}
		if (value != oldValue && !isBlur.value) {
			updataModelValue(Number(inputValue.value))
		}
		const nv = Number(value)
		const treatEmpty = value === "" || value === null || value === undefined
		validateBetRange(nv, treatEmpty)
		const rawSync = String(inputValue.value ?? "").trim()
		const amtSync = rawSync === "" || rawSync === "." ? 0 : Number(rawSync)
		applyInsufficientBalanceUiAfterCommit(
			Number.isFinite(amtSync) ? amtSync : 0,
			rawSync === "" || rawSync === "."
		)
	}
)

// input 过程：只做合法字符校验，不截小数位（截断在 blur 用 formatPoint）
const oldInputValue = ref("")
const handleInput = (event: Event) => {
	let value = (event.target as HTMLInputElement).value
	if (/^(\d+(\.\d{0,99})?)?$/.test(value.toString())) {
		oldInputValue.value = value
		inputValue.value = value
	} else {
		inputValue.value = oldInputValue.value
	}
	const raw = String(inputValue.value).trim()
	const emitNum = raw === "" || raw === "." ? 0 : Number(raw)
	const num = Number.isFinite(emitNum) ? emitNum : 0
	updataModelValue(num)
	validateBetRange(num, raw === "" || raw === ".")
	emiter("change", inputValue.value)
}

// 通过失去焦点事件，外部可调用blur事件接收值
const isBlur = ref(false)
const isHaveBlur = () => {
	isBlur.value = false
}
const handleUsdtInputFocus = () => {
	isBlur.value = true
	balanceExceedsAfterBlur.value = false
}

/** H5：点下注/快捷按钮时主动失焦并提交小数位；PC 点外部通常会自动 blur */
const blurInput = () => {
	const el = betAmountInputEl.value
	if (!el) return
	if (import.meta.client && document.activeElement === el) {
		el.blur()
		return
	}
	if (isBlur.value) {
		handleBlur({ target: el } as unknown as FocusEvent)
	}
}

const onQuickBetPointerDown = () => {
	if (!props.isQuicklyBetBtn) return
	blurInput()
}

let dismissBetInputFocusOnPointerDown: ((e: PointerEvent) => void) | null = null

// 失去焦点：按币种截取 / 补齐小数位
const handleBlur = (event: Event) => {
	isHaveBlur()
	checkInputValue()
	const raw = String((event.target as HTMLInputElement).value).trim()
	if (raw === "" || raw === ".") {
		inputValue.value = 0
		emiter("update:modelValue", 0)
		validateBetRange(0, true)
		applyInsufficientBalanceUiAfterCommit(0, true)
		emiter("blur", "")
		return
	}
	const numericValue = Number(raw)
	if (!Number.isFinite(numericValue)) {
		inputValue.value = 0
		emiter("update:modelValue", 0)
		validateBetRange(0, true)
		applyInsufficientBalanceUiAfterCommit(0, true)
		emiter("blur", "")
		return
	}
	const dp = effectiveBetInputDecimals.value
	inputValue.value = formatPoint(numericValue, dp) || ""
	const finalNum = Number(inputValue.value)
	emiter("update:modelValue", Number.isFinite(finalNum) ? finalNum : 0)
	const committed = Number.isFinite(finalNum) ? finalNum : 0
	validateBetRange(committed, false)
	applyInsufficientBalanceUiAfterCommit(committed, false)
	emiter("blur", inputValue.value)
}

/** 桌台 min/max 越界（含显式 currency：仍参与桌台区间判断与橙色 min/max 提示） */
const tableRangeInvalidWallet = ref(false)
/**
 * 余额不足文案与红框（余额维度）：失焦、快速下注、`checkInputValue`（含首屏与配置/余额拉取后）会更新；
 * 获得焦点时仍会清空以免干扰输入。下注拦截见 `isBetAmountInvalid`。
 */
const balanceExceedsAfterBlur = ref(false)
/** 外部 `checkedinputFail()` 强制标红（不附带 min/max 文案） */
const manualInvalid = ref(false)

const showInsufficientBalanceHint = computed(() => balanceExceedsAfterBlur.value)
/** 提示行容器：桌台越界（橙色 min/max）或余额不足 */
const showValidationHintsRow = computed(
	() => tableRangeInvalidWallet.value || showInsufficientBalanceHint.value
)
/** 输入框红框：桌台越界、失焦后余额不足或外部校验失败 */
const inputValidationRed = computed(
	() =>
		manualInvalid.value ||
		tableRangeInvalidWallet.value ||
		balanceExceedsAfterBlur.value
)

const checkedinputPass = () => {
	tableRangeInvalidWallet.value = false
	balanceExceedsAfterBlur.value = false
	manualInvalid.value = false
}

const checkedinputFail = () => {
	manualInvalid.value = true
}

/** 在 `checkInputValue` 定义后赋值；供其上方 watch 在余额回调里安全调用 */
let scheduleWalletHintRecheck: () => void = () => { }

// 切换货币后：用当前输入重新跑 min/max（含 `setRegalRate`），超范围则标红；勿仅 `checkedinputPass`，否则换币后仍显示旧金额却不提示非法
watch(
	() => getDefailtImg.value,
	() => {
		nextTick(() => checkInputValue())
	},
)
watch(
	() => userInfo.value.selectedCoinType,
	() => {
		nextTick(() => checkInputValue())
	},
)
watch(
	() => userInfo.value.selectedBalanceType,
	() => {
		nextTick(() => checkInputValue())
	},
)
watch(
	() => userInfo.value.selectedBonusCoinType,
	() => {
		nextTick(() => checkInputValue())
	},
)
watch(
	() => userInfo.value.amountType,
	() => {
		nextTick(() => checkInputValue())
	},
)
watch(
	() => userInfo.value.allBalance,
	() => {
		nextTick(() => checkInputValue())
		scheduleWalletHintRecheck()
	},
	{ deep: true }
)

// 快速下注按钮
const quickBetCallback = (val: string, number: string | number) => {
	if (props.isQuicklyBetBtn) {
		const newBet = quickBet(val, number)
		inputValue.value = newBet
		const n = Number(newBet)
		const committed = Number.isFinite(n) ? n : 0
		updataModelValue(committed)
		validateBetRange(committed, false)
		applyInsufficientBalanceUiAfterCommit(committed, false)
	}
}
const updataModelValue = (value: string | number) => {
	emiter("update:modelValue", Number(value))
}
// gameStore.fetchGameConfigData()
const quickBet = (val: string, number: string | number) => {
	const current = Number(number) || 0
	const amountType = userInfo.value.amountType === "BONUS"
	const balance = userInfo.value.allBalance
	const coin = amountType ? `${userInfo.value.selectedBonusCoinType}.b` : userInfo.value.selectedCoinType

	const maxNum = gameIdGetConfig()?.maxBetAmount
	switch (val) {
		case "1/2":
			if (effectiveBetInputDecimals.value === 6) {
				if (current === 0.000001) return 0.000001
				return formatPriceNew(current * 0.5) || 0.000001
			} else {
				const halved = current * 0.5
				return formatPoint(halved, 2) || "0.00"
			}
		case "X2":
			{
				// 封顶：不能超过余额（同 MAX），也不能超过后端下发的 maxBetAmount
				const currencyType = JSON.parse(JSON.stringify(coin)) // 单独增加对 .b 处理（沿用 MAX 分支）
				const balanceMax = newVictural(
					balance[coin],
					currencyType.replace(".b", ""),
					userInfo.value.selectedBalanceType
				)
				const hardMax = maxNum != null ? Math.min(Number(balanceMax), Number(maxNum)) : Number(balanceMax)
				const doubled = current * 2
				const capped = Math.min(doubled, hardMax)

				if (effectiveBetInputDecimals.value === 6) {
					return formatPriceNew(capped) || 0.000001
				}
				return formatPoint(capped, 2) || "0.00"
			}
		case "MAX": {
			const currencyType = JSON.parse(JSON.stringify(coin)) //单独增加 对.b 处理
			const balanceMax = Number(newVictural(balance[coin], currencyType.replace('.b', ''), userInfo.value.selectedBalanceType)) || 0
			const maxBet = maxNum != null ? Number(maxNum) : Number.POSITIVE_INFINITY
			const capped = Math.min(balanceMax, maxBet)
			return effectiveBetInputDecimals.value === 6
				? (formatPriceNew(capped) || "0.000001")
				: formatPoint(capped, 2) || "0.00"

		}
	}
}

/** 按已提交语义金额更新「余额不足」提示与红框（与桌台校验解耦，可与 `checkInputValue` 一并调用） */
const applyInsufficientBalanceUiAfterCommit = (amount: number, treatAsEmpty: boolean) => {
	if (treatAsEmpty || !Number.isFinite(amount) || amount <= 0) {
		balanceExceedsAfterBlur.value = false
		return
	}
	if (skipWalletBalanceCompareWithGlobalMax.value) {
		balanceExceedsAfterBlur.value = false
		return
	}
	if (!isUserWalletBalanceUiReady()) {
		balanceExceedsAfterBlur.value = false
		return
	}
	const maxBal = getUserBalanceMax()
	balanceExceedsAfterBlur.value = amount > maxBal
}

/** 与是否在输入焦点一致：焦点内只消除「余额足够」时的误报，不按余额标红；失焦态走完整比较 */
const syncBalanceHintForCurrentAmount = (amount: number, treatAsEmpty: boolean) => {
	if (isBlur.value) {
		if (treatAsEmpty || !Number.isFinite(amount) || amount <= 0) return
		if (skipWalletBalanceCompareWithGlobalMax.value || !isUserWalletBalanceUiReady()) return
		const maxBal = getUserBalanceMax()
		if (amount <= maxBal) balanceExceedsAfterBlur.value = false
		return
	}
	applyInsufficientBalanceUiAfterCommit(amount, treatAsEmpty)
}

/** 仅重算余额提示（不碰桌台 min/max），供汇率/余额防抖回调使用 */
const parseAmountForWalletUi = () => {
	const raw = String(inputValue.value ?? "").trim()
	const n = raw === "" || raw === "." ? 0 : Number(raw)
	const amt = Number.isFinite(n) ? n : 0
	const empty = raw === "" || raw === "."
	return { amt, empty }
}
const recheckInsufficientBalanceOnly = () => {
	const { amt, empty } = parseAmountForWalletUi()
	syncBalanceHintForCurrentAmount(amt, empty)
}

/** 仅当金额 > 0 时按桌台 min/max 校验；空视为 0 不标桌台红。显式本局币种仍校验桌台区间（仅余额维度仍单独处理）。余额 UI 由 `applyInsufficientBalanceUiAfterCommit` 单独更新 */
const validateBetRange = (amount: number, treatAsEmpty = false) => {
	if (treatAsEmpty || !Number.isFinite(amount) || amount <= 0) {
		manualInvalid.value = false
		tableRangeInvalidWallet.value = false
		return
	}
	manualInvalid.value = false
	const cfg = resolveTableGameConfig()
	if (!cfg) {
		tableRangeInvalidWallet.value = false
		return
	}
	const minBet = cfg.bet !== undefined && cfg.bet !== "" ? Number(cfg.bet) : Number.NaN
	const maxBet =
		cfg.maxBetAmount !== undefined && cfg.maxBetAmount !== "" ? Number(cfg.maxBetAmount) : Number.NaN
	const minBoundRaw = resolveMinBetBound(minBet)
	const maxBound = Number(setRegalRate(maxBet, rateCoinForBetRange.value))
	const minOk =
		!Number.isFinite(minBet) || (Number.isFinite(minBoundRaw) && amount >= minBoundRaw)
	const maxOk =
		!Number.isFinite(maxBet) || (Number.isFinite(maxBound) && amount <= maxBound)
	tableRangeInvalidWallet.value = !(minOk && maxOk)
}

// 小数位数随币种；桌台与余额提示由 validateBetRange + applyInsufficientBalanceUiAfterCommit 维护
const checkInputValue = () => {
	const raw = String(inputValue.value ?? "").trim()
	const n = raw === "" || raw === "." ? 0 : Number(raw)
	const amt = Number.isFinite(n) ? n : 0
	const empty = raw === "" || raw === "."
	validateBetRange(amt, empty)
	syncBalanceHintForCurrentAmount(amt, empty)
	decimalLengthCommon.value = effectiveBetInputDecimals.value
}

/** 余额/汇率异步落盘后再跑一轮，避免游戏页刷新时先误标「余额不足」 */
let walletHintRecheckTimer: ReturnType<typeof setTimeout> | null = null
scheduleWalletHintRecheck = () => {
	if (!import.meta.client) return
	if (walletHintRecheckTimer != null) clearTimeout(walletHintRecheckTimer)
	walletHintRecheckTimer = setTimeout(() => {
		walletHintRecheckTimer = null
		recheckInsufficientBalanceOnly()
	}, 150)
}

/** 汇率落地会改变「可下最大额」换算；勿对整个对象 deep 跑 `checkInputValue`，否则会干扰输入中的桌台提示 */
watch(
	() => rateData.value,
	() => {
		nextTick(() => {
			if (isBlur.value) {
				recheckInsufficientBalanceOnly()
			} else {
				checkInputValue()
			}
		})
		scheduleWalletHintRecheck()
	},
	{ deep: true }
)

watch(getMyInfoRoundDoneForWalletUi, (done) => {
	if (!done) return
	nextTick(() => checkInputValue())
	scheduleWalletHintRecheck()
})

// 监听钱包币种与显式传入的法币符号 / 虚拟币代码，同步小数位与展示
watch(
	() =>
		[userInfo.value.currencyType, props.currencySymbol, props.currencyCoin] as const,
	() => {
		checkInputValue()
		if (isBlur.value) return
		if (inputValue.value != "" && inputValue.value != undefined && inputValue.value != null) {
			nextTick(() => {
				const dp = effectiveBetInputDecimals.value
				inputValue.value = formatPoint(inputValue.value, dp) || ""
			})
		}
	},
	{ immediate: true }
)

watch(
	() => gameConfigStore.gameConfig,
	() => {
		nextTick(() => checkInputValue())
	},
	{ deep: true }
)

const bus = useEventBus()
const onLayoutWalletSettled = () => {
	nextTick(() => {
		checkInputValue()
		scheduleWalletHintRecheck()
	})
}

let betInputVisibilityIo: IntersectionObserver | null = null
onMounted(() => {
	if (import.meta.client) {
		bus.on("layoutGetMyInfoSettled", onLayoutWalletSettled)
		nextTick(() => {
			checkInputValue()
			scheduleWalletHintRecheck()
		})
		dismissBetInputFocusOnPointerDown = (e: PointerEvent) => {
			const el = betAmountInputEl.value
			if (!el || document.activeElement !== el) return
			const t = e.target as Node | null
			if (!t || el === t || el.contains(t)) return
			blurInput()
		}
		document.addEventListener("pointerdown", dismissBetInputFocusOnPointerDown, true)
	}
	if (!import.meta.client || typeof IntersectionObserver === "undefined") return
	nextTick(() => {
		const el = betInputRoot.value
		if (!el) return
		let prevVisible: boolean | null = null
		betInputVisibilityIo = new IntersectionObserver(
			(entries) => {
				const e = entries[0]
				const vis = !!(e?.isIntersecting && (e.intersectionRatio ?? 0) > 0)
				if (prevVisible === null) {
					prevVisible = vis
					return
				}
				if (vis && !prevVisible && !isBlur.value) {
					checkInputValue()
				}
				prevVisible = vis
			},
			{ threshold: 0.01, rootMargin: "0px" }
		)
		betInputVisibilityIo.observe(el)
	})
})
onBeforeUnmount(() => {
	if (import.meta.client) {
		bus.off("layoutGetMyInfoSettled", onLayoutWalletSettled)
		if (walletHintRecheckTimer != null) {
			clearTimeout(walletHintRecheckTimer)
			walletHintRecheckTimer = null
		}
		if (dismissBetInputFocusOnPointerDown) {
			document.removeEventListener("pointerdown", dismissBetInputFocusOnPointerDown, true)
			dismissBetInputFocusOnPointerDown = null
		}
	}
	betInputVisibilityIo?.disconnect()
	betInputVisibilityIo = null
})

const parseCommittedAmountFromInput = () => {
	const raw = String(inputValue.value ?? "").trim()
	const n = raw === "" || raw === "." ? 0 : Number(raw)
	return Number.isFinite(n) ? n : 0
}

defineExpose({
	/** 下注前或点页面其它区域时调用：收起键盘并走 `handleBlur` 截断小数 */
	blurInput,
	checkedinputPass,
	checkedinputFail,
	/** 按当前输入值重新跑 min/max（含 `setRegalRate`）；切换货币后一般已由内部 watch 触发，特殊流程可再调一次 */
	checkInputValue,
	/**
	 * 下注前拦截：桌台 min/max、**当前**金额是否超余额（与失焦提示分离），或 `checkedinputFail`。
	 */
	isBetAmountInvalid: () => {
		if (manualInvalid.value) return true
		if (tableRangeInvalidWallet.value) return true
		const amount = parseCommittedAmountFromInput()
		if (!Number.isFinite(amount) || amount <= 0) return false
		if (skipWalletBalanceCompareWithGlobalMax.value) return false
		// 提交时用「即时桌台比较」兜底，避免 ref/watch 与 expose 不同步导致放行非法金额
		if (isBetTableRangeInvalid(amount)) return true
		if (!isUserWalletBalanceUiReady()) return false
		return amount > getUserBalanceMax()
	},
})
</script>
<style scoped lang="scss">
@use "./common.scss";

.betInputRoot {
	width: 100%;
	display: flex;
	flex-direction: column;
}

.minAmountSpan {
	font-size: 12px;
	word-break: break-all;
}

.minAmountSpan--belowQuick {
	display: block;
	margin-top: 8px;
}

.minMaxReference {
	color: #94a1ba;
}

.minMaxReference--invalid {
	color: #ffba53;
}

.balanceInsufficientHint {
	display: block;
	margin-top: 0;
	color: #ffba53;
}

/* 金额输入框 — 对齐线上 BetInput / 参考稿 */
.custom-input1 {
	width: 100%;
	min-height: 48px;
	border-radius: 10px;
	border: 1px solid var(--new-aside-border-color, #1c2a46);
	background: var(--new-message-input-background, #09122b);
	display: flex;
	align-items: center;
	padding: 0 12px;
	box-sizing: border-box;
	gap: 8px;
	transition: border-color 0.15s ease;

	&.isBlur {
		border-color: #94a1ba;
	}

	&.hoverBorder:hover {
		border-color: #94a1ba;
	}

	&.redBorder {
		border-color: #ffba53 !important;
	}

	.inputIcom {
		display: flex;
		align-items: center;
		flex-shrink: 0;
		gap: 6px;

		> img {
			width: 20px;
			height: 20px;
			object-fit: contain;
			display: block;
		}

		.money {
			font-size: 15px;
			font-weight: 600;
			color: var(--new-white, #fff);
			line-height: 1;
			white-space: nowrap;
		}
	}

	.pri_input.gameInput {
		flex: 1;
		min-width: 0;
		width: auto;
		height: 46px;
		margin: 0;
		padding: 0 0 0 2px;
		border: none !important;
		outline: none !important;
		box-shadow: none !important;
		background: transparent !important;
		color: var(--new-white, #fff) !important;
		font-size: 15px;
		font-weight: 600;
		line-height: 46px;
		-webkit-appearance: none;
		appearance: none;

		&::placeholder {
			color: #456c99;
			font-size: 15px;
			font-weight: 500;
			opacity: 0.85;
		}

		&:hover,
		&:focus {
			border: none !important;
			outline: none !important;
			background: transparent !important;
		}

		&:disabled {
			opacity: 0.55;
			cursor: not-allowed;
		}
	}
}
</style>