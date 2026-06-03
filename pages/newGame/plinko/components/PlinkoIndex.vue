<template>
	<div ref="Plinko" class="Plinko">
		<div class="topBox">
			<GameHistoryDobule :is-show-switch="false" :game-code="GAME_CODE.PLINKO" :is-pinko-game="true"
				:list="plinkHistory.list" :plinko-row="reqData.row" :plinko-risk="reqData.risk"
				:plinko-multipliers="currentMultipliers" />
		</div>
		<div class="plinkBox" :class="{ pcStyle: deviceAdvanced !== 'mobile' }">
			<ClientOnly>
				<PlinkoGame ref="gameRef" :canvas-height="canvasHeight" :rows="reqData.row" :risk="reqData.risk"
					:active-slot-index="gameBottomData.index" @onResult="handleGameResult" />
			</ClientOnly>
		</div>
	</div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue"
import {
	reqData,
	plinkoGameRef,
	plinkHistory,
	takePendingPlinkoRound,
	currentMultipliers
} from "../composables/usePlinkoState"
import { sendPlinkoBallLandedWs } from "../composables/usePlinkoSettlementWs"
import GameHistoryDobule from "~/components/GameComponents/gameHistoryDobule.vue"
import PlinkoGame from "./PlinkoGame.vue"
import { usePlinkoGame } from "~/pages/newGame/plinko/composables/usePlinkoGame"
import { deviceAdvanced } from "~/utils/hook/hook"
import { GAME_CODE } from "~/pages/newGame/common/composables/newGameCodes"

const gameRef = ref<any>(null)
const { gameBottomData } = usePlinkoGame()
const MAX_HISTORY = 50

// 监听视口宽度，保证在窗口尺寸持续变化时高度能够实时响应
const viewportWidth = ref(0)

const handleResize = () => {
	if (typeof window === "undefined") return
	// 高度不能跟 visualViewport 走：iOS 地址栏收起/展开会触发 resize，导致 16 行画布跳跃/拉伸。
	viewportWidth.value = Math.round(window.innerWidth)
}
const handleGameResult = (binIndex: number, multiplier: number, roundId = '') => {
	console.log(`弹珠落入槽位 ${binIndex}, 倍数 ${multiplier}x`, roundId)
	// 落槽后结束本次回合，解除 row/risk 控件禁用
	if (!reqData.isAuto) reqData.isStart = false
	const pending = takePendingPlinkoRound(roundId)
	if (!pending) return
	// 仅在弹珠实际落槽后写入历史（roundId 与下注时 register 的局一一对应，支持多球并行）
	plinkHistory.list.push({
		...pending,
		_ui_slot_index: binIndex
	})
	if (plinkHistory.list.length > MAX_HISTORY) {
		plinkHistory.list.splice(0, plinkHistory.list.length - MAX_HISTORY)
	}
	const betKey = pending.bet_id ?? pending.betId ?? pending._plinko_round_id ?? roundId
	sendPlinkoBallLandedWs({
		bet_id: betKey != null ? String(betKey) : undefined,
		round_id: roundId || undefined,
		bin_index: binIndex,
		multiplier,
		game_code: GAME_CODE.PLINKO,
		payout: typeof pending.payout === 'number' ? pending.payout : undefined
	})
}

// ✅ 关键修复：使用 watch 监听 gameRef 变化
watch(
	gameRef,
	(newVal) => {
		if (newVal) {
			console.log("PlinkoGame 已挂载:", newVal)
			plinkoGameRef.value = newVal
		}
	},
	{ immediate: true }
)

onMounted(() => {
	handleResize()
	if (typeof window !== "undefined") {
		window.addEventListener("resize", handleResize)
		window.addEventListener("orientationchange", handleResize)
	}
})

onUnmounted(() => {
	plinkoGameRef.value = null // ✅ 清理引用
	if (typeof window !== "undefined") {
		window.removeEventListener("resize", handleResize)
		window.removeEventListener("orientationchange", handleResize)
	}

	//退出当前页面时，获取最新余额
	sendPlinkoBallLandedWs({
		bet_id: "abc_user_balance",
		round_id: "",
		bin_index: 0,
		multiplier: 0,
		game_code: GAME_CODE.PLINKO,
		payout: 0
	})
})

const canvasHeight = computed(() => {
	const width = viewportWidth.value
	if (width === 0) return "100%"

	if (width <= 768) {
		// H5 高度保持稳定；Plinko 内部会按行数压缩纵向间距，不能 rows 越大越撑高，否则底部空白会挤掉下注区。
		return `${width <= 480 ? 390 : 430}px`
	}
	// PC：跟随父级高度
	return "100%"
})
</script>
<style scoped lang="scss">
.plinkBox {
	max-height: 1400px;
	height: calc(100% - 50px);

	@media screen and (max-width: 768px) {
		height: auto;
		max-height: none;
	}
}

.pcStyle {
	// padding-left:21%;
	// padding-right:21%;
	padding-top: 20px;
	min-width: 460px;
}

.pcStyleBottom {
	margin-left: 18%;
}

.Plinko {
	height: 100%;
	position: relative;
	container-type: inline-size;

	@media screen and (max-width: 768px) {
		height: auto;
	}

	.topBox {
		width: 100%;
		display: flex;
		justify-content: center;
		align-items: center;
		min-height: 40px;
		box-sizing: border-box;
		padding: 10px 10px 0 10px;

		@media screen and (max-width: 768px) {
			padding: 0;
			margin-top: 5px;
		}
	}
}
</style>
