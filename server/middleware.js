import fs from 'node:fs'
import { ApiError, CSRF_COOKIE, STAFF_COOKIE, USER_COOKIE, randomToken, readSession, safeEqual } from './security.js'

export function sessionContext(db) {
  return (req, _res, next) => {
    req.userSession = readSession(db, req.cookies?.[USER_COOKIE], 'user')
    req.staffSession = readSession(db, req.cookies?.[STAFF_COOKIE], 'staff')
    next()
  }
}

export function csrfProtection(config) {
  return (req, res, next) => {
    let token = req.cookies?.[CSRF_COOKIE]
    if (!token) {
      token = randomToken(24)
      res.cookie(CSRF_COOKIE, token, {
        httpOnly: false,
        secure: config.isProduction,
        sameSite: 'lax',
        path: '/',
        maxAge: 24 * 60 * 60 * 1000
      })
    }
    req.csrfToken = token

    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('origin')
      if (origin && origin !== config.siteOrigin) {
        return next(new ApiError(403, 'origin_rejected', '请求来源不被允许。'))
      }
      if (!safeEqual(req.get('x-csrf-token'), token)) {
        return next(new ApiError(403, 'csrf_invalid', '页面凭证已过期，请刷新后重试。'))
      }
    }
    next()
  }
}

export function requireUser(req, _res, next) {
  if (!req.userSession) return next(new ApiError(401, 'authentication_required', '请先登录。'))
  next()
}

export function requireStaff(req, _res, next) {
  if (!req.staffSession) return next(new ApiError(401, 'staff_authentication_required', '请通过管理员入口登录。'))
  next()
}

export function requireRoles(...roles) {
  return (req, _res, next) => {
    if (!req.staffSession || !roles.includes(req.staffSession.role)) {
      return next(new ApiError(403, 'insufficient_role', '当前管理员没有执行此操作的权限。'))
    }
    next()
  }
}

export function parsePage(req) {
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit || '20', 10) || 20, 1), 50)
  const offset = Math.max(Number.parseInt(req.query.offset || '0', 10) || 0, 0)
  return { limit, offset }
}

export function jsonErrorHandler(err, req, res, _next) {
  const files = [...(Array.isArray(req.files) ? req.files : Object.values(req.files || {}).flat()), req.file].filter(Boolean)
  for (const file of files) {
    if (file.path && file.filename?.startsWith('.incoming-')) {
      try { fs.unlinkSync(file.path) } catch (error) { if (error.code !== 'ENOENT') console.error(error) }
    }
  }
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ ok: false, error: { code: 'file_too_large', message: '单个文件超过大小限制。' } })
  }
  if (err?.code === 'LIMIT_FILE_COUNT') {
    return res.status(413).json({ ok: false, error: { code: 'too_many_files', message: '上传文件数量超过限制。' } })
  }
  if (err?.code === 'LIMIT_UNEXPECTED_FILE') return res.status(413).json({ ok: false, error: { code: 'unexpected_file', message: '图片最多 9 张，视频最多 1 个。' } })
  const status = Number.isInteger(err?.status) ? err.status : 500
  if (status >= 500) console.error(err)
  return res.status(status).json({
    ok: false,
    error: {
      code: err?.code || 'internal_error',
      message: status >= 500 ? '服务器暂时无法完成请求，请稍后重试。' : err.message
    }
  })
}
