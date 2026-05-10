/**
 * 对联合类型逐个成员执行 Omit
 * K 必须为合法的对象 key
 * T extends unknown 会触发 TypeScript 对联合类型的分发
 */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, Extract<keyof T, K>> : never
