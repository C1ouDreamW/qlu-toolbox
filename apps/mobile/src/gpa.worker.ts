import { parseGradeRows } from '@lumatile/academic-core'
import type { GradeWorkbookRows } from '@lumatile/contracts'

interface ParseRequest {
  id: number
  source: GradeWorkbookRows
}

interface WorkerScope {
  addEventListener(type: 'message', listener: (event: MessageEvent<ParseRequest>) => void): void
  postMessage(message: unknown): void
}

const workerScope = self as unknown as WorkerScope

workerScope.addEventListener('message', (event) => {
  const { id, source } = event.data
  try {
    workerScope.postMessage({ id, workbook: parseGradeRows(source) })
  } catch (error) {
    workerScope.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
  }
})

export {}
