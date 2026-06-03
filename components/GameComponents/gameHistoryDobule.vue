<template>
	<div style="position: relative; height: 40px; width: 100%">
		<div ref="refGameHistoryDouble" class="gameHistoryDouble" :class="[className]"
			:style="historyLayoutCssVars">
			<div class="doubleItemContent" v-if="displayList.length" v-show="itemShowNum > 0">
				<div style="cursor: pointer" v-for="(item, index) in displayList" :key="getItemKey(item, index)"
					@click="handleFairnessDetail(item)">
					<slot name="item" :item="item" :index="index">
						<div class="doubleItem" :class="{
							ml0: index === displayList.length - 1,
							newlyAdded: isNewestItem(item, index),
						}">
							<p class="userId Cy_font_Medium">{{ setBetID(item) }}</p>
							<div class="winDouble">
								<div class="colorBlock" :style="{ background: getItemBackground(item) }"
									aria-hidden="true">
								</div>
								<div class="gameDouble Cy_font_Bold">
									<span v-if="props.gameCode === GAME_CODE.DICE">{{ Number(item.rand_num).toFixed(2)
										?? '0.00' }}</span>
									<span v-else-if="item.multplier != null && item.multplier !== ''">
										{{ Number(item.multplier).toFixed(2) }}
									</span>
									<span v-else-if="crashPointDisplay(item) != null">{{ crashPointDisplay(item)
									}}</span>
									<span v-else>
										0.00
									</span>
									<slot name="x">{{ props.gameCode === GAME_CODE.DICE ? '' : 'x' }}</slot>
								</div>
							</div>
						</div>
					</slot>
				</div>
			</div>
		</div>
		<div class="gradient" v-if="itemShowNum > 0"></div>
	</div>
</template>
<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from "vue"
import { bus } from "~/utils/bus"
import { useGameConfigStore } from "~/stores/gameConfig"
import { getPlinkoMultipliersForRiskRow } from "~/pages/newGame/plinko/composables/usePlinkoState"
import { GAME_CODE } from "~/pages/newGame/common/composables/newGameCodes"

const props = defineProps({
	list: {
		type: Array as () => Array<{ [key: string]: any }>,
		default: []
	},
	itemWidth: {
		type: Number,
		default: 81
	},
	itemGap: {
		type: Number,
		default: 10
	},
	className: {
		type: String
	},
	isPinkoGame: {
		type: Boolean,
		default: false
	},
	/** Crash：crash_point &gt; 2 为赢绿，否则深底（与 gameHistoryDobuleNew 一致） */
	isCrashGame: {
		type: Boolean,
		default: false
	},
	gameCode: {
		type: String,
		default: ""
	},
	plinkoRow: {
		type: Number,
		default: 8
	},
	plinkoRisk: {
		type: Number,
		default: 0
	},
	plinkoMultipliers: {
		type: Array as () => number[],
		default: () => []
	}
})

const emiter = defineEmits(["colorTable"])

/** 与 Crash 默认一致：卡片最小宽、间距由 props 驱动，避免父级传 `item-width` 与内部 CSS 脱节 */
const historyLayoutCssVars = computed(() => ({
	"--gh-item-min-width": `${Number(props.itemWidth) || 81}px`,
	"--gh-item-gap": `${Number(props.itemGap) || 10}px`,
}))

/** 仅展示传入顺序，不在此 reverse；顺序由父组件 / 接口层统一为「旧 → 新」即可配合下方 flex-end（最新靠右）。 */
const displayList = computed(() => {
	const raw = props.list
	if (!raw?.length) return []
	return [...raw]
})

const newestItemKey = ref<string>("")
let newestItemTimer: ReturnType<typeof setTimeout> | null = null

const getItemKey = (item: any, index: number) => String(item?.bet_id ?? item?._bet_id ?? item?.uid ?? `idx_${index}`)
const isNewestItem = (item: any, index: number) => getItemKey(item, index) === newestItemKey.value

