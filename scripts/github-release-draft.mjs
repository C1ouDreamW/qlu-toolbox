import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { GITHUB_REPOSITORY } from '../electron/update-contract.mjs'

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

export function githubReleaseClient({ token, fetcher = fetch }) {
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
  return { api, request, json, publicJson, paginate }
}

export async function publishVerifiedDraft({ identity, directory, names, prerelease, title, body, beforePublish, client }) {
  const { api, request, json, paginate } = client
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
  let release = await json(`${api}/releases/tags/${encodeURIComponent(identity.tag)}`, undefined, true)
  if (release && release.tag_name !== identity.tag) throw new Error('GitHub returned a different release tag')
  if (release && release.prerelease !== prerelease) throw new Error('Release prerelease flag does not match its channel')
  if (release && !release.draft) {
    if ((await json(`${api}/commits/${encodeURIComponent(identity.tag)}`))?.sha !== identity.commit) throw new Error('Remote release tag commit differs from verified build')
    await verifyRemote(await assetsFor(release.id), true)
    return { status: 'already-published', tag: identity.tag }
  }
  await beforePublish()
  if (!release) {
    release = await json(`${api}/releases`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      tag_name: identity.tag, target_commitish: identity.commit, draft: true, prerelease, make_latest: 'false',
      name: title, body,
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
  await beforePublish()
  await json(`${api}/releases/${release.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft: false, make_latest: 'false' }) })
  return { status: 'published', tag: identity.tag }
}
