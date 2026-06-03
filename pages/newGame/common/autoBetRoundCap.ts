/**
 * 自动模式「总局数 / 投注次数」上限解析。
 * `null`、空串、`0`、非正数、NaN → 无限局；正整数 → `Math.floor` 后的上限。
 * 用于 Dice / Limbo / Mines 的 `betBigNumber` 与 Plinko 的 `gameNum`，避免 `v-model` 为字符串 `"0"` 时被 `&&` 当成「有限局」。
 */
export function autoBetRoundCap(raw: unknown): number | null {
  if (raw === "" || raw == null) return null
  const n = typeof raw === "number" ? raw : Number(String(raw).trim())
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.floor(n)
}
