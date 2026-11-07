import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { assertStableVersion, isArtifactUrl } from '../electron/update-contract.mjs'

const [apkPathArg, outputPathArg, versionCodeArg, versionName, repository, tag, notesPathArg, downloadBaseUrl] = process.argv.slice(2)
if (![apkPathArg, outputPathArg, versionCodeArg, versionName, repository, tag, notesPathArg].every(Boolean)) {
  throw new Error('Usage: node scripts/generate-android-update-manifest.mjs <apk> <output> <versionCode> <versionName> <owner/repo> <tag> <notes> [downloadBaseUrl]')
}

const versionCode = Number(versionCodeArg)
if (!Number.isSafeInteger(versionCode) || versionCode <= 0 || versionCode > 2100000000) throw new Error('versionCode must be a valid Android integer')
assertStableVersion(versionName)
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('repository must use owner/name format')
if (tag !== `android-v${versionName}` && tag !== `v${versionName}`) throw new Error('Android tag does not match versionName')

const apkPath = resolve(apkPathArg)
const outputPath = resolve(outputPathArg)
const apk = await readFile(apkPath)
const details = await stat(apkPath)
const fileName = apkPath.replaceAll('\\', '/').split('/').at(-1)
if (fileName !== `LumaTile-Android-v${versionName}.apk` || details.size <= 0) throw new Error('APK filename or size does not match release')
const sha256 = createHash('sha256').update(apk).digest('hex')
// 旧发布入口使用历史日志，新入口使用 Android 平台日志；多源复用同一 APK。
const notes = (await readFile(resolve(notesPathArg), 'utf8')).trim()
if (!notes) throw new Error('Empty Android release notes')
const apkUrl = downloadBaseUrl
  ? `${downloadBaseUrl.replace(/\/$/, '')}/${fileName}`
  : `https://github.com/${repository}/releases/download/${tag}/${fileName}`
if (!isArtifactUrl(apkUrl, tag, fileName)) throw new Error('Untrusted APK download URL')
const manifest = {
  schemaVersion: 1,
  applicationId: 'io.github.c1oudreamw.lumatile',
  versionCode,
  versionName,
  channel: 'stable',
  title: versionName.startsWith('1.') ? 'QLU 工具箱最终迁移版' : '一格有光版本更新',
  notes,
  publishedAt: new Date().toISOString(),
  apkUrl,
  sha256,
  size: details.size,
  mandatory: false,
}

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
console.log(`Wrote ${outputPath}`)
console.log(`SHA-256 ${sha256}`)
