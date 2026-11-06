import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { assertStableVersion, readReleaseConfig } from './release-config.mjs'
import { validateMigrationPolicy } from '../electron/update-contract.mjs'
const tag = process.argv[2]
const root = fileURLToPath(new URL('../', import.meta.url))
const policy = JSON.parse(await readFile(new URL('../config/release-migration.json', import.meta.url), 'utf8'))
const { bridgeVersion } = validateMigrationPolicy(policy)
if (policy.independentPublishingEnabled === true) throw new Error('Legacy multi-platform publishing is disabled after the independent release cutover')
if (bridgeVersion !== null && tag === `v${bridgeVersion}`) throw new Error('The reserved desktop bridge tag must use the desktop-only bridge workflow')
const config = await readReleaseConfig(root)
for (const platform of ['windows', 'macos', 'android']) {
  assertStableVersion(config[platform].version)
  if (tag !== `v${config[platform].version}`) throw new Error(`Legacy tag does not match ${platform} version config`)
}