/** 新接口 crash_point；兼容旧字段 _tex 数值字符串 */
const crashPointDisplay = (item: any): string | number | null => {
	const raw = item?.crash_point ?? item?._tex
	if (raw === null || raw === undefined || raw === "") return null
	const n = Number(raw)
	if (Number.isFinite(n)) {
		// 必须返回两位小数字符串：若再包一层 Number()，2.80 会变成数字 2.8，界面上只显示 2.8
		return n.toFixed(2)
	}
	return raw
}

const setBetID = (item: any) => {
	if (item._bet_id || item.bet_id || item.this_bet_id) {
		const id = item._bet_id ?? item.bet_id ?? item.this_bet_id
		const s = String(id)
		return s.length > 8 ? s.substring(s.length - 8) : s
	}
	//默认 感觉没啥用
	return item._hash ? String(item._hash).substring(String(item._hash).length - 8) : ""
}

const PLINKO_SLOT_COLORS: Record<number, string[]> = {
	8: ["#F83557", "#F85858", "#FF7956", "#FF8F5D", "#FFB250", "#FF8F5D", "#FF7956", "#F85858", "#F83557"],
	9: ["#F83557", "#F85858", "#FF7956", "#FF8F5D", "#FFB250", "#FFB250", "#FF8F5D", "#FF7956", "#F85858", "#F83557"],
	10: ["#F83557", "#F85858", "#FF7559", "#EB7C4F", "#F89A52", "#FFB745", "#F89A52", "#EB7C4F", "#FF7559", "#F85858", "#F83557"],
	11: ["#F83557", "#F85858", "#FF7559", "#EB7C4F", "#F89A52", "#FFB745", "#FFB745", "#F89A52", "#EB7C4F", "#FF7559", "#F85858", "#F83557"],
	12: ["#F83557", "#FF4566", "#FA5551", "#FF7559", "#FB9058", "#FFA54D", "#FBC354", "#FFA54D", "#FB9058", "#FF7559", "#FA5551", "#FF4566", "#F83557"],
	13: ["#F83557", "#FF4566", "#FA5551", "#FF7559", "#FB9058", "#FFA54D", "#FBC354", "#FBC354", "#FFA54D", "#FB9058", "#FF7559", "#FA5551", "#FF4566", "#F83557"],
	14: ["#F83557", "#FF4566", "#EC575D", "#FF6E56", "#F8895B", "#FF9855", "#FFAE5A", "#FBC354", "#FFAE5A", "#FF9855", "#F8895B", "#FF6E56", "#EC575D", "#FF4566", "#F83557"],
	15: ["#F83557", "#FF4566", "#EC575D", "#FF6E56", "#F8895B", "#FF9855", "#FFAE5A", "#FBC354", "#FBC354", "#FFAE5A", "#FF9855", "#F8895B", "#FF6E56", "#EC575D", "#FF4566", "#F83557"],
	16: ["#F83557", "#FF4566", "#EC575D", "#FF6E56", "#F8895B", "#FF9855", "#FFAE5A", "#FBC354", "#FFE54F", "#FBC354", "#FFAE5A", "#FF9855", "#F8895B", "#FF6E56", "#EC575D", "#FF4566", "#F83557"]
}

/** Crash / 通用：赢绿；低倍 / 未中为玫红（与线上一致） */
const HISTORY_WIN_GREEN = "#20ce2e"
const HISTORY_DEFAULT_ROSE = "#f43f5e"

const parsePlinkoRow = (item: any): number => {
	const raw = item?.row ?? item?.rows
	const n = Number(raw)
	if (Number.isFinite(n)) return Math.max(8, Math.min(16, Math.floor(n)))
	return props.plinkoRow
}

const parsePlinkoRisk = (item: any): number => {
	const raw = item?.risk ?? item?.default_risk
	const n = Number(raw)
	if (Number.isFinite(n)) return Math.max(0, Math.min(2, Math.floor(n)))
	return props.plinkoRisk
}

