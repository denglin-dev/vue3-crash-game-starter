<template>
	<div class="numberContent">
		<img v-for="(char, index) in formattedValue" :key="index" :src="getImageSrc(char)" :alt="char"
			:class="{ dot: char === '.' }" v-bind:style="{ visibility: imageLoaded ? 'visible' : 'hidden' }" />
	</div>
</template>

<script lang="ts">
const PAYOUT_NUMBER_PICS = [
	{ img: "/img/gamepage/number0.webp", value: "0" },
	{ img: "/img/gamepage/number1.webp", value: "1" },
	{ img: "/img/gamepage/number2.webp", value: "2" },
	{ img: "/img/gamepage/number3.webp", value: "3" },
	{ img: "/img/gamepage/number4.webp", value: "4" },
	{ img: "/img/gamepage/number5.webp", value: "5" },
	{ img: "/img/gamepage/number6.webp", value: "6" },
	{ img: "/img/gamepage/number7.webp", value: "7" },
	{ img: "/img/gamepage/number8.webp", value: "8" },
	{ img: "/img/gamepage/number9.webp", value: "9" },
	{ img: "/img/gamepage/numberFh.webp", value: "," },
	{ img: "/img/gamepage/numberPoint.webp", value: "." }
]

let payoutNumberImagesLoaded = false
let payoutNumberImagesPromise: Promise<void> | null = null

function preloadPayoutNumberImages(): Promise<void> {
	if (payoutNumberImagesLoaded) return Promise.resolve()
	if (payoutNumberImagesPromise) return payoutNumberImagesPromise
	if (typeof window === "undefined") return Promise.resolve()
	payoutNumberImagesPromise = Promise.all(
		PAYOUT_NUMBER_PICS.map((item) => {
			return new Promise<void>((resolve) => {
				const img = new Image()
				img.src = item.img
				img.onload = () => resolve()
				img.onerror = () => resolve()
			})
		})
	).then(() => {
		payoutNumberImagesLoaded = true
	})
	return payoutNumberImagesPromise
}

function getPayoutNumberImageSrc(char: string): string {
	const found = PAYOUT_NUMBER_PICS.find((item) => item.value === char)
	return found ? found.img : ""
}
</script>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue"
import formatPrice from "~/utils/ts/formatPrice"

const prop = defineProps({
	value: {
		type: [String, Number],
		default: "123.48"
	}
})

const imageLoaded = ref(payoutNumberImagesLoaded) // 控制图像加载完毕后显示

// 计算属性格式化值，保留两位小数
const formattedValue = computed(() => {
	// let n = Number(prop.value).toFixed(6);

	let n = formatPrice(prop.value).toString()
	return n.split("")
})

// 根据字符获取对应的图像
const getImageSrc = (char: string) => getPayoutNumberImageSrc(char)
onMounted(() => {
	preloadPayoutNumberImages().then(() => {
		imageLoaded.value = true
		emiter("loadedOver")
	})
})

// 预加载图像
const emiter = defineEmits(["loadedOver"])
</script>

<style>
.numberContent {
	display: flex;
	align-items: center;
	height: 67px;
	line-height: 69px;
	justify-content: center;
	width: 100%;
}

.dot {
	margin-top: 30px;
}
</style>