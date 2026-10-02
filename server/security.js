import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import { addTime, nowIso } from './db.js'

export const USER_COOKIE = 'htyz_session'
export const STAFF_COOKIE = 'htyz_staff_session'
export const CSRF_COOKIE = 'htyz_csrf'

export function id() {
  return crypto.randomUUID()
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url')
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex')
}

export function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''))
  const right = Buffer.from(String(b || ''))
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

export function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase()
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null
  return email
}

export const gradeOptions = {
  current_student: ['初一', '初二', '初三', '高一', '高二', '高三'],
  graduate: ['大一', '大二', '大三', '大四', '大五', '研究生', '已工作']
}

export function validGrade(memberType, grade) {
  return typeof grade === 'string' && (gradeOptions[memberType] || []).includes(grade)
}

export function validatePassword(value) {
  const password = String(value || '')
  if (password.length < 10) return '密码至少需要 10 个字符。'
  if (password.length > 128) return '密码不能超过 128 个字符。'
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return '密码需要同时包含字母和数字。'
  return null
}

export function cleanText(value, { min = 1, max = 5000 } = {}) {
  const text = String(value || '').replace(/\r\n/g, '\n').trim()
  if (text.length < min || text.length > max) return null
  return text
}

export function hashPassword(password) {
  return bcrypt.hash(password, 12)
}

export function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash)
}

export function setAuthCookie(res, config, scope, token) {
  const name = scope === 'staff' ? STAFF_COOKIE : USER_COOKIE
  res.cookie(name, token, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: config.sessionDays * 24 * 60 * 60 * 1000
  })
}

export function clearAuthCookie(res, config, scope) {
  const name = scope === 'staff' ? STAFF_COOKIE : USER_COOKIE
  res.clearCookie(name, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax',
    path: '/'
  })
}

export function createSession(db, config, principalType, principalId) {
  const token = randomToken()
  const now = nowIso()
  db.prepare(`INSERT INTO auth_sessions
    (id, token_hash, principal_type, principal_id, expires_at, last_seen_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id(), hashToken(token), principalType, principalId, addTime({ days: config.sessionDays }), now, now)
  return token
}

export function createEmailToken(db, principalType, principalId, purpose, ttl) {
  const token = randomToken()
  const now = nowIso()
  db.prepare('DELETE FROM email_tokens WHERE principal_type = ? AND principal_id = ? AND purpose = ? AND consumed_at IS NULL')
    .run(principalType, principalId, purpose)
  db.prepare(`INSERT INTO email_tokens
    (id, principal_type, principal_id, purpose, token_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id(), principalType, principalId, purpose, hashToken(token), ttl, now)
  return token
}

export function readSession(db, token, principalType) {
  if (!token) return null
  const now = nowIso()
  const row = db.prepare(`SELECT s.*, 
      CASE WHEN s.principal_type = 'user' THEN u.email ELSE a.email END AS email,
      CASE WHEN s.principal_type = 'user' THEN u.status ELSE a.status END AS principal_status,
      u.member_type, u.username, u.grade, u.avatar_storage_name, a.role, a.must_change_password
    FROM auth_sessions s
    LEFT JOIN users u ON s.principal_type = 'user' AND u.id = s.principal_id
    LEFT JOIN staff_accounts a ON s.principal_type = 'staff' AND a.id = s.principal_id
    WHERE s.token_hash = ? AND s.principal_type = ? AND s.expires_at > ?`)
    .get(hashToken(token), principalType, now)
  if (!row || row.principal_status !== 'active') return null
  db.prepare('UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?').run(now, row.id)
  return row
}

export function audit(db, { actorType, actorId = null, event, targetType = null, targetId = null, metadata = null }) {
  db.prepare(`INSERT INTO audit_events
    (id, actor_type, actor_id, event_name, target_type, target_id, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id(), actorType, actorId, event, targetType, targetId, metadata ? JSON.stringify(metadata) : null, nowIso())
}

export function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
}

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}
