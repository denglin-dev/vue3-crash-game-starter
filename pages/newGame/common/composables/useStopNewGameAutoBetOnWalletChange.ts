import { watch } from "vue"
import { loginStatus, userInfo } from "~/utils/hook/hook"

/**
 * 留在 Dice / Limbo / Mines / Plinko / Crash 等页时，若用户切换钱包币种、法币种类或开关「法币展示」，
 * 与 `userInfo` 展示上下文对齐：正在自动下注则立即停止，避免旧额度/汇率继续连投。
 */
export function useStopNewGameAutoBetOnWalletChange(
	isAutoBetting: () => boolean,
	stopAutoBetting: () => void
) {
	if (!import.meta.client) return

	const walletContextSignature = () => {
		if (!loginStatus.value) return null
		const u = userInfo.value
		return [
			String(u.currencyType ?? ""),
			String(u.selectedBalanceType ?? ""),
			String(u.selectedCoinType ?? ""),
			String(u.amountType ?? ""),
			String(u.selectedBonusCoinType ?? ""),
		].join("\u0001")
	}

	let lastSig: string | null = null

	watch(walletContextSignature, (sig) => {
		if (sig === null) {
			lastSig = null
			return
		}
		if (lastSig === null) {
			lastSig = sig
			return
		}
		if (lastSig === sig) return
		lastSig = sig
		if (isAutoBetting()) stopAutoBetting()
	})
}
