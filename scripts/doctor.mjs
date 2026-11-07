#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: { platform: { type: 'string', default: 'desktop' }, json: { type: 'boolean' } } })
if (!['desktop', 'android', 'all'].includes(values.platform)) throw new Error('Usage: node scripts/doctor.mjs --platform desktop|android|all [--json]')
const root = fileURLToPath(new URL('../', import.meta.url))
const checks = []
function result(name, ok, detail, help, warning = false) {
  checks.push({ name, status: ok ? 'ok' : warning ? 'warning' : 'missing', detail, ...(!ok ? { help } : {}) })
}
function command(name, executable, args, matches, help) {
  const value = spawnSync(executable, args, { cwd: root, encoding: 'utf8', timeout: 15_000, shell: process.platform === 'win32' && executable.endsWith('.cmd') })
  const output = `${value.stdout ?? ''}\n${value.stderr ?? ''}`.trim()
  const ok = !value.error && value.status === 0 && matches(output)
  result(name, ok, ok ? output.split('\n')[0] : '未找到可用的兼容版本', help)
  return ok
}
function file(name, path, help) { result(name, existsSync(path), existsSync(path) ? '已找到' : '缺失', help) }
const nodeMajor = Number(process.versions.node.split('.')[0])
result('Node.js', nodeMajor >= 22, process.version, '安装 Node.js 22；CI 使用 22')
if (nodeMajor !== 22 && nodeMajor >= 22) result('与 CI 的 Node 版本一致', false, `本机 ${nodeMajor}，CI 22`, '遇到依赖或打包差异时先使用 Node.js 22 复现', true)
command('Git', 'git', ['--version'], value => value.startsWith('git version '), '安装 Git / Xcode Command Line Tools')
command('npm', process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--version'], value => /^\d+\./.test(value), '安装 Node.js 22 附带的 npm')
file('npm 锁定依赖', join(root, 'node_modules/typescript/package.json'), '在仓库根目录执行 npm ci')

if (values.platform !== 'android') {
  const supported = process.platform === 'darwin' && process.arch === 'arm64' || process.platform === 'win32' && process.arch === 'x64'
  result('桌面原生目标', supported, `${process.platform}/${process.arch}`, '使用 Windows x64 或原生 macOS arm64 的 Node/Python，退出 Rosetta；Linux 可开发 Android')
  command('uv', 'uv', ['--version'], value => value.startsWith('uv '), '安装 uv，再执行 uv sync --locked')
  const python = join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
  const code = 'import json, platform, sys; from importlib.metadata import version; print(json.dumps({"python":platform.python_version(),"arch":platform.machine(),"playwright":version("playwright"),"pyinstaller":version("pyinstaller")}))'
  command('Python 3.12 / Playwright / PyInstaller', python, ['-c', code], output => {
    try {
      const item = JSON.parse(output)
      const arch = item.arch.toLowerCase()
      return item.python.startsWith('3.12.') && (process.arch === 'arm64' ? arch === 'arm64' : ['amd64', 'x86_64'].includes(arch))
    } catch { return false }
  }, '执行 uv sync --locked；使用与目标一致架构的 Python 3.12')
  const electron = join(root, 'node_modules/electron/dist', process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron.exe')
  file('Electron 原生运行文件', electron, 'npm ci 后若安装脚本未执行，运行 node node_modules/electron/install.js；保留下载校验，勿用正式签名 key 修复开发环境')
}

if (values.platform !== 'desktop') {
  command('JDK 21', 'java', ['-version'], value => /(?:openjdk|java) version "21\./.test(value), '安装 JDK 21，设置 JAVA_HOME 并确认 java 使用该版本')
  let sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT
  const properties = join(root, 'apps/mobile/android/local.properties')
  if (!sdk && existsSync(properties)) sdk = readFileSync(properties, 'utf8').match(/^sdk\.dir=(.+)$/m)?.[1]?.replace(/\\([\\:=])/g, '$1').trim()
  if (!sdk) sdk = process.platform === 'darwin' ? join(homedir(), 'Library/Android/sdk') : process.platform === 'win32' ? join(process.env.LOCALAPPDATA || '', 'Android/Sdk') : join(homedir(), 'Android/Sdk')
  result('Android SDK 位置', existsSync(sdk), existsSync(sdk) ? '已找到' : '未找到', '安装 Android Studio SDK，并设置 ANDROID_HOME 或 apps/mobile/android/local.properties 的 sdk.dir')
  file('Android API 36', join(sdk, 'platforms/android-36/android.jar'), 'sdkmanager "platforms;android-36"')
  for (const tool of ['aapt', 'apksigner', 'zipalign']) {
    const extension = process.platform === 'win32' ? tool === 'apksigner' ? '.bat' : '.exe' : ''
    file(`Android build-tools 36.0.0 / ${tool}`, join(sdk, 'build-tools/36.0.0', tool + extension), 'sdkmanager "build-tools;36.0.0"')
  }
  file('adb', join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb'), 'sdkmanager "platform-tools"；安装验收另需设备 / 模拟器')
  file('Gradle Wrapper', join(root, 'apps/mobile/android/gradle/wrapper/gradle-wrapper.jar'), '检查完整源码 checkout；构建时由 wrapper 下载锁定工具链')
}
const missing = checks.filter(check => check.status === 'missing')
if (values.json) console.log(JSON.stringify({ schemaVersion: 1, platform: values.platform, ready: !missing.length, checks }, null, 2))
else {
  for (const check of checks) console.log(`${check.status === 'ok' ? '✓' : check.status === 'warning' ? '△' : '✗'} ${check.name}：${check.detail}${check.help ? `\n  → ${check.help}` : ''}`)
  console.log(`\n${missing.length ? `仍缺 ${missing.length} 项开发依赖` : '所选目标的基础开发依赖齐全'}。此检查不读取签名密钥，不代表设备或发布验收通过。`)
}
if (missing.length) process.exitCode = 1
