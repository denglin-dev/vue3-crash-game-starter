// composables/useLeftIsClose.ts
export const useLeftIsClose = () => useCookie("left-is-close", { default: () => false })
