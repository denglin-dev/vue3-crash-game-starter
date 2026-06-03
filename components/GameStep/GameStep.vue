<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue"

const props = defineProps({
	min: {
		type: Number,
		default: 1
	},
	max: {
		type: Number,
		default: 10
	},
	step: {
		type: Number,
		default: 3
	},
	disabled: {
		type: Boolean,
		default: false
	},
	defaultValue: {
		type: Number,
		default: 1
	}
})

watch(
	() => props.defaultValue,
	(val) => {
		value.value = Math.max(val, props.min)
	}
)

// 生成 marks
const marks = computed(() => {
	const arr = []
	const stepCount = props.step // 需要间隔的次数（4 个值意味着 3 个间隔）

	for (let i = 0; i <= stepCount; i++) {
		const val = Math.round(props.min + ((props.max - props.min) / stepCount) * i)
		arr.push(val)
	}

	return arr
})

const emits = defineEmits(["update:step"])

const value = ref()

// 计算滑块位置百分比
const getPosition = (val) => {
	const position = ((val - props.min) / (props.max - props.min)) * 100
	return Math.min(position, 100) + "%"
}

// 进度条宽度
const progressWidth = computed(() => getPosition(value.value))

// 处理滑动
const updateValue = (event) => {
	if (props.disabled) return
	const newValue = Number(event.target.value)
	value.value = newValue
	emits("update:step", newValue)
}
const label = computed(() => {
	return Array.from({ length: props.max - props.min + 1 }, (_, i) => i + props.min)
})
const changeInputValue = (num: number) => {
	value.value = num
}
onMounted(() => {
	value.value = Math.max(props.defaultValue, props.min)
})
defineExpose({
	// changeValue
	changeInputValue
})
</script>

<template>
	<div class="slider-container">
		<div class="slider-labels">
			<span v-for="mark in label" :key="mark"
				:class="['slider-label', { active: value === mark, show: value === mark }]"
				:style="{ left: getPosition(mark) }">
				{{ mark }}
			</span>
		</div>
		<!-- 轨道 -->
		<div class="slider-track">
			<div class="slider-progress" :style="{ width: progressWidth }"></div>
			<!-- 刻度点 -->
			<div v-for="mark in marks" :key="mark" class="slider-mark slider-mark-top"
				:style="{ left: getPosition(mark) }" :class="{ active: value >= mark }"></div>

			<!-- 隐藏的原生输入框 -->
			<input type="range" :min="min" :max="max" :step="1" v-model="value" @input="updateValue"
				class="slider-input" :disabled="disabled" />

			<!-- 滑块 -->
			<div class="slider-thumb" :style="{ left: progressWidth }"></div>
		</div>
		<!--
             -->
		<!-- 刻度标签 -->
		<div class="slider-labels slider-labels-bottom Cy_font_Medium">
			<span v-for="mark in label" :key="mark" :class="['slider-label', { show: marks.indexOf(mark) !== -1 }]"
				:style="{ left: getPosition(mark) }">
				{{ mark }}
			</span>
		</div>
	</div>
</template>

<style scoped lang="scss">
/* 容器 */
.slider-container {
	position: relative;
	width: 100%;
	max-width: 400px;
	padding: 20px 13px 26px 19px;
	background: #09122b;
	border-radius: 12px;
}

/* 轨道 */
.slider-track {
	position: relative;
	height: 4px;
	background: #1c2a45;
	border-radius: 2px;
	margin-top: 5px;
}

.slider-mark-top {
	top: 0;
}

/* 进度条 */
.slider-progress {
	position: absolute;
	height: 100%;
	background: #00ff00;
	border-radius: 2px;
}

/* 刻度点 */
.slider-mark {
	position: absolute;
	top: 50%;
	width: 8px;
	height: 8px;
	background: #1c2a45;
	border-radius: 50%;
	transform: translate(-50%, -50%);
}

.slider-mark.active {
	background: #20ce2e;
}

/* 隐藏原生 input */
.slider-input {
	position: absolute;
	top: -6px;
	left: -6px;
	width: calc(100% + 9px);
	opacity: 0;
	cursor: pointer;
	height: 14px;
	z-index: 9;
}

/* 滑块 */
.slider-thumb {
	position: absolute;
	top: 1px;
	width: 14px;
	height: 14px;
	//background: #00ff00;
	background: #ffffff;
	border: 3px solid #00ff00;
	border-radius: 50%;
	transform: translate(-50%, -50%);
}

/* 刻度标签 */
.slider-labels {
	position: relative;
	display: flex;
	margin-top: 5px;
	width: 100%;
	font-size: 14px;
}

.slider-label {
	position: absolute;
	transform: translateX(-50%);
	color: #ffffff;
	font-size: 14px;
	opacity: 0;
}

.slider-label.active {
	color: #00ff00;
	z-index: 9;
	margin-top: -20px;
}

.slider-label.show {
	opacity: 1;
}

.slider-labels-bottom {
	:first-child {
		display: flex;
	}
}
</style>