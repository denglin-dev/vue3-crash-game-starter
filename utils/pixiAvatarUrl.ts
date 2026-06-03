/**
 * 把「外域头像 URL」改成走本站同源代理（或保持原样）。
 *
 * 线上曾出现：依赖 `useRuntimeConfig()` 时未正确读到配置，导致仍直连 S3 → CORS 报错。
 * 此处改为：**默认永远把业务桶域名走代理**（见 `BUILTIN_PROXY_HOSTNAMES`），仅用 `import.meta.env` 关代理。
 *
 * 关闭代理（例如已在 S3 配好 CORS）：构建环境变量 `NUXT_PUBLIC_CRASH_AVATAR_PROXY_ENABLED=false`
 *
 * 额外允许走代理的域名：`NUXT_PUBLIC_CRASH_AVATAR_PROXY_HOSTS` 英文逗号分隔（可选）。
 */
import {
	BUILTIN_AVATAR_PROXY_HOSTNAMES,
	CRASH_AVATAR_PROXY_ROUTE_PATH,
	DEFAULT_CRASH_AVATAR_PROXY_HOSTS_CSV,
	isBuiltinCrashAvatarUpstreamHost,
} from "./crashAvatarProxyDefaults"

function parseCsvHosts(csv: string): Set<string> {
	const parts = csv
		.split(",")
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean)
	return new Set(parts)
}

function mergedProxyHosts(): Set<string> {
	const out = new Set<string>()
	for (const x of BUILTIN_AVATAR_PROXY_HOSTNAMES) out.add(x.toLowerCase())
	const csv =
		typeof import.meta.env.NUXT_PUBLIC_CRASH_AVATAR_PROXY_HOSTS === "string" &&
		import.meta.env.NUXT_PUBLIC_CRASH_AVATAR_PROXY_HOSTS.trim()
			? import.meta.env.NUXT_PUBLIC_CRASH_AVATAR_PROXY_HOSTS
			: DEFAULT_CRASH_AVATAR_PROXY_HOSTS_CSV
	for (const h of parseCsvHosts(csv)) out.add(h)
	return out
}

export function toPixiCrossOriginSafeImageUrl(original: string): string {
	const s = String(original ?? "").trim()
	if (!s) return s
	if (typeof window === "undefined") return s

	if (import.meta.env.NUXT_PUBLIC_CRASH_AVATAR_PROXY_ENABLED === "false") return s

	let parseSrc = s
	if (s.startsWith("//")) parseSrc = `https:${s}`
	else if (s.startsWith("/") && typeof window !== "undefined") {
		try {
			parseSrc = new URL(s, window.location.origin).href
		} catch {
			return s
		}
	}
	try {
		const u = new URL(parseSrc)
		if (u.protocol !== "https:") return s
		const host = u.hostname.toLowerCase()
		if (!mergedProxyHosts().has(host) && !isBuiltinCrashAvatarUpstreamHost(host)) return s
		return `${CRASH_AVATAR_PROXY_ROUTE_PATH}?u=${encodeURIComponent(s)}`
	} catch {
		return s
	}
}
