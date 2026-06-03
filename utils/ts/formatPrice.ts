// const {userInfo} = useCounterStore()
import { userInfo, loginStatus } from "~/utils/hook/hook"

function formatPrice(num: string | number, showAllLength = false) {

	if (num === 0 || num === "0" || !num) {
		if (userInfo.value.currencyType === "COIN" && loginStatus.value) {
			return "0.000000"
		} else {
			return "0.00"
		}
	}

	let numStr = num.toString()


	// 确保不会变成科学计数法
	if (numStr.includes("e") || numStr.includes("E")) {
		numStr = Number(num).toFixed(10) // 固定 10 位小数，避免科学计数法

	}

	if (!numStr.includes(".")) {
		return numStr + ".00"
	} else {
		const number = userInfo.value.currencyType === "COIN" && loginStatus.value ? 6 : 2
		// eslint-disable-next-line prefer-const
		let [integerPart, decimalPart] = numStr.split(".")

		// 截取小数部分，并保证至少有 `number` 位
		decimalPart = decimalPart.slice(0, number)
		while (decimalPart.length < number) {
			decimalPart += "0"
		}

		// 小数部分全是 0，则返回 `整数.00`
		if (!Number(decimalPart)) {
			const len = showAllLength ? number : 2
			decimalPart = "".padEnd(len, "0")

			return integerPart + "." + decimalPart
		} else {

			return removeTrailingZeros(integerPart + "." + decimalPart, number)
		}
	}
}

// **去除多余的 0，但保证至少保留 `minDecimals` 位小数**
function removeTrailingZeros(number: string | number, minDecimals: number) {
	let numberString = number.toString()

	// 避免科学计数法
	if (numberString.includes("e") || numberString.includes("E")) {
		numberString = Number(number).toFixed(minDecimals)
	}

	// 确保小数部分至少保留 `minDecimals` 位
	// eslint-disable-next-line prefer-const
	let [integerPart, decimalPart] = numberString.split(".")
	decimalPart = decimalPart.replace(/0+$/, "") // 先移除多余 0
	while (decimalPart.length < minDecimals) {
		decimalPart += "0" // 再补齐到 `minDecimals` 位
	}

	return integerPart + "." + decimalPart
}

export default formatPrice
