import { defineStore } from "pinia"
import { GAME_CODE } from "~/pages/newGame/common/composables/newGameCodes"
import { useSideStore } from "~/stores/side"
import { mainContent } from "~/utils/ts/api"
import { ssrBlogApi } from "~/utils/ts/ssrApi"
import type { ResponseData } from "~/utils/ts/type"

// 与首页 Banner 展示字段一致
export interface HomeBannerItem {
	title: string
	imgUrl: string
	mobileImgUrl?: string
	type: number
	linkType: number
	link: string
	id?: string
	url: string
}

const MEGA_WINS_MAX_LENGTH = 30

/** 与 ensureMegaWins 一致，供首页 SSR 水合复用 */
export const normalizeMegaWinsList = (res: Record<string, unknown>[]) =>
	res
		.filter((item) => item.coinToFait)
		.map((item: Record<string, unknown>, idx: number) => ({
			...item,
			levelIcon: undefined,
			_uid: item.id != null ? `api-${item.id}` : `api-${idx}-${Date.now()}`
		}))

// 首页横向游戏区：与 getAllGameListNew / getGameProviderList 返回结构一致
export type HomeGameModuleListData = Record<string, unknown>
export type HomeGameModuleProviderData = Record<string, unknown>

/** 首页 hgame（getAllGameListNew）首屏条数，SSR / ensureGameModule / WS 刷新共用 */
export const HOME_HGAME_LIST_PAGE_SIZE = 21
export const HOME_HGAME_LIST_REQUEST = {
	pageSize: HOME_HGAME_LIST_PAGE_SIZE,
	pageNum: 1,
	cutImgs: ""
} as const

// /searchGame 列表第一页会话缓存载荷
export type SearchGameListCachedPayload = {
	pageData: {
		total: number
		pageNum: number
		pages: number
		pageSize: number
	}
	list: Record<string, unknown>[]
	progress: number
	/** 与 getListGame 首屏请求体一致，供 WS 多桶逐桶重放 */
	listGameRequestPage1?: Record<string, unknown>
}

// /gameList/recent、favorites
export type GameListRouteTab = "recent" | "favorites"

export type GameListRouteCachedPayload = {
	searchResultList: Record<string, unknown>[]
	pageData: {
		total: number
		pageNum: number
		pages: number
		pageSize: number
	}
	progress: number
}

// /searchGame 路由 fullPath 规范化（query 按 key 排序），不同入口路径分桶缓存
export function normalizeSearchGameRouteKey(fullPath: string): string {
	const qIndex = fullPath.indexOf("?")
	const pathOnly = qIndex === -1 ? fullPath : fullPath.slice(0, qIndex)
	const query = qIndex === -1 ? "" : fullPath.slice(qIndex + 1)
	if (!query) return pathOnly
	const params = new URLSearchParams(query)
	const keys = [...new Set([...params.keys()])].sort((a, b) => a.localeCompare(b))
	const sorted = new URLSearchParams()
	for (const k of keys) {
		const vals = params.getAll(k).sort((a, b) => a.localeCompare(b))
		for (const v of vals) sorted.append(k, v)
	}
	const qs = sorted.toString()
	return qs ? `${pathOnly}?${qs}` : pathOnly
}

// /promotions 列表请求体字段（type/status 与页面上筛选一致）
export type PromotionsListRequest = {
	type: number | null
	status: number | null
	pageNum: number
	pageSize: number
}

// /promotions 单桶缓存：列表记录 + 分页（与接口 data 对齐）
export type PromotionsListCachedPayload = {
	records: Record<string, unknown>[]
	current: number
	total: number
}

// 会话内缓存键：同一筛选 + 同一页只保留一份；整页刷新后 Pinia 清空
export function promotionsListCacheKey(req: PromotionsListRequest): string {
	return `${req.type ?? "n"}:${req.status ?? "n"}:${req.pageNum}:${req.pageSize}`
}

/** 与 {@link promotionsListCacheKey} 互逆；用于 WS 推送后按已有分桶重新拉取 */
export function promotionsRequestFromCacheKey(key: string): PromotionsListRequest | null {
	const parts = key.split(":")
	if (parts.length !== 4) return null
	const [typeStr, statusStr, pageNumStr, pageSizeStr] = parts
	const pageNum = Number(pageNumStr)
	const pageSize = Number(pageSizeStr)
	if (!Number.isFinite(pageNum) || !Number.isFinite(pageSize)) return null

	let type: number | null = null
	if (typeStr !== "n") {
		const n = Number(typeStr)
		if (!Number.isFinite(n)) return null
		type = n
	}

	let status: number | null = null
	if (statusStr !== "n") {
		const n = Number(statusStr)
		if (!Number.isFinite(n)) return null
		status = n
	}

	return { type, status, pageNum, pageSize }
}

// /blog/blogList：按分类 + 分页分桶（与页面 blogTypeId、pageNum、pageSize 一致）
export type BlogListRequest = {
	blogTypeId: string
	pageNum: number
	pageSize: number
}

export type BlogListCachedPayload = {
	records: Record<string, unknown>[]
	current: number
	total: number
}

export function blogListCacheKey(req: BlogListRequest): string {
	return `${req.blogTypeId || "all"}:${req.pageNum}:${req.pageSize}`
}

