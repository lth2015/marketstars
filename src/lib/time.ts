// 日本时间（JST, UTC+9，无夏令时）周期计算。
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 从 start 起至下个月同日同一时刻（JST）；下个月无对应日期取该月最后一日。 */
export function addOneMonthJst(start: Date): Date {
  const j = new Date(start.getTime() + JST_OFFSET_MS);
  const y = j.getUTCFullYear();
  const m = j.getUTCMonth();
  const d = j.getUTCDate();
  const lastDayNext = new Date(Date.UTC(y, m + 2, 0)).getUTCDate();
  const day = Math.min(d, lastDayNext);
  const res = Date.UTC(y, m + 1, day, j.getUTCHours(), j.getUTCMinutes(), j.getUTCSeconds(), j.getUTCMilliseconds());
  return new Date(res - JST_OFFSET_MS);
}

export function addDays(start: Date, days: number): Date {
  return new Date(start.getTime() + days * 86400000);
}

export function formatJst(d: Date | null | undefined, withTime = false): string {
  if (!d) return "—";
  const j = new Date(d.getTime() + JST_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, "0");
  const date = `${j.getUTCFullYear()}/${p(j.getUTCMonth() + 1)}/${p(j.getUTCDate())}`;
  return withTime ? `${date} ${p(j.getUTCHours())}:${p(j.getUTCMinutes())}` : date;
}
