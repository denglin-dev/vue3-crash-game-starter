<template>
	<div>
		<!-- 重写usdt input样式 -->
		<div v-if="type === 'usdtInput'" class="custom-input1" :class="{
			isBlur: isBlur,
			hoverBorder: !disabled,
			inputCommonStyle: !disabled,
			redBorder: usdtInputIsRed,
			disabled: disabled
		}" :style="{ width: customWidth, height: customHeight }">
			<p v-if="isShowLabel" class="label Cy_font_ExtraBold">{{ label }}</p>
			<slot name="inputLeftIcon">
				<div class="inputIcom">
					<img :src="getDefailtImg" alt="" v-if="type === 'usdtInput' && showDefailtImg" />
					<span class="money Cy_font_Medium" :class="{ greenColor: isGreen }">{{ getDefailtSymbol }}</span>
				</div>
			</slot>
			<input type="text" :inputmode="props.inputValueType === 'number' ? 'decimal' : undefined" autocomplete="off"
				class="pri_input gameInput" :disabled="disabled"
				:class="{ redBorder: usdtInputIsRed, inhibit: !isQuicklyBetBtn, greenColor: isGreen }"
				@blur="handleBlur" @focus="handleUsdtInputFocus" v-model="displayInputValue" @change="handleInput"
				@input="handleInput" :placeholder="placeholder" :maxlength="maxlength" />
		</div>
		<!-- 末尾有x的 input -->
		<div v-if="type === 'xInput'" class="custom-input custom-inputX"
			:style="{ width: customWidth, height: customHeight }" :class="{ disabled: disabled }">
			<p v-if="isShowLabel" class="label Cy_font_ExtraBold">{{ label }}</p>
			<div class="xIcon userSelectNone" @click="handleClickBtnX" v-sound v-if="type === 'xInput' && showXBtn">
				<img src="/img/gamepage/Xicon.webp" alt="" />
			</div>
			<input type="text" class="pri_input gameInput" ref="refXInput" :class="{ inputCommonStyle: !disabled }"
				@blur="handleBlur" v-model="displayInputValue" @input="handleInput" :disabled="disabled"
				:placeholder="placeholder" :maxlength="maxlength" />
		</div>
		<!-- 切换Increase/Reset input -->
		<div v-if="type === 'selectInput'" class="custom-input custom-input-select"
			:style="{ width: customWidth, height: customHeight }" :class="{ disabled: disabled }">
			<p v-if="isShowLabel" class="label Cy_font_ExtraBold">{{ label }}</p>
			<div class="selectConent">
				<span style="position: absolute; left: -20px; color: white; font-size: 14px">%</span>
				<div v-for="item in selectConentData" v-sound @click="handleChangeTags(item.value)"
					:class="{ active: item.value === selectTagIndex }"
					class="selectItem beuserSelectNonetBtn Cy_font_Regular" :key="item.value">
					{{ $t('Button.' + item.label) }}
				</div>
			</div>
			<input type="text" ref="refTagInput" class="pri_input gameInput"
				:class="{ inputCommonStyle: !disabled, disabled: disabled }" @focus="handleTagsFocus"
				@blur="handleBlur2" v-model="displayInputValue" @input="handleInput" :disabled="disabled"
				:placeholder="placeholder" :maxlength="maxlength" />
		</div>
		<!-- default input  -->
		<div v-if="type === 'defaultInput'" class="custom-input defaultInput"
			:style="{ width: customWidth, height: customHeight }" :class="[{ disabled: disabled }, className]">
			<p v-if="isShowLabel" class="label Cy_font_ExtraBold">{{ label }}</p>
			<!-- 带%的input -->
			<div v-if="className === 'percentageInput'" class="percentage Cy_font_Medium">
				<slot name="rightIcon">
					%
				</slot>
			</div>
			<!-- 无穷输入框 -->
			<div class="wuQiongIcon" v-if="className === 'wuQiong'" @click="handleClickWuQiong" v-sound>
				<img class="userSelectNone" src="/img/gamepage/wuQiong.webp" alt="" />
			</div>
			<input type="text" class="pri_input selfIpt" :class="{ inputCommonStyle: !disabled }"
				:inputmode="props.inputValueType === 'number' ? 'decimal' : undefined" autocomplete="off"
				@blur="handleBlur" v-model="displayInputValue" @input="handleInput" :disabled="disabled"
				:placeholder="placeholder" :maxlength="15" />
		</div>
		<!-- <div class="quicklyBetBtn Cy_font_Medium" v-if="buttonStatus" :class="{ disable: !isQuicklyBetBtn }">
			<div class="userSelectNone" v-sound @click="quickBetCallback('1/2', inputValue)">1/2</div>
			<div class="userSelectNone" @click="quickBetCallback('X2', inputValue)" v-sound>X2</div>
			<div v-sound class="userSelectNone" @click="quickBetCallback('MAX', inputValue)">MAX</div>
		</div> -->
	</div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue"
