/** score хранится в процентах с одной десятой (23.2); показываем шагом 5, но не меньше 5. */
export const roundPercent = (score: number): number => Math.max(5, Math.round(score / 5) * 5)
export const percentLabel = (score: number): string => `≈${roundPercent(score)}%`
