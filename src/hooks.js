import { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { api } from './api.js'

export function useResource(path) {
  const [state, setState] = useState({ loading: true, data: null, error: null })
  const load = useCallback(async (signal) => {
    setState((current) => ({ ...current, loading: true, error: null }))
    try {
      const data = await api(path, { signal })
      setState({ loading: false, data, error: null })
    } catch (error) {
      if (error.name !== 'AbortError') setState({ loading: false, data: null, error })
    }
  }, [path])

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
    return () => controller.abort()
  }, [load])
  return { ...state, reload: () => load() }
}

export function usePostAnchor(ready) {
  const { hash } = useLocation()
  useEffect(() => {
    if (!ready || !hash.startsWith('#post-')) return
    const frame = requestAnimationFrame(() => document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'center' }))
    return () => cancelAnimationFrame(frame)
  }, [ready, hash])
}
