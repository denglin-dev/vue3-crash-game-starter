<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue"
import { useI18n } from "vue-i18n"
import { autoBetData } from "../composables/useAutoBet"
import {
	InGame,
	isAutoModel,
	getCashOut,
	userBetInfo,
	minesIdleAmountPrefix,
	minesRoundDisplayUseFiatSymbol,
	minesRoundFiatSymbolFrozen,
	minesRoundCurrencyFreeze,
	minesBetFiatIsoFromBetInfoRecord,
} from "../composables/useMinesState"
import { useMinesGame } from "../composables/useMinesGame"
import gemsVideo from "/sounds/mines/sound_gems.mp3"
import bombVideo from "/sounds/mines/sound_mines.mp3"
import winVideo from "/sounds/mines/win.mp3"
import { useGame } from "~/composables/GameHook"
import { ShortSfxWebAudioController } from "~/utils/sound/shortSfxWebAudio"
import { createDeferGameSfxController } from "~/utils/sound/deferGameSfx"
import { ensurePreparedAudioInCache, replayAudioFromStartDeferred } from "~/utils/sound/prepareCachedGameAudio"
import {
	setMinesWebSfxUserGestureHook,
	runMinesBetUserGestureSfxHook,
} from "../minesSfxGestureBridge"
import { getFiatDisplaySymbolByCode, userInfo } from "~/utils/hook/hook"
import type { GridItem } from "../types"

const MINES_GRID_TEXTURES = [
	"/img/game_mine/1-5.webp",
	"/img/game_mine/2-5.webp",
	"/img/game_mine/3-5.webp",
	"/img/game_mine/5-5.webp",
	"/img/game_mine/6-5.webp"
]
let minesGridTexturePreloadPromise: Promise<void> | null = null

const preloadMinesGridTextures = () => {
	if (!import.meta.client) return Promise.resolve()
	if (minesGridTexturePreloadPromise) return minesGridTexturePreloadPromise
	minesGridTexturePreloadPromise = Promise.all(
		MINES_GRID_TEXTURES.map((src) => {
			return new Promise<void>((resolve) => {
				const img = new Image()
				img.src = src
				img.onload = () => resolve()
				img.onerror = () => resolve()
			})
		})
	).then(() => undefined)
	return minesGridTexturePreloadPromise
}

const { t: $t } = useI18n()
const { soundState } = useGame()
const { pickTileFun } = useMinesGame(useI18n())

/** 三档格子音效：Web Audio；失败时 HTML 兜底（与 Dice 一致，减轻多局挂起后全哑） */
const MINES_SFX = { gems: "gems", bomb: "bomb", win: "win" } as const
const minesWebSfx = new ShortSfxWebAudioController([
	{ key: MINES_SFX.gems, url: gemsVideo },
	{ key: MINES_SFX.bomb, url: bombVideo },
	{ key: MINES_SFX.win, url: winVideo }
])
const minesSfxHtmlFallbackCache = new Map<string, HTMLAudioElement>()
/** 格点/结算音效略晚于翻转动画，减轻与主线程峰值叠在一起 */
const minesTileSfxDefer = createDeferGameSfxController()
let minesSfxUnlockListenersCleanup: (() => void) | null = null

const minesSfxResumeFromBetStack = async () => {
	if (!soundState.isClickSoundEnabled || !import.meta.client) return
	await minesWebSfx.resumeRunningAndPreloadFromBetStack()
}

const attachMinesSfxGestureUnlockListeners = () => {
	if (minesSfxUnlockListenersCleanup || !import.meta.client) return
	const onFirstGesture = () => {
		runMinesBetUserGestureSfxHook()
		detachMinesSfxGestureUnlockListeners()
	}
	const docOpts: AddEventListenerOptions = { capture: true, passive: true }
	document.addEventListener("pointerdown", onFirstGesture, docOpts)
	document.addEventListener("touchstart", onFirstGesture, docOpts)
	minesSfxUnlockListenersCleanup = () => {
		document.removeEventListener("pointerdown", onFirstGesture, docOpts)
		document.removeEventListener("touchstart", onFirstGesture, docOpts)
		minesSfxUnlockListenersCleanup = null
	}
}

const props = defineProps({
	gridSize: {
		type: Number,
		default: 25
	}
})
const gameOverAndWin = ref<boolean>(false)
const cashOutMul = ref(0)
const cashOutMon = ref<string | number>(0)

