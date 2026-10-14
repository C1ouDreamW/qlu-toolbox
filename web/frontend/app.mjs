import { MANIFEST_URLS, fetchManifest, readDownload } from './downloads.mjs'

const views = {
  schedule: {
    title: '从今天的课，\n看到整个学期。',
    description: '切换周次，预览后续安排；编辑课程、管理多份课表。课表备份还可以在电脑与手机之间互通。',
    image: 'schedule.gif', alt: '合成课表演示：切换周次与重叠课程',
  },
  gpa: {
    title: '选好每门课程，\n看清每分努力。',
    description: '导入分项成绩 Excel，逐门查看成绩构成。勾选或取消课程，总学分与加权 GPA 随选择即时更新。',
    image: 'gpa.gif', alt: '合成成绩演示：勾选课程，加权 GPA 与总学分即时变化',
  },
  credit: {
    title: '已修与待修，\n下一步更清楚。',
    description: '对照培养方案与本地要求，查看综合素质选修课各模块的学分进度、未修完项目和选课方向。',
    image: 'credit.webp', alt: '合成学分数据：已修与在修概览，各模块学分进度与缺口',
  },
}

document.querySelectorAll('[data-view]').forEach(button => {
  button.addEventListener('click', () => {
    const view = views[button.dataset.view]
    document.querySelectorAll('[data-view]').forEach(item => item.setAttribute('aria-pressed', String(item === button)))
    const title = document.querySelector('#showcase-title')
    title.replaceChildren()
    view.title.split('\n').forEach((line, index) => {
      if (index) title.append(document.createElement('br'))
      title.append(document.createTextNode(line))
    })
    document.querySelector('#showcase-description').textContent = view.description
    const image = document.querySelector('#showcase-image')
    image.src = `./assets/${view.image}`
    image.alt = view.alt
  })
})

async function updateDownloads() {
  const results = await Promise.allSettled([
    fetchManifest(MANIFEST_URLS.android), fetchManifest(MANIFEST_URLS.desktop),
  ])
  let updated = 0
  for (const card of document.querySelectorAll('[data-platform]')) {
    const platform = card.dataset.platform
    const result = results[platform === 'android' ? 0 : 1]
    try {
      if (result.status === 'rejected') throw result.reason
      const download = readDownload(platform, result.value)
      card.querySelector('[data-download]').href = download.url
      card.querySelector('[data-version]').textContent = `v${download.version}`
      if (platform === 'android') {
        card.querySelector('[data-meta]').textContent = `约 ${(download.size / 1024 / 1024).toFixed(1)} MB · 正式安装包`
        document.querySelectorAll('[data-android-version]').forEach(item => { item.textContent = `v${download.version}` })
      }
      updated++
    } catch {
      // shortcut: 清单不可用时保留已发布版本链接，增加统一下载代理后再由服务端回退。
    }
  }
  document.querySelector('#download-status').textContent = updated === 3
    ? '已获取更新源当前版本 · 安装包由 LumaTile 自建更新源提供'
    : '部分版本信息暂时无法刷新，已保留已发布版本链接；下载失败时请使用备用下载。'
}

updateDownloads()
