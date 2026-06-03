<template>
	<div ref="minesBox" class="minesBox">
		<div class="topBox">
			<GameHistoryDobule :is-show-switch="false" :game-code="GAME_CODE.MINES" :list="minesHistory.list">
			</GameHistoryDobule>
		</div>
		<div class="minesGameBox">
			<GameContent ref="gameContentRef" class="GameContent" :grid-size="minesCommonSet.gridIndex" />
		</div>
	</div>
</template>
<script setup lang="ts">
import GameContent from "./GameContent.vue"
import GameHistoryDobule from "~/components/GameComponents/gameHistoryDobule.vue"
import { onMounted } from "vue"
import { useI18n } from "vue-i18n"
import { minesCommonSet, gameContentRef, minesHistory } from "../composables/useMinesState"
import { useMinesGame } from "../composables/useMinesGame"
import { GAME_CODE } from "~/pages/newGame/common/composables/newGameCodes"

const { initGame, initMinesData } = useMinesGame(useI18n())
/**
 * 走势：进入页时拉全量历史；对局结算由本局接口返回追加到本地列表，避免每局请求 history。
 * 先 `initMinesData`（保留在局下注展示直至 enter 返回）再 `initGame`：清 buttonText / isBetAndNoRes 等，并用 enter 恢复在局注单；避免中途清空导致下注框虚拟币图标跟顶部钱包切币。
 */
onMounted(async () => {
	initMinesData({ preserveBetDisplayFromPreviousSession: true })
	await initGame()
})


</script>
<style scoped lang="scss">
.minesBox {
	height: 100%;
	min-height: 0;
	display: flex;
	flex-direction: column;
	background: url("/img/gamepage/minesBg.webp");
	border-radius: 10px;
	overflow: hidden;
	// pointer-events: none;

	@media screen and (max-width: 768px) {
		width: 100%;
		height: auto;
		background: transparent;
	}

	.minesGameBox {
		position: relative;
		z-index: 0;
		flex: 1 1 auto;
		min-height: 0;
		display: flex;
		flex-direction: column;

		@media screen and (max-width: 768px) {
			flex: 0 0 auto;
			height: auto;
			min-height: 0;
		}

		.GameCanvas {
			position: absolute;
			z-index: -1;
		}

		.GameContent {
			position: relative;
			z-index: 0;
			flex: 1 1 auto;
			min-height: 0;
			width: 100%;
			max-width: 100%;
			overflow: hidden;
		}
	}

	.topBox {
		position: relative;
		z-index: 2;
		flex: 0 0 auto;
		width: 100%;
		display: flex;
		justify-content: center;
		align-items: center;
		padding: 10px 10px 0 10px;
		min-height: 40px;
		box-sizing: border-box;

		@media screen and (max-width: 768px) {
			/* 与 gameHistoryDobule 外层 40px 高度对齐，避免历史条被裁切或被棋盘区盖住 */
			margin: 0 0 8px;
			padding: 0;
			margin-top: 5px;
			min-height: 40px;
			height: auto;
		}

		.btn {
			width: 80px;
			height: 30px;
			flex-shrink: 0;
			border-radius: 5px;
			background: #202b50;
			border: none;
			margin: 0 5px;
			font-size: 14px;
			display: flex;
			align-items: center;
			justify-content: center;
			cursor: pointer;

			span {
				vertical-align: middle;
				margin-right: 4px;
				border-radius: 2px;
				overflow: hidden;
				padding: 5px;
			}
		}

		.up {
			color: #20ce2e;

			span {
				background-color: #20ce2e;
			}
		}

		.down {
			color: #f3296c;

			span {
				background-color: #f3296c;
			}
		}
	}
}

.fontRedColor {
	color: #f00;
}

.fontGreenColor {
	color: #20ce2e;
}

.fontYellowColor {
	color: #ffb039;
}
</style>
