import { loadAndroidDownload, fetchManifest } from './downloads.mjs'

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

const androidCard = document.querySelector('[data-platform="android"]')
const androidLink = androidCard.querySelector('[data-download]')
const githubApk = androidLink.href
const androidVersion = androidCard.querySelector('[data-version]').textContent
const androidMeta = androidCard.querySelector('[data-meta]').textContent

async function updateDownloads() {
  const status = document.querySelector('#download-status')
  const download = await loadAndroidDownload()
  androidLink.href = download?.url ?? githubApk
  const version = download ? `v${download.version}` : androidVersion
  androidCard.querySelector('[data-version]').textContent = version
  androidCard.querySelector('[data-meta]').textContent = download
    ? `约 ${(download.size / 1024 / 1024).toFixed(1)} MB · 正式安装包`
    : androidMeta
  document.querySelectorAll('[data-android-version]').forEach(item => { item.textContent = version })
  status.textContent = download ? 'Android 提供自建源下载，桌面版通过外部渠道分发。' : '安装包可通过 GitHub 等已配置渠道获取。'
}

async function updateDesktopDownloads() {
  const releases = await fetchManifest('/desktop-releases.json').catch(() => null)
  if (!releases) return
  for (const platform of ['windows', 'mac']) {
    const card = document.querySelector(`[data-platform="${platform}"]`)
    const release = releases[platform]
    if (!release || !/^\d+\.\d+\.\d+$/.test(release.version)) continue
    const prefix = 'https://github.com/C1ouDreamW/qlu-toolbox/releases/'
    if (typeof release.installer !== 'string' || !release.installer.startsWith(prefix + 'download/')) continue
    card.querySelector('[data-version]').textContent = `v${release.version}`
    card.querySelector('[data-download]').href = release.installer
    const extra = platform === 'windows' ? release.portable : release.release
    if (typeof extra === 'string' && extra.startsWith(prefix)) card.querySelector('.download-backup').href = extra
  }
}

async function showExternalLinks() {
  const channels = await fetchManifest('/download-channels.json').catch(() => null)
  if (!channels) return
  for (const card of document.querySelectorAll('[data-platform]')) {
    const links = channels[card.dataset.platform]
    for (const [key, label, host] of [['qq', '加入 QQ 群', 'qm.qq.com'], ['baidu', '百度网盘', 'pan.baidu.com']]) {
      if (!links?.[key]) continue
      try {
        const url = new URL(links[key])
        if (url.protocol !== 'https:' || url.hostname !== host || url.username || url.password) continue
        const link = document.createElement('a')
        link.className = 'download-backup'
        link.href = url.href
        link.target = '_blank'
        link.rel = 'noopener noreferrer'
        link.textContent = label
        card.append(link)
      } catch { /* 未配置有效链接时隐藏该入口。 */ }
    }
  }
}

updateDownloads()
updateDesktopDownloads()
showExternalLinks()
window.addEventListener('pageshow', event => { if (event.persisted) void updateDownloads() })
