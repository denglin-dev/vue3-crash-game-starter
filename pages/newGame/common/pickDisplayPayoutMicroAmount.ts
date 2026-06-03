/**
 * 各游戏接口常以「微单位」（×1e6）返回派彩；展示/UI 累加时应不超过服务端给的封顶额。
 *
 * 返回用于展示的微单位数值（均为原始微单位整数）。
 * - `payout` 与 `max_profit` 皆有效且 **`max_profit > 0`**：`Math.min(payout, max_profit)`
 * - `max_profit` 为 `0` 或 **≤ 0**：视为无封顶，**只取 `payout`**（有则返回，无则 `0`）
 * - 仅 `payout` 有效：返回 `payout`
 * - 仅 `max_profit` 有效且 **> 0**：返回 `max_profit`
 * - 皆无效：`0`
 *
 * @param payout - 本局派彩/盈利（如 `payout`、`result`、`profit`）
 * @param maxProfit - 单局利润上限（`max_profit`）；缺省或空字符串则不封顶
 */
export function pickDisplayPayoutMicroAmount(payout: unknown, maxProfit: unknown): number {
	const safe = (v: unknown): number | undefined => {
		if (v == null || v === "") return undefined
		const n = Number(v)
		return Number.isFinite(n) ? n : undefined
	}

	const pay = safe(payout)
	const cap = safe(maxProfit)

	if (pay !== undefined && cap !== undefined && cap > 0) return Math.min(pay, cap)
	if (pay !== undefined) return pay
	if (cap !== undefined && cap > 0) return cap
	return 0
}