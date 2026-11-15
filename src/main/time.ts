// Всё время — местное: локальные конструкторы Date, поэтому смена пояса/DST не ломает «09:00».
export function atLocal(now: number, hhmm: string, dayOffset = 0): number {
  const [h, m] = hhmm.split(':').map(Number)
  const d = new Date(now)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + dayOffset, h, m, 0, 0).getTime()
}
export const startOfDay = (now: number): number => atLocal(now, '00:00')

/** Ближайшая граница часа строго после now (начало текущего местного часа + 1 ч, верно и на переводе часов). */
export function nextHour(now: number): number {
  const off = new Date(now).getTimezoneOffset() * 60_000
  return Math.floor((now - off) / 3_600_000) * 3_600_000 + off + 3_600_000
}
