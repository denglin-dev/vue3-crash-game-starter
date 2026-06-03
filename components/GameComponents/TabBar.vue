<template>
	<div class="tabbar" :class="{ 'tabbar--other': other }">
		<!--        手机端 bet 按钮-->
		<div id="crashMobileBet"></div>
		<!-- Tab1 tabClassic-->
		<div class="tabbarContent" v-if="type === 'tabMenu'" :style="{ width: componentWidth }">
			<div class="tabbarItem Cy_font_Medium userSelectNone" @click="onTabClick(index)"
				:class="{
					active: index === modelValue,
					'tabbarItem--switchBlocked': tabbarNonActiveBlocked(index)
				}" v-for="(item, index) in tabbarData" :key="index">
				<span>{{ item.label }}</span>
			</div>
		</div>
		<!-- Tab2 tabBuyColor -->
		<!--     :class="{ showBorder: isShowBorder }"-->
		<div class="changeModel" v-if="type === 'tabTag'" :style="{ width: componentWidth }">
			<div class="changeModelContent" :style="{ backgroundColor: bgColor, height: height }">
				<div class="changeModelItem Cy_font_ExtraBold userSelectNone" @click="onTabClick(index)"
					:class="{
						active: index === modelValue,
						'changeModelItem--switchBlocked': tabbarNonActiveBlocked(index)
					}"
					:style="{ backgroundColor: index === modelValue ? activeColor : '', lineHeight: itemHeight }"
					v-for="(item, index) in tabbarData" :key="index">
					<span>{{ item.label }}</span>
				</div>
			</div>
		</div>
		<!-- 插槽：各 tab 同时挂载、用 v-show 切换，避免切换时卸载子树导致 BetInput 校验态丢失 -->
		<div ref="tabContentEl" class="tabContent">
			<template v-for="(_item, index) in tabbarData" :key="index">
				<div v-show="index === modelValue" class="tabBarPanel">
					<slot :name="`tab-${index}`"></slot>
				</div>
			</template>
		</div>
	</div>
</template>

<script setup>
import { deviceAdvanced } from "~/utils/hook/hook"
import { onBeforeUnmount, onMounted, ref } from "vue"
import { useGame } from "~/composables/GameHook"
import { playClickSoundOnce } from "~/utils/sound/clickSound"

const { soundState } = useGame()

/** 不用 v-sound：SSR 下指令偶发未注册会导致整站 500；客户端点击仍保留音效 */
const onTabClick = (index) => {
	if (import.meta.client && soundState.isClickSoundEnabled) {
		playClickSoundOnce()
	}
	handleClick(index)
}
// 定义 props
const props = defineProps({
	tabbarData: {
		type: Array,
		default: () => [
			{ label: "Classic", value: "Classic" },
			{ label: "Buy color", value: "Buy color" }
		]
	},
	modelValue: {
		// 使用 modelValue
		type: Number,
		required: true
	},
	type: {
		type: String,
		default: "tabMenu"
	},
	isShowBorder: {
		type: Boolean,
		default: true
	},
	bgColor: {
		type: String
	},
	activeColor: {
		type: String
	},
	height: {
		type: String,
		default: "42px"
	},
	componentWidth: {
		type: String
	},
	itemHeight: {
		type: String,
		default: "32px"
	},
	other: {
		type: Boolean,
		default: false
	},
	/** 为 true 时禁止切换 Tab（例如 Buy color 等场景锁定） */
	buyColorLockTabbar: {
		type: Boolean,
		default: false
	},
	/** 为 true 时点击不触发 `update:modelValue`（与历史逻辑保持一致） */
	tabbarCanChange: {
		type: Boolean,
		default: false
	}
})

const emiter = defineEmits(["update:modelValue"])

/** 锁定切换时：非当前 Tab 显示为不可点（与 Mines 等在局态一致） */
const tabbarNonActiveBlocked = (index) => {
	if (index === props.modelValue) return false
	if (props.type === "tabTag") return !!props.tabbarCanChange
	return !!(props.buyColorLockTabbar || props.tabbarCanChange)
}

const tabContentEl = ref(null)
let tabContentWheelCleanup = null

function attachNoOverflowWheelGuard() {
	const el = tabContentEl.value
	if (!el) return

	const TOL = 1

	/** overflow-y 是否可能产生纵向滚动条 */
	const overflowAllowsScrollY = (style) => {
		const oy = style.overflowY
		return oy === "auto" || oy === "scroll" || oy === "overlay"
	}

	/**
	 * 当前滚轮增量是否还能被该节点「吃掉」。
	 * 旧逻辑：只要祖先带 overflow:auto 就一律 return，不 preventDefault；
	 * 但子区域已在顶/底时浏览器默认应把剩余滚动链交给外层（如 main），
	 * 再配合 tabContent 的 overscroll-behavior:contain，会导致「表单滚到底后整页再也滚不动」。
	 */
	const canConsumeWheelDelta = (node, deltaY) => {
		if (!node || !(node instanceof HTMLElement)) return false
		const style = window.getComputedStyle(node)
		if (!overflowAllowsScrollY(style)) return false
		if (node.scrollHeight <= node.clientHeight + TOL) return false
		if (deltaY > 0) {
			return node.scrollTop + node.clientHeight < node.scrollHeight - TOL
		}
		if (deltaY < 0) {
			return node.scrollTop > TOL
		}
		return false
	}

	const onWheel = (e) => {
		let cur = e.target
		while (cur && cur !== el) {
			if (cur instanceof HTMLElement && canConsumeWheelDelta(cur, e.deltaY)) return
			cur = cur.parentNode
		}
		if (canConsumeWheelDelta(el, e.deltaY)) return
		// 从事件目标到 tabContent 没有任何容器还能消化本次 delta：不拦截，交给外层 <main> 等默认滚动
	}

	el.addEventListener("wheel", onWheel, { passive: true })
	tabContentWheelCleanup = () => {
		try { el.removeEventListener("wheel", onWheel) } catch { /**/ }
		tabContentWheelCleanup = null
	}
}

