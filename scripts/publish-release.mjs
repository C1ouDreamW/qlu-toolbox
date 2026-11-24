import { githubReleaseClient, publishVerifiedDraft } from './github-release-draft.mjs'
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { artifactFileNames, assertStableVersion, desktopTagVersion, GITHUB_REPOSITORY, isArtifactUrl, UPDATE_ORIGIN } from '../packages/release-contract/update-contract.mjs'
import { assertChannelVersion, compareChannelVersions } from '../packages/release-contract/channel-contract.mjs'
import { androidArtifactName, androidReleaseTag, androidTagVersion } from '../packages/release-contract/android-update-contract.mjs'
import { RELEASE_TARGETS } from './release-config.mjs'
import { assertReleaseSource, releaseRunContext } from './release-source.mjs'
import { assertPromotion, manifestTarget, repositoryRoot, sha256, taggedRelease, targetFor, validatePlatformManifest, verifyReleaseFiles } from './release-artifacts.mjs'

async function inspectPlatformBundle(identity, directory) {
  if (identity.purpose === 'rehearsal' || identity.deployable === false) throw new Error('Debug artifacts cannot be published')
  const channel = identity.channel ?? 'stable'
  if (!['stable', 'alpha'].includes(channel)) throw new Error('Invalid publication channel')
  assertChannelVersion(identity.version, channel)
  const names = await verifyReleaseFiles(directory)
  const platformAssets = identity.platform === 'android' ? [androidArtifactName(identity.version, channel)]
    : Object.values(artifactFileNames(targetFor(identity.platform), identity.version, false, channel))
  const expectedNames = [...platformAssets, `update-${manifestTarget(identity.platform)}.json`, 'release-record.json', 'release-notes.md', 'SHA256SUMS.txt']
  if (names.length !== expectedNames.length || !expectedNames.every(name => names.includes(name))) throw new Error('Platform bundle asset set is incomplete or unexpected')
  const record = JSON.parse(await readFile(join(directory, 'release-record.json'), 'utf8'))
  if (record.verification?.purpose === 'rehearsal' || record.verification?.deployable === false) throw new Error('Non-deployable verification cannot authorize publication')
  for (const key of ['platform', 'version', 'commit', 'target']) {
    if (record[key] !== identity[key] || record.verification?.[key] !== identity[key]) throw new Error(`Release record mismatch: ${key}`)
  }
  if (record.tag !== identity.tag) throw new Error('Release record tag mismatch')
  if (record.channel !== channel || (record.verification?.channel ?? 'stable') !== channel) throw new Error('Release record channel mismatch')
  if (record.verification?.verified !== true) throw new Error('Unverified release build')
  const manifest = validatePlatformManifest(identity.platform, JSON.parse(await readFile(join(directory, `update-${manifestTarget(identity.platform)}.json`), 'utf8')), identity.bridgeVersion, channel)
  if ((identity.platform === 'android' ? manifest.versionName : manifest.version) !== identity.version) throw new Error('Release manifest version mismatch')
  if (manifest.tag !== identity.tag || manifest.commit !== identity.commit) throw new Error('Manifest source mismatch')
  if (identity.platform === 'android') {
    if (manifest.versionCode !== identity.versionCode || !isArtifactUrl(manifest.apkUrl, identity.tag, androidArtifactName(identity.version, channel), true)) throw new Error('Android release identity mismatch')
    if (record.verification.checks?.signingSha256 !== identity.androidSigningSha256 ||
        record.verification.checks?.signedSha256 !== manifest.sha256 || record.verification.checks?.signedSize !== manifest.size) throw new Error('Android signing verification does not match the published APK')
  } else if (manifest.buildNumber !== identity.information.buildNumber || manifest.nativeBuildVersion !== identity.information.nativeBuildVersion) throw new Error('Desktop manifest identity mismatch')
  const artifacts = identity.platform === 'android' ? [{ url: manifest.apkUrl, size: manifest.size, sha256: manifest.sha256 }] : Object.values(manifest.artifacts)
  if (artifacts.length !== platformAssets.length) throw new Error('Release manifest is missing an installer')
  for (const artifact of artifacts) {
    const bytes = await readFile(join(directory, new URL(artifact.url).pathname.split('/').at(-1)))
    if (bytes.length !== artifact.size || sha256(bytes) !== artifact.sha256) throw new Error('Manifest artifact hash or size mismatch')
  }
  return { identity, directory, names, record, manifest }
}

