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

test('preload exposes the LumaTile API and forwards requests and events', async () => {
  const exposed = new Map()
  const ipc = new EventEmitter()
  const sent = []
  ipc.invoke = async (...args) => args
  ipc.send = (...args) => sent.push(args)
  loadElectronModule('electron/preload.cts', {
    electron: {
      contextBridge: { exposeInMainWorld: (name, api) => exposed.set(name, api) },
      ipcRenderer: ipc,
      webUtils: { getPathForFile: file => file.path },
    },
  }, { platform: 'darwin' })
  assert.deepEqual([...exposed.keys()], ['lumatile'])
  const api = exposed.get('lumatile')
  assert.equal(api.platform, 'darwin')
  assert.deepEqual(await api.invoke('listTasks', { limit: 2 }), ['bridge:invoke', 'listTasks', { limit: 2 }])
  api.windowAction('minimize')
  assert.deepEqual(sent, [['window:action', 'minimize']])

  const events = []
  const unsubscribe = api.onEvent((name, payload) => events.push([name, payload]))
  ipc.emit('bridge:event', {}, 'scheduleImport', { taskId: 'test-task' })
  assert.deepEqual(events, [['scheduleImport', { taskId: 'test-task' }]])
  unsubscribe()
  ipc.emit('bridge:event', {}, 'scheduleImport', {})
  assert.equal(events.length, 1)
})

function restoreStartupTheme(initial, { readError = false, writeError = false } = {}) {
  const html = readFileSync(path.join(root, 'index.html'), 'utf8')
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1]
  assert.ok(script, 'The startup theme script must run before the renderer mounts')
  const values = new Map(Object.entries(initial))
  const dataset = {}
  runInNewContext(script, {
    document: { documentElement: { dataset } },
    localStorage: {
      getItem(key) {
        if (readError) throw new Error('Storage unavailable')
        return values.get(key) ?? null
      },
      setItem(key, value) {
        if (writeError) throw new Error('Storage is read-only')
        values.set(key, value)
      },
    },
  })
  return { theme: dataset.theme, values }
}

for (const theme of ['dark', 'light']) {
  test(`startup migrates the legacy ${theme} cache while preserving it for older versions`, () => {
    const result = restoreStartupTheme({ 'qlu:theme': theme })
    assert.equal(result.theme, theme)
    assert.equal(result.values.get('lumatile:theme'), theme)
    assert.equal(result.values.get('qlu:theme'), theme)
  })
}

test('the branded theme cache takes priority over a stale legacy cache', () => {
  const result = restoreStartupTheme({ 'lumatile:theme': 'light', 'qlu:theme': 'dark' })
  assert.equal(result.theme, 'light')
  assert.equal(result.values.get('qlu:theme'), 'dark')
})

test('an invalid branded cache falls back to a valid legacy theme', () => {
  const result = restoreStartupTheme({ 'lumatile:theme': 'invalid', 'qlu:theme': 'dark' })
  assert.equal(result.theme, 'dark')
  assert.equal(result.values.get('lumatile:theme'), 'dark')
})

test('missing or invalid theme caches preserve the default appearance', () => {
  assert.equal(restoreStartupTheme({}).theme, undefined)
  const result = restoreStartupTheme({ 'qlu:theme': 'invalid' })
  assert.equal(result.theme, undefined)
  assert.equal(result.values.has('lumatile:theme'), false)
})

test('a failed cache write still restores the startup theme', () => {
  const result = restoreStartupTheme({ 'qlu:theme': 'dark' }, { writeError: true })
  assert.equal(result.theme, 'dark')
  assert.equal(result.values.has('lumatile:theme'), false)
})

test('unavailable localStorage does not prevent startup', () => {
  assert.equal(restoreStartupTheme({}, { readError: true }).theme, undefined)
})
