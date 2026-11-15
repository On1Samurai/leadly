/** Шаг «миссии»: 1 город, 2 поиск, 3 база, 4 первое сообщение; 'done' — миссия выполнена. */
export type MissionStep = 1 | 2 | 3 | 4 | 'done'

export function computeMission(s: { cities: number; places: number; inBase: number; written: number }): MissionStep {
  if (s.cities === 0) return 1
  if (s.places < 20) return 2
  if (s.inBase === 0) return 3
  if (s.written === 0) return 4
  return 'done'
}