/**
 * 父组件在 `UserCashOut` 之后会立刻 `minesRoundClearFrozenDisplay()`，全局冻结 ref 被清空。
 * 结算蒙层与格上角标若仍读全局 ref，会丢失法币符号或把金额按 6 位重排；此处快照本局展示口径。
 */
const minesPostGameUseFiatSymbol = ref(false)
const minesPostGameFiatPrefix = ref("")
const minesPostGameMoneyDecimals = ref<2 | 6 | null>(null)

function strField(v: unknown): string {
	return typeof v === "string" ? v.trim() : ""
}

/** 与 `MinesCommon` / `getBetInfo` 一致：有本局 `userBetInfo` 时法币用 `faitType→$` 等，虚拟币用 `accountType` 前缀；否则用冻结快照 `minesIdleAmountPrefix` */
const minesDisplayAmountPrefix = computed(() => {
	const info = userBetInfo.value as Record<string, unknown>
	if (!info || typeof info !== "object" || Object.keys(info).length === 0) {
		return minesIdleAmountPrefix.value
	}
	const ctRaw = strField(info.currencyType) || userInfo.value.currencyType
	const ct = /^FIAT$/i.test(ctRaw) ? "FAIT" : ctRaw
	if (ct === "FAIT") {
		const fiat = minesBetFiatIsoFromBetInfoRecord(info)
		if (fiat) return getFiatDisplaySymbolByCode(fiat)
		return strField(info.symbol) || minesIdleAmountPrefix.value
	}
	const coin = strField(info.accountType) || strField(info.currency) || strField(info.coinSymbol)
	return coin || minesIdleAmountPrefix.value
})

/** 本局首次下注冻结的法币符号；兑现后仍用于格上/结算，避免中间切钱包改掉符号 */
const minesRoundFiatPrefixForUi = computed(() => {
	if (minesRoundDisplayUseFiatSymbol.value !== true) return ""
	const frozen = minesRoundFiatSymbolFrozen.value
	if (frozen) return frozen
	return minesDisplayAmountPrefix.value
})

/** 结算/格上金额：与本局 `minesRoundCurrencyFreeze` 小数位一致（法币 2 / 虚拟币 6） */
const formatMinesRoundSettlementAmount = (raw: string | number): string => {
	const n = typeof raw === "string" ? Number(String(raw).trim()) : Number(raw)
	const dec = minesRoundCurrencyFreeze.value?.decimals ?? (minesRoundDisplayUseFiatSymbol.value === true ? 2 : 6)
	if (!Number.isFinite(n)) {
		return dec === 2 ? "0.00" : "0.000000"
	}
	return dec === 2 ? n.toFixed(2) : n.toFixed(6)
}

const resolveMinesGridMoneyDecimals = (): 2 | 6 =>
	(minesRoundCurrencyFreeze.value?.decimals ??
		(minesRoundDisplayUseFiatSymbol.value === true ? 2 : 6)) as 2 | 6

/** 中途顶栏换币后冻结/小数位修正：把已写死的格上字符串按当前本局小数位重排，避免长期停在 6 位 */
const reformatGridMoniesForRoundDecimals = () => {
	const dec =
		(gameOverAndWin.value || gameOver.value) && minesPostGameMoneyDecimals.value != null
			? minesPostGameMoneyDecimals.value
			: resolveMinesGridMoneyDecimals()
	for (const it of gridList.value) {
		if (it.money == null || it.money === "" || it.money === 0) continue
		const raw =
			typeof it.money === "number"
				? it.money
				: Number.parseFloat(String(it.money).replace(/[^0-9.+-eE]/g, ""))
		if (!Number.isFinite(raw)) continue
		it.money = dec === 2 ? raw.toFixed(2) : raw.toFixed(6)
	}
	const c = cashOutMon.value
	if (c != null && c !== "") {
		const n =
			typeof c === "number" ? c : Number.parseFloat(String(c).replace(/[^0-9.+-eE]/g, ""))
		if (Number.isFinite(n)) {
			cashOutMon.value = dec === 2 ? n.toFixed(2) : n.toFixed(6)
		}
	}
}

watch(
	() => [minesRoundCurrencyFreeze.value?.decimals, minesRoundDisplayUseFiatSymbol.value] as const,
	() => {
		reformatGridMoniesForRoundDecimals()
	}
)

