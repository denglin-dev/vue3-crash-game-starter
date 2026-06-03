/**
 * Crash 火箭头像「同源代理」的默认配置（仅域名/路径，与单张图片 URL 无关）。
 *
 * 原理简述：
 * - 业务里拿到的永远是「完整图片地址」字符串（如 WS 里的 Headimg），不需要你事先枚举每张图。
 * - 若图片在别的域名（如 S3）且未配 CORS，浏览器不让 WebGL/Pixi 用这张图；同源代理让浏览器只请求「你自己网站」上的路径，由服务端再去拉原图并原样返回。
 * - `CRASH_AVATAR_PROXY_ROUTE_PATH`：是你们 Nuxt 站点上的**接口路径**（不是 CDN）。例如 `https://a.com/crash/avatar-proxy?u=编码后的原图URL`。
 * - 故意不用 `.jpg` 文件名路由，减少与静态资源、中间件「按扩展名跳过」逻辑冲突。
 */
export const CRASH_AVATAR_PROXY_ROUTE_PATH = "/crash/avatar-proxy"

/**
 * 无 CORS 的图床：客户端与服务端代理均**始终**放行（除非显式关闭整个代理）。
 * 含 CloudFront：扩展名常为 `.jpeg` 实际体为 WebP，需经代理 + 客户端 WebP 解码。
 */
export const BUILTIN_AVATAR_PROXY_HOSTNAMES = [
	"cybetimg.s3.ap-east-1.amazonaws.com",
	"d2ssgncogl8du4.cloudfront.net",
] as const

/** 逗号分隔的 hostname 默认值（与内置表一致，可被 env 覆盖追加） */
export const DEFAULT_CRASH_AVATAR_PROXY_HOSTS_CSV = BUILTIN_AVATAR_PROXY_HOSTNAMES.join(",")

/**
 * 业务桶在 S3 上可能出现的 hostname 变体（region / dualstack / 旧 global endpoint），
 * 与「枚举在 BUILTIN 里的一条」等价放行，避免漏配导致仍直连 → WebGL fetch CORS。
 */
export function isBuiltinCrashAvatarUpstreamHost(hostname: string): boolean {
	const h = hostname.trim().toLowerCase()
	if (!h) return false
	for (const x of BUILTIN_AVATAR_PROXY_HOSTNAMES) {
		if (x.toLowerCase() === h) return true
	}
	if (/^cybetimg\.s3(\.[a-z0-9-]+)*\.amazonaws\.com$/.test(h)) return true
	// 换 CloudFront 分发 id 时仍为 `*.cloudfront.net`，与内置 d2… 条目共用同一放行规则
	if (/^[a-z0-9]+\.cloudfront\.net$/i.test(h)) return true
	return false
}
