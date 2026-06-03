<template>
	<div class="bettingStatistics" :style="bettingStatisticsCssVars">
		<div class="totalBox">
			<div class="totalBetNumber">
				<img src="/img/gamepage/person.svg" />
				<span class="Cy_font_Medium">{{ betCountDisplay }}</span>
			</div>
			<div class="totalBetAmount">
				<!-- <img src="/img/gamepage/betAmount.svg" /> -->
				<span class="Cy_font_Medium">
					<span class="betAmountSymbol">{{ getDefailtSymbol }}</span>
					{{ formatNumberWithCommas(accuracyNumber(String(betAmountDisplay)))
					}}</span>
			</div>
		</div>
		<div class="bettingRecord Cy_font_Medium crash-totalbet-virtual">
			<!-- 虚拟列表：仅挂载可视区 + 上下缓冲行，避免 100+ 行全量 DOM -->
			<div class="virtual-table">
				<div class="table-header cti" style="padding: 0; background: transparent">
					<div class="table-row cti thd virtual-header-row"
						:style="{ gridTemplateColumns: tableProps.gridTemplate }">
						<div v-for="col in tableProps.columns" :key="col.key"
							class="table-cell Cy_font_Medium text-ellipsis" style="max-width: 100%">
							{{ col.title }}
						</div>
					</div>
				</div>
				<div ref="scrollEl" class="virtual-scroll-body crashGameTableScroll"
					:class="{ 'virtual-scroll-body--empty': crashBettingTableRows.length === 0 }"
					:style="scrollAreaStyle" @scroll.passive="onScroll">
					<template v-if="crashBettingTableRows.length === 0">
						<div class="virtual-empty">
							<img src="/img/components/noData.svg" alt="" />
							<div class="no-data-text">{{ $t('noDataMessage.No_Data') }}</div>
						</div>
					</template>
					<template v-else>
						<div v-if="virtual.topPad > 0" class="virtual-spacer"
							:style="{ height: virtual.topPad + 'px' }" />
						<div v-for="row in virtual.slice" :key="row.rowKey"
							class="table-row cti thd Cy_font_Medium virtual-data-row" :style="{
								gridTemplateColumns: tableProps.gridTemplate,
								padding: '0',
								minHeight: ROW_HEIGHT + 'px',
								height: ROW_HEIGHT + 'px',
							}">
							<div class="table-cell crash-cell-name">
								<div class="crashTableName">
									<img :src="row.Headimg" alt="" v-if="row.Headimg" />
									<span class="userName overH" :title="row.NickName">{{ row.NickName }}</span>
								</div>
							</div>
							<div class="table-cell crash-cell-color">
								<div class="crashTableColor overH">
									<span :title="getCashOut(row.gamedata.cash_out)">
										{{ getCashOut(row.gamedata.cash_out) }}
									</span>
								</div>
							</div>
							<div class="table-cell crash-cell-amount">
								<div class="crashTableAmount overH" :title="`${getDefailtSymbol} ${row.gamedata.bet}`">
									{{ getDefailtSymbol }} {{ row.gamedata.bet }}
								</div>
							</div>
							<div class="table-cell crash-cell-win">
								<div class="crashTableWin overH" :title="String(
									getColorName(getWin(row)) === 'redColor'
										? getWin(row).toString().slice(1)
										: getWin(row)
								)
									" :class="[getColorName(getWin(row))]">
									{{ getWin(row) === $t('newlang.betting') ? '' : getDefailtSymbol }}
									{{
										String(getColorName(getWin(row)) === 'redColor'
											? getWin(row).toString().slice(1)
											: getWin(row))
									}}
								</div>
							</div>
						</div>
						<div v-if="virtual.bottomPad > 0" class="virtual-spacer"
							:style="{ height: virtual.bottomPad + 'px' }" />
					</template>
				</div>
			</div>
		</div>
	</div>
</template>
<script setup lang="ts">
/**
 * 本局玩家下注列表：汇总人数/总金额；表格为虚拟列表，只渲染可视行。
 */
