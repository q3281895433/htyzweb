import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api, getSession } from '../api.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null, staff: null, mailAvailable: false })
  const [unreadCount, setUnreadCount] = useState(0)
  const [chatUnreadCount, setChatUnreadCount] = useState(0)

  const refresh = useCallback(async () => {
    try {
      const session = await getSession({ refresh: true })
      setState({ loading: false, user: session.user, staff: session.staff, mailAvailable: session.mailAvailable })
      return session
    } catch {
      setState((current) => ({ ...current, loading: false }))
      return null
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const refreshNotifications = useCallback(async () => {
    try {
      const result = await api('/api/notifications/unread-count')
      setUnreadCount(result.count)
      return result.count
    } catch { return null }
  }, [])

  const refreshChats = useCallback(async () => {
    try { const result = await api('/api/chats/unread-count'); setChatUnreadCount(result.count); return result.count }
    catch { return null }
  }, [])

  useEffect(() => {
    if (!state.user) { setUnreadCount(0); setChatUnreadCount(0); return undefined }
    refreshNotifications(); refreshChats()
    const timer = window.setInterval(() => { refreshNotifications(); refreshChats() }, 30_000)
    return () => window.clearInterval(timer)
  }, [state.user?.id, refreshNotifications, refreshChats])

  const logout = useCallback(async (scope = 'user') => {
    await api(scope === 'staff' ? '/api/htyzSlowSnow/auth/logout' : '/api/auth/logout', { method: 'POST' })
    await refresh()
  }, [refresh])

  const value = useMemo(() => ({ ...state, unreadCount, chatUnreadCount, refreshNotifications, refreshChats, refresh, logout }), [state, unreadCount, chatUnreadCount, refreshNotifications, refreshChats, refresh, logout])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
