<template>
	<div class="gameGridBox">
		<div
			v-for="(e, i) in count"
			:key="e"
			class=" "
			:class="{ choose: isChooseIndex === count[i] }"
			@click="changeChooseIndex(count[i])">
			{{ e }}
		</div>
	</div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue"

const emits = defineEmits(["gridComChange"])
const props = defineProps({
	defaultsIndex: {
		type: Number,
		default: 25
	},
	disabled: {
		type: Boolean,
		default: false
	}
})
const count = [25, 36, 49, 64]
const isChooseIndex = ref(25)
const changeChooseIndex = (i: number, isNotVa?: boolean) => {
	if (props.disabled && !isNotVa) return
	isChooseIndex.value = i
	emits("gridComChange", isChooseIndex.value)
}
onMounted(() => {
	isChooseIndex.value = props.defaultsIndex
})
defineExpose({
	changeChooseIndex
})
</script>
<style scoped lang="scss">
.gameGridBox {
	display: grid;
	gap: 10px;
	padding: 10px;
	background: #09122b;
	grid-template-columns: repeat(4, 1fr);
	border-radius: 10px;

	div {
		background: #202b50;
		font-size: 15px;
		font-style: normal;
		font-weight: 600;
		line-height: 17px;
		color: #456c99;
		display: grid;
		width: 100%;
		height: 30px;
		border-radius: 5px;
		place-items: center;
		cursor: pointer;
	}

	div.choose {
		background: #20ce2e;
		color: #ffffff;
	}

	div:hover {
		color: #ffffff;
	}
}
</style>