import {
	getDefailtImg,
	getDefailtSymbol,
	userInfoCurrencyTypeisFait,
	newVictural
} from "~/utils/hook/hook"
import { userInfo } from "~/utils/hook/hook"
import { formatPoint } from "~/utils/ts/formatPoint"
import formatPrice from "~/utils/ts/formatPrice"
import { useI18n } from "vue-i18n"
const { t: $t } = useI18n()
const emiter = defineEmits(["update:modelValue", "changeIptTags", "change", "blur"])

interface SelectContentItem {
	label: string
	value: number
}

const props = defineProps({
	maxlength: {
		type: Number,
		default: 10
	},
	modelValue: {
		type: [String, Number],
		default: ""
	},
	type: {
		//ipt类型 xInput、usdtInput、selectInput, defaultInput
		type: String,
		default: "usdtInput"
	},
	/** `number`：仅允许数字与单个小数点（输入/失焦/同步时均过滤字母与符号）；`text` 不限制 */
	inputValueType: {
		type: String,
		default: "number" // number、text
	},
	isCoin: {
		type: Boolean,
		default: false
	},
	// 保留几位小数
	decimalLength: {
		// 0 为整数；未传时由 syncDecimalLengthCommon 按当前币种动态决定 2/6 位
		type: Number,
		default: undefined
	},
	label: {
		//是否显示内置label文本
		type: String,
		default: "Bet amount"
	},
	isShowLabel: {
		type: Boolean,
		default: true
	},
	placeholder: {
		type: String,
		default: "0"
	},
	customWidth: {
		type: String,
		default: "100%" // 默认宽度
	},
	customHeight: {
		type: String,
		default: "50px" // 默认高度
	},
	disabled: {
		type: Boolean,
		default: false
	},
	selectConentData: {
		type: Array as () => SelectContentItem[],
		default: () => [
			{
				label: "Increase",
				value: 0
			},
			{
				label: "Reset",
				value: 1
			}
		]
	},
	buttonStatus: {
		type: Boolean,
		default: false // 默认不展示1/2，x2,max的按钮
	},
	isQuicklyBetBtn: {
		type: Boolean,
		default: true // 快速下注按钮是否可点击
	},
	showXBtn: {
		type: Boolean,
		default: true // 是否显示x的图标
	},
	showDefailtImg: {
		type: Boolean,
		default: true // 是否显示当前选中的虚拟币的图标
	},
	isClickX: {
		type: Boolean,
		default: true // x按钮是否可点击
	},
	tagIndex: {
		type: Number,
		default: 0 // selectInput Increase/Reset 选择标签的索引
	},
	className: {
		//percentageInput带有百分号的input, wuQiong带有无穷符号的input, 为空位纯净input
		type: String,
		default: "" // 自定义样式类名
	},
	isBlusrSendValue: {
		type: Boolean,
		default: false // 是否是blur事件触发的发送值
	},
	isGreen: {
		type: Boolean,
		default: false // 是否需要字体变绿
	},
	maxValue: {
		type: [Number, Boolean],
		default: false // 输入框最大输入值
	},
	minValue: {
		type: [Number, Boolean],
		default: false // 输入框最小输入值
	}
})

