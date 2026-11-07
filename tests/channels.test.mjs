import assert from 'node:assert/strict'
import test from 'node:test'
import { assertChannelVersion, buildInformation, channelIdentity, compareChannelVersions, validateBuildInformation } from '../electron/channel-contract.mjs'
import { releaseVersion, resolveRelease, validateReleaseConfig } from '../scripts/release-config.mjs'

function versions() {
  return { schemaVersion: 2,
    windows: { stable: { version: '2.0.5', buildNumber: 1 }, alpha: { version: '2.1.0-alpha.2', buildNumber: 2 } },
    macos: { stable: { version: '2.0.6', buildNumber: 3 }, alpha: { version: '2.1.0-alpha.10', buildNumber: 10 } },
    android: { stable: { version: '2.0.7', versionCode: 16 }, alpha: { version: '2.1.0-alpha.1', versionCode: 1 } } }
}

test('schema 2 resolves each platform and channel independently with Debug derived from Alpha', () => {
  const config = versions()
  assert.equal(resolveRelease(config, { platform: 'windows', channel: 'alpha' }).tag, 'win-alpha-v2.1.0-alpha.2')
  assert.equal(resolveRelease(config, { platform: 'macos', channel: 'stable' }).version, '2.0.6')
  assert.equal(resolveRelease(config, { platform: 'android', channel: 'alpha' }).versionCode, 1)
  assert.equal(resolveRelease(config, { platform: 'android', channel: 'stable' }).versionCode, 16)
  const debug = resolveRelease(config, { platform: 'windows', channel: 'debug' })
  assert.equal(debug.version, '2.1.0-debug.0')
  assert.equal(debug.tag, undefined)
  assert.throws(() => resolveRelease(config, { platform: 'windows', channel: 'debug', tag: 'win-v2.1.0' }))
  assert.throws(() => resolveRelease(config, { platform: 'android', channel: 'stable', tag: 'android-alpha-v2.1.0-alpha.1' }))
})

test('strict Alpha and Debug versions cannot enter another channel', () => {
  assert.equal(assertChannelVersion('2.1.0-alpha.1', 'alpha'), '2.1.0-alpha.1')
  assert.equal(assertChannelVersion('2.1.0-debug.0', 'debug'), '2.1.0-debug.0')
  for (const value of ['2.1.0', 'v2.1.0-alpha.1', '2.1.0-beta.1', '2.1.0-alpha.0', '2.1.0-alpha.01', '02.1.0-alpha.1',
    '2.1.0-alpha.1+metadata', '2.1.0-alpha.1\n', '2.1.0-alpha.9007199254740992', '2.1.0-debug.0']) {
    assert.throws(() => assertChannelVersion(value, 'alpha'))
  }
  assert.throws(() => assertChannelVersion('2.1.0-alpha.1', 'stable'))
  assert.equal(compareChannelVersions('2.1.0-alpha.10', '2.1.0-alpha.2', 'alpha'), 1)
  assert.equal(compareChannelVersions('2.2.0-alpha.1', '2.1.0-alpha.99', 'alpha'), 1)
  assert.equal(compareChannelVersions('2.1.0-alpha.2', '2.1.0-alpha.2', 'alpha'), 0)
})

test('native build and Android code ranges are validated per channel', () => {
  for (const [platform, channel, field, value] of [
    ['android', 'alpha', 'versionCode', 0], ['android', 'stable', 'versionCode', 2100000001],
    ['windows', 'alpha', 'buildNumber', 65536], ['macos', 'alpha', 'buildNumber', 0],
    ['windows', 'stable', 'version', '65536.0.0'], ['macos', 'alpha', 'version', '2.1.0'],
  ]) {
    const config = versions()
    config[platform][channel][field] = value
    assert.throws(() => validateReleaseConfig(config))
  }
  const config = versions()
  delete config.android.alpha
  assert.throws(() => validateReleaseConfig(config))
})

test('application identities and private-data namespaces are distinct and Stable is preserved', () => {
  for (const platform of ['windows', 'macos', 'android']) {
    const stable = channelIdentity('stable', platform)
    const alpha = channelIdentity('alpha', platform)
    const debug = channelIdentity('debug', platform)
    assert.equal(new Set([stable.applicationId, alpha.applicationId, debug.applicationId]).size, 3)
    assert.equal(new Set([stable.dataNamespace, alpha.dataNamespace, debug.dataNamespace]).size, 3)
    assert.equal(stable.dataNamespace, 'QLUToolbox')
    assert.equal(stable.applicationId, platform === 'android' ? 'io.github.c1oudreamw.lumatile' : 'student.qlu.toolbox')
    assert.equal(debug.updatesEnabled, false)
    assert.equal(debug.telemetryEnabled, false)
    assert.equal(alpha.telemetryEnabled, false)
  }
  assert.throws(() => channelIdentity('beta', 'android'))
})

test('historical schema 1 tags remain readable while Alpha requires schema 2', () => {
  const config = { schemaVersion: 1, windows: { version: '2.0.4' }, macos: { version: '2.0.4' }, android: { version: '2.0.4', versionCode: 15 } }
  assert.equal(releaseVersion(config, 'android').versionCode, 15)
  assert.equal(resolveRelease(config, { platform: 'windows', channel: 'debug' }).version, '2.0.4-debug.0')
  assert.throws(() => releaseVersion(config, 'android', 'alpha'), /no Alpha/)
})

test('generated build information binds channel, native versions, source and immutable data policy', () => {
  const info = buildInformation(resolveRelease(versions(), { platform: 'macos', channel: 'alpha' }), 'a'.repeat(40))
  assert.equal(info.version, '2.1.0-alpha.10')
  assert.equal(info.baseVersion, '2.1.0')
  assert.equal(info.nativeBuildVersion, '10')
  assert.deepEqual(validateBuildInformation(info), info)
  for (const change of [{ applicationId: 'student.qlu.toolbox' }, { dataNamespace: 'QLUToolbox' }, { channel: 'stable' },
    { telemetryEnabled: true }, { nativeBuildVersion: '9' }, { commit: 'main' }, { target: 'windows-x64' }]) {
    assert.throws(() => validateBuildInformation({ ...info, ...change }))
  }
  const windows = buildInformation(resolveRelease(versions(), { platform: 'windows', channel: 'debug' }))
  assert.equal(windows.nativeBuildVersion, '2.1.0.2')
  assert.equal(windows.updatesEnabled, false)
})
