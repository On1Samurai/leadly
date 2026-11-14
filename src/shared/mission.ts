/** Шаг «миссии дня»; computeMission появится в Задаче 13. */
export interface MissionStep {
  id: 'keys' | 'city' | 'search' | 'review' | 'write' | 'done'
  title: string
  hint: string
}