// 用来切换标签带有标签的input
let selectTagIndex = ref(props.tagIndex) // 选择标签的索引
const inputValue = ref(props.modelValue) // 内部存储的原始输入值

const decimalLengthCommon = ref(2)

/** 父组件显式传入的 `decimalLength`（含 0 表示整数）优先；未传或非数字再按币种默认 6/2 */
function resolveDecimalLengthCommon() {
	const raw = props.decimalLength as unknown
	const p = typeof raw === "number" && Number.isFinite(raw) ? raw : Number(raw)
	if (Number.isFinite(p) && p >= 0) {
		return p
	}
	if (userInfo.value.currencyType === "COIN") {
		return 6
	}
	return 2
}

function syncDecimalLengthCommon() {
	decimalLengthCommon.value = resolveDecimalLengthCommon()
}
syncDecimalLengthCommon()

function formatModelValueForDisplay(value: unknown) {
	const decimalLength = resolveDecimalLengthCommon()
	if (value === "" || value === null || value === undefined) {
		return ""
	}
	const n = Number(value)
	if (Number.isFinite(n) && decimalLength > 0) {
		const q = Math.pow(10, decimalLength)
		const rounded = Math.round(n * q) / q
		return formatPoint(rounded, decimalLength) ?? ""
	} else if (Number.isFinite(n)) {
		return formatPoint(Math.round(n), 0) ?? ""
	}
	return String(value)
}

function formatDisabledModelValue(value: unknown) {
	inputValue.value = formatModelValueForDisplay(value)
}

if (props.disabled) {
	formatDisabledModelValue(props.modelValue)
}

const displayInputValue = computed({
	get() {
		return props.disabled ? formatModelValueForDisplay(props.modelValue) : inputValue.value
	},
	set(value) {
		inputValue.value = value
	}
})

watch(
	() => [props.decimalLength, userInfo.value.currencyType],
	() => {
		syncDecimalLengthCommon()
		if (props.disabled) {
			formatDisabledModelValue(props.modelValue)
		}
	},
)

watch(
	() => props.modelValue,
	(value) => {
		// 只读：禁止把长浮点经 `checkedValue` 截断后 `emit` 回父级（Dice 胜率等会从 49.999… 被锁成 49.99）
		if (props.disabled) {
			formatDisabledModelValue(value)
			if (Number(value) > 0) {
				checkedinputPass()
			}
			return
		}
		inputValue.value = checkedValue(value.toString())
		// inputValue.value = value;
		updataModelValue(inputValue.value)
		if (Number(value) > 0) {
			checkedinputPass()
		}
	}
)
const updataModelValue = (value) => {
	emiter("update:modelValue", value)
}
// 初始化当输入框有值时,默认显示Increase标签
watch(
	() => props.tagIndex,
	(value) => {
		if (
			value == 1 &&
			inputValue.value !== "" &&
			+inputValue.value !== 0 &&
			inputValue.value !== undefined &&
			inputValue.value !== null
		) {
			selectTagIndex.value = 0
		}
	},
	{ immediate: true }
)

// 切换币种后，清楚校验样式
watch(
	() => getDefailtImg.value,
	(value) => {
		checkedinputPass()
	}
)

const quickBetCallback = (val: string, number: number) => {
	if (props.isQuicklyBetBtn) {
		const newBet = quickBet(val, number)
		console.log(newBet, 'newBet');

		inputValue.value = newBet
		// emiter('update:modelValue', newBet);

		updataModelValue(newBet)
	}
}

const quickBet = (val: string, number: number) => {
	switch (val) {
		case "1/2":
			if (number == 0.01 && userInfo.value.currencyType !== "COIN") return 0.01
			if (number == 0.000001) return 0.000001
			return formatPrice(Number(number) * 0.5) || 0.0
		case "X2":
			return formatPrice(Number(number) * 2)
		case "MAX":
			return newVictural(
				userInfo.value.balance[userInfo.value.selectedCoinType],
				userInfo.value.selectedCoinType,
				userInfo.value.selectedBalanceType
			)
	}
}

