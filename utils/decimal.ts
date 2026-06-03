import Decimal from "decimal.js-light/decimal.mjs"

// 内部工具：安全生成 Decimal
function toDecimal(value: string | number | null | undefined): Decimal {
	if (value === null || value === undefined || value === "" || isNaN(Number(value))) {
		return new Decimal(0)
	}
	return new Decimal(value)
}

// 加
export function decimal_add(x: string | number, y: string | number): number {
	return toDecimal(x).plus(toDecimal(y)).toNumber()
}

// 减
export function decimal_sub(x: string | number, y: string | number): number {
	return toDecimal(x).sub(toDecimal(y)).toNumber()
}

// 除
export function decimal_div(x: string | number, y: string | number): number {

	const divisor = toDecimal(y)
	if (divisor.isZero()) return 0 // 避免除 0
	return toDecimal(x).div(divisor).toNumber()
}

// 乘
export function decimal_mul(x: string | number, y: string | number): number {
	return toDecimal(x).mul(toDecimal(y)).toNumber()
}
