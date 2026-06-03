import { Container, Graphics, Sprite, Texture } from "pixi.js"
import { toPixiCrossOriginSafeImageUrl } from "~/utils/pixiAvatarUrl"
import { CRASH_AVATAR_PROXY_ROUTE_PATH, isBuiltinCrashAvatarUpstreamHost } from "~/utils/crashAvatarProxyDefaults"

/**
 * 经 `Image` 解码再 `Texture.from`：同源 fetch 字节 → Blob URL，避免外域直连 CORS / WebP 扩展名误导。
 */
async function decodeBytesToTexture(ab: ArrayBuffer, mime: string): Promise<Texture> {
	const blob = new Blob([ab], { type: mime })
	const objectUrl = URL.createObjectURL(blob)
	try {
		const img = await new Promise<HTMLImageElement>((resolve, reject) => {
			const el = new Image()
			el.crossOrigin = "anonymous"
			el.onload = () => resolve(el)
			el.onerror = () => reject(new Error("avatar image decode failed (object URL)"))
			el.src = objectUrl
		})
		return Texture.from(img, true)
	} finally {
		URL.revokeObjectURL(objectUrl)
	}
}

/**
 * Crash `GameCanvas` 的火箭标记控制器。
 *
 * 头像加载：对命中白名单的外域图走本站 `/crash/avatar-proxy`（见 `toPixiCrossOriginSafeImageUrl`），
 * 浏览器 `fetch` 同源 URL + 魔数识别 JPEG/PNG/WebP 后解码为纹理；**不用** `Assets.load` 直连外域，否则会触发 S3 CORS。
 */

export type RocketPose = { x: number; y: number; angle: number }

export type RocketMarkerOptions = {
	/** 爆炸/结算后矢量火箭本体 tint；头像 tint 也会用同色保证一致。 */
	crashBodyColor: number
	/** 头像标记固定朝向（通常为 0，不随曲线切线旋转）。 */
	avatarFixedRotationRad: number
	/** 头像描边线宽（屏幕像素）。 */
	avatarBorderPx: number

	/** 当前阶段是否应使用“已爆炸/结算”配色。 */
	isCrashTintPhase: () => boolean
	/** 本帧是否允许显示光晕（例如仅 flying，betting/countdown/crashed 不显示）。 */
	shouldDrawRipples: () => boolean

	/** 圆形头像标记半径（屏幕像素）。 */
	getAvatarRadiusPx: () => number
	/** 矢量火箭绘制半径（屏幕像素）。 */
	getVectorRadiusPx: () => number

	/**
	 * 水波纹环形光晕绘制函数。
	 * 传入的 `Graphics` 本地原点应位于 marker 圆心。
	 */
	paintRippleGlowRing: (g: Graphics, contentRadiusR: number) => void
}

export type RocketMarkerNodes = {
	/** 矢量火箭 marker（本地原点为圆心）。 */
	rocketGfx: Graphics
	/** 矢量火箭光晕（与 rocketGfx 同层级，通常放在 rocketGfx 下方）。 */
	rocketVectorGlowGfx: Graphics

	/** 头像容器（其坐标系原点位于 marker 圆心）。 */
	rocketAvatarRoot: Container
	/** 头像光晕（挂在 root 下，本地原点为 marker 圆心）。 */
	rocketAvatarGlowGfx: Graphics
	/** 头像 sprite（会被 mask 裁切成圆形）。 */
	rocketAvatarSprite: Sprite
	/** sprite 的圆形 mask（本地原点为 root 圆心）。 */
	rocketAvatarMaskGfx: Graphics
	/** 头像圆形描边（本地原点为 root 圆心）。 */
	rocketAvatarBorderGfx: Graphics
}

export type RocketMarkerController = {
	/** 根据 pose 与可选头像 url 绘制 marker（会自动选择矢量/头像模式）。 */
	draw: (pose: RocketPose, avatarUrl: string | null) => void
	/** 对 marker 应用一个很小的拍动偏移（调用方决定何时启用）。 */
	applyPatOffset: (pose: RocketPose, ox: number, oy: number) => void
	/** 每帧更新光晕的 transform；光晕几何可在内部做降频重绘。 */
	tickGlows: () => void
	/** 立刻隐藏并清空光晕图形。 */
	hideGlows: () => void
	/** 释放已解析的头像纹理（销毁 GPU 纹理）。 */
	releaseAvatarIfAny: () => void
	/** 清空显示节点并失效几何/早退缓存；用于新回合 reset，避免 Graphics.clear() 后缓存仍认为已绘制。 */
	reset: () => void
}

