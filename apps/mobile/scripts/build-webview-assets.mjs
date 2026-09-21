import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transform } from 'esbuild'

const mobileDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryDir = resolve(mobileDir, '../..')
const compatibility = JSON.parse(await readFile(resolve(mobileDir, 'webview-compatibility.json'), 'utf8'))
const outputDir = resolve(process.argv[2] || resolve(mobileDir, 'android/app/build/generated/webviewAssets'))
const entries = [
  [resolve(repositoryDir, 'assets/qlu-schedule-dom.js'), 'qlu-schedule-dom.js'],
  [resolve(mobileDir, 'webview-scripts/credit-capture.js'), 'credit-capture.js'],
  [resolve(mobileDir, 'webview-scripts/credit-plan-observer.js'), 'credit-plan-observer.js'],
  [resolve(mobileDir, 'webview-scripts/schedule-export-interceptor.js'), 'schedule-export-interceptor.js'],
  [resolve(mobileDir, 'webview-scripts/grade-export.js'), 'grade-export.js'],
]
const unsupportedRuntimeApi = /\.(?:at|findLast|findLastIndex|toSorted|toReversed|toSpliced|replaceAll)\s*\(|\bPromise\.any\s*\(|\bObject\.(?:hasOwn|groupBy)\s*\(/

async function assertCompatibleSources(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) await assertCompatibleSources(path)
    else if (/\.(?:ts|vue)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) {
      if (unsupportedRuntimeApi.test(await readFile(path, 'utf8'))) {
        throw new Error(`${path} 使用了超出 ${compatibility.target} 基线的运行时 API`)
      }
    }
  }
}

await assertCompatibleSources(resolve(mobileDir, 'src'))
await assertCompatibleSources(resolve(repositoryDir, 'packages'))

await rm(outputDir, { recursive: true, force: true })
await mkdir(outputDir, { recursive: true })
for (const [input, name] of entries) {
  const source = await readFile(input, 'utf8')
  if (unsupportedRuntimeApi.test(source)) throw new Error(`${name} 使用了超出 ${compatibility.target} 基线的运行时 API`)
  const { code } = await transform(source, { loader: 'js', target: compatibility.target, legalComments: 'none' })
  await writeFile(resolve(outputDir, name), code)
}
