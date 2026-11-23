import { readonly, ref, shallowRef } from 'vue'
import { createApi, type Credentials, type PasswordChange, type Session } from './api/client'
import { errorText } from './ui'

type UserSession = Pick<Session, 'user' | 'permissions'>
const session = shallowRef<UserSession>()
const checking = ref(false)
const connectionError = ref('')

export const api = createApi(fetch, () => {
  session.value = undefined
  void initialize()
})

function setSession({ user, permissions }: Session) {
  session.value = { user, permissions }
}

async function initialize() {
  if (checking.value) return
  checking.value = true
  connectionError.value = ''
  try {
    setSession(await api.session())
  } catch (error) {
    connectionError.value = errorText(error)
  } finally {
    checking.value = false
  }
}

export function useSession() {
  return {
    session: readonly(session), checking: readonly(checking), connectionError: readonly(connectionError), initialize,
    login: async (credentials: Credentials) => setSession(await api.login(credentials)),
    logout: async () => setSession(await api.logout()),
    changePassword: async (passwords: PasswordChange) => setSession(await api.changePassword(passwords)),
  }
}
