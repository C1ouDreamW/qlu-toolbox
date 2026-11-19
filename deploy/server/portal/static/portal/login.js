const togglePassword = document.querySelector('#toggle-password')
const password = document.getElementById(togglePassword.getAttribute('aria-controls'))

togglePassword.hidden = false
togglePassword.addEventListener('click', () => {
  const show = password.type === 'password'
  password.type = show ? 'text' : 'password'
  togglePassword.textContent = show ? '隐藏密码' : '显示密码'
})
