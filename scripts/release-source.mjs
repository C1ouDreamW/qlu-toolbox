import { execFileSync } from 'node:child_process'
import { GITHUB_REPOSITORY } from '../electron/update-contract.mjs'

export function releaseRunContext(env = process.env) {
  return { repository: env.GITHUB_REPOSITORY, event: env.GITHUB_EVENT_NAME, ref: env.GITHUB_REF,
    sha: env.GITHUB_SHA, runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT }
}

export function assertReleaseRun(identity, context) {
  if (context.repository !== GITHUB_REPOSITORY || context.event !== 'push' || context.ref !== `refs/tags/${identity.tag}` ||
      !/^[a-f0-9]{40}$/.test(context.sha) || !/^[1-9]\d*$/.test(context.runId) || !/^[1-9]\d*$/.test(context.runAttempt)) {
    throw new Error('Release must originate from this repository and a platform tag push')
  }
}

export function assertReleaseSource(root, identity, context = releaseRunContext(), expectedCommit = identity.commit) {
  assertReleaseRun(identity, context)
  if (!/^[a-f0-9]{40}$/.test(expectedCommit) || expectedCommit !== identity.commit) throw new Error('Release commit differs from the validated build')
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  if (git(['rev-parse', 'HEAD']) !== identity.commit ||
      git(['rev-parse', '--verify', `refs/tags/${identity.tag}^{commit}`]) !== identity.commit ||
      git(['rev-parse', '--verify', `${context.sha}^{commit}`]) !== identity.commit) throw new Error('Release tag, workflow SHA and checkout must resolve to the validated commit')
  try {
    git(['merge-base', '--is-ancestor', identity.commit, 'refs/remotes/origin/main'])
  } catch {
    throw new Error('Release commit must already belong to origin/main')
  }
  return identity
}

export function assertCandidateRun(identity, context) {
  if (identity.purpose !== 'candidate' || identity.deployable !== false || identity.channel !== 'alpha' || identity.tag !== null ||
      context.repository !== GITHUB_REPOSITORY || context.event !== 'workflow_dispatch' || context.ref !== 'refs/heads/main' ||
      !/^[a-f0-9]{40}$/.test(context.sha) || context.sha !== identity.commit ||
      !/^[1-9]\d*$/.test(context.runId) || !/^[1-9]\d*$/.test(context.runAttempt)) throw new Error('Alpha candidates require a manual dispatch on this repository main')
}

export function assertCandidateSource(root, identity, context = releaseRunContext(), expectedCommit = identity.commit) {
  assertCandidateRun(identity, context)
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  if (expectedCommit !== identity.commit || git(['rev-parse', 'HEAD']) !== identity.commit ||
      git(['rev-parse', '--verify', 'refs/remotes/origin/main']) !== identity.commit) throw new Error('Candidate source must match the validated dispatch and current origin/main exactly')
  return identity
}