async function verifyPublicationBaselines(bundles, client) {
  const { api, json, publicJson, paginate } = client
  const source = bundles[0].identity
  const channel = source.channel ?? 'stable'
  const prerelease = channel === 'alpha'
  const remote = await json(`${api}/commits/${encodeURIComponent(source.tag)}`)
  if (remote?.sha !== source.commit) throw new Error('Remote release tag commit differs from verified build')
  const releases = await paginate('/releases')
  for (const { identity, manifest } of bundles) {
    const baseline = await publicJson(`${UPDATE_ORIGIN}/${channel}/${manifestTarget(identity.platform)}.json`, prerelease || identity.platform !== 'android')
    if (baseline) assertPromotion(identity.platform, validatePlatformManifest(identity.platform, baseline, identity.bridgeVersion, channel), manifest)
    else if (!prerelease && identity.platform !== 'android') {
      const legacy = await publicJson(`${UPDATE_ORIGIN}/stable/desktop.json`, true)
      if (legacy && (legacy.schemaVersion !== 1 || compareChannelVersions(identity.version, assertStableVersion(legacy.version), 'stable') <= 0)) throw new Error('Desktop version must exceed the legacy publication baseline')
    }
    if (identity.platform === 'android') {
      for (const repository of ['C1ouDreamW/qlu-toolbox', 'C1ouDreamW/lumatile']) {
        const backup = await publicJson(`https://raw.githubusercontent.com/${repository}/main/updates/${prerelease ? 'android-alpha.json' : 'android.json'}`, true)
        if (backup) assertPromotion('android', validatePlatformManifest('android', backup, null, channel), manifest)
      }
    }
    for (const release of releases) {
      if (release.draft !== false || release.prerelease !== prerelease || release.tag_name === identity.tag) continue
      const version = identity.platform === 'android' ? androidTagVersion(release.tag_name, channel)
        : desktopTagVersion(release.tag_name, targetFor(identity.platform), identity.bridgeVersion, channel)
      if (!version) continue
      const name = `update-${identity.target}.json`
      const asset = release.assets?.find(item => item.name === name)
      if (!prerelease && release.tag_name === `v${version}` && !asset && !release.assets?.some(item => item.name === 'release-record.json')) {
        if (compareChannelVersions(identity.version, version, channel) <= 0) throw new Error('A newer or equal legacy version is already public')
        continue
      }
      if (compareChannelVersions(identity.version, version, channel) <= 0) throw new Error('A newer or equal platform version is already public')
      if (!asset || !isArtifactUrl(asset.browser_download_url, release.tag_name, name, true)) throw new Error(`Published ${identity.platform} release lacks its manifest`)
      const prior = validatePlatformManifest(identity.platform, await publicJson(asset.browser_download_url), identity.bridgeVersion, channel)
      const priorTag = identity.platform === 'android' ? prior.tag ?? androidReleaseTag(prior.versionName, channel) : prior.tag
      if (priorTag !== release.tag_name || (prior.versionName ?? prior.version) !== version) throw new Error('Published manifest identity mismatch')
      assertPromotion(identity.platform, prior, manifest)
    }
  }
}

