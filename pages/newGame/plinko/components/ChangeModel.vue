<template>
	<div class="PinkoChangeModel">
		<div class="changeModelContent">
			<div class="changeModelItem Cy_font_Bold" @click="handleClick(index)" v-sound
				:class="{ active: index == activeIndex }" v-for="(item, index) in tabbarData" :key="index">
				<span class="Cy_font_Bold">{{ item.label }}</span>
			</div>
		</div>
	</div>
</template>
<script setup lang="ts">
import { ref, watch } from 'vue'
import { deviceAdvanced } from '~/utils/hook/hook'

interface TabItem {
	label: string
	value: string | number
}

const props = defineProps({
	tabbarData: {
		type: Array as () => TabItem[],
		default: () => [
			{ label: "Manual", value: "Manual" },
			{ label: "Auto", value: "Auto" }
		]
	},
	tabbarActive: {
		type: Number,
		default: 0
	},
	canChange: {
		type: Boolean,
		default: true
	}
})

watch(
	() => props.tabbarActive,
	(newVal) => {
		activeIndex.value = newVal
	}
)

const emiter = defineEmits<{
	(e: 'changeModel', value: number): void
}>()

let activeIndex = ref(props.tabbarActive)
const handleClick = (index: number) => {
	if (!props.canChange) return  // ✅ 修复：canChange=false 时阻止点击
	activeIndex.value = index
	emiter("changeModel", index)  // 添加这行来触发事件
}

</script>
<style lang="scss" scoped>
.PinkoChangeModel {
	.changeModelContent {
		height: 50px;
		padding: 7px;
		background-color: var(--new-body-bg-color);
		box-sizing: border-box;
		display: flex;
		width: 100%;
		border-radius: 10px;
		border: 0.5px solid #1c2a46;

		.changeModelItem {
			flex: 1;
			text-align: center;
			line-height: 34px;
			cursor: pointer;

			span {
				color: var(--notification-time-color);
				font-size: 14px;
			}
		}

		.active {
			background-color: var(--search-game-active-text);
			border-radius: 10px;

			span {
				color: var(--new-white);
			}
		}
	}
}
</style>
