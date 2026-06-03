import { useNuxtApp } from "#app"

export const MessageService = {
	error(msg: string) {
		useNuxtApp().$MessageService.error(msg)
	},
	success(msg: string) {
		useNuxtApp().$MessageService.success(msg)
	},
	warning(msg: string) {
		useNuxtApp().$MessageService.warning(msg)
	},
	info(msg: string) {
        useNuxtApp().$MessageService.info(msg)
    }
}
