import { ref } from 'vue'
import { errorText, type Status } from './ui'

export function useAction() {
  const pending = ref(false)
  const status = ref<Status>()

  async function run(action: () => Promise<void>, success = '') {
    if (pending.value) return false
    pending.value = true
    status.value = { text: '处理中…', state: 'loading' }
    try {
      await action()
      status.value = success ? { text: success, state: 'success' } : undefined
      return true
    } catch (error) {
      status.value = { text: errorText(error), state: 'error' }
      return false
    } finally {
      pending.value = false
    }
  }

  return { pending, status, run }
}
