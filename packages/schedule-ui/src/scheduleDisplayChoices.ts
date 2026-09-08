const prefix = 'lumatile.scheduleDisplayChoices.'

export function readScheduleDisplayChoices(scheduleId: string): Record<string, string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(prefix + scheduleId) || '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  } catch { return {} }
}

export function saveScheduleDisplayChoices(scheduleId: string, choices: Record<string, string>): boolean {
  try {
    localStorage.setItem(prefix + scheduleId, JSON.stringify(choices))
    return true
  } catch { return false }
}
