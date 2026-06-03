import { bus } from "~/utils/bus"

const ZENDESK_SNIPPET_ID = "ze-snippet"
const ZENDESK_SNIPPET_SRC =
	"https://static.zdassets.com/ekr/snippet.js?key=78305a3e-c258-4485-ada2-31f7cc7843df"

let snippetLoadPromise: Promise<boolean> | null = null
let zendeskHooksAttached = false

const attachZendeskHooks = () => {
	if (zendeskHooksAttached || typeof window === "undefined") return
	const zE = window.zE
	if (typeof zE !== "function") return
	zendeskHooksAttached = true
	try {
		zE("messenger", "hide")
	} catch {
		/* Zendesk not fully ready */
	}
	try {
		zE("messenger:on", "close", () => {
			try {
				window.zE?.("messenger", "hide")
			} catch {
				/* ignore */
			}
			try {
				bus.emit("serviceState", false)
			} catch {
				/* ignore */
			}
		})
	} catch {
		/* ignore */
	}
}

const waitForZendeskReady = (): Promise<boolean> =>
	new Promise((resolve) => {
		let ticks = 0
		const maxTicks = 300
		const id = window.setInterval(() => {
			ticks++
			if (typeof window.zE === "function") {
				window.clearInterval(id)
				attachZendeskHooks()
				resolve(true)
				return
			}
			if (ticks >= maxTicks) {
				window.clearInterval(id)
				console.warn("[Zendesk] snippet ready timeout")
				resolve(false)
			}
		}, 50)
	})

export const ensureZendeskSnippet = (): Promise<boolean> => {
	if (import.meta.server) return Promise.resolve(false)

	if (typeof window.zE === "function") {
		attachZendeskHooks()
		return Promise.resolve(true)
	}

	if (snippetLoadPromise) return snippetLoadPromise

	const existing = document.getElementById(ZENDESK_SNIPPET_ID)
	if (existing) {
		snippetLoadPromise = (async () => {
			if (typeof window.zE === "function") {
				attachZendeskHooks()
				return true
			}
			await new Promise<void>((resolve) => {
				existing.addEventListener("load", () => resolve(), { once: true })
				window.setTimeout(resolve, 8000)
			})
			if (typeof window.zE === "function") {
				attachZendeskHooks()
				return true
			}
			return waitForZendeskReady()
		})()
		return snippetLoadPromise
	}

	snippetLoadPromise = new Promise((resolve) => {
		const script = document.createElement("script")
		script.id = ZENDESK_SNIPPET_ID
		script.src = ZENDESK_SNIPPET_SRC
		script.async = true
		script.onload = () => {
			if (typeof window.zE === "function") {
				attachZendeskHooks()
				resolve(true)
				return
			}
			void waitForZendeskReady().then(resolve)
		}
		script.onerror = () => {
			snippetLoadPromise = null
			console.warn("[Zendesk] snippet script failed to load")
			resolve(false)
		}
		document.body.appendChild(script)
	})

	return snippetLoadPromise
}
