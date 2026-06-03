// utils/bus.ts
type Handler = (...args: any[]) => void

class EventBus {
	private events: Map<string, Set<Handler>> = new Map()

	// 用箭头函数绑定 this
	on = (event: string, handler: Handler) => {
		if (!this.events.has(event)) {
			this.events.set(event, new Set())
		}
		this.events.get(event)!.add(handler)
		return () => this.off(event, handler)
	}

	off = (event: string, handler: Handler) => {
		this.events.get(event)?.delete(handler)
	}

	emit = (event: string, ...args: any[]) => {
		this.events.get(event)?.forEach((h) => h(...args))
	}
}

export const bus = new EventBus()
