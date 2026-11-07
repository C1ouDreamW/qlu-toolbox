import { createHash } from 'node:crypto'
import { GITHUB_REPOSITORY, isPublicationDate, desktopTarget, validateDesktopManifest } from '../electron/update-contract.mjs'
import { validateAndroidManifest } from '../electron/android-update-contract.mjs'

// Public reads only: a GitHub write token must never be forwarded to download URLs.
export async function validatePublishedAlpha(promotion, fetcher = fetch) {
  const { alpha, platform, alphaVersion, review } = promotion
  const api = `https://api.github.com/repos/${GITHUB_REPOSITORY}`
  const request = async url => {
    const response = await fetcher(url, { headers: { Accept: 'application/json', 'User-Agent': 'LumaTile-PromotionVerifier' }, signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new Error(`Cannot verify the tested Alpha publication: ${response.status}`)
    return response
  }
  const release = await (await request(`${api}/releases/tags/${encodeURIComponent(alpha.tag)}`)).json()
  if (release?.tag_name !== alpha.tag || release.draft !== false || release.prerelease !== true || !Array.isArray(release.assets)) throw new Error('Tested Alpha must be a public prerelease with its own tag')
  const source = await (await request(`${api}/commits/${encodeURIComponent(alpha.tag)}`)).json()
  if (source?.sha !== alpha.commit) throw new Error('Published Alpha tag moved from the reviewed commit')
  if (!isPublicationDate(release.published_at) || Date.parse(release.published_at) > Date.parse(review.approvedAt)) throw new Error('Stable approval must follow the Alpha publication')
  const target = platform === 'android' ? null : desktopTarget(platform === 'windows' ? 'win32' : 'darwin', platform === 'windows' ? 'x64' : 'arm64')
  const manifestName = `update-${target?.id ?? 'android'}.json`
  const manifestUrl = `https://github.com/${GITHUB_REPOSITORY}/releases/download/${alpha.tag}/${manifestName}`
  const found = release.assets.filter(asset => asset.name === manifestName)
  if (found.length !== 1 || found[0].browser_download_url !== manifestUrl || found[0].state !== 'uploaded') throw new Error('Tested Alpha is missing its platform manifest')
  const bytes = Buffer.from(await (await request(manifestUrl)).arrayBuffer())
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (found[0].size !== bytes.length || (found[0].digest != null && found[0].digest !== `sha256:${digest}`)) throw new Error('Tested Alpha manifest differs from its published asset')
  const value = JSON.parse(bytes.toString('utf8'))
  const manifest = platform === 'android' ? validateAndroidManifest(value, 'alpha') : validateDesktopManifest(value, target, null, 'alpha')
  if (manifest.tag !== alpha.tag || manifest.commit !== alpha.commit || (platform === 'android' ? manifest.versionName : manifest.version) !== alphaVersion) throw new Error('Tested Alpha manifest differs from the reviewed source')
  const artifacts = platform === 'android' ? [{ fallbackUrl: manifest.apkUrl, sha256: manifest.sha256, size: manifest.size }] : Object.values(manifest.artifacts)
  for (const item of artifacts) {
    const assets = release.assets.filter(asset => asset.browser_download_url === item.fallbackUrl)
    if (assets.length !== 1 || assets[0].state !== 'uploaded' || assets[0].size !== item.size ||
        (assets[0].digest != null && assets[0].digest !== `sha256:${item.sha256}`)) throw new Error('Tested Alpha installation asset is incomplete or conflicts with its manifest')
  }
  return { tag: alpha.tag, commit: alpha.commit, publishedAt: release.published_at, manifestSha256: digest }
}