// 点击x按钮时，清空输入框
const refXInput = ref()
const handleClickBtnX = () => {
	if (props.isClickX) {
		//inputValue.value = 1.01;
		inputValue.value = ""
		oldInputValue.value = ""
		refXInput.value.focus()
		// emiter('update:modelValue', inputValue.value);
		updataModelValue(inputValue.value)
	}
}

// watch(() => selectTagIndex.value, (value) => {
//   emiter('changeIptTags', value);
// })

const refTagInput = ref()
const handleChangeTags = (value: string | number) => {
	selectTagIndex.value = +value
	if (selectTagIndex.value) {
		inputValue.value = ""
		// emiter('update:modelValue', '');
		updataModelValue("")
	} else {
		refTagInput.value.focus()
	}

	emiter("changeIptTags", value)
}

// 当输入等于0时，改变input显示红色边框
const usdtInputIsRed = ref(false)

// 校验通过取消失败样式
const checkedinputPass = () => {
	usdtInputIsRed.value = false
}

// 校验失败显示红色边框
const checkedinputFail = () => {
	usdtInputIsRed.value = true
}

const handleClickWuQiong = () => {
	inputValue.value = 0
	// emiter('update:modelValue', inputValue.value);
	updataModelValue(inputValue.value)
}

// 获取焦点的时候将selectTagIndex置为0
const handleTagsFocus = () => {
	selectTagIndex.value = 0
	emiter("changeIptTags", selectTagIndex.value)
}

const oldInputValue = ref("") //保留上一次输入的符合条件的值

/** 仅保留 0-9 与至多一个小数点（用于 `inputValueType="number"`：止损金额等，禁止字母与特殊符号） */
function sanitizeNumericDecimalString(raw: string): string {
	let s = String(raw ?? "").replace(/[^\d.]/g, "")
	const dot = s.indexOf(".")
	if (dot === -1) return s
	return s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, "")
}

const checkedValue = (value: string) => {
	syncDecimalLengthCommon()
	if (value == "" || value == undefined || value == null) return
	if (props.inputValueType === "number") {
		value = sanitizeNumericDecimalString(String(value))
		if (value === "") return ""
	}
	if (decimalLengthCommon.value === 0 && value.includes(".")) {
		value = value.split(".")[0] ?? ""
		return value
	}
	if (value.split(".")[1] && value.split(".")[1].length > decimalLengthCommon.value) {
		// if(value.indexOf("x"))
		value =
			value.split(".")[0] +
			"." +
			value.split(".")[1].slice(0, decimalLengthCommon.value) +
			(value.indexOf("x") == -1 ? "" : "x")
	}
	return value
}
const handleInput = (event: Event) => {
	syncDecimalLengthCommon()
	let value = (event.target as HTMLInputElement).value

	if (props.inputValueType === "number") {
		value = sanitizeNumericDecimalString(value)
		if (/^(\d+(\.\d{0,99})?)?$/.test(value.toString())) {
			// 在基本数字格式验证通过后，再根据 decimalLengthCommon 限制小数位数
			if (decimalLengthCommon.value > 0) {
				// 当为金额时,不能四舍五入, 需要根据出入的小数位数进行处理,所以才用截取的方式处理
				const parts = value.split(".")
				if (parts[1] && parts[1].length > decimalLengthCommon.value) {
					// 如果小数位数超过限制，截取到允许的位数
					value = parts[0] + "." + parts[1].slice(0, decimalLengthCommon.value)
				}
			} else {
				// 整数模式，不允许小数点
				if (value.includes(".")) {
					value = value.split(".")[0]
				}
			}

			// oldInputValue.value = value //当输入字符串或者错误数值时，会赋值上一次正确的值，但是测试不要这个功能
			// if (props.maxValue && value > props.maxValue) {
			// 	inputValue.value = props.maxValue
			// } else if (props.minValue && value < props.minValue) {
			// 	inputValue.value = props.minValue
			// } else {
			// 	inputValue.value = value
			// }
			inputValue.value = value
			oldInputValue.value = value
		} else {
			value = oldInputValue.value // 输入不符合条件时，保留上一次输入的符合条件的值
			inputValue.value = value
		}
		updataModelValue(inputValue.value)
	} else {
		inputValue.value = value
		// emiter('update:modelValue', inputValue.value);
	}
	updataModelValue(inputValue.value)

	emiter("change", inputValue.value)
}

