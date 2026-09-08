export function formatWeekSummary(weeks: number[]): string {
  if (!weeks.length) return '未选择'
  const sorted = [...new Set(weeks)].sort((left, right) => left - right)
  const runs = collectRuns(sorted)
  if (runs.length === 1) {
    const [start, end] = runs[0]
    if (start === end) return `第 ${start} 周`
    return `第 ${start}-${end} 周`
  }
  const [first, last] = [sorted[0], sorted[sorted.length - 1]]
  if (isSingleParityRun(sorted, first, last)) {
    const parity = first % 2 === 1 ? '单' : '双'
    return `第 ${first}-${last} 周(${parity})`
  }
  const body = runs.map(([start, end]) => start === end ? `${start}` : `${start}-${end}`).join('、')
  return `第 ${body} 周`
}

function collectRuns(sorted: number[]): Array<[number, number]> {
  const runs: Array<[number, number]> = []
  for (const week of sorted) {
    const last = runs[runs.length - 1]
    if (last && last[1] + 1 === week) last[1] = week
    else runs.push([week, week])
  }
  return runs
}

function isSingleParityRun(sorted: number[], first: number, last: number) {
  if ((last - first) % 2 !== 0) return false
  for (let index = 0; index < sorted.length; index += 1) {
    if (sorted[index] !== first + index * 2) return false
  }
  return true
}

const WEEKDAY_NAMES = '一二三四五六日'

export function formatMeetingSummary(weekday: number | null, startPeriod: number | null, endPeriod: number | null): string {
  if (weekday === null || startPeriod === null || endPeriod === null) return '待安排'
  return `周${WEEKDAY_NAMES[weekday - 1]} 第${startPeriod}-${endPeriod}节`
}
