// 进程内短时缓存（公开目录读取）。保留 Date 等对象类型；多副本之间不共享，最长 TTL 秒后自然过期。
type Entry = { at: number; v: Promise<unknown> };
const store = new Map<string, Entry>();
const MAX = 500;

export function memo<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && now - hit.at < ttlSeconds * 1000) return hit.v as Promise<T>;
  const v = fn().catch((e) => { store.delete(key); throw e; });
  if (store.size >= MAX) store.delete(store.keys().next().value as string);
  store.set(key, { at: now, v });
  return v;
}

/** 发布、套餐变更等之后清空（只影响本进程；其他副本在 TTL 内过期）。 */
export function invalidateCatalog() {
  store.clear();
}
