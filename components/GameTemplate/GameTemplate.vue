<template>
	<!-- 布局壳参与 SSR，首屏即有左右栏结构；Pixi/WS 等仍在子组件 onMounted 注水 -->
	<div class="crash" :data-layout-version="layoutVersion">
		<div :key="`control-${layoutModeKey}-${layoutRemountKey}`" class="crashLeft scrollbarNone"
			:style="{ height: innerHeight }">
			<slot name="gameControl"></slot>
		</div>
		<div :key="`canvas-${layoutModeKey}-${layoutRemountKey}`" class="crashRight" :style="{ height: innerHeight }">
			<slot name="gameCanvas"></slot>
		</div>
	</div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue"
import { deviceAdvanced } from "~/utils/hook/hook"
import detectDeviceAdvanced from "~/utils/detectDeviceAdvanced"
import type { DeviceAdvanced } from "~/composables/useDeviceAdvanced"
import { useDeviceAdvanced } from "~/composables/useDeviceAdvanced"
import { useRoute } from "vue-router"

const props = defineProps({
	gameId: [String, Number],
	/** 桌台当前下注额：用于「金额为 0 时禁止开启快速模式」等（未传则快速开关不做金额校验） */
	tableBetAmount: Number
})

const { deviceAdvanced: deviceState } = useDeviceAdvanced()

const toLayoutMode = (device: DeviceAdvanced): "mobile" | "desktop" =>
	device === "mobile" ? "mobile" : "desktop"

const innerHeight = ref("")
const layoutVersion = ref(0)
const layoutRemountKey = ref(0)
const layoutModeKey = ref<"mobile" | "desktop">(toLayoutMode(deviceState.value))

watch(
	() => deviceAdvanced.value,
	() => {
		changeInnerHeight()
	}
)

const changeInnerHeight = () => {
	if (typeof window === "undefined") return
	const nextDevice = detectDeviceAdvanced()
	if (deviceAdvanced.value !== nextDevice) {
		deviceAdvanced.value = nextDevice
	}

	const nextMode = toLayoutMode(nextDevice)
	if (layoutModeKey.value !== nextMode) {
		layoutModeKey.value = nextMode
		layoutRemountKey.value++
	}
	if (nextDevice === "mobile") {
		innerHeight.value = ""
	} else {
		innerHeight.value = window.innerHeight - 62 - 91 + "px"
	}
	layoutVersion.value++
}

const onlineObj = (_val: unknown) => {
	// demo: favorites disabled
}

onMounted(() => {
	changeInnerHeight()
	window.addEventListener("resize", changeInnerHeight)
	window.addEventListener("orientationchange", changeInnerHeight)
	window.visualViewport?.addEventListener("resize", changeInnerHeight)
	if (typeof window !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent)) {
		const crashLeft = document.querySelector(".crashLeft")
		if (crashLeft) {
			let startY = 0
			let scrollTop = 0

			crashLeft.addEventListener("touchstart", (e: TouchEvent) => {
				startY = e.touches[0].clientY
				scrollTop = crashLeft.scrollTop
			}, { passive: true })

			crashLeft.addEventListener("touchmove", (e: TouchEvent) => {
				if (crashLeft.scrollHeight <= crashLeft.clientHeight + 1) return
				const currentY = e.touches[0].clientY
				const deltaY = currentY - startY

				if ((scrollTop <= 0 && deltaY > 0) ||
					(scrollTop >= crashLeft.scrollHeight - crashLeft.clientHeight && deltaY < 0)) {
					e.preventDefault()
				}
			}, { passive: false })
		}
	}
})

onUnmounted(() => {
	window.removeEventListener("resize", changeInnerHeight)
	window.removeEventListener("orientationchange", changeInnerHeight)
	window.visualViewport?.removeEventListener("resize", changeInnerHeight)
})

</script>
<style>
.top_box_game {
	display: flex;
	justify-content: flex-start;
	align-items: center;
	margin-bottom: 10px;

	.top_title {
		color: #FFF;
		font-size: 14px;
		font-weight: 800;
		line-height: 150%;


		/* 21px */
	}

	.top_name {
		color: #6A89AD;
		font-size: 14px;
		font-weight: 700;
		line-height: 150%;
		/* 21px */
		text-transform: capitalize;
		margin-left: 10px;
		margin-right: 24px;
	}
}

.crash .betBtn,
.crash .btn,
.crash .colorItem {
	width: 100% !important;
}
</style>
<style scoped lang="scss">
.crash {
	display: flex;
	width: 100%;
	height: 100%;
	max-height: 800px;


	.crashLeft {
		width: 293px;
		height: 750px;

		//height: 100%;
		// height: 922px;
		flex-shrink: 0;
		margin-right: 15px;
		border-radius: 10px;
		background: var(--111933HeaderBg);
		max-height: 800px;
		/* PC/平板：外层不要滚动，避免内容不溢出时滚轮造成“轻微滚动”；滚动交给 TabBar 的 tabContent */
		overflow: hidden;

		/* iOS移动端特殊处理 */
		@media screen and (max-width: 768px) {
			overflow-y: auto;
			overflow-x: hidden;
			/*这行放开会导致在PC浏览器用手机模式无法滑动的情况*/
			/* overscroll-behavior: contain;*/
			touch-action: pan-y;
			-webkit-overflow-scrolling: touch;
			position: relative;
			width: 100%;
			background: transparent;
			padding: 0;
			margin-right: 0;
			height: auto;
			/* 移动端不限制 crashLeft 的高度，让它可以自然滚动 */
			max-height: none;


		}
	}

	.crashRight {
		width: calc(100% - 293px - 15px);
		height: 750px;
		background-color: var(--111933HeaderBg);
		border-radius: 12px;
		position: relative;
		max-height: 800px;

		/* iOS移动端特殊处理：游戏canvas区域完全禁用触摸 */
		@media screen and (max-width: 768px) {
			// pointer-events: none;
			// touch-action: none;
			// display: none;
			/* 移动端直接隐藏,避免触摸事件 */
			position: relative;
			order: -1;
			width: 100%;
			height: auto;
			max-height: none;
		}
	}

	/* 移动端布局调整 */
	@media screen and (max-width: 768px) {
		/* 保持 flex 布局 */
		display: flex;
		flex-direction: column;

		/* 完全移除高度限制 */
		height: auto;
		max-height: none;

		/*
		 * 允许滚动链路传递到 body（否则当 crashLeft 自身不形成滚动容器时，会出现“在内容区滑动无反应”）
		 * 防橡皮筋应由 html/body 的策略处理（见 layouts/default.vue）。
		 */
		overscroll-behavior: auto;
		overscroll-behavior-x: auto;
		overscroll-behavior-y: auto;

		.crashLeft {
			width: 100%;
			background: transparent;
			padding: 0;
			margin-right: 0;

			/* 确保没有高度限制 */
			height: auto;
			max-height: none;
		}

		.crashRight {
			/* H5 需要显示游戏画布区（GameCanvas/Plinko/Mines 等），不要隐藏 */
			display: block;
			height: auto;
			max-height: none;
		}
	}
}
</style>
