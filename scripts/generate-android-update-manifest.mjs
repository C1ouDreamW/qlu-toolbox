import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const [apkPathArg, outputPathArg, versionCodeArg, versionName, repository, tag] = process.argv.slice(2)
if (![apkPathArg, outputPathArg, versionCodeArg, versionName, repository, tag].every(Boolean)) {
  throw new Error('Usage: node scripts/generate-android-update-manifest.mjs <apk> <output> <versionCode> <versionName> <owner/repo> <tag>')
}

const versionCode = Number(versionCodeArg)
if (!Number.isSafeInteger(versionCode) || versionCode <= 0) throw new Error('versionCode must be a positive integer')
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('repository must use owner/name format')
if (!/^[A-Za-z0-9_.-]+$/.test(tag)) throw new Error('tag contains unsupported characters')

const apkPath = resolve(apkPathArg)
const outputPath = resolve(outputPathArg)
const apk = await readFile(apkPath)
const details = await stat(apkPath)
const fileName = apkPath.replaceAll('\\', '/').split('/').at(-1)
const sha256 = createHash('sha256').update(apk).digest('hex')
const manifest = {
  schemaVersion: 1,
  applicationId: 'io.github.c1oudreamw.lumatile',
  versionCode,
  versionName,
  channel: versionName.includes('-') ? 'beta' : 'stable',
  title: versionName.startsWith('1.') ? 'QLU 工具箱最终迁移版' : '一格有光版本更新',
  notes: versionName.startsWith('1.')
    ? '本版本完成 Android 应用身份、正式签名和双更新渠道迁移。后续版本将更名为一格有光 / LumaTile。'
    : '发现一格有光 / LumaTile 新版本，请安装更新。',
  publishedAt: new Date().toISOString(),
  apkUrl: `https://github.com/${repository}/releases/download/${tag}/${fileName}`,
  sha256,
  size: details.size,
  mandatory: false,
}

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
console.log(`Wrote ${outputPath}`)
console.log(`SHA-256 ${sha256}`)
