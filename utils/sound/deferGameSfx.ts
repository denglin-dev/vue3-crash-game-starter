/**
 * 将短音效排到「两帧 rAF + 少量 ms」之后执行：
 * - 让 Vue DOM 更新、CSS transition/transform 先进入 compositor，再跑 Web Audio decode/start，减轻同帧峰值叠在一起；
 * - 与 Plinko 物理帧上「先建球体再发声」一类错峰思路一致，Dice / Mines / Limbo 共用。
 *
 * 卸载或新一局要丢弃尚未执行的回调时调用 `invalidate()`（递增代际，已排队的 setTimeout 内会自行短路）。
 */
export const DEFAULT_DEFER_GAME_SFX_MS = 36

export function createDeferGameSfxController() {
	let gen = 0
	return {
		/** 打断尚未执行的延后音效（组件卸载、或 Dice 新一局覆盖上一局 move） */
		invalidate: () => {
			gen++
		},
		/**
		 * @param run 实际播发（内部应再判断音效开关等）
		 * @param extraMs 第二帧之后再延迟的毫秒数；极速局可传更小（如 20）
		 */
		schedule: (run: () => void, extraMs: number = DEFAULT_DEFER_GAME_SFX_MS) => {
			if (!import.meta.client) return
			const my = gen
			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					window.setTimeout(() => {
						if (my !== gen) return
						run()
					}, extraMs)
				})
			})
		},
	}
}
