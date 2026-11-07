import { execFileSync } from 'node:child_process'
import { isDeepStrictEqual } from 'node:util'
import { assertStableVersion, compareVersions, isPublicationDate, validateMigrationPolicy } from '../electron/update-contract.mjs'
import { buildInformation } from '../electron/channel-contract.mjs'
import { parseReleaseTag, resolveRelease, validateReleaseConfig } from './release-config.mjs'
import { replacePythonVersion } from './set-python-version.mjs'

export function promotionEvidencePath(platform, version) {
  if (!['windows', 'macos', 'android'].includes(platform)) throw new Error('Invalid promotion platform')
  return `config/promotions/${platform}-${assertStableVersion(version)}.json`
}

const text = value => typeof value === 'string' && value.trim().length > 0
function gitReader(root) {
  const raw = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
  const git = args => raw(args).trimEnd()
  git.file = (ref, path) => raw(['show', `${ref}:${path}`])
  return git
}
function omitPath(value, path) {
  const parts = path.split('.')
  let current = value
  for (const part of parts.slice(0, -1)) {
    if (!current || typeof current !== 'object') return
    current = current[part]
  }
  if (current && typeof current === 'object') delete current[parts.at(-1)]
}
function getPath(value, path) { return path.split('.').reduce((item, key) => item?.[key], value) }

// Only a precise new generated value can be ignored; never ignore entire build/dependency objects.
function generatedPackage(before, after, information) {
  const expected = {
    version: information.version,
    'build.appId': information.applicationId, 'build.productName': information.productName,
    'build.buildVersion': information.nativeBuildVersion,
    'build.win.executableName': information.productName, 'build.mac.executableName': information.productName,
    'build.win.artifactName': 'LumaTile_v${version}_${arch}.${ext}',
    'build.nsis.artifactName': 'LumaTile_v${version}_${arch}_Setup.${ext}',
    'build.mac.artifactName': 'LumaTile_v${version}_${arch}.${ext}',
    'build.dmg.artifactName': 'LumaTile_v${version}_${arch}.${ext}',
    'build.dmg.title': 'LumaTile ${version}', 'build.nsis.shortcutName': information.productName,
    'build.mac.bundleVersion': information.nativeBuildVersion,
    'build.mac.extendInfo.CFBundleShortVersionString': information.baseVersion,
  }
  for (const [path, value] of Object.entries(expected)) {
    if (!isDeepStrictEqual(getPath(before, path), getPath(after, path)) && getPath(after, path) !== value) return false
    omitPath(before, path); omitPath(after, path)
  }
  for (const item of [before, after]) {
    if (Array.isArray(item.build?.files)) item.build.files = item.build.files.filter(file => file !== 'lumatile/build-info.json')
    // Preparing missing extendInfo may create an otherwise empty generated container.
    if (item.build?.mac?.extendInfo && Object.keys(item.build.mac.extendInfo).length === 0) delete item.build.mac.extendInfo
  }
  return isDeepStrictEqual(before, after)
}

function metadataOnly(path, before, after, identity, versions) {
  if (path === `changelogs/${identity.platform}.md` || path === 'CHANGELOG.md' || (identity.purpose === 'bridge' && ['changelogs/windows.md', 'changelogs/macos.md'].includes(path))) return true
  if (path === 'lumatile/__init__.py' && identity.platform !== 'android') return replacePythonVersion(before, identity.version) === after
  const a = JSON.parse(before), b = JSON.parse(after)
  if (path === 'config/release-versions.json') {
    validateReleaseConfig(a); validateReleaseConfig(b)
    if (a.schemaVersion !== 2 || b.schemaVersion !== 2) return false
    // Another platform/channel may advance its version while this Alpha is under observation.
    // Ignore only declared version counters; retain every other configuration field.
    for (const platform of ['windows', 'macos', 'android']) {
      for (const channel of ['stable', 'alpha']) {
        for (const key of ['version', platform === 'android' ? 'versionCode' : 'buildNumber']) {
          delete a[platform][channel][key]; delete b[platform][channel][key]
        }
      }
    }
    return isDeepStrictEqual(a, b)
  }
  if (path === 'config/release-migration.json') {
    validateMigrationPolicy(a); validateMigrationPolicy(b)
    for (const key of ['independentPublishingEnabled', 'bridgeVersion', ...(identity.purpose === 'bridge' ? ['desktopBridgePublishingEnabled'] : [])]) { delete a[key]; delete b[key] }
    return isDeepStrictEqual(a, b)
  }
  if (path === 'package.json' && identity.platform !== 'android') return generatedPackage(a, b, buildInformation(resolveRelease(versions, { platform: identity.platform, channel: 'stable' })))
  if (path === 'apps/mobile/package.json' && identity.platform === 'android') {
    if (b.version !== identity.version) return false
    delete a.version; delete b.version
    return isDeepStrictEqual(a, b)
  }
  if (path === 'package-lock.json') {
    if (identity.platform === 'android') {
      if (b.packages?.['apps/mobile']?.version !== identity.version) return false
      delete a.packages['apps/mobile'].version; delete b.packages['apps/mobile'].version
    } else {
      if (b.version !== identity.version || b.packages?.['']?.version !== identity.version) return false
      delete a.version; delete b.version; delete a.packages[''].version; delete b.packages[''].version
    }
    return isDeepStrictEqual(a, b)
  }
  return false
}