const detachMinesSfxGestureUnlockListeners = () => {
	minesSfxUnlockListenersCleanup?.()
}

const playMinesSfxKey = (key: (typeof MINES_SFX)[keyof typeof MINES_SFX], url: string) => {
	minesTileSfxDefer.schedule(() => {
		minesWebSfx.play(key, {
			onPlaybackImpossible: () => {
				const a = ensurePreparedAudioInCache(minesSfxHtmlFallbackCache, url)
				replayAudioFromStartDeferred(a, (e) => {
					if (import.meta.dev) console.warn("[mines] HTML sfx fallback failed", e)
				})
			},
		})
	}, 34)
}

const playVideo = (type: number) => {
	if (!soundState.isClickSoundEnabled) return
	switch (type) {
		case 1:
			playMinesSfxKey(MINES_SFX.gems, gemsVideo)
			break
		case 2:
			playMinesSfxKey(MINES_SFX.bomb, bombVideo)
			break
		case 3:
			playMinesSfxKey(MINES_SFX.win, winVideo)
			break
		default:
			break
	}
}
const customGridItemNum = ref(props.gridSize)

const gridList = ref<GridItem[]>([])
const gridColumnMap: Record<number, number> = {
	25: 5,
	36: 6,
	49: 7,
	64: 8
}
const gameOver = ref(false)

const autoChooseIndexArr = ref<number[]>([])
const clearAutoIndex = () => {
	autoChooseIndexArr.value = []
}
/**
 * 初始化格子列表
 * @param bol 说明是在自动模式关闭时触发的，需要做一些特殊处理
 * @param isFlipped 说明需要展示问号
 */
const initGridList = (bol?: boolean, isFlipped?: boolean) => {
	minesPostGameUseFiatSymbol.value = false
	minesPostGameFiatPrefix.value = ""
	minesPostGameMoneyDecimals.value = null
	gameOver.value = false
	gameOverAndWin.value = false
	if (autoBetData.start || bol) {
		gridList.value.forEach((_item, index) => {
			_item.isClick = autoChooseIndexArr.value.includes(index)
			_item.state = 0
			_item.isFlipped = isFlipped ? autoChooseIndexArr.value.includes(index) : false
			_item.type = bol ? "ques" : ""
			_item.score = 1.97
		})
		return
	}

	if (!customGridItemNum.value) return
	gridList.value = Array.from(
		{ length: customGridItemNum.value },
		(_item, index) =>
			({
				id: index + 1,
				state: 0,
				isFlipped: false,
				isClick: false,
				money: 0,
				type: "",
				score: 1.97
			}) as GridItem
	)
}

const changeGrid = (gridSize: number) => {
	if (!gridSize) return
	customGridItemNum.value = gridSize

	clearAutoIndex()
	initGridList()
}
/**
 * 用户点击格子请求
 * @param btn_profit 按钮上要显示的数字
 * @param index 格子下标
 * @param type 翻牌结果 2是雷
 */
const UserPickTileReq = (btn_profit: number, index: number, type: number) => {
	if (!gridList.value[index]) return
	gridList.value[index].money = formatMinesRoundSettlementAmount(btn_profit)
	gridList.value[index].isFlipped = true

	gridList.value[index].isClick = true
	if (type === 2) {
		gridList.value[index].type = "mine"
		gameOver.value = true
		playVideo(2)
	} else {
		gridList.value[index].type = "money"
		playVideo(1)
	}
}
// 修改 list 的状态
const changeListStatus = (arr: number[]) => {
	arr.forEach((e, index) => {
		if (e !== 0 && gridList.value[index]) {
			gridList.value[index].isFlipped = true
			gridList.value[index].money = 0
			gridList.value[index].state = 1
			gridList.value[index].type = e === 2 ? "mine" : "money"
		}
	})
}
/**
 * 提现/自动局结算后的棋盘展示；顶部走势由 useMinesBet.pushMinesHistoryFromResult / refreshMinesHistory 维护。
 * @param _is_suc 是否成功 0 成功
 * @param payout 派彩金额
 * @param list 所有格子状态 0 未开 1 宝石 2 雷
 * @param multplier 倍数
 * @param win 是否胜利
 */