// 通过失去焦点事件，外部可调用blur事件接收值
const isBlur = ref(false) //用来判断usdtInput是否失去焦点
const isHaveBlur = () => {
	isBlur.value = false
}
const handleUsdtInputFocus = () => {
	isBlur.value = true
}
const handleBlur = (event: Event) => {
	// console.log(type,'type');
	// console.log(event,'event.target.value');

	isHaveBlur()
	syncDecimalLengthCommon()
	let value = (event.target as HTMLInputElement).value
	if (props.inputValueType === "number") {
		const cleaned = sanitizeNumericDecimalString(String(value ?? ""))
		const numericValue = parseFloat(cleaned === "" || cleaned === "." ? "NaN" : cleaned)
		if (!isNaN(numericValue)) {
			if (decimalLengthCommon.value === 0) {
				inputValue.value = String(Math.round(numericValue))
			} else {
				inputValue.value = formatPoint(numericValue, decimalLengthCommon.value) || ""
			}
			oldInputValue.value = String(inputValue.value)
			emiter("update:modelValue", inputValue.value)
		} else {
			inputValue.value = ""
			oldInputValue.value = ""
			emiter("update:modelValue", "")
		}
	} else {
		inputValue.value = value
		emiter("update:modelValue", inputValue.value)
	}
	emiter("blur", inputValue.value)
}
// 百分比输入框保留两位小数
const handleBlur2 = (event: Event) => {
	isHaveBlur()
	let value = (event.target as HTMLInputElement).value
	if (props.inputValueType === "number") {
		const cleaned = sanitizeNumericDecimalString(String(value ?? ""))
		const numericValue = parseFloat(cleaned === "" || cleaned === "." ? "NaN" : cleaned)
		if (!isNaN(numericValue)) {
			// inputValue.value = numericValue;
			inputValue.value = formatPoint(numericValue, 2) || ""
			oldInputValue.value = String(inputValue.value)
			emiter("update:modelValue", inputValue.value)
		} else {
			inputValue.value = "" // 非数字输入时，清空输入框,不让输入
			oldInputValue.value = ""
			emiter("update:modelValue", "")
		}
	} else {
		inputValue.value = value
		emiter("update:modelValue", inputValue.value)
	}
	emiter("blur", inputValue.value)

}
defineExpose({
	checkedinputPass,
	checkedinputFail
})
</script>

<style lang="scss" scoped>
@use "/public/style/common.scss";

.pri_input:hover,
.pri_input {
	border-color: transparent;
}

/* // 默认样式 */
.defaultInput {
	.selfIpt {
		border-radius: 10px;
		/* //border: 1px solid #1C2A46;;
		//background: transparent; */

		background: var(--new-message-input-background);
	}
}

/* //inputRightIcon 样式 */
.percentageInput {
	.percentage {
		position: absolute;
		right: 10px;
		top: 17px;
		color: white;
		font-size: 14px;
	}

	.selfIpt {
		padding-right: 26px;
	}
}

/* // 无穷 */
.wuQiong {
	.wuQiongIcon {
		position: absolute;
		right: 10px;
		top: 13px;
		display: flex;
		align-items: center;
		cursor: pointer;

		>img {
			height: 24px;
			width: 24px;
		}

		.selfIpt {
			border-radius: 10px;
			/* //border: 0.5px solid var(--new-aside-border-color); */
			background: var(--new-message-input-background);
			padding-left: 42px;
		}
	}
}

