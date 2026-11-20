export const field = id => document.getElementById(id)
export const dateFormat = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Shanghai',
})

export function textElement(tag, className, value) {
  const element = document.createElement(tag)
  element.className = className
  element.textContent = value
  return element
}

export function showMessage(id, text, state = '') {
  const message = field(id)
  message.dataset.state = state
  message.classList.toggle('error', state === 'error')
  message.textContent = text
}

export function showError(id, error) {
  showMessage(id, error.message === 'Failed to fetch' ? '无法连接 API，请稍后重试' : error.message, 'error')
}

export async function runAction(message, button, action) {
  button.disabled = true
  showMessage(message, '处理中…', 'loading')
  try {
    showMessage(message, await action(), 'success')
    return true
  } catch (error) {
    showError(message, error)
    return false
  } finally {
    button.disabled = false
  }
}

export function table(headers, rows) {
  const scroll = document.createElement('div')
  scroll.className = 'table-scroll'
  const result = document.createElement('table')
  const head = result.createTHead().insertRow()
  for (const label of headers) head.append(textElement('th', '', label))
  const body = result.createTBody()
  for (const values of rows) {
    const row = body.insertRow()
    for (const value of values) row.insertCell().textContent = value
  }
  scroll.append(result)
  return scroll
}
