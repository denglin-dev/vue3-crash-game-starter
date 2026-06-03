/**
 * 自研游戏与后端约定的 game_code / game_id（统一字符串）。
 */
export const GAME_CODE = {
	CRASH: "10001",
	PLINKO: "10002",
	DICE: "10003",
	LIMBO: "10004",
	MINES: "10005",
	HILO: "10006",
} as const

export type GameCode = (typeof GAME_CODE)[keyof typeof GAME_CODE]

/** 后端 gameCode → `/game/<slug>` 路由段（原 hook 中 `souceMap`） */
export const GAME_CODE_TO_ROUTE_SLUG: Readonly<Record<GameCode, string>> = {
	[GAME_CODE.CRASH]: "crash",
	[GAME_CODE.PLINKO]: "plinko",
	[GAME_CODE.DICE]: "dice",
	[GAME_CODE.LIMBO]: "limbo",
	[GAME_CODE.MINES]: "mines",
	[GAME_CODE.HILO]: "hilo",
}

/** Nuxt 路由 name（含 i18n `game-dice___en_US`）→ game_code */
const ROUTE_NAME_TO_GAME_CODE: Record<string, GameCode> = {
	"game-limbo": GAME_CODE.LIMBO,
	"game-crash": GAME_CODE.CRASH,
	"game-dice": GAME_CODE.DICE,
	"game-plinko": GAME_CODE.PLINKO,
	"game-mines": GAME_CODE.MINES,
	"game-hilo": GAME_CODE.HILO,
	"newGame-limbo": GAME_CODE.LIMBO,
	"newGame-crash": GAME_CODE.CRASH,
	"newGame-dice": GAME_CODE.DICE,
	"newGame-plinko": GAME_CODE.PLINKO,
	"newGame-mines": GAME_CODE.MINES,
	"newGame-hilo": GAME_CODE.HILO,
}

/** 从路由 name 解析 game_code；可在任意上下文调用（不依赖 `useRoute`） */
export function resolveGameCodeFromRouteName(name: unknown): GameCode | undefined {
	if (name == null || typeof name === "symbol") return undefined
	const nameStr = typeof name === "string" ? name : String(name)
	if (!nameStr) return undefined
	const base = nameStr.includes("___") ? (nameStr.split("___")[0] ?? nameStr) : nameStr
	if (ROUTE_NAME_TO_GAME_CODE[base]) return ROUTE_NAME_TO_GAME_CODE[base]
	if (ROUTE_NAME_TO_GAME_CODE[nameStr]) return ROUTE_NAME_TO_GAME_CODE[nameStr]
	for (const key of Object.keys(ROUTE_NAME_TO_GAME_CODE)) {
		if (nameStr === key || nameStr.startsWith(`${key}___`) || nameStr.startsWith(`${key}__`)) {
			return ROUTE_NAME_TO_GAME_CODE[key]
		}
	}
	return undefined
}

/** 从 URL path 解析 game_code；可在 observer / bus / 异步回调中安全调用 */
export function resolveGameCodeFromPath(path: string): GameCode | undefined {
	const p = path.toLowerCase()
	for (const [code, slug] of Object.entries(GAME_CODE_TO_ROUTE_SLUG)) {
		const normalizedSlug = String(slug).toLowerCase()
		if (
			p.includes(`/game/${normalizedSlug}`) ||
			p.includes(`/newgame/${normalizedSlug}`)
		) {
			return code as GameCode
		}
	}
	return undefined
}

/**
 * 解析当前页面对应的 game_code。
 * - 有 `routeName` / `path` 时优先使用（组件 setup 内传入 `useRoute()` 结果）
 * - 否则在客户端回退 `window.location.pathname`（避免 setup 外调用 `useRoute()` → inject 警告）
 */
export function resolveGameCodeForCurrentPage(opts?: {
	routeName?: unknown
	path?: string
}): GameCode | undefined {
	if (opts?.routeName != null) {
		const fromName = resolveGameCodeFromRouteName(opts.routeName)
		if (fromName) return fromName
	}
	if (opts?.path) {
		const fromPath = resolveGameCodeFromPath(opts.path)
		if (fromPath) return fromPath
	}
	if (import.meta.client && typeof window !== "undefined") {
		return resolveGameCodeFromPath(window.location.pathname)
	}
	return undefined
}
