import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const root = fileURLToPath(new URL('../', import.meta.url))

function loadElectronModule(file, mocks, processStub) {
  const source = readFileSync(path.join(root, file), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  })
  const exports = {}
  runInNewContext(outputText, {
    exports,
    require(name) {
      if (!(name in mocks)) throw new Error(`Unexpected dependency: ${name}`)
      return mocks[name]
    },
    process: processStub,
    console,
    setTimeout,
    clearTimeout,
  }, { filename: file })
  return exports
}

function startBridge({ platform = 'darwin', packaged = false, env = {} } = {}) {
  const child = new EventEmitter()
  child.stdin = new PassThrough()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.kill = () => {}
  let launched
  const { PythonBridge } = loadElectronModule('electron/bridge.ts', {
    electron: { app: { isPackaged: packaged, getAppPath: () => '/workspace' } },
    'node:child_process': { spawn: (...args) => { launched = args; return child } },
    'node:path': path,
    'node:crypto': { randomUUID: () => 'test-request' },
  }, { platform, env, resourcesPath: '/resources' })
  const bridge = new PythonBridge()
  bridge.start()
  bridge.stop()
  return launched
}

test('development honors the branded Python override before the legacy override', () => {
  const [program, args] = startBridge({ env: {
    LUMATILE_PYTHON: '/custom/new-python', QLU_PYTHON: '/custom/old-python',
  } })
  assert.equal(program, '/custom/new-python')
  assert.deepEqual(Array.from(args), [path.join('/workspace', 'main.py'), '--bridge'])
})

test('development still accepts the legacy Python override', () => {
  assert.equal(startBridge({ env: { QLU_PYTHON: '/custom/old-python' } })[0], '/custom/old-python')
})

for (const platform of ['darwin', 'win32']) {
  test(`${platform} development defaults to the project virtual environment`, () => {
    const expected = platform === 'win32'
      ? path.join('/workspace', '.venv', 'Scripts', 'python.exe')
      : path.join('/workspace', '.venv', 'bin', 'python')
    assert.equal(startBridge({ platform })[0], expected)
  })

  test(`${platform} packaged app launches its bundled LumaTile worker`, () => {
    const [program, args, options] = startBridge({
      platform, packaged: true, env: { LUMATILE_PYTHON: '/custom/python' },
    })
    const worker = platform === 'win32' ? 'LumaTileWorker.exe' : 'LumaTileWorker'
    assert.equal(program, path.join('/resources', 'backend', worker))
    assert.deepEqual(Array.from(args), ['--bridge'])
    assert.equal(options.cwd, '/resources')
  })
}
