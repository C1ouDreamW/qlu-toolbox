import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import path from 'node:path'
import { app } from 'electron'
import { randomUUID } from 'node:crypto'

type Pending = { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: NodeJS.Timeout }

export class PythonBridge {
  private process?: ChildProcessWithoutNullStreams
  private startError = ''
  private buffer = ''
  private pending = new Map<string, Pending>()
  onEvent?: (name: string, payload: unknown) => void

  start() {
    const development = !app.isPackaged
    this.startError = ''
    const pythonExecutable = process.platform === 'win32'
      ? path.join(app.getAppPath(), '.venv', 'Scripts', 'python.exe')
      : path.join(app.getAppPath(), '.venv', 'bin', 'python')
    const workerExecutable = process.platform === 'win32'
      ? 'LumaTileWorker.exe'
      : 'LumaTileWorker'
    const program = development
      ? (process.env.LUMATILE_PYTHON || process.env.QLU_PYTHON || pythonExecutable)
      : path.join(process.resourcesPath, 'backend', workerExecutable)
    const args = development ? [path.join(app.getAppPath(), 'main.py'), '--bridge'] : ['--bridge']
    this.process = spawn(program, args, {
      cwd: development ? app.getAppPath() : process.resourcesPath,
      windowsHide: true,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONUNBUFFERED: '1' },
    })
    this.process.on('error', (error) => {
      this.startError = `无法启动本地服务：${error.message}`
      for (const item of this.pending.values()) item.reject(new Error(this.startError))
      this.pending.clear()
      this.process = undefined
    })
    this.process.stdin.on('error', () => undefined)
    this.process.stdout.setEncoding('utf8')
    this.process.stdout.on('data', (chunk: string) => this.consume(chunk))
    this.process.stderr.setEncoding('utf8')
    this.process.stderr.on('data', (chunk: string) => console.error('[python]', chunk.trim()))
    this.process.on('exit', (code) => {
      for (const item of this.pending.values()) item.reject(new Error(`本地服务已退出（${code ?? 'unknown'}）`))
      this.pending.clear()
      this.process = undefined
    })
  }

  stop() {
    this.process?.kill()
  }

  invoke<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (this.startError) return Promise.reject(new Error(this.startError))
    if (!this.process || this.process.killed) return Promise.reject(new Error('本地服务尚未启动'))
    const id = randomUUID()
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('本地操作响应超时'))
      }, 15_000)
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
      this.process!.stdin.write(`${JSON.stringify({ id, method, params })}\n`, (error) => {
        if (!error) return
        const item = this.pending.get(id)
        if (!item) return
        clearTimeout(item.timer)
        this.pending.delete(id)
        item.reject(error)
      })
    })
  }

  private consume(chunk: string) {
    this.buffer += chunk
    let index = this.buffer.indexOf('\n')
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim()
      this.buffer = this.buffer.slice(index + 1)
      if (line) this.dispatch(line)
      index = this.buffer.indexOf('\n')
    }
  }

  private dispatch(line: string) {
    try {
      const message = JSON.parse(line)
      if (message.channel === 'event') {
        this.onEvent?.(message.name, message)
        return
      }
      const pending = this.pending.get(message.id)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error))
      else pending.resolve(message.result)
    } catch (error) {
      console.error('无法解析本地服务消息', error)
    }
  }
}
