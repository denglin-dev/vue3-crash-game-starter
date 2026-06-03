export const useFormatDate = () => {
  const { $formatDate } = useNuxtApp()
  return $formatDate as (
    timestamp: number | string,
    options?: { format?: string }
  ) => string
}