/** 与 {@link blogListCacheKey} 互逆（blogTypeId 不含 `:`） */
export function blogRequestFromCacheKey(key: string): BlogListRequest | null {
	const parts = key.split(":")
	if (parts.length !== 3) return null
	const typePart = parts[0] ?? ""
	const pageNumStr = parts[1] ?? ""
	const pageSizeStr = parts[2] ?? ""
	const pageNum = Number(pageNumStr)
	const pageSize = Number(pageSizeStr)
	if (!Number.isFinite(pageNum) || !Number.isFinite(pageSize)) return null
	const blogTypeId = typePart === "all" ? "" : typePart
	return { blogTypeId, pageNum, pageSize }
}

/** 首页 WinTable：三 tab 分桶 + 条数 + 法币类型；个人 tab 含 userId */
export type WinTableTabKind = "self" | "live" | "high"

export function winTableCacheKey(
	tab: WinTableTabKind,
	pageSize: number,
	balanceType: string,
	userId?: string | number | null
): string {
	const bal = balanceType || "default"
	if (tab === "self") {
		const u = userId != null && userId !== "" ? String(userId) : "guest"
		return `wt:self:${u}:${pageSize}:${bal}`
	}
	return `wt:${tab}:${pageSize}:${bal}`
}

export const useHomeDataStore = defineStore("homeData", () => {
	// --- 首页 Banner：selectAllActivity，ensure 会话内只拉一次直至 invalidate ---
	const bannerList = ref<HomeBannerItem[]>([])
	const loaded = ref(false)
	let inFlight: Promise<void> | null = null
	let requestSeq = 0
	/** 仅用于 softRefetchBanner，与 ensureBanner 的 requestSeq 分离，避免抢跑首次拉取 */
	let bannerSoftFetchId = 0

	const megaWinsList = ref<unknown[]>([])
	const megaWinsLoaded = ref(false)
	let megaInFlight: Promise<void> | null = null
	let megaRequestSeq = 0

	const invalidateBanner = () => {
		requestSeq++
		bannerSoftFetchId++
		loaded.value = false
		bannerList.value = []
		inFlight = null
	}

	const ensureBanner = () => {
		if (loaded.value) return Promise.resolve()
		if (inFlight) return inFlight
		const seq = requestSeq
		inFlight = new Promise<void>((resolve) => {
			mainContent.selectAllActivity({}, (res: ResponseData) => {
				inFlight = null
				if (seq !== requestSeq) {
					resolve()
					return
				}
				if (!res) {
					bannerList.value = []
					loaded.value = true
					resolve()
					return
				}
				const raw = res.data as unknown
				const list = Array.isArray(raw) ? (raw as HomeBannerItem[]) : []
				bannerList.value = list
				loaded.value = true
				resolve()
			})
		})
		return inFlight
	}

	const refetchBanner = () => {
		invalidateBanner()
		return ensureBanner()
	}

	/** 首页 SSR 水合：标记已加载，避免子组件 ensureBanner 重复请求 */
	const hydrateBannerFromSsr = (list: HomeBannerItem[]) => {
		requestSeq++
		bannerSoftFetchId++
		inFlight = null
		bannerList.value = list
		// SSR 偶发空数据时不要锁死为已加载，客户端挂载后可再补请求一次。
		loaded.value = list.length > 0
	}

	const hydrateMegaWinsFromSsr = (list: unknown[]) => {
		megaRequestSeq++
		megaInFlight = null
		megaWinsList.value = list
		megaWinsLoaded.value = true
	}

	const hydrateGameModuleFromSsr = (
		list: HomeGameModuleListData,
		provider: HomeGameModuleProviderData
	) => {
		gameModuleRequestSeq++
		gameModuleListSoftId++
		gameModuleProviderSoftId++
		gameModuleInFlight = null
		gameModuleListData.value = list
		gameModuleProviderData.value = provider
		gameModuleLoaded.value = true
	}

	// 左侧 gameTypeAll：与 hgame 相同的 Pinia 会话缓存 + axios 请求
	const gameTypeListData = ref<unknown[]>([])
	const gameTypeLoaded = ref(false)
	let gameTypeInFlight: Promise<void> | null = null
	let gameTypeSoftId = 0

	const syncSideStoreFromGameType = () => {
		const sideStore = useSideStore()
		const list = gameTypeListData.value
		sideStore.sideList = list
		sideStore.firstId = (list[0] as { id?: string } | undefined)?.id ?? null
	}

	const invalidateGameType = () => {
		gameTypeSoftId++
		gameTypeLoaded.value = false
		gameTypeListData.value = []
		gameTypeInFlight = null
	}

	const ensureGameTypeAll = async () => {
		if (gameTypeLoaded.value) return
		if (gameTypeInFlight) return gameTypeInFlight
		const id = gameTypeSoftId
		gameTypeInFlight = (async () => {
			try {
				const raw = await mainContent.gameTypeAll()
				if (id !== gameTypeSoftId) return
				gameTypeListData.value = Array.isArray(raw) ? raw : []
				gameTypeLoaded.value = true
				syncSideStoreFromGameType()
			} finally {
				gameTypeInFlight = null
			}
		})()
		return gameTypeInFlight
	}

	/** 仅重拉 gameTypeAll（与 softRefetchGameModuleListOnly 对称） */
	const softRefetchGameTypeAllOnly = async (): Promise<boolean> => {
		if (!gameTypeLoaded.value) {
			try {
				await ensureGameTypeAll()
				return gameTypeListData.value.length > 0
			} catch {
				return false
			}
		}
		const id = ++gameTypeSoftId
		try {
			const raw = await mainContent.gameTypeAll()
			if (id !== gameTypeSoftId) return true
			gameTypeListData.value = Array.isArray(raw) ? raw : []
			syncSideStoreFromGameType()
			return gameTypeListData.value.length > 0
		} catch {
			return false
		}
	}

	/**
	 * WS 306 game：强制重拉侧栏（不走「已加载则跳过」），并避免被 SSR 水合空 sidebar 覆盖
	 */
	const forceRefetchGameTypeAllAfterWsPush = async (): Promise<boolean> => {
		gameTypeInFlight = null
		const id = ++gameTypeSoftId
		try {
			const raw = await mainContent.gameTypeAll()
			if (id !== gameTypeSoftId) return false
			const list = Array.isArray(raw) ? raw : []
			gameTypeListData.value = list
			gameTypeLoaded.value = true
			syncSideStoreFromGameType()
			return list.length > 0
		} catch {
			return false
		}
	}

	const hydrateGameTypeFromSsr = (list: unknown[]) => {
		gameTypeSoftId++
		gameTypeInFlight = null
		gameTypeListData.value = Array.isArray(list) ? list : []
		gameTypeLoaded.value = true
		syncSideStoreFromGameType()
	}

	/** 后台刷新 Banner：不先清空列表，避免首页长时间黑底骨架 */
	const softRefetchBanner = (): Promise<void> => {
		const id = ++bannerSoftFetchId
		return new Promise<void>((resolve) => {
			mainContent.selectAllActivity({}, (res: ResponseData) => {
				if (id !== bannerSoftFetchId) {
					resolve()
					return
				}
				if (!res || !res.data) {
					resolve()
					return
				}
				bannerList.value = res.data as HomeBannerItem[]
				loaded.value = true
				resolve()
			})
		})
	}

	const invalidateMegaWins = () => {
		megaRequestSeq++
		megaWinsLoaded.value = false
		megaWinsList.value = []
		megaInFlight = null
	}

	const ensureMegaWins = async () => {
		if (megaWinsLoaded.value) return
		if (megaInFlight) return megaInFlight
		const seq = megaRequestSeq
		megaInFlight = (async () => {
			try {
				const res = (await mainContent.getLiveVictory({})) as Record<string, unknown>[]
				if (seq !== megaRequestSeq) return
				megaWinsList.value = normalizeMegaWinsList(res)
				megaWinsLoaded.value = true
			} finally {
				megaInFlight = null
			}
		})()
		return megaInFlight
	}

	// WebSocket 推送单条：与组件内 prepend 规则一致，写入会话缓存
	const prependMegaWinsLive = (newItem: Record<string, unknown>) => {
		const next = [newItem, ...megaWinsList.value] as Record<string, unknown>[]
		if (next.length > MEGA_WINS_MAX_LENGTH) {
			next.pop()
		}
		megaWinsList.value = next
	}

	// 首页 SwiperCollect：游戏模块列表 + 厂商列表，会话内复用
	const gameModuleListData = ref<HomeGameModuleListData | null>(null)
	const gameModuleProviderData = ref<HomeGameModuleProviderData | null>(null)
	const gameModuleLoaded = ref(false)
	let gameModuleInFlight: Promise<void> | null = null
	let gameModuleRequestSeq = 0
	/** 仅 hgame 软刷新与 invalidate 串行，丢弃过期 list 请求 */
	let gameModuleListSoftId = 0
	/** 仅 gameProviderList 软刷新与 invalidate 串行，丢弃过期请求 */
	let gameModuleProviderSoftId = 0

	const invalidateGameModule = () => {
		gameModuleRequestSeq++
		gameModuleListSoftId++
		gameModuleProviderSoftId++
		gameModuleLoaded.value = false
		gameModuleListData.value = null
		gameModuleProviderData.value = null
		gameModuleInFlight = null
	}

	const ensureGameModule = async () => {
		if (gameModuleLoaded.value) return
		if (gameModuleInFlight) return gameModuleInFlight
		const seq = gameModuleRequestSeq
		gameModuleInFlight = (async () => {
			try {
				const [listRes, providerRes] = await Promise.all([
					mainContent.getAllGameListNew({ ...HOME_HGAME_LIST_REQUEST }),
					mainContent.getGameProviderList({
						pageSize: 20,
						pageNum: 1
					})
				])
				if (seq !== gameModuleRequestSeq) return
				gameModuleListData.value = listRes as HomeGameModuleListData
				gameModuleProviderData.value = providerRes as HomeGameModuleProviderData
				gameModuleLoaded.value = true
			} finally {
				gameModuleInFlight = null
			}
		})()
		return gameModuleInFlight
	}

	const refetchGameModule = () => {
		invalidateGameModule()
		return ensureGameModule()
	}

	/**
	 * 仅重拉 `/v1/home/main/hgame`（getAllGameListNew），不碰 gameProviderList
	 * 在已拉过游戏模块时由 WS game 推送调用，避免清屏
	 */
	const softRefetchGameModuleListOnly = async (): Promise<boolean> => {
		if (!gameModuleLoaded.value) return false
		const id = ++gameModuleListSoftId
		try {
			const listRes = (await mainContent.getAllGameListNew({
				...HOME_HGAME_LIST_REQUEST
			})) as HomeGameModuleListData
			if (id !== gameModuleListSoftId) return true
			gameModuleListData.value = listRes
			return true
		} catch {
			return false
		}
	}

	/**
	 * 仅重拉 gameProviderList（与 ensureGameModule 内参数一致），不碰 hgame
	 * 在已拉过游戏模块时由 WS providers 推送调用，避免清屏
	 */
	const softRefetchGameModuleProviderOnly = async (): Promise<boolean> => {
		if (!gameModuleLoaded.value) return false
		const id = ++gameModuleProviderSoftId
		try {
			const providerRes = (await mainContent.getGameProviderList({
				pageSize: 20,
				pageNum: 1
			})) as HomeGameModuleProviderData
			if (id !== gameModuleProviderSoftId) return true
			gameModuleProviderData.value = providerRes
			return true
		} catch {
			return false
		}
	}

	// --- /firmList：按 pageSize + pageNum 分桶缓存；Pinia 重置即清空 ---
	const firmListPageCacheKey = (pageSize: number, pageNum: number) => `${pageSize}:${pageNum}`

	const firmListPagesCacheMap = ref<
		Record<string, { firmList: Record<string, unknown>[]; total: number }>
	>({})
	const firmListPageInflightMap = new Map<
		string,
		Promise<{ firmList: Record<string, unknown>[]; total: number }>
	>()
	let firmListPagesSeq = 0

	const mapFirmProviderRecords = (records: Record<string, unknown>[]) =>
		records.map((item) => ({
			...item,
			channel: "providers",
			count: (item as { gameCount?: number }).gameCount
		}))

	const invalidateFirmListFirstPage = () => {
		firmListPagesSeq++
		firmListPagesCacheMap.value = {}
		firmListPageInflightMap.clear()
	}

	const ensureFirmListPage = async (
		pageSize: number,
		pageNum: number
	): Promise<{ firmList: Record<string, unknown>[]; total: number }> => {
		const key = firmListPageCacheKey(pageSize, pageNum)
		const hit = firmListPagesCacheMap.value[key]
		if (hit) {
			return { firmList: hit.firmList, total: hit.total }
		}
		const existing = firmListPageInflightMap.get(key)
		if (existing) return existing
		const seq = firmListPagesSeq
		const p = (async () => {
			try {
				const res = (await mainContent.getGameProviderList({
					pageSize,
					pageNum
				})) as { records?: Record<string, unknown>[]; total?: number }
				if (seq !== firmListPagesSeq) {
					return ensureFirmListPage(pageSize, pageNum)
				}
				const records = res?.records ?? []
				const total = res?.total ?? 0
				const firmList = mapFirmProviderRecords(records)
				firmListPagesCacheMap.value = {
					...firmListPagesCacheMap.value,
					[key]: { firmList, total }
				}
				return { firmList, total }
			} finally {
				firmListPageInflightMap.delete(key)
			}
		})()
		firmListPageInflightMap.set(key, p)
		return p
	}

	const ensureFirmListFirstPage = (pageSize: number) => ensureFirmListPage(pageSize, 1)

	/** 兼容旧导出：任一首页（pageNum=1）分桶的首条 */
	const firmListFirstPageCache = computed(() => {
		const m = firmListPagesCacheMap.value
		for (const k of Object.keys(m)) {
			const [ps, pn] = k.split(":")
			if (Number(pn) === 1) {
				const pageSize = Number(ps)
				const e = m[k]
				return { pageSize, firmList: e.firmList, total: e.total }
			}
		}
		return null
	})

	const firmListFirstPageLoaded = computed(() => firmListFirstPageCache.value !== null)

	/** 若会话内已有厂商列表分桶缓存，则清空后按原分桶逐一重拉（供 WS providers 推送） */
	const refetchCachedFirmListPagesIfAny = async (): Promise<boolean> => {
		const snap = { ...firmListPagesCacheMap.value }
		const keys = Object.keys(snap)
		if (keys.length === 0) return false
		invalidateFirmListFirstPage()
		await Promise.all(
			keys.map((k) => {
				const [a, b] = k.split(":")
				const pageSize = Number(a)
				const pageNum = Number(b)
				if (!Number.isFinite(pageSize) || !Number.isFinite(pageNum)) return Promise.resolve()
				return ensureFirmListPage(pageSize, pageNum)
			})
		)
		return true
	}

	// --- /searchGame 第一页：按规范化 route.fullPath 分桶 ---
	const searchGameListCacheMap = ref<Record<string, SearchGameListCachedPayload>>({})

	// 列表缓存键 = 规范化后的 route.fullPath，与接口 query 拼装方式解耦
	const searchGameCacheRouteKey = (fullPath: string) => normalizeSearchGameRouteKey(fullPath)

	const invalidateSearchGameListCache = () => {
		searchGameListCacheMap.value = {}
	}

	const CY_SELF_GAME_TYPE_ID = "v3oaNkfnZCmWxQ9j"

	const cySelfGamePlaceholder = (
		name: string,
		imgUrl: string,
		gameCode = ""
	): Record<string, unknown> => ({
		id: "",
		gameCode,
		name,
		gameType: "Cybet 自研游戏",
		gameTypeId: "",
		status: 0,
		maintainState: 0,
		gameDes: null,
		sort: 1000,
		imgUrl,
		gameMerchants: "1",
		gameMerchantsName: "Cybet Game",
		gameUrl: null,
		language: null,
		platform: null,
		currency: "USDT",
		channel: "HS-GAME",
		gameTags: "recommends",
		seo: "test",
		isAvailable: 1,
		rtp: "0",
		collect: false,
		demo: false,
		playerNum: null
	})

	/** 会话内每个 listGame 分桶各打一次接口并重写缓存（与 promotions 分桶刷新一致） */
	const refetchCachedSearchGameListBucketsIfAny = async (): Promise<boolean> => {
		const snap = { ...searchGameListCacheMap.value }
		const routeKeys = Object.keys(snap)
		if (routeKeys.length === 0) return false

		invalidateSearchGameListCache()

		await Promise.all(
			routeKeys.map((routeKey) => {
				const payload = snap[routeKey]
				const req = payload.listGameRequestPage1
				if (!req || typeof req !== "object") return Promise.resolve()

				return new Promise<void>((resolve) => {
					const body = { ...req, pageNum: 1 }
					mainContent.getListGame(body, (res: ResponseData | null) => {
						try {
							if (!res?.data) {
								resolve()
								return
							}
							const d = res.data as {
								current: number
								pages: number
								size: number
								total: number
								records: Record<string, unknown>[]
							}
							const r = req as Record<string, unknown>
							let list = [...(d.records ?? [])]
							let total = d.total
							if (
								r.gameType === CY_SELF_GAME_TYPE_ID &&
								!r.gameProvider &&
								!r.gameProviderText
							) {
								list.push(cySelfGamePlaceholder("hilo", "/img/hilo.png", GAME_CODE.HILO))
								list.push(cySelfGamePlaceholder("tiktok", "/img/tiktok.png"))
								list.push(cySelfGamePlaceholder("tower", "/img/tower.png"))
								total = d.total + 3
							}
							const pageData = {
								total,
								pageNum: d.current,
								pages: d.pages,
								pageSize: d.size
							}
							const progress =
								total > 0 ? ((pageData.pageNum * pageData.pageSize) / total) * 100 : 0
							const nextReq = { ...r, ...pageData }
							setSearchGameListCache(routeKey, {
								pageData,
								list,
								progress,
								listGameRequestPage1: nextReq
							})
						} finally {
							resolve()
						}
					})
				})
			})
		)

		return true
	}

	/** 与 gameItem 内收藏回写一致的首页请求体（供 WS game 重拉收藏列表缓存） */
	const favoritesGameListPage1Request = () => ({
		gameName: "",
		pageNum: 1,
		pageSize: 14,
		total: 0,
		pages: 1,
		key: "/gameList/favorites"
	})

	/** 若会话内已有 /gameList/favorites 缓存，则重拉 getFavoriteGame 首页并写回 */
	const refetchCachedFavoritesGameListRouteIfAny = async (): Promise<boolean> => {
		if (gameListRouteCache.value.favorites == null) return false

		await new Promise<void>((resolve) => {
			const req = favoritesGameListPage1Request()
			mainContent.getFavoriteGame(req, (listRes: ResponseData | null) => {
				try {
					if (!listRes?.data) {
						return
					}
					const d = listRes.data as {
						records?: Record<string, unknown>[]
						total?: number
						current?: number
						pages?: number
						size?: number
					}
					const pageData = {
						total: d.total ?? 0,
						pageNum: d.current ?? 1,
						pages: d.pages ?? 1,
						pageSize: d.size ?? req.pageSize
					}
					const list = [...(d.records ?? [])]
					setGameListRouteCache("favorites", {
						searchResultList: list,
						pageData,
						progress: 100
					})
				} finally {
					resolve()
				}
			})
		})
		return true
	}

	/**
	 * WS `type: game`：更新 hgame 与 listGame 在 homeData 中的会话缓存
	 * - hgame：已加载过游戏模块时只重拉 hgame
	 * - listGame：已缓存的每个 route 分桶各重拉一次 getListGame 写回
	 * - /gameList/favorites：会话内已有收藏列表缓存时重拉首页写回
	 */
	const refreshGameDataCachesAfterWsPush = async (): Promise<{ didAnything: boolean }> => {
		let didAnything = false

		if (gameModuleLoaded.value) {
			if (await softRefetchGameModuleListOnly()) {
				didAnything = true
			}
		} else {
			try {
				await ensureGameModule()
				didAnything = true
			} catch {
				/* 首页游戏区未挂载时忽略 */
			}
		}

		if (await refetchCachedSearchGameListBucketsIfAny()) {
			didAnything = true
		}

		if (await refetchCachedFavoritesGameListRouteIfAny()) {
			didAnything = true
		}

		return { didAnything }
	}

	/**
	 * WS `type: providers`：更新首页厂商条与 firmList 分页在 homeData 中的会话缓存
	 * - gameProviderList：已加载过游戏模块时只重拉厂商接口
	 * - firmList：已有分桶缓存时清空后按原 pageSize/pageNum 重拉
	 */
	const refreshProviderDataCachesAfterWsPush = async (): Promise<{ didAnything: boolean }> => {
		let didAnything = false

		if (await softRefetchGameModuleProviderOnly()) {
			didAnything = true
		}

		if (await refetchCachedFirmListPagesIfAny()) {
			didAnything = true
		}

		return { didAnything }
	}

	const getSearchGameListCacheIfHit = (routeKey: string): SearchGameListCachedPayload | null => {
		return searchGameListCacheMap.value[routeKey] ?? null
	}

	const setSearchGameListCache = (routeKey: string, payload: SearchGameListCachedPayload) => {
		searchGameListCacheMap.value = {
			...searchGameListCacheMap.value,
			[routeKey]: payload
		}
	}

	// --- /promotions：selectPromotion，按筛选 + 分页分桶；先命中会话缓存再请求 ---
	const promotionsListCacheMap = ref<Record<string, PromotionsListCachedPayload>>({})
	const promotionsListInflightMap = new Map<string, Promise<PromotionsListCachedPayload>>()

	const invalidatePromotionsListCache = () => {
		promotionsListCacheMap.value = {}
		promotionsListInflightMap.clear()
	}

	const getPromotionsListCacheIfHit = (key: string): PromotionsListCachedPayload | null => {
		return promotionsListCacheMap.value[key] ?? null
	}

	const setPromotionsListCache = (key: string, payload: PromotionsListCachedPayload) => {
		promotionsListCacheMap.value = {
			...promotionsListCacheMap.value,
			[key]: payload
		}
	}

	const payloadFromPromotionResponse = (
		req: PromotionsListRequest,
		res: ResponseData
	): PromotionsListCachedPayload => {
		const data = res.data as { records?: Record<string, unknown>[]; current?: number; total?: number }
		return {
			records: (data.records ?? []) as Record<string, unknown>[],
			current: data.current ?? req.pageNum,
			total: data.total ?? 0
		}
	}

	// 客户端：未命中缓存时走 mainContent；成功写入缓存，失败不写缓存便于重试
	const ensurePromotionsList = (
		req: PromotionsListRequest,
		options?: { signal?: AbortSignal }
	): Promise<PromotionsListCachedPayload> => {
		const key = promotionsListCacheKey(req)
		const hit = promotionsListCacheMap.value[key]
		if (hit) return Promise.resolve(hit)

		const existing = promotionsListInflightMap.get(key)
		if (existing) return existing

		const p = new Promise<PromotionsListCachedPayload>((resolve) => {
			mainContent.selectAllPromotions({ ...req, signal: options?.signal }, (res: ResponseData) => {
				promotionsListInflightMap.delete(key)
				if (!res?.data) {
					resolve({ records: [], current: req.pageNum, total: 0 })
					return
				}
				const payload = payloadFromPromotionResponse(req, res)
				setPromotionsListCache(key, payload)
				resolve(payload)
			})
		})
		promotionsListInflightMap.set(key, p)
		return p
	}

	/** 若会话内已有 /promotions 分桶缓存，则清空后按原分桶重新请求并写回（供 WS 活动变更推送） */
	const refetchCachedPromotionsListsIfAny = async (): Promise<boolean> => {
		const keys = Object.keys(promotionsListCacheMap.value)
		if (keys.length === 0) return false

		const reqs = keys
			.map((key) => promotionsRequestFromCacheKey(key))
			.filter((req): req is PromotionsListRequest => req !== null)

		invalidatePromotionsListCache()

		if (reqs.length === 0) return false

		await Promise.all(reqs.map((req) => ensurePromotionsList(req)))
		return true
	}

	// --- /blog/blogList：按 blogTypeId + 分页分桶；先命中会话缓存再请求 ---
	const blogListCacheMap = ref<Record<string, BlogListCachedPayload>>({})
	const blogListInflightMap = new Map<string, Promise<BlogListCachedPayload>>()

	const invalidateBlogListCache = () => {
		blogListCacheMap.value = {}
		blogListInflightMap.clear()
	}

	const getBlogListCacheIfHit = (key: string): BlogListCachedPayload | null => {
		return blogListCacheMap.value[key] ?? null
	}

	const setBlogListCache = (key: string, payload: BlogListCachedPayload) => {
		blogListCacheMap.value = {
			...blogListCacheMap.value,
			[key]: payload
		}
	}

	const payloadFromBlogListResponse = (req: BlogListRequest, res: ResponseData | null): BlogListCachedPayload => {
		const data = res?.data as { records?: Record<string, unknown>[]; current?: number; total?: number } | undefined
		return {
			records: (data?.records ?? []) as Record<string, unknown>[],
			current: data?.current ?? req.pageNum,
			total: data?.total ?? 0
		}
	}

	const ensureBlogList = (req: BlogListRequest): Promise<BlogListCachedPayload> => {
		const key = blogListCacheKey(req)
		const hit = blogListCacheMap.value[key]
		if (hit) return Promise.resolve(hit)

		const existing = blogListInflightMap.get(key)
		if (existing) return existing

		const p = (async () => {
			try {
				const res = (await ssrBlogApi.blogList(req)) as ResponseData | null
				blogListInflightMap.delete(key)
				if (!res?.data) {
					return {
						records: [],
						current: req.pageNum,
						total: 0
					}
				}
				const payload = payloadFromBlogListResponse(req, res)
				setBlogListCache(key, payload)
				return payload
			} catch {
				blogListInflightMap.delete(key)
				return {
					records: [],
					current: req.pageNum,
					total: 0
				}
			}
		})()
		blogListInflightMap.set(key, p)
		return p
	}

	/** 若会话内已有 blog 列表分桶缓存，则清空后按原分桶重新请求并写回（供 WS blog 推送） */
	const refetchCachedBlogListsIfAny = async (): Promise<boolean> => {
		const keys = Object.keys(blogListCacheMap.value)
		if (keys.length === 0) return false

		const reqs = keys
			.map((key) => blogRequestFromCacheKey(key))
			.filter((req): req is BlogListRequest => req !== null)

		invalidateBlogListCache()

		if (reqs.length === 0) return false

		await Promise.all(reqs.map((req) => ensureBlogList(req)))
		return true
	}

	// --- /blog/blogTypes：无参，会话内 ensure 一次直至 invalidate ---
	const blogTypesSeq = ref(0)
	let blogTypesInFlight: Promise<Record<string, unknown>[]> | null = null
	const blogTypesRows = ref<Record<string, unknown>[] | null>(null)
	const blogTypesLoaded = ref(false)

	const invalidateBlogTypesCache = () => {
		blogTypesSeq.value++
		blogTypesLoaded.value = false
		blogTypesRows.value = null
		blogTypesInFlight = null
	}

	const ensureBlogTypes = async (): Promise<Record<string, unknown>[]> => {
		const cached = blogTypesRows.value
		if (blogTypesLoaded.value && cached !== null) return cached
		if (blogTypesInFlight) return blogTypesInFlight
		const seq = blogTypesSeq.value
		blogTypesInFlight = (async () => {
			try {
				const res = (await ssrBlogApi.getMenuList()) as ResponseData | null
				blogTypesInFlight = null
				if (seq !== blogTypesSeq.value) return ensureBlogTypes()
				if (!res) {
					return []
				}
				if (res.data == null) {
					blogTypesRows.value = []
					blogTypesLoaded.value = true
					return []
				}
				const rows = Array.isArray(res.data) ? (res.data as Record<string, unknown>[]) : []
				blogTypesRows.value = rows
				blogTypesLoaded.value = true
				return rows
			} catch {
				blogTypesInFlight = null
				return []
			}
		})()
		return blogTypesInFlight
	}

	// --- /blog/recommendBlog：无参，会话内 ensure 一次直至 invalidate ---
	const blogRecommendSeq = ref(0)
	let blogRecommendInFlight: Promise<Record<string, unknown> | null> | null = null
	const blogRecommendItem = ref<Record<string, unknown> | null>(null)
	const blogRecommendLoaded = ref(false)

	const invalidateBlogRecommendCache = () => {
		blogRecommendSeq.value++
		blogRecommendLoaded.value = false
		blogRecommendItem.value = null
		blogRecommendInFlight = null
	}

	const ensureBlogRecommend = async (): Promise<Record<string, unknown> | null> => {
		if (blogRecommendLoaded.value) return blogRecommendItem.value
		if (blogRecommendInFlight) return blogRecommendInFlight
		const seq = blogRecommendSeq.value
		blogRecommendInFlight = (async () => {
			try {
				const res = (await ssrBlogApi.getRecommend()) as ResponseData | null
				blogRecommendInFlight = null
				if (seq !== blogRecommendSeq.value) return ensureBlogRecommend()
				if (!res) {
					return null
				}
				const raw = res.data
				const item =
					raw != null && typeof raw === "object"
						? (raw as Record<string, unknown>)
						: null
				blogRecommendItem.value = item
				blogRecommendLoaded.value = true
				return item
			} catch {
				blogRecommendInFlight = null
				return null
			}
		})()
		return blogRecommendInFlight
	}

	/** WS blog 推送：会话内已有博客相关缓存则重新拉接口写回（列表分桶 / 菜单 / 推荐） */
	const refreshBlogCachesAfterWsPush = async (): Promise<{ didAnything: boolean }> => {
		let didAnything = false

		const listRefetched = await refetchCachedBlogListsIfAny()
		if (listRefetched) didAnything = true

		if (blogTypesLoaded.value) {
			invalidateBlogTypesCache()
			await ensureBlogTypes()
			didAnything = true
		}

		if (blogRecommendLoaded.value) {
			invalidateBlogRecommendCache()
			await ensureBlogRecommend()
			didAnything = true
		}

		return { didAnything }
	}

	// --- /gameList/recent | /gameList/favorites ---
	const gameListRouteCache = ref<Partial<Record<GameListRouteTab, GameListRouteCachedPayload>>>({})

	const invalidateGameListRouteCache = (tab?: GameListRouteTab) => {
		if (tab) {
			const next = { ...gameListRouteCache.value }
			delete next[tab]
			gameListRouteCache.value = next
		} else {
			gameListRouteCache.value = {}
		}
	}

	// --- 首页 WinTable：三 tab 会话缓存；已成功拉取 API 的 key 记入集合，切换 tab 命中即不重复请求 ---
	const winTableCacheMap = ref<Record<string, Record<string, unknown>[]>>({})
	const winTableApiLoadedKeys = ref<Set<string>>(new Set())

	const invalidateWinTableCache = () => {
		winTableCacheMap.value = {}
		winTableApiLoadedKeys.value = new Set()
	}

	const getWinTableCacheIfHit = (key: string): Record<string, unknown>[] | null => {
		const rows = winTableCacheMap.value[key]
		return rows !== undefined ? rows : null
	}

	const setWinTableCache = (key: string, rows: Record<string, unknown>[]) => {
		winTableCacheMap.value = {
			...winTableCacheMap.value,
			[key]: rows
		}
	}

	const markWinTableApiLoaded = (key: string) => {
		winTableApiLoadedKeys.value = new Set(winTableApiLoadedKeys.value).add(key)
	}

	const hasWinTableApiLoaded = (key: string) => winTableApiLoadedKeys.value.has(key)

	/** 与 WinTable addNewRow 一致：新行插前、超长截断；供 WS 后台更新缓存 */
	const prependWinTableLiveRow = (row: Record<string, unknown>, pageSize: number, balanceType: string) => {
		const key = winTableCacheKey("live", pageSize, balanceType)
		const prev = winTableCacheMap.value[key] ?? []
		const next = [row, ...prev]
		if (next.length > pageSize) next.splice(pageSize)
		winTableCacheMap.value = { ...winTableCacheMap.value, [key]: next }
	}

	const prependWinTableHighRow = (row: Record<string, unknown>, pageSize: number, balanceType: string) => {
		const key = winTableCacheKey("high", pageSize, balanceType)
		const prev = winTableCacheMap.value[key] ?? []
		const next = [row, ...prev]
		if (next.length > pageSize) next.splice(pageSize)
		winTableCacheMap.value = { ...winTableCacheMap.value, [key]: next }
	}

	const getGameListRouteCache = (tab: GameListRouteTab): GameListRouteCachedPayload | null => {
		return gameListRouteCache.value[tab] ?? null
	}

	const setGameListRouteCache = (tab: GameListRouteTab, payload: GameListRouteCachedPayload) => {
		gameListRouteCache.value = {
			...gameListRouteCache.value,
			[tab]: payload
		}
	}

	// 语言切换等与首页一并清空：路由页会话缓存（刷新整页会重建 store，一般不必手动调）
	const invalidateRoutePageCaches = () => {
		invalidateFirmListFirstPage()
		invalidateSearchGameListCache()
		invalidateGameListRouteCache()
		invalidatePromotionsListCache()
		invalidateBlogListCache()
		invalidateBlogTypesCache()
		invalidateBlogRecommendCache()
		invalidateWinTableCache()
	}

	return {
		bannerList,
		loaded,
		ensureBanner,
		invalidateBanner,
		refetchBanner,
		softRefetchBanner,
		hydrateBannerFromSsr,
		hydrateMegaWinsFromSsr,
		hydrateGameModuleFromSsr,
		gameTypeListData,
		gameTypeLoaded,
		ensureGameTypeAll,
		invalidateGameType,
		softRefetchGameTypeAllOnly,
		forceRefetchGameTypeAllAfterWsPush,
		hydrateGameTypeFromSsr,
		megaWinsList,
		megaWinsLoaded,
		ensureMegaWins,
		invalidateMegaWins,
		prependMegaWinsLive,
		gameModuleListData,
		gameModuleProviderData,
		gameModuleLoaded,
		ensureGameModule,
		invalidateGameModule,
		refetchGameModule,
		softRefetchGameModuleListOnly,
		refreshGameDataCachesAfterWsPush,
		refreshProviderDataCachesAfterWsPush,
		firmListFirstPageCache,
		firmListFirstPageLoaded,
		ensureFirmListPage,
		ensureFirmListFirstPage,
		invalidateFirmListFirstPage,
		searchGameCacheRouteKey,
		getSearchGameListCacheIfHit,
		setSearchGameListCache,
		invalidateSearchGameListCache,
		gameListRouteCache,
		getGameListRouteCache,
		setGameListRouteCache,
		invalidateGameListRouteCache,
		getPromotionsListCacheIfHit,
		setPromotionsListCache,
		invalidatePromotionsListCache,
		refetchCachedPromotionsListsIfAny,
		ensurePromotionsList,
		getBlogListCacheIfHit,
		setBlogListCache,
		invalidateBlogListCache,
		refetchCachedBlogListsIfAny,
		ensureBlogList,
		refreshBlogCachesAfterWsPush,
		invalidateBlogTypesCache,
		ensureBlogTypes,
		invalidateBlogRecommendCache,
		ensureBlogRecommend,
		invalidateRoutePageCaches,
		invalidateWinTableCache,
		getWinTableCacheIfHit,
		setWinTableCache,
		markWinTableApiLoaded,
		hasWinTableApiLoaded,
		prependWinTableLiveRow,
		prependWinTableHighRow
	}
})