onMounted(() => {
	attachNoOverflowWheelGuard()
})

onBeforeUnmount(() => {
	if (tabContentWheelCleanup) tabContentWheelCleanup()
})

// 处理 Tab 点击事件
const handleClick = (index) => {
	if (!props.other) {
		if (props.buyColorLockTabbar) return
		if (props.tabbarCanChange) return
	}
	// deviceAdvanced 为 Ref，script 里须用 .value；误写成 !== 'pc' 时恒为 true，PC 也会把背后 main 滚到顶（如公平弹窗切 Tab）
	if (!props.other && deviceAdvanced.value !== "pc") {
		const main = document.querySelector("main")
		main?.scrollTo({ top: 0, behavior: "smooth" })
	}

	emiter("update:modelValue", index) // 更新父组件的 v-model
}

// 暴露 activeIndex
defineExpose({
	modelValue: props.modelValue
})
</script>

<style lang="scss" scoped>
.tabbar {
	display: flex;
	flex-direction: column;
	height: 100%;
	min-height: 0;
	// tabs 固定不滚动：只让 tabContent 内部滚动
	overflow: hidden;

	.tabContent {
		padding: 0 10px;
		flex: 1;
		min-height: 0;
		overflow: auto;
		/* contain 会阻断子滚动区在顶/底时把滚轮链到外层页面，导致表单滚到底后整页无法跟滚 */
		overscroll-behavior: auto;
		/* 可滚动但不显示滚动条（PC/Windows 也隐藏白条） */
		scrollbar-width: none;
		/* Firefox */
		-ms-overflow-style: none;

		/* IE/Edge legacy */
		&::-webkit-scrollbar {
			width: 0;
			height: 0;
		}

		@media screen and (max-width: 768px) {
			height: unset;
			min-height: unset;
			overflow: visible;
		}

	}

	#crashMobileBet {
		padding-top: 1px;

		.submit {
			margin-top: 14px;
		}
	}

	//margin-top: 15px;
	.tabbarContent {
		display: flex;
		width: 100%;
		// border-top: 2px solid #09122b;
		box-sizing: border-box;
		background-color: var(--new-aside-bg-color);
		align-items: center;
		justify-content: center;

		.tabbarItem {
			color: var(--radio-border-color);
			font-size: 14px;
			font-style: normal;
			font-weight: 500;
			flex: 1;
			text-align: center;
			cursor: pointer;
			border-bottom: 2px solid var(--new-aside-border-color);
			line-height: 42px;

			&.tabbarItem--switchBlocked {
				cursor: not-allowed;
				pointer-events: none;
				opacity: 0.45;

				span {
					color: #5a6b85 !important;
				}
			}

			&:hover {
				color: var(--search-game-active-text);
			}
		}

		.active {
			border-bottom: 2px solid var(--search-game-active-text);
			color: var(--search-game-active-text);
		}
	}

	.showBorder {
		border-top: 2px solid #09122b;
		padding-top: 15px;
	}

	.changeModel {
		margin-top: 10px;

		.changeModelContent {
			height: 42px;
			display: flex;
			width: 100%;
			justify-content: space-between;
			border-bottom: 1px solid rgba(59, 94, 136, 0.4);

			.changeModelItem {
				// flex: 1;
				text-align: center;
				line-height: 32px;
				cursor: pointer;
				width: 50%;
				position: relative;

				&.changeModelItem--switchBlocked {
					cursor: not-allowed;
					pointer-events: none;

					span {
						color: #5a6b85 !important;
						opacity: 0.55;
					}

					&:hover > span {
						color: #5a6b85 !important;
					}

					&:after {
						background: transparent !important;
						box-shadow: none !important;
					}
				}

				&:after {
					background: transparent;
					box-shadow: 0 0 5px 0 transparent;
					content: " ";
					width: 100%;
					height: 2px;
					display: inline-block;
					position: absolute;
					bottom: 0;
					left: 0;
				}

				// Move cursor: pointer above the nested @media rule to avoid Sass mixed-decls warning
				@media screen and (max-width: 768px) {
					flex: 1 !important;
				}

				&:hover>span {
					color: var(--new-white);
				}

				span {
					color: var(--notification-time-color);
					font-size: 16px;
					font-weight: 600;
				}
			}

			.active {
				border-radius: 10px;

				&:after {
					background: #20ce2e;
					box-shadow: 0 0 5px 0 #20ce2e;
					content: " ";
					width: 100%;
					height: 2px;
					display: inline-block;
					position: absolute;
					bottom: 0;
					left: 0;
				}

				span {
					color: var(--new-white);
				}
			}
		}
	}

	/* 弹窗 / 公平页等复用 TabBar：勿用游戏区 737px 与 overflow:hidden，否则超高后触摸滚动会穿透到 body */
	&.tabbar--other .tabContent {
		min-height: 0;
		overflow-x: hidden;
		overflow-y: auto;
		-webkit-overflow-scrolling: touch;

		@media screen and (max-width: 768px) {
			height: unset;
			min-height: unset;
			overflow: unset;
		}
	}

	@media screen and (max-width: 768px) {
		display: flex;
		flex-direction: column-reverse;
		/* 反转垂直方向排列 */
		background: #111933;
		border-radius: 10px;
		margin-top: 5px;

		.changeModel {
			padding: 0 10px 10px 10px;
		}

		.tabContent {
			padding: 10px;
		}
	}
}
</style>