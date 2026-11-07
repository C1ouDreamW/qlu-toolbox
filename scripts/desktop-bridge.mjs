import { execFileSync } from 'node:child_process'
import { buildInformation } from '../electron/channel-contract.mjs'
import { assertStableVersion, validateMigrationPolicy } from '../electron/update-contract.mjs'
import { extractReleaseNotes, resolveRelease, validateReleaseConfig } from './release-config.mjs'
import { assertReleaseSource, releaseRunContext } from './release-source.mjs'
import { validateStablePromotion } from './release-promotion.mjs'

// This is deliberately a separate identity factory: legacy combined publishing and
// independent per-platform tags must never accept the one-time desktop bridge tag.
export function desktopBridgeSource(root, tag) {
  if (typeof tag !== 'string' || !tag.startsWith('v')) throw new Error('Expected the exact legacy desktop bridge tag')
  const version = assertStableVersion(tag.slice(1))
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const commit = git(['rev-parse', '--verify', `refs/tags/${tag}^{commit}`])
  if (git(['rev-parse', 'HEAD']) !== commit) throw new Error('Bridge tag must match the checked-out commit')
  const policy = JSON.parse(git(['show', `${commit}:config/release-migration.json`]))
  const { bridgeVersion } = validateMigrationPolicy(policy)
  if (bridgeVersion !== version || policy.desktopBridgePublishingEnabled !== true || policy.desktopMigrationComplete === true) throw new Error('Desktop bridge publication is disabled or its exact reserved version differs')
  const config = validateReleaseConfig(JSON.parse(git(['show', `${commit}:config/release-versions.json`])))
  if (config.schemaVersion !== 2) throw new Error('Desktop bridge requires explicit native build counters')
  return Object.fromEntries(['windows', 'macos'].map(platform => {
    const release = resolveRelease(config, { platform, channel: 'stable' })
    if (release.version !== version) throw new Error('Both desktop Stable versions must match the bridge; Android remains independent')
    return [platform, { ...release, releaseTag: release.tag, tag, commit, purpose: 'bridge', deployable: true, bridgeVersion,
      information: buildInformation(release, commit), notes: extractReleaseNotes(git(['show', `${commit}:changelogs/${platform}.md`]), version),
      publishedAt: new Date(git(['show', '-s', '--format=%cI', commit])).toISOString() }]
  }))
}

export function taggedDesktopBridge(root, tag, context = releaseRunContext(), expectedCommit) {
  const identities = desktopBridgeSource(root, tag)
  // Reuse the complete tag / workflow / main ancestry checks before accepting reviews.
  for (const identity of Object.values(identities)) {
    assertReleaseSource(root, identity, context, expectedCommit ?? identity.commit)
    identity.promotion = validateStablePromotion(root, { ...identity, tag: identity.releaseTag })
  }
  return identities
}