// Historical platform bundles remain independently inspectable for publication checks.
export async function publishPlatformRelease({ identity, directory, token, fetcher = fetch }) {
  if (identity.tag === `v${identity.version}`) throw new Error('Shared tags must be published with all platform bundles')
  const bundle = await inspectPlatformBundle(identity, directory)
  const client = githubReleaseClient({ token, fetcher })
  return publishVerifiedDraft({ identity, directory, names: bundle.names, prerelease: identity.channel === 'alpha',
    title: `LumaTile for ${identity.platform === 'macos' ? 'macOS' : identity.platform === 'windows' ? 'Windows' : 'Android'} ${identity.version}`,
    body: identity.notes, beforePublish: () => verifyPublicationBaselines([bundle], client), client })
}

export async function publishRelease({ inputs, token, fetcher = fetch }) {
  const client = githubReleaseClient({ token, fetcher })
  const platforms = Object.keys(RELEASE_TARGETS)
  const identity = inputs[0]?.identity
  if (!identity || identity.tag !== `v${identity.version}` || inputs.length !== platforms.length ||
      !platforms.every(platform => inputs.some(input => input.identity.platform === platform)) ||
      !inputs.every(({ identity: current }) => ['tag', 'version', 'commit', 'channel'].every(key => current[key] === identity[key]))) {
    throw new Error('A shared release needs Windows, macOS and Android from the same tagged commit and channel')
  }
  const bundles = await Promise.all(platforms.map(platform => {
    const input = inputs.find(({ identity }) => identity.platform === platform)
    return inspectPlatformBundle(input.identity, input.directory)
  }))
  const directory = await mkdtemp(join(tmpdir(), 'lumatile-release-'))
  try {
    const names = new Set()
    const records = {}
    const notes = []
    const platformNames = { windows: 'Windows x64', macos: 'macOS arm64', android: 'Android' }
    for (const bundle of bundles) {
      const { platform } = bundle.identity
      records[platform] = bundle.record
      notes.push(`## ${platformNames[platform]}\n\n${bundle.identity.notes}`)
      for (const name of bundle.names) {
        if (['SHA256SUMS.txt', 'release-record.json', 'release-notes.md'].includes(name)) continue
        if (names.has(name)) throw new Error(`Duplicate release asset: ${name}`)
        await copyFile(join(bundle.directory, name), join(directory, name))
        names.add(name)
      }
    }
    const body = notes.join('\n\n')
    await writeFile(join(directory, 'release-notes.md'), `${body}\n`)
    await writeFile(join(directory, 'release-record.json'), `${JSON.stringify({
      schemaVersion: 2, tag: identity.tag, version: identity.version, commit: identity.commit, channel: identity.channel, platforms: records,
    }, null, 2)}\n`)
    names.add('release-notes.md').add('release-record.json')
    const sums = []
    for (const name of [...names].sort()) sums.push(`${sha256(await readFile(join(directory, name)))}  ${name}`)
    await writeFile(join(directory, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`)
    const prerelease = identity.channel === 'alpha'
    return await publishVerifiedDraft({ identity, directory, names: [...names, 'SHA256SUMS.txt'], prerelease, makeLatest: !prerelease,
      title: `LumaTile ${identity.tag}`, body, beforePublish: () => verifyPublicationBaselines(bundles, client), client })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [tag, bundleRoot] = process.argv.slice(2)
  if (!tag || !bundleRoot) throw new Error('Usage: node scripts/publish-release.mjs <tag> <platform-bundles-directory>')
  if (process.env.GITHUB_REPOSITORY !== GITHUB_REPOSITORY) throw new Error('Unexpected publication repository')
  const inputs = Object.keys(RELEASE_TARGETS).map(platform => {
    const identity = taggedRelease(repositoryRoot, platform, tag)
    assertReleaseSource(repositoryRoot, identity, releaseRunContext(), process.env.RELEASE_EXPECTED_COMMIT || identity.commit)
    return { identity, directory: resolve(bundleRoot, platform, 'releases', tag) }
  })
  console.log(JSON.stringify(await publishRelease({ inputs, token: process.env.GITHUB_TOKEN })))
}