const UserCashOut = (_is_suc: unknown, payout: number, list: unknown, multplier: number, win?: number) => {
	const fz = minesRoundCurrencyFreeze.value
	minesPostGameUseFiatSymbol.value =
		fz?.kind === "FAIT" || minesRoundDisplayUseFiatSymbol.value === true
	minesPostGameFiatPrefix.value = minesPostGameUseFiatSymbol.value
		? minesRoundFiatSymbolFrozen.value || minesDisplayAmountPrefix.value
		: ""
	minesPostGameMoneyDecimals.value = resolveMinesGridMoneyDecimals()

	gameOver.value = true
	if (payout > 0 || win) {
		gameOverAndWin.value = true
		cashOutMul.value = multplier
		cashOutMon.value = formatMinesRoundSettlementAmount(payout)
		playVideo(3)
	} else if (Array.isArray(list) && list.some((e: number) => Number(e) === 2)) {
		playVideo(2)
	}
	if (!Array.isArray(list)) return
	const payoutStr = formatMinesRoundSettlementAmount(payout)
	list.forEach((e: number, index: number) => {
		if (e !== 0 && gridList.value[index]) {
			gridList.value[index].isFlipped = true
			gridList.value[index].money = payoutStr
			gridList.value[index].type = e === 2 ? "mine" : "money"
		}
	})
}
const getAutoIndexArr = () => {
	return autoChooseIndexArr.value
}
let lastTouchGridAt = 0
let touchGridStart: { x: number; y: number; time: number; item: GridItem; index: number } | null = null

// 点击卡片时翻转它
const flipCard = (_item: GridItem, index: number) => {
	if (autoBetData.start) return
	if (isAutoModel.value) {
		// 自动模式
		if (gridList.value[index].isFlipped) {
			autoChooseIndexArr.value = autoChooseIndexArr.value.filter((i) => i !== index)
			gridList.value[index].isFlipped = false
			gridList.value[index].type = ""
			gridList.value[index].isClick = false
		} else {
			autoChooseIndexArr.value.push(index)
			gridList.value[index].isFlipped = true
			gridList.value[index].type = "ques"
			gridList.value[index].isClick = true
		}
		getCashOut()
		return
	}
	if (InGame.value && !gridList.value[index].isFlipped) {
		pickTileFun(index)
	}
}

const onGridTouchStart = (event: TouchEvent, item: GridItem, index: number) => {
	const touch = event.touches[0]
	if (!touch) return
	touchGridStart = {
		x: touch.clientX,
		y: touch.clientY,
		time: Date.now(),
		item,
		index
	}
}

const onGridTouchEnd = (event: TouchEvent) => {
	if (!touchGridStart) return
	const touch = event.changedTouches[0]
	if (!touch) {
		touchGridStart = null
		return
	}
	const dx = touch.clientX - touchGridStart.x
	const dy = touch.clientY - touchGridStart.y
	const moved = Math.hypot(dx, dy)
	const elapsed = Date.now() - touchGridStart.time
	const tap = moved <= 18 && elapsed <= 600
	const start = touchGridStart
	touchGridStart = null
	if (!tap) return
	lastTouchGridAt = Date.now()
	flipCard(start.item, start.index)
}

const onGridTouchCancel = () => {
	touchGridStart = null
}

const onGridClick = (item: GridItem, index: number) => {
	if (Date.now() - lastTouchGridAt < 450) return
	flipCard(item, index)
}

// 随机翻转一个未翻开的格子
const randomFlipCard = () => {
	const availableIndices: number[] = []
	gridList.value.forEach((_item, index) => {
		if (!_item.isFlipped) {
			availableIndices.push(index)
		}
	})
	if (availableIndices.length === 0) return false

	const randomIndex = availableIndices[Math.floor(Math.random() * availableIndices.length)]
	flipCard(gridList.value[randomIndex], randomIndex)
	return true
}
const showWinMultiples = (item: GridItem) => {
	return item.type === "money" && item.isFlipped && item.isClick
}
watch(
	() => gameOver.value,
	() => {
		if (!gameOver.value || !gridList.value) return
		gridList.value.forEach((item) => {
			if (item.isClick || item.type === "mine" || item.type === "money" || item.type === "ques") {
				item.isFlipped = true
			}
		})
	}
)
onMounted(() => {
	initGridList()
	if (import.meta.client) {
		void preloadMinesGridTextures()
		setMinesWebSfxUserGestureHook(minesSfxResumeFromBetStack)
		attachMinesSfxGestureUnlockListeners()
		void minesWebSfx.preloadAll().catch(() => {
			/* ignore */
		})
	}
})

