import { isDeepStrictEqual } from 'node:util'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { desktopTagVersion, GITHUB_REPOSITORY, isArtifactUrl, UPDATE_ORIGIN } from '../electron/update-contract.mjs'
import { assertChannelVersion, compareChannelVersions } from '../electron/channel-contract.mjs'
import { androidArtifactName, androidReleaseTag } from '../electron/android-update-contract.mjs'
import { validatePublishedAlpha } from './promotion-publication.mjs'
import { parseReleaseTag } from './release-config.mjs'
import { readBuildInventory } from './inventory-artifacts.mjs'
import { assertPromotion, manifestTarget, repositoryRoot, sha256, taggedRelease, targetFor, validatePlatformManifest, verifyReleaseFiles } from './release-artifacts.mjs'

// All mutations are confined to this platform's draft until every asset is verified.
export async function publishPlatformRelease({ identity, directory, token, fetcher = fetch }) {
  if (identity.purpose === 'bridge') throw new Error('Desktop bridge requires a dedicated publisher verifying both desktop targets')
  if (identity.purpose === 'rehearsal' || identity.deployable === false) throw new Error('Non-deployable candidate or rehearsal artifacts cannot be published')
  const channel = identity.channel ?? 'stable'
  if (!['stable', 'alpha'].includes(channel)) throw new Error('Invalid publication channel')
  assertChannelVersion(identity.version, channel)
  const prerelease = channel === 'alpha'
  if (!token) throw new Error('A GitHub contents-write token is required')
  const api = `https://api.github.com/repos/${GITHUB_REPOSITORY}`
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
  const request = async (url, options = {}, allowMissing = false) => {
    const response = await fetcher(url, { ...options, headers: { ...headers, ...options.headers }, signal: AbortSignal.timeout(300_000) })
    if (allowMissing && response.status === 404) return null
    if (!response.ok) throw new Error(`GitHub release request failed: ${response.status}`)
    return response
  }
  const json = async (url, options, missing) => (await request(url, options, missing))?.json() ?? null
  const publicJson = async (url, allowMissing = false) => {
    const response = await fetcher(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) })
    if (allowMissing && response.status === 404) return null
    if (!response.ok) throw new Error(`Cannot verify publication baseline: ${response.status}`)
    const value = await response.json()
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid publication baseline JSON')
    return value
  }
  const paginate = async path => {
    const results = []
    for (let page = 1; ; page++) {
      if (page > 100) throw new Error('GitHub pagination limit exceeded')
      const response = await request(`${api}${path}?per_page=100&page=${page}`)
      const values = await response.json()
      if (!Array.isArray(values)) throw new Error('Invalid GitHub list response')
      results.push(...values)
      if (values.length < 100 && !response.headers.get('link')?.includes('rel="next"')) return results
    }
  }
  const names = await verifyReleaseFiles(directory)
  const record = JSON.parse(await readFile(join(directory, 'release-record.json'), 'utf8'))
  if (record.verification?.purpose === 'rehearsal' || record.verification?.deployable === false) throw new Error('Non-deployable verification cannot authorize publication')
  for (const key of ['platform', 'version', 'tag', 'commit', 'target']) if (record[key] !== identity[key]) throw new Error(`Release record mismatch: ${key}`)
  if (!isDeepStrictEqual(record.promotion ?? null, identity.promotion ?? null)) throw new Error('Release promotion evidence does not match the immutable source')
  if (record.channel !== channel || (record.verification?.channel ?? 'stable') !== channel) throw new Error('Release record channel mismatch')
  if (record.verification?.verified !== true) throw new Error('Unverified release build')
  if (!record.inventory?.provenanceSha256) throw new Error('Release lacks its bound build inventory')
  const inventory = await readBuildInventory(directory, identity.information, record.inventory.provenanceSha256)
  if (!isDeepStrictEqual(record.inventory.entries, inventory.entries) || (identity.platform === 'android' && record.verification.checks?.inventorySha256 !== inventory.provenanceSha256)) throw new Error('Release inventory differs from the verified build')
  const manifest = validatePlatformManifest(identity.platform, JSON.parse(await readFile(join(directory, `update-${manifestTarget(identity.platform)}.json`), 'utf8')), identity.bridgeVersion, channel)
  if ((identity.platform === 'android' ? manifest.versionName : manifest.version) !== identity.version) throw new Error('Release manifest version mismatch')
  if (identity.platform === 'android') {
    if (manifest.versionCode !== identity.versionCode || !isArtifactUrl(manifest.apkUrl, identity.tag, androidArtifactName(identity.version, channel), true)) throw new Error('Android release identity mismatch')
  } else if (manifest.tag !== identity.tag || manifest.commit !== identity.commit || manifest.buildNumber !== identity.information.buildNumber || manifest.nativeBuildVersion !== identity.information.nativeBuildVersion) throw new Error('Desktop manifest identity mismatch')
  const artifacts = identity.platform === 'android' ? [{ url: manifest.apkUrl, size: manifest.size, sha256: manifest.sha256 }] : Object.values(manifest.artifacts)
  for (const artifact of artifacts) {
    const bytes = await readFile(join(directory, new URL(artifact.url).pathname.split('/').at(-1)))
    if (bytes.length !== artifact.size || sha256(bytes) !== artifact.sha256) throw new Error('Manifest artifact hash or size mismatch')
  }
  const assetsFor = id => paginate(`/releases/${id}/assets`)
  const verifyRemote = async (assets, complete) => {
    if (new Set(assets.map(asset => asset.name)).size !== assets.length || assets.some(asset => !names.includes(asset.name)) || (complete && assets.length !== names.length)) throw new Error('Remote release asset set does not match this build')
    for (const asset of assets) {
      const bytes = await readFile(join(directory, asset.name))
      if (asset.state !== 'uploaded' || asset.size !== bytes.length) throw new Error(`Remote asset size/state mismatch: ${asset.name}`)
      const expected = sha256(bytes)
      const actual = asset.digest?.startsWith('sha256:') ? asset.digest.slice(7) : sha256(Buffer.from(await (await request(`${api}/releases/assets/${asset.id}`, { headers: { Accept: 'application/octet-stream' } })).arrayBuffer()))
      if (actual !== expected) throw new Error(`Refusing to replace a different asset: ${asset.name}`)
    }
  }
  const monotonic = async () => {
    if (identity.promotion) await validatePublishedAlpha(identity.promotion, fetcher)
    const remote = await json(`${api}/commits/${encodeURIComponent(identity.tag)}`)
    if (remote?.sha !== identity.commit) throw new Error('Remote release tag commit differs from verified build')
    const baseline = await publicJson(`${UPDATE_ORIGIN}/${channel}/${manifestTarget(identity.platform)}.json`, prerelease)
    if (baseline) assertPromotion(identity.platform, validatePlatformManifest(identity.platform, baseline, identity.bridgeVersion, channel), manifest)
    if (identity.platform === 'android') {
      for (const repository of ['C1ouDreamW/qlu-toolbox', 'C1ouDreamW/lumatile']) {
        const backup = await publicJson(`https://raw.githubusercontent.com/${repository}/main/updates/${prerelease ? 'android-alpha.json' : 'android.json'}`, true)
        if (backup) assertPromotion('android', validatePlatformManifest('android', backup, null, channel), manifest)
      }
    }
    for (const release of await paginate('/releases')) {
      if (release.draft !== false || release.prerelease !== prerelease || release.tag_name === identity.tag) continue
      let version
      if (identity.platform === 'android') {
        try {
          const parsed = parseReleaseTag('android', release.tag_name)
          if (parsed.channel === channel) version = parsed.version
        } catch { continue }
      } else version = desktopTagVersion(release.tag_name, targetFor(identity.platform), identity.bridgeVersion, channel)
      if (!version) continue
      if (compareChannelVersions(identity.version, version, channel) <= 0) throw new Error('A newer or equal platform version is already public')
      if (identity.platform === 'android') {
        const asset = release.assets?.find(asset => asset.name === 'update-android.json')
        if (!asset || !isArtifactUrl(asset.browser_download_url, release.tag_name, 'update-android.json', true)) throw new Error('Published Android release lacks its manifest')
        const prior = validatePlatformManifest('android', await publicJson(asset.browser_download_url), null, channel)
        if (androidReleaseTag(prior.versionName, channel) !== release.tag_name) throw new Error('Published Android manifest identity mismatch')
        assertPromotion('android', prior, manifest)
      } else {
        const name = `update-${identity.target}.json`
        const asset = release.assets?.find(asset => asset.name === name)
        if (!asset || !isArtifactUrl(asset.browser_download_url, release.tag_name, name, true)) throw new Error('Published desktop release lacks its native build baseline manifest')
        const prior = validatePlatformManifest(identity.platform, await publicJson(asset.browser_download_url), identity.bridgeVersion, channel)
        if (prior.tag !== release.tag_name || prior.version !== version) throw new Error('Published desktop manifest identity mismatch')
        assertPromotion(identity.platform, prior, manifest)
      }
    }
  }
  let release = await json(`${api}/releases/tags/${encodeURIComponent(identity.tag)}`, undefined, true)
  if (release && release.tag_name !== identity.tag) throw new Error('GitHub returned a different release tag')
  if (release && release.prerelease !== prerelease) throw new Error('Release prerelease flag does not match its channel')
  if (release && !release.draft) {
    if ((await json(`${api}/commits/${encodeURIComponent(identity.tag)}`))?.sha !== identity.commit) throw new Error('Remote release tag commit differs from verified build')
    await verifyRemote(await assetsFor(release.id), true)
    return { status: 'already-published', tag: identity.tag }
  }
  await monotonic()
  if (!release) {
    release = await json(`${api}/releases`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      tag_name: identity.tag, target_commitish: identity.commit, draft: true, prerelease, make_latest: 'false',
      name: `LumaTile for ${identity.platform === 'macos' ? 'macOS' : identity.platform === 'windows' ? 'Windows' : 'Android'} ${identity.version}`, body: identity.notes,
    }) })
  }
  const existing = await assetsFor(release.id)
  await verifyRemote(existing, false)
  for (const name of names) {
    if (existing.some(asset => asset.name === name)) continue
    await request(`https://uploads.github.com/repos/${GITHUB_REPOSITORY}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: await readFile(join(directory, name)),
    })
  }
  await verifyRemote(await assetsFor(release.id), true)
  await monotonic()
  await json(`${api}/releases/${release.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft: false, make_latest: 'false' }) })
  return { status: 'published', tag: identity.tag }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [platform, tag, directory] = process.argv.slice(2)
  if (!directory) throw new Error('Usage: node scripts/publish-platform-release.mjs <platform> <tag> <release-assets-directory>')
  if (process.env.GITHUB_REPOSITORY !== GITHUB_REPOSITORY) throw new Error('Unexpected publication repository')
  console.log(JSON.stringify(await publishPlatformRelease({ identity: taggedRelease(repositoryRoot, platform, tag), directory: resolve(directory), token: process.env.GITHUB_TOKEN })))
}
