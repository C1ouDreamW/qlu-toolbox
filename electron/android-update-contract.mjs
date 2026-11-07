// Shared by the Android client and release tooling; no filesystem or native APIs.
import { assertChannelVersion } from './version-contract.mjs'
import { channelIdentity } from './channel-contract.mjs'
import { GITHUB_REPOSITORY, isArtifactUrl, isPublicationDate, UPDATE_ORIGIN } from './update-contract.mjs'

export function androidReleaseTag(version, channel = 'stable') {
  assertChannelVersion(version, channel)
  if (!['stable', 'alpha'].includes(channel)) throw new Error('Debug builds cannot be released')
  return `android-${channel === 'alpha' ? 'alpha-' : ''}v${version}`
}

export function androidArtifactName(version, channel = 'stable') {
  androidReleaseTag(version, channel)
  return `LumaTile-${channel === 'alpha' ? 'Alpha-' : ''}Android-v${version}.apk`
}

export function androidUpdateSources(channel) {
  if (!['stable', 'alpha'].includes(channel)) throw new Error('Debug 版本不提供在线更新')
  const file = channel === 'alpha' ? 'android-alpha.json' : 'android.json'
  return [
    `${UPDATE_ORIGIN}/${channel}/android.json`,
    `https://raw.githubusercontent.com/${GITHUB_REPOSITORY}/main/updates/${file}`,
    `https://raw.githubusercontent.com/C1ouDreamW/lumatile/main/updates/${file}`,
  ]
}

export function validateAndroidManifest(item, channel = 'stable') {
  if (!['stable', 'alpha'].includes(channel) || !item || item.schemaVersion !== 1 ||
      item.applicationId !== channelIdentity(channel, 'android').applicationId || item.channel !== channel ||
      !Number.isSafeInteger(item.versionCode) || item.versionCode <= 0 || item.versionCode > 2100000000 ||
      typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256) || !Number.isSafeInteger(item.size) || item.size <= 0 ||
      typeof item.title !== 'string' || !item.title.trim() || typeof item.notes !== 'string' || !item.notes.trim() ||
      typeof item.mandatory !== 'boolean' || !isPublicationDate(item.publishedAt)) throw new Error('Android 更新清单的身份或元数据无效')
  const tag = androidReleaseTag(item.versionName, channel)
  const file = androidArtifactName(item.versionName, channel)
  if ((item.tag !== undefined || item.commit !== undefined) &&
      (item.tag !== tag || typeof item.commit !== 'string' || !/^[a-f0-9]{40}$/.test(item.commit))) throw new Error('Android 清单源码身份无效')
  const tags = channel === 'stable' ? [tag, `v${item.versionName}`] : [tag]
  if (!tags.some(value => isArtifactUrl(item.apkUrl, value, file))) throw new Error('Android APK 地址与渠道或版本不匹配')
  return item
}