const getItemBackground = (item: any) => {
	if (!props.isPinkoGame) {
		if (props.isCrashGame) {
			const cp = Number(item?.crash_point ?? item?._tex)
			return Number.isFinite(cp) && cp > 2 ? HISTORY_WIN_GREEN : HISTORY_DEFAULT_ROSE
		}
		return item.is_win ? HISTORY_WIN_GREEN : HISTORY_DEFAULT_ROSE
	}
	const row = parsePlinkoRow(item)
	const risk = parsePlinkoRisk(item)
	const colors = PLINKO_SLOT_COLORS[row] || []
	const mults = getPlinkoMultipliersForRiskRow(risk, row)

	let slotIndex = Number(item?._ui_slot_index)
	if (Number.isNaN(slotIndex)) {
		const rawSlot =
			typeof item?.slot_index === "number" ? item.slot_index :
				typeof item?.bin_index === "number" ? item.bin_index :
					typeof item?.slot === "number" ? item.slot : null
		if (rawSlot != null && !Number.isNaN(Number(rawSlot))) {
			slotIndex = Math.floor(Number(rawSlot))
		}
	}
	if (Number.isNaN(slotIndex)) {
		const mult = Number(item?.multplier ?? item?.multiplier)
		if (Number.isFinite(mult) && mults.length > 0) {
			const nearEqual = (a: number, b: number) => Math.abs(a - b) < 0.02
			const candidates = mults
				.map((m, i) => (nearEqual(m, mult) ? i : -1))
				.filter((i) => i >= 0)
			if (candidates.length > 0) {
				slotIndex = candidates[Math.floor(candidates.length / 2)]
			}
		}
	}
	if (Number.isNaN(slotIndex) && (props.plinkoMultipliers ?? []).length > 0) {
		const mult = Number(item?.multplier ?? item?.multiplier)
		if (Number.isFinite(mult)) {
			const nearEqual = (a: number, b: number) => Math.abs(a - b) < 0.02
			const candidates = (props.plinkoMultipliers || [])
				.map((m, i) => (nearEqual(m, mult) ? i : -1))
				.filter((i) => i >= 0)
			if (candidates.length > 0) {
				slotIndex = candidates[Math.floor(candidates.length / 2)]
			}
		}
	}
	if (!Number.isNaN(slotIndex) && slotIndex >= 0 && slotIndex < colors.length) {
		return colors[slotIndex]
	}
	return HISTORY_DEFAULT_ROSE
}

const handleFairnessDetail = (item: any) => {
	bus.emit("openGlobalDialog", {
		type: "FairnessDetail",
		gameCode: props.gameCode,
		betId: item.bet_id ?? item._bet_id,
		gameHistoryType: "self",
		gameHistoryData: props.isCrashGame ? item : null,
		is_win: item.is_win,
		result: item.result,
	})
}

/** 无 UI 开关时仍与 store 中 chart 同步，向父组件派发 colorTable（兼容原 @colorTable） */
const isOpenColorTable = ref(true)
const handleChange = (value: boolean) => {
	isOpenColorTable.value = value
	emiter("colorTable", value)
}

const refGameHistoryDouble = ref<HTMLElement>()
let resizeObserver: ResizeObserver | null = null
const itemShowNum = ref(0)

const syncItemShowNumFromWidth = (width: number) => {
	const raw = Math.floor((width - 10) / (props.itemGap + props.itemWidth))
	itemShowNum.value = Math.max(0, raw)
}

const getWidth = () => {
	const el = refGameHistoryDouble.value
	if (!el) return
	if (resizeObserver) {
		resizeObserver.disconnect()
		resizeObserver = null
	}
	resizeObserver = new ResizeObserver((entries) => {
		for (const entry of entries) {
			syncItemShowNumFromWidth(entry.contentRect.width)
		}
	})
	resizeObserver.observe(el)
	syncItemShowNumFromWidth(el.getBoundingClientRect().width)
}

