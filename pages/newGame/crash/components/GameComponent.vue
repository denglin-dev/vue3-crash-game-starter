<template>
	<div id="CyGameBoxContainer" ref="TreasureChestBox">
		<div class="top-box">
			<GameHistoryDobule @colorTable="handleColorTable" :game-code="GAME_CODE.CRASH" is-crash-game :list="crashHistory.list">
			</GameHistoryDobule>
		</div>
		<GameCanvas :key="crashGameKey" :canvas-height="canvasHeight" />
	</div>
</template>

<script setup>
/**
 * 右侧画布区：历史倍数曲线 + Pixi 主画布；`canvasHeight` 随 PC/移动适配。
 */
import { ref, defineAsyncComponent, computed } from "vue"
import { deviceAdvanced } from "~/utils/hook/hook"
import GameCanvas from "./GameCanvas.vue"
import { crashGameKey, crashHistory } from "../composables/useCrashState"
import { GAME_CODE } from "~/pages/newGame/common/composables/newGameCodes"
const GameHistoryDobule = defineAsyncComponent(() => import("~/components/GameComponents/gameHistoryDobule.vue"))

/** 历史组件是否展开色块表（本页模板未再使用，仅保留与 gameHistory 事件兼容） */
const isShowColorTable = ref(true)
const handleColorTable = (value) => {
	isShowColorTable.value = value
}	
const canvasHeight = computed(() => {
	if (deviceAdvanced.value === "mobile") {
		return "229px"
	} else {
		return "calc(100% - 60px)"
	}
})

</script>

<style lang="scss" scoped>
#CyGameBoxContainer {
	//height: calc(100% - 82px);
	overflow: hidden;
	height: 100%;
	display: flex;
	flex-direction: column;
	justify-content: space-between;

	.GameCanvas {
		margin-top: 6px;
	}

}

.top-box {
	position: relative;
	z-index: 2;
	flex: 0 0 auto;
	width: 100%;
	min-height: 40px;
	box-sizing: border-box;
	padding: 10px 10px 0px 10px;

	@media screen and (max-width: 768px) {
		padding: 0px;
		margin: 5px 0 8px;
		min-height: 40px;
	}
}

.TreasureChestBox {
	height: calc(100% - 25.73%);
	width: 100%;
	border-radius: 15px;
	position: relative;

	.love-box {
		position: absolute;
		bottom: -40px;
		display: flex;
		gap: 20px;
		left: 5%;
		z-index: 1000001;

		div {
			display: flex;
			align-items: center;
			gap: 5px;

			img {
				cursor: pointer;
				width: 30px;
				height: 30px;
			}

			span {
				color: #ffffff;
				font-size: 16px;
			}
		}
	}
}
</style>