onUnmounted(() => {
	if (import.meta.client) {
		minesTileSfxDefer.invalidate()
		setMinesWebSfxUserGestureHook(null)
		detachMinesSfxGestureUnlockListeners()
		minesWebSfx.dispose()
		minesSfxHtmlFallbackCache.forEach((audio) => {
			try {
				audio.pause()
			} catch {
				/* ignore */
			}
		})
		minesSfxHtmlFallbackCache.clear()
	}
})
defineExpose({
	changeGrid,
	changeListStatus,
	initGridList,
	getAutoIndexArr,
	clearAutoIndex,
	UserCashOut,
	UserPickTileReq,
	autoChooseIndexArr,
	gameOverAndWin,
	randomFlipCard
})
</script>

<template>
	<div class="mine-container">
		<div class="grid-box" :style="{ '--column': gridColumnMap[customGridItemNum] }"
			:class="{ 'grid-box-6': customGridItemNum === 64, 'grid-box-5': customGridItemNum === 49 }"
			:key="customGridItemNum">
			<div v-for="(item, index) in gridList" :key="item.id" class="grid-item"
				:class="{ flipped: item.isFlipped, notActive: !item.isClick && gameOver }"
				@touchstart="onGridTouchStart($event, item, index)" @touchend="onGridTouchEnd"
				@touchcancel="onGridTouchCancel" @click="onGridClick(item, index)">
				<div class="card" :class="{ flipped: item.isFlipped }">
					<!--      正面-->
					<div class="card-front" />
					<!--反面-->
					<div class="card-back">
						<img v-if="item.type === 'money'" class="card-img" src="/img/game_mine/3-5.webp" alt="" />
						<img v-if="item.type === 'mine'" class="card-img" src="/img/game_mine/5-5.webp" alt="" />
						<img v-if="item.type === 'ques'" class="card-img" src="/img/game_mine/6-5.webp" alt="" />
						<div v-if="item.type === 'mine' && item.isClick" class="boom-group">
							<div v-for="i in 15" :key="i" class="boom" :class="[`boom_${i}`]" />
						</div>
					</div>
				</div>
				<!-- 展示规则随「本局首次下注」冻结，与中途切钱包无关 -->
				<div v-if="showWinMultiples(item) && !isAutoModel && item.money" class="multiple_success">
					<template v-if="minesPostGameUseFiatSymbol">{{ minesPostGameFiatPrefix }}{{ item.money }}</template>
					<template v-else-if="minesRoundDisplayUseFiatSymbol === true">{{ minesRoundFiatPrefixForUi }}{{
						item.money }}</template>
					<template v-else>{{ item.money }}</template>
				</div>
			</div>
		</div>
		<!--    结算-->
		<div v-if="gameOverAndWin" class="settlement-mask">
			<div class="settlement">
				<h3 class="title Cy_font_Bold"> {{ $t("fairness.win") }}</h3>
				<!-- 与格上角标一致：本局首次下注为法币则带冻结符号，虚拟币则仅数字 -->
				<div class="money">
					<template v-if="minesPostGameUseFiatSymbol">{{ minesPostGameFiatPrefix }} {{ cashOutMon
						}}</template>
					<template v-else-if="minesRoundDisplayUseFiatSymbol === true">{{ minesRoundFiatPrefixForUi }} {{
						cashOutMon }}</template>
					<template v-else>{{ cashOutMon }}</template>
				</div>
				<div class="multiple_value Cy_font_Bold">{{ cashOutMul }}x</div>
			</div>
		</div>
	</div>
</template>

