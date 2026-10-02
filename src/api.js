let sessionPromise = null

export class ApiClientError extends Error {
  constructor(message, code, status) {
    super(message)
    this.name = 'ApiClientError'
    this.code = code
    this.status = status
  }
}

export async function getSession({ refresh = false } = {}) {
  if (!sessionPromise || refresh) {
    sessionPromise = request('/api/session', { skipCsrf: true }).catch((error) => {
      sessionPromise = null
      throw error
    })
  }
  return sessionPromise
}

export async function api(path, options = {}) {
  const result = await request(path, options)
  if (path.includes('/auth/') || path === '/api/auth/logout') {
    sessionPromise = null
  }
  return result
}

export async function uploadForm(path, body, onProgress = () => {}) {
  const session = await getSession()
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', path)
    request.withCredentials = true
    request.setRequestHeader('X-CSRF-Token', session.csrfToken)
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100))
    })
    request.addEventListener('load', () => {
      let payload
      try { payload = JSON.parse(request.responseText) } catch { reject(new ApiClientError('服务器返回了无法识别的响应。', 'invalid_response', request.status)); return }
      if (request.status < 200 || request.status >= 300 || payload.ok === false) reject(new ApiClientError(payload.error?.message || '上传失败。', payload.error?.code || 'upload_failed', request.status))
      else resolve(payload.data)
    })
    request.addEventListener('error', () => reject(new ApiClientError('网络中断，上传未完成。', 'network_error', 0)))
    request.send(body)
  })
}

async function request(path, options = {}) {
  const method = options.method || 'GET'
  const headers = new Headers(options.headers || {})
  let body = options.body

  if (!['GET', 'HEAD'].includes(method) && !options.skipCsrf) {
    const session = await getSession()
    headers.set('X-CSRF-Token', session.csrfToken)
  }

  if (body && !(body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
    body = JSON.stringify(body)
  }

  const response = await fetch(path, {
    method,
    headers,
    body,
    credentials: 'same-origin',
    signal: options.signal
  })
  let payload
  try {
    payload = await response.json()
  } catch {
    throw new ApiClientError('服务器返回了无法识别的响应。', 'invalid_response', response.status)
  }
  if (!response.ok || payload.ok === false) {
    throw new ApiClientError(payload.error?.message || '请求失败。', payload.error?.code || 'request_failed', response.status)
  }
  return payload.data
}
