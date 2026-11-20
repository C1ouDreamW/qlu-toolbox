import { resource } from './api.mjs'
import { dateFormat, field, showError, showMessage, table, textElement } from './ui.mjs'

function reportPanel(title, content) {
  const panel = document.createElement('div')
  panel.className = 'panel'
  panel.append(textElement('h2', '', title), content)
  return panel
}

export async function loadStatistics() {
  const content = field('stats-content')
  const refresh = field('refresh-stats')
  refresh.disabled = true
  showMessage('stats-message', '正在读取统计报告…', 'loading')
  try {
    const report = await resource('/v1/statistics')
    const totals = table(['指标', '累计'], [
      ['识别安装', report.totals.installs], ['匿名心跳', report.totals.beacons],
      ['更新清单请求', report.totals.manifest_checks], ['自建源下载', report.totals.downloads_selfhosted],
      ['GitHub 下载', report.totals.downloads_github],
    ])
    const days = report.days.map((day, index) => [
      day, report.dau[index], report.new_installs[index], report.raw_checks[index], report.downloads[index],
    ]).reverse()
    const daily = days.length ? table(['日期', '日活', '新增安装', '更新检查', '自建源下载'], days)
      : textElement('p', 'message', '暂无逐日数据')
    const distributions = document.createElement('div')
    distributions.className = 'publish-grid'
    for (const [title, rows] of [
      ['客户端分布', report.client_dist], ['版本分布', report.version_dist], ['系统分布', report.os_dist],
      ['架构分布', report.arch_dist], ['自建源下载', report.top_files], ['GitHub 资源下载', report.github_by_asset],
    ]) {
      const detail = rows.length ? table(['项目', '次数'], rows.map(item => [item.label, item.count]))
        : textElement('p', 'message', '暂无数据')
      distributions.append(reportPanel(title, detail))
    }
    content.replaceChildren(reportPanel('累计概览', totals), reportPanel(`每日明细 · 最近 ${report.range_days} 天`, daily), distributions)
    showMessage('stats-message', `更新于 ${report.generated_at.replace('T', ' ')}${report.github_snapshot_day ? ` · GitHub 快照 ${report.github_snapshot_day}` : ''}`)
  } catch (error) {
    showError('stats-message', error)
  } finally {
    refresh.disabled = false
  }
}

let operationRequest = 0
let offset = 0
let nextOffset = null
export async function loadOperations(start = 0) {
  const request = ++operationRequest
  const previous = field('operations-prev')
  const next = field('operations-next')
  previous.disabled = next.disabled = true
  showMessage('operations-message', '正在读取操作记录…', 'loading')
  try {
    const params = new URLSearchParams({ offset: start, q: field('operation-query').value.trim() })
    const result = await resource(`/v1/operations?${params}`)
    if (request !== operationRequest) return
    field('operations-content').replaceChildren(...(result.items.length ? [table(['时间', '操作者', '对象', '结果'],
      result.items.map(item => [dateFormat.format(new Date(item.created_at)), item.actor, item.resource, item.value]))] : []))
    showMessage('operations-message', result.items.length ? '' : '没有符合条件的操作记录。')
    offset = start
    nextOffset = result.nextOffset
  } catch (error) {
    if (request === operationRequest) showError('operations-message', error)
  } finally {
    if (request === operationRequest) {
      previous.disabled = !offset
      next.disabled = nextOffset === null
    }
  }
}

field('refresh-stats').onclick = loadStatistics
field('operation-filter').onsubmit = event => { event.preventDefault(); void loadOperations() }
field('operations-prev').onclick = () => loadOperations(Math.max(0, offset - 50))
field('operations-next').onclick = () => loadOperations(nextOffset)
