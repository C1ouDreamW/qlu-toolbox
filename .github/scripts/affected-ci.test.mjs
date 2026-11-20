import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix } from 'node:path'
import test from 'node:test'
import yaml from 'js-yaml'
import { affectedChecks, changedPaths } from './affected-ci.mjs'

const selected = paths => Object.entries(affectedChecks(paths))
  .filter(([, enabled]) => enabled)
  .map(([name]) => name)

test('selects only the affected client and infrastructure checks', () => {
  for (const [paths, expected] of [
    [['backend/portal/views.py'], []],
    [['frontend/website/public/downloads.mjs'], []],
    [['frontend/console/public/app.mjs'], []],
    [['backend/tests/test_feedback_server.py', 'deploy/server/compose.yaml'], []],
    [['apps/desktop/src/App.vue'], ['windows', 'macos']],
    [['apps/desktop/scripts/build.bat'], ['windows']],
    [['apps/desktop/installer-assets/entitlements.mac.plist'], ['macos']],
    [['apps/mobile/src/App.vue'], ['android']],
    [['apps/mobile/android/app/build.gradle', 'backend/jobs.py'], ['android']],
    [['packages/school-web/qlu-schedule-dom.js'], ['windows', 'macos', 'android']],
    [['packages/release-contract/update-contract.mjs'], ['windows', 'macos', 'android', 'release']],
    [['package-lock.json'], ['windows', 'macos', 'android', 'release']],
    [['uv.lock'], ['windows', 'macos']],
    [['scripts/build-mobile.ps1'], ['android', 'workflows']],
    [['scripts/detach-dmg.sh'], ['macos']],
    [['tests/release-pipeline.test.mjs'], ['release']],
    [['deploy/server/promote-android.sh'], ['workflows']],
    [['.github/workflows/website.yml'], ['workflows', 'release']],
    [['deploy/update-source/nginx.conf'], ['legacy']],
    [['docs/releasing.md', 'apps/mobile/README.md', 'tools/logo-animation/src/index.ts'], []],
  ]) {
    assert.deepEqual(selected(paths), expected, paths.join(', '))
  }
})

test('scopes main pushes and keeps the PR jobs available as status checks', () => {
  const workflow = yaml.load(readFileSync(new URL('../workflows/ci.yml', import.meta.url), 'utf8'))
  assert.deepEqual(workflow.on.push.branches, ['main'])
  assert.equal(workflow.on.pull_request, null)
  const gates = {
    'verify-windows': 'windows', 'verify-macos': 'macos', 'verify-android': 'android',
    'verify-workflows': 'workflows', 'verify-release-tools': 'release', 'verify-legacy-update-source': 'legacy',
  }
  for (const [job, check] of Object.entries(gates)) {
    assert.equal(workflow.jobs[job].needs, 'changes')
    assert.equal(workflow.jobs[job].if, `\${{ !cancelled() && (needs.changes.result != 'success' || needs.changes.outputs.${check} == 'true') }}`)
    assert.ok(workflow.jobs.changes.outputs[check])
  }
  const triggers = path => workflow.on.push.paths.reduce((included, pattern) => {
    const exclude = pattern.startsWith('!')
    return posix.matchesGlob(path, exclude ? pattern.slice(1) : pattern) ? !exclude : included
  }, false)
  for (const path of ['apps/desktop/src/App.vue', 'apps/mobile/src/App.vue', 'deploy/server/promote-android.sh', '.github/workflows/ci.yml']) {
    assert.ok(triggers(path), path)
  }
  for (const path of ['backend/jobs.py', 'frontend/website/public/index.html', 'frontend/console/public/index.html', 'deploy/server/compose.yaml', 'scripts/publish_announcement.py', 'README.md']) {
    assert.ok(!triggers(path), path)
  }
})

test('uses the whole push range, the PR merge base, and both paths of a rename', t => {
  const root = mkdtempSync(join(tmpdir(), 'lumatile-ci-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const commit = message => {
    git('add', '--all')
    git('-c', 'user.name=CI Test', '-c', 'user.email=ci@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', message)
    return git('rev-parse', 'HEAD')
  }
  git('init', '-qb', 'main')
  mkdirSync(join(root, 'apps/desktop'), { recursive: true })
  mkdirSync(join(root, 'apps/mobile'), { recursive: true })
  mkdirSync(join(root, 'backend'), { recursive: true })
  writeFileSync(join(root, 'apps/desktop/shared.txt'), 'move me')
  const base = commit('base')
  git('checkout', '-qb', 'feature')
  renameSync(join(root, 'apps/desktop/shared.txt'), join(root, 'apps/mobile/shared.txt'))
  commit('move')
  writeFileSync(join(root, 'README.md'), 'unrelated docs')
  const head = commit('docs')
  git('checkout', '-q', 'main')
  mkdirSync(join(root, 'backend'), { recursive: true })
  writeFileSync(join(root, 'backend/jobs.py'), 'new base change')
  const updatedBase = commit('base changed')
  const expected = ['README.md', 'apps/desktop/shared.txt', 'apps/mobile/shared.txt']
  assert.deepEqual(changedPaths('push', { before: base, after: head }, root).sort(), expected)
  assert.deepEqual(changedPaths('pull_request', { pull_request: {
    base: { sha: updatedBase }, head: { sha: head },
  } }, root).sort(), expected)
  assert.deepEqual(selected(expected), ['windows', 'macos', 'android'])
  const all = ['windows', 'macos', 'android', 'workflows', 'release', 'legacy']
  assert.deepEqual(selected(changedPaths('workflow_dispatch', {}, root)), all)
  assert.deepEqual(selected(changedPaths('push', { before: '0'.repeat(40), after: head }, root)), all)
})