export function validateStablePromotion(root, identity) {
  if (identity.channel !== 'stable') throw new Error('Only Stable builds use promotion evidence')
  const git = gitReader(root)
  const commit = identity.commit
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Promotion requires a full Stable commit')
  const path = promotionEvidencePath(identity.platform, identity.version)
  let evidence
  try { evidence = JSON.parse(git(['show', `${commit}:${path}`])) } catch { throw new Error(`Missing or invalid Stable promotion evidence: ${path}`) }
  const { alpha, review } = evidence
  if (evidence.schemaVersion !== 1 || !['alpha', 'emergency'].includes(evidence.mode) || evidence.platform !== identity.platform ||
      evidence.stableVersion !== identity.version || !alpha || !/^[a-f0-9]{40}$/.test(alpha.commit) ||
      !review || !text(review.approvedBy) || !isPublicationDate(review.approvedAt) || !text(review.summary) ||
      !Array.isArray(review.tests) || !review.tests.length || review.tests.some(item => !text(item.name) || item.result !== 'passed' || !text(item.evidence))) {
    throw new Error('Invalid Stable promotion review or source identity')
  }
  const parsed = parseReleaseTag(identity.platform, alpha.tag)
  if (parsed.channel !== 'alpha' || git(['rev-parse', '--verify', `refs/tags/${alpha.tag}^{commit}`]) !== alpha.commit) throw new Error('Promotion Alpha tag does not match its recorded commit')
  try { git(['merge-base', '--is-ancestor', alpha.commit, commit]) } catch { throw new Error('Tested Alpha must be an ancestor of the Stable source') }
  const versions = validateReleaseConfig(JSON.parse(git(['show', `${commit}:config/release-versions.json`])))
  if (resolveRelease(versions, { platform: identity.platform, channel: 'stable', tag: identity.tag }).version !== identity.version) throw new Error('Stable promotion version differs from its source config')
  const alphaVersions = validateReleaseConfig(JSON.parse(git(['show', `${alpha.commit}:config/release-versions.json`])))
  const tested = resolveRelease(alphaVersions, { platform: identity.platform, channel: 'alpha', tag: alpha.tag })
  const alphaBase = tested.version.split('-')[0]
  if ((evidence.mode === 'alpha' && alphaBase !== identity.version) || compareVersions(alphaBase, identity.version) > 0) throw new Error('Stable version does not match the tested Alpha base')
  const stableTime = Date.parse(git(['show', '-s', '--format=%cI', commit]))
  const sourceTime = Date.parse(git(['show', '-s', '--format=%cI', alpha.commit]))
  if (!isPublicationDate(review.observationStartedAt) || !isPublicationDate(review.observationEndedAt) ||
      Date.parse(review.observationStartedAt) < sourceTime || Date.parse(review.observationEndedAt) < Date.parse(review.observationStartedAt) ||
      Date.parse(review.approvedAt) < Date.parse(review.observationEndedAt) || Date.parse(review.approvedAt) > stableTime) throw new Error('Promotion observation and approval timeline is invalid')
  const changedPaths = git(['diff', '--name-only', '-z', '--no-renames', alpha.commit, commit]).split('\0').filter(Boolean).sort()
  const metadataPaths = new Set([path, 'config/release-versions.json', 'config/release-migration.json', 'package-lock.json', 'CHANGELOG.md', `changelogs/${identity.platform}.md`,
    ...(identity.platform === 'android' ? ['apps/mobile/package.json'] : ['package.json', 'lumatile/__init__.py'])])
  const peerReview = identity.purpose === 'bridge' ? promotionEvidencePath(identity.platform === 'windows' ? 'macos' : 'windows', identity.version) : null
  if (peerReview) { metadataPaths.add(peerReview); metadataPaths.add('changelogs/windows.md'); metadataPaths.add('changelogs/macos.md') }
  const untested = []
  for (const file of changedPaths) {
    const previousEntry = git(['ls-tree', alpha.commit, '--', file])
    const nextEntry = git(['ls-tree', commit, '--', file])
    if (!nextEntry.startsWith('100644 blob ') || (previousEntry && !previousEntry.startsWith('100644 blob '))) { untested.push(file); continue }
    if (file === path) continue
    // The bridge validates both complete reviews separately; neither review is business code.
    if (file === peerReview) continue
    if (!metadataPaths.has(file)) { untested.push(file); continue }
    try {
      const before = previousEntry ? git.file(alpha.commit, file) : ''
      const after = git.file(commit, file)
      if (!metadataOnly(file, before, after, identity, versions)) untested.push(file)
    } catch { untested.push(file) }
  }
  if (evidence.mode === 'alpha' && untested.length) throw new Error(`Business, dependency or build changes require another Alpha: ${untested.join(', ')}`)
  if (evidence.mode === 'emergency') {
    const emergency = evidence.emergency
    if (!emergency || !text(emergency.reason) || !Array.isArray(emergency.approvedChangedPaths) ||
        !isDeepStrictEqual(emergency.approvedChangedPaths, untested)) throw new Error('Emergency review must explicitly approve the exact untested paths')
  } else if (evidence.emergency !== undefined) throw new Error('Emergency exceptions must use explicit emergency mode')
  return { ...evidence, stableCommit: commit, alphaVersion: tested.version, changedPaths, untestedPaths: untested }
}
