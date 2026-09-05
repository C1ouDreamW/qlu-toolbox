export function nearbyWeeks(week: number, totalWeeks: number) {
  return [week - 1, week, week + 1].filter(item => item >= 1 && item <= totalWeeks)
}

export function weekDeltaForSwipe(offset: number, width: number, week: number, totalWeeks: number) {
  if (Math.abs(offset) <= Math.min(82, width * 0.2)) return 0
  const delta = offset < 0 ? 1 : -1
  return week + delta >= 1 && week + delta <= totalWeeks ? delta : 0
}