watch(
	() => props.list.length,
	(next, prev) => {
		if (next <= prev || next === 0) return
		const last = props.list[next - 1]
		newestItemKey.value = getItemKey(last, next - 1)
		if (newestItemTimer) clearTimeout(newestItemTimer)
		newestItemTimer = setTimeout(() => {
			newestItemKey.value = ""
			newestItemTimer = null
		}, 420)
	}
)

onMounted(() => {
	getWidth()
	const cfg = useGameConfigStore().gameConfig as Record<string, { chart?: number }> | undefined
	cfg?.[GAME_CODE.CRASH] != null && handleChange(cfg[GAME_CODE.CRASH].chart === 0)
})
watch(
	() => useGameConfigStore().gameConfig,
	(newVal) => {
		const cfg = newVal as Record<string, { chart?: number }> | undefined
		cfg?.[GAME_CODE.CRASH] != null && handleChange(cfg[GAME_CODE.CRASH].chart === 0)
	}
)
onBeforeUnmount(() => {
	if (resizeObserver) {
		resizeObserver.disconnect()
	}
	if (newestItemTimer) {
		clearTimeout(newestItemTimer)
		newestItemTimer = null
	}
})
</script>
<style lang="scss" scoped>
.gradient {
	position: relative;
	left: 0;
	top: -40px;
	width: 31px;
	height: 40px;
	// background: linear-gradient(270deg, rgba(17, 25, 51, 0.05) 0%, #09122B 100%);
	background: linear-gradient(270deg, rgba(17, 25, 51, 0.05) 0%, #111933 100%);
}

.gameHistoryDouble {
	display: flex;
	flex-direction: row;
	width: 100%;
	padding-bottom: 0;
	padding-right: 5px;
	box-sizing: border-box;
	justify-content: flex-start;
	align-items: center;
	overflow: hidden;
}

//.dicGameHistory {
//  padding: 0 !important;
//}

.ml0 {
	margin-right: 0px !important;
}

.doubleItem {
	border-radius: 10px;
	background: var(--wallte-tab-bg, #202b50);
	padding: 5px 13px;
	margin-right: var(--gh-item-gap, 10px);
	min-width: var(--gh-item-min-width, 81px);
	flex-shrink: 0;
	box-sizing: border-box;

	.userId {
		margin: 0 0 3px;
		padding: 0;
		text-align: center;
		color: var(--notification-time-color, #456c99);
		font-size: 12px;
		line-height: 1.2;
	}

	.winDouble {
		display: flex;
		align-items: center;
		justify-content: center;

		.colorBlock {
			width: 12px;
			height: 12px;
			border-radius: 2px;
			line-height: 12px;
			margin-right: 5px;
			flex-shrink: 0;
		}

		.gameDouble {
			color: var(--new-white, #fff);
			font-size: 14px;
			line-height: 14px;
			flex-shrink: 0;
			white-space: nowrap;
		}
	}
}

.doubleItem.newlyAdded {
	animation: historyItemPop 0.42s ease-out 1;
}

.doubleBtn {
	border-radius: 10px;
	background-color: #202b50;
	padding: 6px;
	box-sizing: border-box;

	.btnWrap {
		display: flex;
		align-items: center;
		background-color: #192240;
		padding: 4px 10px;
		box-sizing: border-box;
		border-radius: 10px;
	}

	.btnText {
		font-size: 14px;
		color: var(--new-white);
		margin-left: 5px;
	}
}

.doubleItemContent {
	display: flex;
	flex-direction: row;
	align-items: center;
	/* 数据顺序：旧 → 新（index 增大）。整组靠右对齐，新记录在主轴末端 = 视觉最右侧；左侧溢出隐藏 */
	justify-content: flex-end;
	position: relative;
	width: 100%;
	min-width: 0;
	flex: 1;
}

@keyframes historyItemPop {
	0% {
		transform: translateY(-4px) scale(0.96);
		filter: brightness(1.28);
	}

	60% {
		transform: translateY(1px) scale(1.02);
		filter: brightness(1.1);
	}

	100% {
		transform: translateY(0) scale(1);
		filter: brightness(1);
	}
}
</style>
