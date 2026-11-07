import { execFileSync } from 'node:child_process'
import { resolveRelease, validateReleaseConfig } from './release-config.mjs'
import { validateMigrationPolicy } from '../electron/update-contract.mjs'
import { buildInformation } from '../electron/channel-contract.mjs'

// CI reads the Debug identity from immutable HEAD without creating release tags.
export function rehearsalIdentity(root, platform) {
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  const commit = git(['rev-parse', 'HEAD'])
  const config = validateReleaseConfig(JSON.parse(git(['show', `${commit}:config/release-versions.json`])))
  const policy = JSON.parse(git(['show', `${commit}:config/release-migration.json`]))
  const { bridgeVersion } = validateMigrationPolicy(policy)
  if (platform === 'android' && !/^[a-f0-9]{64}$/.test(policy.androidSigningSha256)) throw new Error('The production certificate digest is required to reject production-signed rehearsals')
  const { tag: _tag, ...release } = resolveRelease(config, { platform, channel: 'debug' })
  const information = buildInformation(release, commit)
  return { ...release, commit, bridgeVersion, androidSigningSha256: policy.androidSigningSha256,
    information,
    ...(platform === 'android' ? { applicationId: information.applicationId, nativeVersionName: release.version, signing: 'debug' } : {}),
    purpose: 'rehearsal', deployable: false }
}
