import { useGameConfigStore } from "~/stores/gameConfig"
import {
	GAME_CODE_TO_ROUTE_SLUG,
	resolveGameCodeForCurrentPage,
	type GameCode
} from "~/pages/newGame/common/composables/newGameCodes"

const GAME_RULE_BACKEND_ID_CACHE_KEY = "cy:gameRuleBackendIds"

const isGameCode = (code: unknown): code is GameCode =>
	typeof code === "string" && code in GAME_CODE_TO_ROUTE_SLUG

const readRuleBackendIdCache = (): Partial<Record<GameCode, string>> => {
	if (!import.meta.client || typeof window === "undefined") return {}
	try {
		const raw = window.sessionStorage.getItem(GAME_RULE_BACKEND_ID_CACHE_KEY)
		if (!raw) return {}
		const parsed = JSON.parse(raw) as Partial<Record<GameCode, string>>
		return parsed && typeof parsed === "object" ? parsed : {}
	} catch {
		return {}
	}
}

const getCurrentGameBackendId = (gameCode: GameCode): string => {
	if (!import.meta.client || typeof window === "undefined") return ""
	try {
		const raw =
			window.sessionStorage.getItem("cybet-currentGame") ||
			window.localStorage.getItem("cybet-currentGame")
		if (!raw) return ""
		const currentGame = JSON.parse(raw) as { gameCode?: unknown; id?: unknown }
		if (String(currentGame?.gameCode ?? "") !== gameCode) return ""
		const id = currentGame?.id
		return id != null && id !== "" ? String(id).trim() : ""
	} catch {
		return ""
	}
}

export const rememberRuleBackendGameIdForRoute = (
	gameCode: unknown,
	backendGameId: unknown
) => {
	if (!import.meta.client || typeof window === "undefined") return
	const normalizedGameCode = String(gameCode ?? "")
	if (!isGameCode(normalizedGameCode)) return
	if (backendGameId == null || backendGameId === "") return

	const id = String(backendGameId).trim()
	if (!id) return
	const cache = readRuleBackendIdCache()
	cache[normalizedGameCode] = id
	const cacheText = JSON.stringify(cache)
	window.sessionStorage.setItem(GAME_RULE_BACKEND_ID_CACHE_KEY, cacheText)
}

/** 优先读旧 query，其次读无 query 路由进入前缓存的后端游戏主键。 */
export const useRuleBackendGameIdFromRoute = (): string => {
	const route = useRoute()
	const raw = route.query.gameId ?? route.query.id
	if (raw != null && raw !== "") return String(raw).trim()

	const gameCode = resolveGameCodeForCurrentPage({
		routeName: route.name,
		path: route.path
	})
	if (!gameCode) return ""

	const cachedId = readRuleBackendIdCache()[gameCode]
	if (cachedId) return cachedId
	return getCurrentGameBackendId(gameCode)
}

const gameRuleInflight = new Map<string, Promise<unknown>>()
const gameRuleResolvedIds = new Set<string>()

const fetchGameRuleOnce = (gid: string) => {
	const store = useGameConfigStore()
	if (!gid) {
		return store.fetchGameConfigData()
	}
	if (gameRuleResolvedIds.has(gid)) {
		return Promise.resolve(store.gameConfig)
	}
	const existing = gameRuleInflight.get(gid)
	if (existing) {
		return existing
	}
	const task = store.fetchGameConfigByGameId(gid)
		.then((result) => {
			if (result) {
				gameRuleResolvedIds.add(gid)
			}
			return result
		})
		.finally(() => {
			gameRuleInflight.delete(gid)
		})
	gameRuleInflight.set(gid, task)
	return task
}

/**
 * 进入游戏页时用后端 `gameId` 拉 selectGameRule；无缓存时回退为全量（书签/直达链接）。
 *
 * - `server: false`：请求只在浏览器发起。
 * - `lazy: true`：不阻塞路由与页面 setup；配置到达后由各校 `watch(gameConfig)` 同步。
 */
export const useGameRuleAsyncData = (backendGameId: string) => {
	const gid = backendGameId.trim()
	const key = gid ? `game-rule-${gid}` : "game-rule-fallback-all"
	return useAsyncData(key, () => fetchGameRuleOnce(gid), {
		server: false,
		lazy: true,
	})
}

/** 页面先进入，但下注必须等对应游戏规则合并到 store 后再开放 */
export const useGameRuleReady = (gameCode: string) => {
	const store = useGameConfigStore()
	return computed(() => {
		if (store.gameConfig === false || store.gameConfig == null) return false
		return Boolean((store.gameConfig as Record<string, unknown>)[gameCode])
	})
}

/** 列表 hover 时预拉规则（与进页请求去重） */
export const prefetchGameRuleByBackendId = (backendGameId: string) => {
	if (!import.meta.client) return
	const gid = backendGameId.trim()
	if (!gid) return
	void fetchGameRuleOnce(gid)
}