// 显示金额输入框样式重写
.custom-input1 {
	border-radius: 10px;
	border: 0.5px solid var(--new-aside-border-color);
	background: var(--new-message-input-background);
	display: flex;
	align-items: center;
	padding: 0 10px;
	box-sizing: border-box;

	&.isBlur {
		border: 1px solid #94a1ba;
	}

	&.hoverBorder:hover {
		border: 1px solid #94a1ba;
	}

	/* // :hover {
	//   border: 1px solid #94A1BA;
	// } */

	.gameInput {
		border-radius: 10px;
		/* // border: 0.5px solid var(--new-aside-border-color); */
		background: transparent;
		height: 47px;
		padding: 12px 0 12px 5px;
		outline: none;

		&:hover {
			border: none;
			outline: none;
			border: 1px solid transparent;
		}

		&:focus {
			border: none;
			border: 1px solid var(--new-message-input-background);
		}
	}

	.inputIcom {
		/* // position: absolute;
		// left: 10px;
		// top: 15px; */
		display: flex;
		align-items: center;

		>img {
			height: 20px;
			// width: 16px;
		}

		.money {
			font-size: 14px;
			color: white;
			/* // margin-left: 5px; */
			display: block;
			padding-left: 5px;
		}
	}
}

/* // 定制样式 */
.custom-input {
	display: flex;
	flex-direction: column;
	position: relative;
	border: 1px solid #1c2a46;
	border-radius: 10px;

	.gameInput {
		border-radius: 10px;
		/* //border: 0.5px solid var(--new-aside-border-color); */
		background: var(--new-message-input-background);
		/* //background: transparent; */
		padding-left: 42px;
	}

	.label {
		margin-bottom: 4px;
	}

	.inputIcom {
		position: absolute;
		left: 10px;
		top: 15px;
		display: flex;
		align-items: center;

		>img {
			height: 20px;
			// width: 16px;
		}

		.money {
			font-size: 14px;
			color: white;
			/* // margin-left: 5px; */
			display: block;
			padding-left: 5px;
		}
	}
}

.custom-inputX {
	.gameInput {
		padding-left: 10px;
	}

	.xIcon {
		height: 22px;
		width: 22px;
		position: absolute;
		right: 10px;
		top: 14px;
		cursor: pointer;

		&:hover {
			transform: scale(1.2);
		}
	}
}

.custom-input-select {
	.gameInput {
		padding-left: 10px;
		padding-right: 156px;
	}

	.selectConent {
		position: absolute;
		right: 10px;
		top: 10px;
		background-color: #09122b;
		border-radius: 5px;
		font-size: 12px;
		color: var(--new-white);
		display: flex;
		align-items: center;
		box-sizing: border-box;
		border: 1px solid var(--wallte-tab-bg);

		.selectItem {
			height: 30px;
			/* width: 100%; */
			padding: 0 5px;
			/* width: 59px; */
			text-align: center;
			line-height: 30px;
			cursor: pointer;
		}

		.active {
			background-color: var(--wallte-tab-bg);
		}
	}
}

.inputCommonStyle.inhibit {
	opacity: 0.5;
}

/* 修改 placeholder 文本颜色 */
input::placeholder {
	color: #456c99;
	/* 红色 */
	opacity: 1;
	/* 确保颜色完全显示 */
}

/* 如果需要兼容旧版浏览器（如 Firefox） */
input::-moz-placeholder {
	color: #456c99;
	opacity: 1;
	font-family: FixelText-ExtraBold !important;
}

/* 兼容 Safari 和旧版 Chrome */
input::-webkit-input-placeholder {
	color: #456c99;
	font-family: FixelText-ExtraBold !important;
}

.custom-input,
.custom-input1,
.pri_input {
	.gameInput {
		font-size: 15px;
		font-weight: 500;
	}
}

.disabled {
	border-radius: 10px;
	border: 1px solid #1c2a46;
	background: #161f3a;

	.gameInput,
	.selfIpt {
		background: transparent;
	}
}

.gameInput {
	font-size: 15px;
	font-weight: 500;
}
</style>