<style lang="scss" scoped>
.mine-container {
	display: flex;
	justify-content: center;
	align-items: center;
	position: relative;
	overscroll-behavior: auto;
	touch-action: pan-y;

	.grid-box {
		padding: 10px;
		display: grid;
		gap: 15px;
		grid-template-columns: repeat(var(--column), minmax(25px, 90px));
		touch-action: pan-y;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;

		&.grid-box-6 {
			grid-template-columns: repeat(var(--column), minmax(25px, 67px));
		}

		&.grid-box-5 {
			grid-template-columns: repeat(var(--column), minmax(25px, 80px));
		}

		.grid-item {
			position: relative;
			align-self: center;
			width: 100%;
			padding-top: 100%;
			transition: transform 0.3s, opacity 0.3s;
			touch-action: pan-y;

			@media (hover: hover) and (pointer: fine) {
				&:hover:not(.flipped) {
					transform: translateY(-5px);
				}
			}

			&.notActive {
				opacity: 0.35;
			}
		}
	}
}

.settlement-mask {
	position: absolute;
	left: 0;
	top: 0;
	width: 100%;
	height: 100%;
	display: flex;
	align-items: center;
	justify-content: center;
	animation: zoomIn 0.2s ease-in-out both;
}

.settlement {
	width: 252px;
	height: 138px;
	padding: 15px;
	border-radius: 10px;
	border: 1px solid #1c2a46;
	background: #111933;
	box-shadow: 0 4px 6px 0 rgba(4, 13, 38, 0.16);
	display: flex;
	flex-direction: column;
	align-items: center;

	.title {
		color: #fff;
		font-size: 16px;
		font-weight: 700;
		line-height: 18px;
	}

	.money {
		color: #20ce2e;
		font-size: 32px;
		font-weight: 600;
		line-height: 34px;
		letter-spacing: -0.96px;
		border-bottom: 1px solid #1c2a46;
		padding: 10px;
		margin-bottom: 10px;
		width: 100%;
		text-align: center;
	}

	.multiple_value {
		padding: 4px 15px;
		border-radius: 4px;
		background: #202b50;
		color: #fff;
		font-size: 16px;
		font-weight: 700;
		line-height: 18px;
	}
}

.card {
	position: absolute;
	left: 0;
	top: 0;
	cursor: pointer;
	width: 100%;
	height: 100%;
	transition: transform ease-in 0.35s;
	transform-style: preserve-3d;
	touch-action: pan-y;

	&.flipped {
		transform: rotateY(180deg);
	}
}

.card-front,
.card-back {
	position: absolute;
	width: 100%;
	height: 100%;
	backface-visibility: hidden;
	display: flex;
	justify-content: center;
	align-items: center;

	.card-img {
		width: 100%;
	}
}

.card-front {
	background: url("/img/game_mine/1-5.webp") no-repeat 0 0;
	background-size: cover;

	@media (hover: hover) and (pointer: fine) {
		&:hover {
			background: url("/img/game_mine/2-5.webp") no-repeat 0 0;
			background-size: contain;
		}
	}
}

.card-back {
	transform: rotateY(180deg);
}

.multiple_default {
	position: absolute;
	color: #456c99;
	bottom: 2px;
	left: 0;
	width: 100%;
	text-align: center;
	font-size: 12px;
}

.multiple_success {
	position: absolute;
	top: -10px;
	right: -8px;
	border-radius: 300px;
	background: #20ce2e;
	display: flex;
	padding: 2px 10px;
	justify-content: center;
	align-items: center;
	box-sizing: border-box;
	color: #fff;
	font-size: 14px;
	font-weight: 500;
	z-index: 1;
	opacity: 0;
	animation: fadeInOut 2s linear both;
}

.boom-group {
	.boom {
		width: 100%;
		height: 100%;
		position: absolute;
		left: 0;
		top: 0;
		background: url("/img/game_mine/boom.png") no-repeat;
		$step: 90px;

		@for $i from 0 through 14 {
			&.boom_#{$i + 1} {
				background-position: center -#{$i * $step};
				animation: fadeInOut 0.2s #{0.04 * $i}s linear both;
			}
		}
	}
}

@media (max-width: 1000px) {
	.mine-container {
		.grid-box {
			gap: 10px;
		}
	}
}

@media (max-width: 768px) {
	.mine-container {
		border-radius: 10px;
		background: #111933;

		.grid-box {
			gap: 10px;
		}

		.multiple_success {
			right: 50%;
			transform: translateX(50%);
		}
	}
}

@keyframes fadeInOut {
	0% {
		opacity: 0;
	}

	50% {
		opacity: 1;
	}

	100% {
		opacity: 0;
	}
}

@keyframes zoomIn {
	from {
		transform: scale(0);
	}

	to {
		transform: scale(1);
	}
}
</style>
