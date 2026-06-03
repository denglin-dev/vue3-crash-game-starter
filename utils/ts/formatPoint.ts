import { userInfo } from "~/utils/hook/hook"

export function formatPricePoint(num: string | number, pointNum: number, cancel: boolean) {
	// 转换为字符串，避免直接操作数字导致精度问题
	if (num === 0 || num === "0" || !num) return "0.00" // 若为0则直接返回0.00
	const numStr = num.toString()
	// 检查是否是整数
	if (numStr.indexOf(".") === -1) {
		// 如果是整数，直接返回
		return numStr
	} else {
		// 有小数部分，但需要截取到pointNum位
		const parts = numStr.split(".")
		const integerPart = parts[0]
		let decimalPart = parts[1]
		// 判断小数末尾是否存在连续性的0,若存在则去掉且只保留六位小数
		if (cancel) {
			decimalPart = decimalPart.replace(/0+$/, "")
			if (decimalPart.length > pointNum) {
				decimalPart = decimalPart.slice(0, pointNum)
			} else {
				// 若不存在且小数位数大于pointNum，则截取到pointNum位
				if (decimalPart.length > pointNum) {
					decimalPart = decimalPart.slice(0, pointNum)
				}
			}
			// 重新组合并返回
			return decimalPart ? integerPart + "." + decimalPart : integerPart
		}
	}
}

// 保留小数位数
export const formatPoint = (num: string | number, decimalLength: number) => {

	// 空字符串或 null/undefined 返回 undefined
	if (num === "" || num === null || num === undefined || (isNaN(Number(num)) && num !== 0)) {
		return
	}

	// 统一转为 number
	let n = Number(num)

	// 处理科学计数法 -> 转为普通小数字符串
	let numStr = n.toFixed(decimalLength + 10) // 保留足够多的小数，避免精度丢失
	numStr = Number(numStr).toString() // 去掉多余的 0

	// 再次确保非科学计数法表示
	if (numStr.includes("e") || numStr.includes("E")) {
		numStr = n.toLocaleString("fullwide", { useGrouping: false })
	}

	const decimalIndex = numStr.indexOf(".")

	// 没有小数点，直接补零
	if (decimalIndex === -1) {
		return decimalLength > 0 ? `${numStr}.${"0".repeat(decimalLength)}` : numStr
	}

	let integerPart = numStr.slice(0, decimalIndex)
	let decimalPart = numStr.slice(decimalIndex + 1)

	// 填充或截断小数部分
	if (decimalPart.length < decimalLength) {
		decimalPart = decimalPart.padEnd(decimalLength, "0")
	} else if (decimalPart.length > decimalLength) {
		decimalPart = decimalPart.slice(0, decimalLength)
	}

	return `${integerPart}.${decimalPart}`

}


// 与虚拟币法币开关按钮无关:2~6位小数
export function formatPriceNew(num: string | number, endNumber?: number, isreserve = false) {
	if (num === 0 || num === "0" || !num) {
		if (isreserve) {
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
		if (!isreserve) {
			return numStr + ".00"
		} else {
			return numStr + ".000000"
		}

	} else {
		// 虚拟币 6 位 / 法币 endNumber；勿用 sessionStorage（SSR 刷新会报 sessionStorage is not defined）
		const number =
			userInfo.value?.currencyType === "FAIT" ? (endNumber ?? 2) : 6
		// eslint-disable-next-line prefer-const
		let [integerPart, decimalPart] = numStr.split(".")

		// 截取小数部分，并保证至少有 `number` 位
		decimalPart = decimalPart.slice(0, number)
		while (decimalPart.length < number) {
			decimalPart += "0"
		}

		// 小数部分全是 0，则返回 `整数.00`
		// if(!isreserve){
		if (!Number(decimalPart)) {

			if (!isreserve) {
				decimalPart = "00"
			}
			return integerPart + "." + decimalPart
		} else {
			return removeTrailingZeros(integerPart + "." + decimalPart, number)
		}

	}
}

// 去除6位小数位(虚拟币)多余的0
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
