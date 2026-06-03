import type { Ref } from "vue"
import { onBeforeUnmount, onMounted } from "vue"

let activeDialogLockCount = 0

const lockDocumentOverscroll = () => {
	activeDialogLockCount += 1
	document.documentElement.classList.add("cy-dialog-overscroll-lock")
}

const unlockDocumentOverscroll = () => {
	activeDialogLockCount = Math.max(0, activeDialogLockCount - 1)
	if (activeDialogLockCount === 0) {
		document.documentElement.classList.remove("cy-dialog-overscroll-lock")
	}
}

export const useDialogOverscrollLock = (rootRef: Ref<HTMLElement | null>) => {
	let lastTouchY = 0

	const getScrollableElement = (target: EventTarget | null) => {
		const root = rootRef.value
		let current = target instanceof HTMLElement ? target : null
		if (!root || !current || !root.contains(current)) return null

		while (current && current !== root) {
			const style = window.getComputedStyle(current)
			const canScrollY = ["auto", "scroll", "overlay"].includes(style.overflowY)

			if (canScrollY && current.scrollHeight > current.clientHeight) {
				return current
			}

			current = current.parentElement
		}

		return null
	}

	const handleTouchStart = (event: TouchEvent) => {
		lastTouchY = event.touches[0]?.clientY ?? 0
	}

	const handleTouchMove = (event: TouchEvent) => {
		const currentY = event.touches[0]?.clientY ?? 0
		const deltaY = currentY - lastTouchY
		lastTouchY = currentY
		const scrollElement = getScrollableElement(event.target)

		if (!scrollElement) {
			return
		}

		const isAtTop = scrollElement.scrollTop <= 0
		const isAtBottom = scrollElement.scrollTop + scrollElement.clientHeight >= scrollElement.scrollHeight - 1

		if ((isAtTop && deltaY > 0) || (isAtBottom && deltaY < 0)) {
			event.preventDefault()
		}
	}

	onMounted(() => {
		lockDocumentOverscroll()
		document.addEventListener("touchstart", handleTouchStart, { passive: true, capture: true })
		document.addEventListener("touchmove", handleTouchMove, { passive: false, capture: true })
	})

	onBeforeUnmount(() => {
		unlockDocumentOverscroll()
		document.removeEventListener("touchstart", handleTouchStart, { capture: true })
		document.removeEventListener("touchmove", handleTouchMove, { capture: true })
	})
}
