import { githubReleaseClient, publishVerifiedDraft } from './github-release-draft.mjs'
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
  const client = githubReleaseClient({ token, fetcher })
  const { api, json, publicJson, paginate } = client
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
  return publishVerifiedDraft({ identity, directory, names, prerelease, title: `LumaTile for ${identity.platform === 'macos' ? 'macOS' : identity.platform === 'windows' ? 'Windows' : 'Android'} ${identity.version}`, body: identity.notes, beforePublish: monotonic, client })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [platform, tag, directory] = process.argv.slice(2)
  if (!directory) throw new Error('Usage: node scripts/publish-platform-release.mjs <platform> <tag> <release-assets-directory>')
  if (process.env.GITHUB_REPOSITORY !== GITHUB_REPOSITORY) throw new Error('Unexpected publication repository')
  console.log(JSON.stringify(await publishPlatformRelease({ identity: taggedRelease(repositoryRoot, platform, tag), directory: resolve(directory), token: process.env.GITHUB_TOKEN })))
}
