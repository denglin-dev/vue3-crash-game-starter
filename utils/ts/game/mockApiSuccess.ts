/** 与线上一致：mock 接口成功时固定 `is_suc: 0` */
export function mockApiOk<T extends Record<string, unknown>>(data: T): T & { is_suc: 0 } {
  return { is_suc: 0, ...data }
}