import { computed, ref, shallowRef, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { accuracyNumber, deviceAdvanced, getDefailtSymbol, userInfo } from '~/utils/hook/hook'
import { floorToDecimal, formatNumberWithCommas } from '~/utils/common'
import {
	crashBettingTableRows,
	crashBettingTableSummary,
} from '~/pages/newGame/crash/composables/useCrashState'
import type { CrashBettingTableRow } from '~/pages/newGame/crash/composables/useCrashState'

const { t: $t } = useI18n()
defineProps({
	tableTitle: {
		type: Array,
		default: () => ['Player', 'Color', 'Amount', 'Win'],
	},
})

/** 与行 CSS 一致，用于计算滚动窗口（px） */
const ROW_HEIGHT = 34
/** 视口外多渲染几行，快速滚动时不露白 */
const OVERSCAN = 8

/**
 * 表体滚动区高度：PC 用 clamp 配合外层 flex 吃满剩余；H5 用 clamp 作「固定视口」高度（min=height=max），数据再多只内部滚动、不撑高整页。
 */
const bettingStatisticsCssVars = computed(() => {
	const mobile = deviceAdvanced.value === 'mobile'
	const h = mobile
		? 'clamp(220px, 42vh, 400px)'
		: 'clamp(260px, min(52vh, calc(100svh - 380px)), 560px)'
	return { '--crash-totalbet-scroll-h': h } as Record<string, string>
})

/** 首帧虚拟列表估算高度，随后由 ResizeObserver 读真实 clientHeight */
const VIEWPORT_FALLBACK_PX = 360

const scrollAreaStyle = computed(() => ({
	width: '100%',
}))

/** 顶部人数 / 总下注额：与表格同源，由 `crashBettingTableSummary` 维护 */
const betCountDisplay = computed(() => crashBettingTableSummary.value.count)

const betAmountDisplay = computed(() => crashBettingTableSummary.value.totalBet)

const scrollEl = ref<HTMLElement | null>(null)
const scrollTop = shallowRef(0)
const viewportH = ref(VIEWPORT_FALLBACK_PX)

function onScroll(e: Event) {
	scrollTop.value = (e.target as HTMLElement).scrollTop
}

function measureViewport() {
	const el = scrollEl.value
	if (!el) return
	const h = el.clientHeight
	if (h > 0) viewportH.value = h
}

let resizeObserver: ResizeObserver | null = null

onMounted(() => {
	nextTick(() => {
		measureViewport()
		const el = scrollEl.value
		if (el && typeof ResizeObserver !== 'undefined') {
			resizeObserver = new ResizeObserver(() => measureViewport())
			resizeObserver.observe(el)
		}
	})
})

onUnmounted(() => {
	resizeObserver?.disconnect()
	resizeObserver = null
})

watch(
	() => crashBettingTableRows.value.length,
	(len) => {
		if (len === 0 && scrollEl.value) {
			scrollEl.value.scrollTop = 0
			scrollTop.value = 0
		}
		nextTick(measureViewport)
	}
)

watch(
	() => deviceAdvanced.value,
	() => nextTick(measureViewport)
)

/** 移动端用 fr 铺满容器，避免 430px 等宽屏下固定 330px 列宽右侧留白 */
const tableProps = computed(() => ({
	gridTemplate:
		deviceAdvanced.value === 'mobile'
			? 'minmax(0, 1.35fr) minmax(0, 0.9fr) minmax(0, 0.85fr) minmax(0, 0.9fr)'
			: '85px 58px 65px 63px',
	columns: [
		{ title: $t('Tag.Player'), key: 'name' },
		{ title: 'X', key: 'color' },
		{ title: $t('Tag.Amount'), key: 'amount' },
		{ title: $t('Tag.Win'), key: 'win' },
	],
}))

const virtual = computed(() => {
	const list = crashBettingTableRows.value as CrashBettingTableRow[]
	const n = list.length
	if (n === 0) {
		return { topPad: 0, bottomPad: 0, slice: [] as CrashBettingTableRow[], totalHeight: 0 }
	}
	const st = scrollTop.value
	const vh = Math.max(viewportH.value, 120)
	let start = Math.floor(st / ROW_HEIGHT)
	if (start < 0) start = 0
	const visibleCount = Math.ceil(vh / ROW_HEIGHT) + OVERSCAN * 2
	let end = Math.min(n, start + visibleCount)
	const slice = list.slice(start, end)
	const topPad = start * ROW_HEIGHT
	const bottomPad = (n - end) * ROW_HEIGHT
	return { topPad, bottomPad, slice, totalHeight: n * ROW_HEIGHT }
})

const getColorName = (str: string | number) => {
	const strVal = String(str)
	if (strVal.indexOf('-') !== -1 && strVal !== $t('newlang.betting')) {
		return 'redColor'
	} else if (strVal.indexOf('-') === -1 && strVal !== $t('newlang.betting')) {
		return 'greenColor'
	}
	return ''
}
const getCashOut = (str: number) => {
	switch (str) {
		case -1:
			return $t('newlang.bang')
		case 0:
			return $t('newlang.betting')
		default:
			return str.toFixed(2) + 'X'
	}
}

const getMoneyDecimalPlaces = () => (userInfo.value.currencyType === 'FAIT' ? 2 : 6)

const getWin = (v: { gamedata?: { cash_out?: number; bet?: number; winDisplay?: number } }) => {
	const cashOut = v.gamedata?.cash_out ?? 0
	const dec = getMoneyDecimalPlaces()
	if (cashOut > 0) {
		/** 已兑现：展示 min(payout, max_profit) 折 UI 额（见 `mapRoundBetsToGeneralList`），不再用 profit */
		return floorToDecimal(v.gamedata?.winDisplay ?? 0, dec)
	} else {
		if (cashOut === -1) {
			return -floorToDecimal(v.gamedata?.bet ?? 0, dec)
		} else {
			return $t('newlang.betting')
		}
	}
}
</script>
<style lang="scss" scoped>
@use '/public/style/table.scss';

.bettingStatistics {
	margin-top: 10px;
	flex: 1 1 0%;
	min-height: 0;
	display: flex;
	flex-direction: column;

	@media (max-width: 768px) {
		padding: 0 10px !important;
		flex: unset;
		min-height: unset;
		display: block;
	}

	:deep(.table-cell) {
		line-height: 14px;
		text-align: center;
		font-size: 13px;
	}

	:deep(.table-header) {
		height: auto;
	}

	.totalBox {
		display: flex;
		justify-content: space-between;
		align-items: center;

		.totalBetNumber {
			display: flex;
			justify-content: space-between;
			align-items: center;

			span {
				color: #fff;
				font-size: 14px;
				font-style: normal;
				font-weight: 500;
				line-height: 16px;
			}

			img {
				width: 14px;
				margin-right: 5px;
			}
		}

		.totalBetAmount {
			display: flex;
			justify-content: space-between;
			align-items: center;

			.betAmountSymbol {
				font-size: 14px;
			}

			span {
				color: #fff;
				font-size: 11px;
				font-style: normal;
				font-weight: 500;
				line-height: normal;
			}

			img {
				width: 16px;
				margin-right: 5px;
			}
		}
	}

	.bettingRecord {
		margin-top: 15px;
		flex: 1 1 0%;
		min-height: 0;
		display: flex;
		flex-direction: column;
		color: var(--1, #fff);
		font-size: 13px;
		font-style: normal;
		font-weight: 500;
		line-height: 15px;

		@media (max-width: 768px) {
			flex: unset;
			min-height: unset;
			display: block;
		}
	}

	.crashTableName {
		display: flex;
		align-items: center;
		width: 100%;
		min-width: 0;
		max-width: 100%;
		padding-left: 3px;
	}

	.crash-cell-name {
		min-width: 0;
		overflow: hidden;
		text-align: left;

		.userName {
			flex: 1;
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
	}

	.crashTableColor {
		width: 100%;
		text-align: center;

		>div {
			display: flex;
			justify-content: center;
			gap: 2px;
		}
	}

	.crash-totalbet-virtual .crashTableName img,
	.crash-totalbet-virtual .virtual-data-row img {
		width: 20px;
		height: 20px;
		border-radius: 50%;
		margin-right: 5px;
	}

	.crashTableWin {
		color: #456c99;
		width: 100%;

		&.redColor {
			color: #f00;
		}

		&.greenColor {
			color: #20ce2e;
		}
	}

	.crashTableAmount {
		width: 100%;
		text-align: center;
	}

	.overH {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
}

.virtual-table {
	background: var(--new-footer-bg-color, #1e293b);
	border-radius: 10px;
	margin-top: 2px;
	overflow: hidden;
	flex: 1 1 0%;
	min-height: 0;
	display: flex;
	flex-direction: column;
	width: 100%;

	@media (max-width: 768px) {
		flex: unset;
		min-height: unset;
		display: block;
	}
}

.virtual-header-row,
.virtual-data-row {
	width: 100%;
	box-sizing: border-box;
}

.virtual-header-row {
	padding: 0 4px;
	min-height: 30px;
	align-items: center;

	.text-ellipsis:nth-child(2),
	.text-ellipsis:nth-child(3),
	.text-ellipsis:nth-child(4) {
		display: flex;
		justify-content: center;
	}
}

.virtual-scroll-body {
	flex: 1 1 auto;
	width: 100%;
	/* PC：高度由外层 flex（min-height:0 + flex:1）约束，此处占满剩余空间 */
	height: auto;
	max-height: none;
	overflow: auto !important;
	overflow-x: hidden !important;
	-webkit-overflow-scrolling: touch;
	background: #09122b;

	@media (max-width: 768px) {
		flex: unset;
		/* 与 script 中 `--crash-totalbet-scroll-h`（clamp 220px~42vh~400px）一致：固定视口高度，数据再多只增加内部滚动，不撑高整页 */
		min-height: var(--crash-totalbet-scroll-h);
		height: var(--crash-totalbet-scroll-h);
		max-height: var(--crash-totalbet-scroll-h);
	}
}

/** 无数据：深蓝区仍铺满 flex 高度，内容靠上水平居中 */
.virtual-scroll-body.virtual-scroll-body--empty {
	display: grid;
	place-items: start center;
	align-content: start;
	box-sizing: border-box;
	padding: 10px;
}

.virtual-data-row {
	align-items: center;
	box-sizing: border-box;
}

.virtual-spacer {
	width: 100%;
	flex-shrink: 0;
}

.crash-cell-name,
.crash-cell-color,
.crash-cell-amount,
.crash-cell-win {
	min-width: 0;
}
</style>

<style lang="scss">
/* 与 public/style/table.scss 中 .crashGameTableScroll 一致；非 scoped，避免 scoped 影响 ::-webkit-scrollbar */
.bettingStatistics .virtual-scroll-body.crashGameTableScroll {
	overflow-y: auto !important;
	overflow-x: hidden !important;
	border-radius: 10px;
	touch-action: pan-y;
	-webkit-overflow-scrolling: touch;
}

/* 窄屏：盖掉 table.scss 的 230px 与历史 max-height:none，与 scoped 中固定视口一致，避免 !important 把高度锁死为「无限」 */
@media (max-width: 768px) {
	.bettingStatistics .virtual-scroll-body.crashGameTableScroll {
		height: var(--crash-totalbet-scroll-h, clamp(220px, 42vh, 400px)) !important;
		max-height: var(--crash-totalbet-scroll-h, clamp(220px, 42vh, 400px)) !important;
		min-height: var(--crash-totalbet-scroll-h, clamp(220px, 42vh, 400px)) !important;
	}
}

.bettingStatistics .virtual-scroll-body.crashGameTableScroll.virtual-scroll-body--empty .virtual-empty {
	display: flex !important;
	flex-direction: column;
	align-items: center;
	justify-content: flex-start;
	margin: 0;
	padding-top: 16px;
	opacity: 0.85;
}

.bettingStatistics .virtual-scroll-body.crashGameTableScroll.virtual-scroll-body--empty .virtual-empty img {
	width: 48px !important;
	height: 48px !important;
	margin-bottom: 15px !important;
	margin-right: 0 !important;
}

.bettingStatistics .virtual-scroll-body.crashGameTableScroll.virtual-scroll-body--empty .virtual-empty .no-data-text {
	font-size: 12px;
	color: #94a3b8;
}

.bettingStatistics .virtual-scroll-body.crashGameTableScroll::-webkit-scrollbar {
	width: 2px;
	height: 35px;
	border-radius: 100px;
}

.bettingStatistics .virtual-scroll-body.crashGameTableScroll::-webkit-scrollbar-thumb {
	background-color: #456c99;
	border-radius: 10px;
	-webkit-box-shadow: none;
}

.bettingStatistics .virtual-scroll-body.crashGameTableScroll:hover::-webkit-scrollbar-thumb {
	background-color: #456c99;
	border-radius: 10px;
	-webkit-box-shadow: none;
}

.bettingStatistics .virtual-scroll-body.crashGameTableScroll::-webkit-scrollbar-thumb:hover {
	background-color: #456c99;
}

.bettingStatistics .virtual-scroll-body.crashGameTableScroll::-webkit-scrollbar-track {
	border-radius: 10px;
	background-color: transparent;
}

.bettingStatistics .virtual-scroll-body.crashGameTableScroll::-webkit-scrollbar-track:hover {
	-webkit-box-shadow: none;
	background-color: transparent;
}
</style>