export function createRocketMarkerController(nodes: RocketMarkerNodes, opts: RocketMarkerOptions): RocketMarkerController {
	let rocketAvatarInflightUrl: string | null = null
	let rocketAvatarResolvedUrl = ""
	/** 递增以作废过期的异步加载 */
	let avatarLoadGen = 0

	let lastX = -1
	let lastY = -1
	let lastRenderSig = ""
	let lastCrashTint = false

	let avatarGeomKey = ""
	let vectorGeomKey = ""

	let glowFrameCounter = 0

	const destroySpriteTextureIfNeeded = (tex: Texture | null | undefined) => {
		if (tex && tex !== Texture.EMPTY && !tex.destroyed) tex.destroy(true)
	}

	const resolveAvatarLoadUrl = (raw: string) => {
		const rawTrim = String(raw ?? "").trim()
		let out = toPixiCrossOriginSafeImageUrl(rawTrim)
		if (import.meta.env.NUXT_PUBLIC_CRASH_AVATAR_PROXY_ENABLED !== "false") {
			try {
				const abs = /^https?:\/\//i.test(out)
					? out
					: typeof window !== "undefined"
						? new URL(out, window.location.origin).href
						: out
				const hn = new URL(abs).hostname.toLowerCase()
				const sameOrigin =
					typeof window !== "undefined" && hn === window.location.hostname.toLowerCase()
				if (!sameOrigin && isBuiltinCrashAvatarUpstreamHost(hn)) {
					out = `${CRASH_AVATAR_PROXY_ROUTE_PATH}?u=${encodeURIComponent(rawTrim)}`
				}
			} catch {
				/**/
			}
		}
		if (typeof window !== "undefined" && out.startsWith("/")) {
			return new URL(out, window.location.origin).href
		}
		return out
	}

	const ensureAvatarMaskGeometry = () => {
		const r = opts.getAvatarRadiusPx()
		const key = `r:${r.toFixed(3)}|b:${opts.avatarBorderPx.toFixed(3)}`
		if (avatarGeomKey === key) return
		avatarGeomKey = key
		nodes.rocketAvatarMaskGfx.clear()
		nodes.rocketAvatarMaskGfx.circle(0, 0, r)
		nodes.rocketAvatarMaskGfx.fill({ color: 0xffffff })
		nodes.rocketAvatarBorderGfx.clear()
		nodes.rocketAvatarBorderGfx.circle(0, 0, r)
		nodes.rocketAvatarBorderGfx.stroke({
			width: opts.avatarBorderPx,
			color: 0xffffff,
			alpha: 0.95,
			cap: "round",
			join: "round",
		})
	}

	const ensureVectorGeometry = () => {
		const r = opts.getVectorRadiusPx()
		const crashed = opts.isCrashTintPhase()
		const key = `r:${r.toFixed(3)}|c:${crashed ? 1 : 0}`
		if (vectorGeomKey === key) return
		vectorGeomKey = key
		const g = nodes.rocketGfx
		g.clear()
		g.circle(0, 0, r)
		if (crashed) {
			g.fill({ color: opts.crashBodyColor, alpha: 0.98 })
			const hx = -r * 0.25
			const hy = -r * 0.2
			g.circle(hx, hy, r * 0.38)
		} else {
			g.fill({ color: 0xf0fdfa, alpha: 0.98 })
			const hx = -r * 0.25
			const hy = -r * 0.2
			g.circle(hx, hy, r * 0.38)
			g.fill({ color: 0xe0fffc, alpha: 0.62 })
			g.circle(hx - r * 0.04, hy - r * 0.06, r * 0.2)
			g.fill({ color: 0xffffff, alpha: 0.82 })
		}
	}

	const queueAvatarTexture = (url: string) => {
		if (rocketAvatarResolvedUrl === url) return
		if (rocketAvatarInflightUrl === url) return
		rocketAvatarInflightUrl = url
		const loadUrl = resolveAvatarLoadUrl(url)
		const gen = ++avatarLoadGen
		;(async () => {
			try {
				const res = await fetch(loadUrl, { credentials: "same-origin" })
				if (!res.ok) throw new Error(`HTTP ${res.status}`)
				const ab = await res.arrayBuffer()
				const u8 = new Uint8Array(ab)
				const isJpeg = u8.byteLength >= 3 && u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff
				const isPng = u8.byteLength >= 8 && u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47
				const isWebp =
					u8.byteLength >= 12 &&
					u8[0] === 0x52 &&
					u8[1] === 0x49 &&
					u8[2] === 0x46 &&
					u8[3] === 0x46 &&
					u8[8] === 0x57 &&
					u8[9] === 0x45 &&
					u8[10] === 0x42 &&
					u8[11] === 0x50
				if (!isJpeg && !isPng && !isWebp) {
					const snippet = new TextDecoder("utf-8", { fatal: false }).decode(
						u8.slice(0, Math.min(256, u8.byteLength)),
					)
					throw new Error(
						`avatar response is not JPEG/PNG/WebP: ${snippet.replace(/\s+/g, " ").slice(0, 120)}`,
					)
				}
				const mime = isJpeg ? "image/jpeg" : isPng ? "image/png" : "image/webp"
				const tex = await decodeBytesToTexture(ab, mime)
				if (gen !== avatarLoadGen) {
					tex.destroy(true)
					return
				}
				rocketAvatarInflightUrl = null
				const prevTex = nodes.rocketAvatarSprite.texture
				nodes.rocketAvatarSprite.texture = tex
				rocketAvatarResolvedUrl = url
				if (prevTex && prevTex !== Texture.EMPTY && prevTex !== tex) prevTex.destroy(true)
				lastX = -1
				lastY = -1
			} catch (e) {
				rocketAvatarInflightUrl = null
				if (import.meta.dev) console.warn("[rocketMarker] avatar texture load failed", loadUrl, e)
			}
		})()
	}

	const releaseAvatarIfAny = () => {
		avatarLoadGen++
		if (!rocketAvatarResolvedUrl) {
			rocketAvatarInflightUrl = null
			return
		}
		destroySpriteTextureIfNeeded(nodes.rocketAvatarSprite.texture)
		nodes.rocketAvatarSprite.texture = Texture.EMPTY
		rocketAvatarResolvedUrl = ""
		rocketAvatarInflightUrl = null
	}

	const reset = () => {
		avatarLoadGen++
		lastX = -1
		lastY = -1
		lastRenderSig = ""
		lastCrashTint = false
		avatarGeomKey = ""
		vectorGeomKey = ""
		glowFrameCounter = 0
		destroySpriteTextureIfNeeded(nodes.rocketAvatarSprite.texture)
		nodes.rocketAvatarSprite.texture = Texture.EMPTY
		rocketAvatarResolvedUrl = ""
		rocketAvatarInflightUrl = null
		nodes.rocketGfx.clear()
		nodes.rocketGfx.visible = false
		nodes.rocketVectorGlowGfx.clear()
		nodes.rocketVectorGlowGfx.visible = false
		nodes.rocketAvatarRoot.visible = false
		nodes.rocketAvatarGlowGfx.clear()
		nodes.rocketAvatarGlowGfx.visible = false
		nodes.rocketAvatarMaskGfx.clear()
		nodes.rocketAvatarBorderGfx.clear()
		nodes.rocketAvatarSprite.tint = 0xffffff
	}

	const hideGlows = () => {
		nodes.rocketVectorGlowGfx.clear()
		nodes.rocketVectorGlowGfx.visible = false
		nodes.rocketAvatarGlowGfx.clear()
		nodes.rocketAvatarGlowGfx.visible = false
	}

	const tickGlows = () => {
		if (!opts.shouldDrawRipples()) {
			hideGlows()
			return
		}

		const rFull = opts.getAvatarRadiusPx()
		const rVec = opts.getVectorRadiusPx()

		if (nodes.rocketGfx.visible) {
			nodes.rocketVectorGlowGfx.visible = true
			nodes.rocketVectorGlowGfx.x = nodes.rocketGfx.x
			nodes.rocketVectorGlowGfx.y = nodes.rocketGfx.y
			nodes.rocketVectorGlowGfx.rotation = nodes.rocketGfx.rotation
		} else {
			nodes.rocketVectorGlowGfx.visible = false
			nodes.rocketVectorGlowGfx.clear()
		}

		if (nodes.rocketAvatarRoot.visible) {
			nodes.rocketAvatarGlowGfx.visible = true
			nodes.rocketAvatarGlowGfx.x = 0
			nodes.rocketAvatarGlowGfx.y = 0
			nodes.rocketAvatarGlowGfx.rotation = 0
		} else {
			nodes.rocketAvatarGlowGfx.visible = false
			nodes.rocketAvatarGlowGfx.clear()
		}

		glowFrameCounter++
		const glowFrameModulo = Math.max(1, Math.floor(opts.getGlowFrameModulo?.() ?? 2))
		if (glowFrameModulo > 1 && glowFrameCounter % glowFrameModulo !== 0) return
		if (nodes.rocketVectorGlowGfx.visible) opts.paintRippleGlowRing(nodes.rocketVectorGlowGfx, rVec)
		if (nodes.rocketAvatarGlowGfx.visible) opts.paintRippleGlowRing(nodes.rocketAvatarGlowGfx, rFull)
	}

	const applyPatOffset = (pose: RocketPose, ox: number, oy: number) => {
		if (nodes.rocketGfx.visible) {
			nodes.rocketGfx.x = pose.x + ox
			nodes.rocketGfx.y = pose.y + oy
			nodes.rocketGfx.rotation = pose.angle
		}
		if (nodes.rocketAvatarRoot.visible) {
			nodes.rocketAvatarRoot.x = pose.x + ox
			nodes.rocketAvatarRoot.y = pose.y + oy
			nodes.rocketAvatarRoot.rotation = opts.avatarFixedRotationRad
		}
	}

	const draw = (pose: RocketPose, avatarUrl: string | null) => {
		const crashTint = opts.isCrashTintPhase()
		if (crashTint !== lastCrashTint) {
			lastCrashTint = crashTint
			lastX = -1
			vectorGeomKey = ""
		}

		const wantAvatar = !!avatarUrl
		const texReady = !!avatarUrl && rocketAvatarResolvedUrl === avatarUrl && !!nodes.rocketAvatarSprite.texture?.width
		const sig = `${avatarUrl ?? ""}|${wantAvatar ? 1 : 0}|${texReady ? 1 : 0}|${crashTint ? 1 : 0}`

		const dx = pose.x - lastX
		const dy = pose.y - lastY
		if (dx * dx + dy * dy < 0.25 && lastX >= 0 && sig === lastRenderSig) return
		lastX = pose.x
		lastY = pose.y
		lastRenderSig = sig

		if (wantAvatar && avatarUrl) {
			queueAvatarTexture(avatarUrl)
			if (texReady) {
				nodes.rocketGfx.visible = false
				const r = opts.getAvatarRadiusPx()
				nodes.rocketAvatarRoot.visible = true
				nodes.rocketAvatarRoot.x = pose.x
				nodes.rocketAvatarRoot.y = pose.y
				nodes.rocketAvatarRoot.rotation = opts.avatarFixedRotationRad
				ensureAvatarMaskGeometry()
				nodes.rocketAvatarSprite.width = 2 * r
				nodes.rocketAvatarSprite.height = 2 * r
				nodes.rocketAvatarSprite.tint = crashTint ? opts.crashBodyColor : 0xffffff
				nodes.rocketAvatarGlowGfx.visible = true
				return
			}
		}

		nodes.rocketAvatarGlowGfx.visible = false
		nodes.rocketAvatarRoot.visible = false
		nodes.rocketAvatarSprite.tint = 0xffffff

		if (!avatarUrl) {
			avatarLoadGen++
			const prev = rocketAvatarResolvedUrl
			rocketAvatarResolvedUrl = ""
			rocketAvatarInflightUrl = null
			if (prev) {
				destroySpriteTextureIfNeeded(nodes.rocketAvatarSprite.texture)
				nodes.rocketAvatarSprite.texture = Texture.EMPTY
			}
		}

		nodes.rocketGfx.visible = true
		ensureVectorGeometry()
		nodes.rocketGfx.x = pose.x
		nodes.rocketGfx.y = pose.y
		nodes.rocketGfx.rotation = pose.angle
	}

	return { draw, applyPatOffset, tickGlows, hideGlows, releaseAvatarIfAny, reset }
}
