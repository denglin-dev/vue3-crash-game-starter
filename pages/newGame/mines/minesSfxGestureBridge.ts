/**
 * Mines 短音效：`GameContent` 注册 `resume+preload`；`useMinesBet` 在 **`await minesApi.*` 之前** `await` 一次，
 * 与点击下注/开格/兑现同属 async 入口前半段，减轻 Web Audio 多局挂起后整段哑火。
 */
type MinesSfxResumeFn = () => void | Promise<void>

let onMinesBetResume: MinesSfxResumeFn | null = null

export function setMinesWebSfxUserGestureHook(fn: MinesSfxResumeFn | null) {
	onMinesBetResume = fn
}

/** 开格入口同步调用：debounce 定时器之前钉住手势（见 `useMinesBet.pickTileFun`） */
export function runMinesBetUserGestureSfxHook() {
	void onMinesBetResume?.()
}

/** 在 `await minesApi.bet|autoBet|pickTile|cashout` 之前 await */
export async function awaitMinesSfxResumeBeforeHttpBet(): Promise<void> {
	await onMinesBetResume?.()
}
