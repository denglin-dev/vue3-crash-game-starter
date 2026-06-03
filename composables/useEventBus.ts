// composables/useEventBus.ts

import { bus } from "~/utils/bus"

export const useEventBus = () => {
	return {
		emit: bus.emit,
		on: bus.on,
		once: (type, handler) => {
			const wrapper = (...args) => {
				handler(...args)
				bus.off(type, wrapper)
			}
			bus.on(type, wrapper)
		},
		off: bus.off
	}
}
