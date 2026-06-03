<template>
	<div class="changeModel">
		<div class="changeModelContent">
			<div
				class="changeModelItem"
				@click="handleClick(index)"
				:class="{ active: index === activeIndex }"
				v-for="(item, index) in tabbarData"
				:key="index">
				<span class=" ">{{ item.label }}</span>
			</div>
		</div>
	</div>
</template>
<script setup>
import { ref } from "vue"
import { deviceAdvanced } from "~/utils/hook/hook"
const props = defineProps({
	tabbarData: {
		type: Array,
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

const emiter = defineEmits(["changeModel"])

let activeIndex = ref(props.tabbarActive)

const handleClick = (index) => {
	if (!props.canChange) return
	activeIndex.value = index
	emiter("changeModel", index)
	if(deviceAdvanced !== 'pc'){
			const main = document.querySelector("main")
			main?.scrollTo({ top: 0, behavior: "smooth" })
		}
}
</script>
<style lang="scss" scoped>
.changeModel {
	margin-top: 10px;

	.changeModelContent {
		height: 42px;
		padding: 5px;
		background-color: var(--new-body-bg-color);
		display: flex;
		width: 100%;
		border-radius: 10px;

		.changeModelItem {
			flex: 1;
			text-align: center;
			line-height: 32px;

			span {
				color: var(--notification-time-color);
				font-size: 15px;
			}
		}

		.active {
			background-color: var(--wallte-tab-bg);
			border-radius: 10px;

			span {
				color: var(--new-white);
			}
		}
	}
}
</style>
