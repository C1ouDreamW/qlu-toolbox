import type { GPAWorkbook, GradeWorkbookRows } from '@qlu-toolbox/contracts'

interface ParseResponse {
  id: number
  workbook?: GPAWorkbook
  error?: string
}

interface PendingRequest {
  resolve: (workbook: GPAWorkbook) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

let worker: Worker | null = null
let requestId = 0
const pending = new Map<number, PendingRequest>()

function rejectPending(message: string) {
  for (const request of pending.values()) {
    clearTimeout(request.timeout)
    request.reject(new Error(message))
  }
  pending.clear()
  worker?.terminate()
  worker = null
}

function getWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./gpa.worker.ts', import.meta.url), { type: 'module' })
  worker.addEventListener('message', (event: MessageEvent<ParseResponse>) => {
    const request = pending.get(event.data.id)
    if (!request) return
    pending.delete(event.data.id)
    clearTimeout(request.timeout)
    if (event.data.workbook) request.resolve(event.data.workbook)
    else request.reject(new Error(event.data.error || '无法解析成绩工作簿'))
  })
  worker.addEventListener('error', () => rejectPending('成绩解析进程异常终止，请重新选择文件'))
  return worker
}

export function parseGradeWorkbook(source: GradeWorkbookRows): Promise<GPAWorkbook> {
  return new Promise((resolve, reject) => {
    const id = ++requestId
    const timeout = setTimeout(() => {
      pending.delete(id)
      reject(new Error('成绩解析超时，请确认文件来自分项成绩导出工具'))
    }, 30_000)
    pending.set(id, { resolve, reject, timeout })
    getWorker().postMessage({ id, source })
  })
}
