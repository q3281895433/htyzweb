import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { addTime, nowIso } from '../db.js'
import {
  ApiError,
  asyncRoute,
  audit,
  clearAuthCookie,
  createEmailToken,
  createSession,
  hashPassword,
  hashToken,
  id,
  normalizeEmail,
  setAuthCookie,
  validatePassword,
  verifyPassword,
  validGrade
} from '../security.js'
import { requireUser } from '../middleware.js'

export function createAuthRouter({ db, config, mailer }) {
  const router = Router()
  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: true, legacyHeaders: false })
  const mailLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false })

  router.get('/session', (req, res) => {
    res.json({
      ok: true,
      data: {
        csrfToken: req.csrfToken,
        mailAvailable: mailer.configured,
        user: req.userSession ? {
          id: req.userSession.principal_id,
          email: req.userSession.email,
          memberType: req.userSession.member_type,
          username: req.userSession.username,
          grade: req.userSession.grade,
          avatar: req.userSession.avatar_storage_name ? `/api/avatar/${req.userSession.principal_id}` : null,
          expiresAt: req.userSession.expires_at
        } : null,
        staff: req.staffSession ? {
          id: req.staffSession.principal_id,
          email: req.staffSession.email,
          role: req.staffSession.role,
          mustChangePassword: Boolean(req.staffSession.must_change_password),
          expiresAt: req.staffSession.expires_at
        } : null
      }
    })
  })

  router.post('/auth/register', authLimiter, asyncRoute(async (req, res) => {
    const email = normalizeEmail(req.body.email)
    const passwordError = validatePassword(req.body.password)
    const memberType = req.body.memberType
    const grade = req.body.grade
    if (!email) throw new ApiError(422, 'email_invalid', '请输入有效邮箱。')
    if (passwordError) throw new ApiError(422, 'password_invalid', passwordError)
    if (!['current_student', 'graduate'].includes(memberType)) throw new ApiError(422, 'member_type_invalid', '请选择在校生或毕业生。')
    if (!validGrade(memberType, grade)) throw new ApiError(422, 'grade_invalid', '请选择与你的身份相符的年级或状态。')
    if (req.body.privacyAccepted !== true) throw new ApiError(422, 'privacy_required', '请先阅读并同意隐私说明。')
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
      throw new ApiError(409, 'email_exists', '该邮箱已经注册，请直接登录或申请重置密码。')
    }

    const userId = id()
    const now = nowIso()
    const passwordHash = await hashPassword(req.body.password)
    db.prepare(`INSERT INTO users (id, email, password_hash, member_type, grade, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`)
      .run(userId, email, passwordHash, memberType, grade, now, now)
    audit(db, { actorType: 'user', actorId: userId, event: 'user_registered', targetType: 'user', targetId: userId })
    res.status(201).json({ ok: true, data: { message: '注册成功，现在可以直接登录。申请管理员时需要单独验证邮箱。' } })
  }))

  router.post('/auth/verify-for-staff', requireUser, mailLimiter, asyncRoute(async (req, res) => {
    if (!mailer.configured) throw new ApiError(503, 'mail_not_configured', '邮件服务尚未配置，暂时无法验证管理员申请邮箱。')
    const user = db.prepare('SELECT email, email_verified_at FROM users WHERE id = ?').get(req.userSession.principal_id)
    if (user.email_verified_at) return res.json({ ok: true, data: { message: '邮箱已经验证，可以提交管理员申请。' } })
    const token = createEmailToken(db, 'user', req.userSession.principal_id, 'verify_email', addTime({ hours: 24 }))
    await mailer.sendVerification(user.email, token)
    res.json({ ok: true, data: { message: '验证邮件已发送，请在 24 小时内点击链接。' } })
  }))

  router.post('/auth/resend-verification', mailLimiter, asyncRoute(async (req, res) => {
    if (!mailer.configured) throw new ApiError(503, 'mail_not_configured', '邮件服务尚未配置。')
    const email = normalizeEmail(req.body.email)
    if (!email) throw new ApiError(422, 'email_invalid', '请输入有效邮箱。')
    const user = db.prepare("SELECT id, status FROM users WHERE email = ?").get(email)
    if (user?.status === 'pending') {
      const token = createEmailToken(db, 'user', user.id, 'verify_email', addTime({ hours: 24 }))
      await mailer.sendVerification(email, token)
    }
    res.json({ ok: true, data: { message: '如果该邮箱存在且尚未验证，我们会发送新的验证邮件。' } })
  }))

  router.post('/auth/verify', authLimiter, (req, res, next) => {
    try {
      const token = String(req.body.token || '')
      const row = db.prepare(`SELECT * FROM email_tokens
        WHERE token_hash = ? AND purpose = 'verify_email' AND consumed_at IS NULL AND expires_at > ?`)
        .get(hashToken(token), nowIso())
      if (!row) throw new ApiError(400, 'token_invalid', '验证链接无效或已过期。')
      const now = nowIso()
      db.transaction(() => {
        db.prepare("UPDATE users SET status = 'active', email_verified_at = ?, updated_at = ? WHERE id = ?").run(now, now, row.principal_id)
        db.prepare('UPDATE email_tokens SET consumed_at = ? WHERE id = ?').run(now, row.id)
      })()
      audit(db, { actorType: 'user', actorId: row.principal_id, event: 'email_verified', targetType: 'user', targetId: row.principal_id })
      res.json({ ok: true, data: { message: '邮箱验证成功，现在可以提交管理员申请。' } })
    } catch (error) {
      next(error)
    }
  })

  router.post('/auth/login', authLimiter, asyncRoute(async (req, res) => {
    const email = normalizeEmail(req.body.email)
    const password = String(req.body.password || '')
    const user = email ? db.prepare('SELECT * FROM users WHERE email = ?').get(email) : null
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      throw new ApiError(401, 'credentials_invalid', '邮箱或密码不正确。')
    }
    if (user.status === 'pending') {
      db.prepare("UPDATE users SET status = 'active', updated_at = ? WHERE id = ?").run(nowIso(), user.id)
    }
    if (user.status !== 'active' && user.status !== 'pending') throw new ApiError(403, 'account_unavailable', '账号当前不可用。')
    const token = createSession(db, config, 'user', user.id)
    setAuthCookie(res, config, 'user', token)
    audit(db, { actorType: 'user', actorId: user.id, event: 'user_logged_in', targetType: 'user', targetId: user.id })
    res.json({ ok: true, data: { user: { id: user.id, email: user.email, memberType: user.member_type, grade: user.grade, username: user.username, avatar: user.avatar_storage_name ? `/api/avatar/${user.id}` : null } } })
  }))

  router.post('/auth/logout', (req, res) => {
    if (req.userSession) db.prepare('DELETE FROM auth_sessions WHERE id = ?').run(req.userSession.id)
    clearAuthCookie(res, config, 'user')
    res.json({ ok: true, data: { message: '已退出登录。' } })
  })

  router.post('/auth/forgot-password', mailLimiter, asyncRoute(async (req, res) => {
    if (!mailer.configured) throw new ApiError(503, 'mail_not_configured', '邮件服务尚未配置。')
    const email = normalizeEmail(req.body.email)
    const user = email ? db.prepare("SELECT id FROM users WHERE email = ? AND status = 'active'").get(email) : null
    if (user) {
      const token = createEmailToken(db, 'user', user.id, 'reset_password', addTime({ minutes: 30 }))
      await mailer.sendReset(email, token)
    }
    res.json({ ok: true, data: { message: '如果该邮箱已注册，我们会发送密码重置邮件。' } })
  }))

  router.post('/auth/reset-password', authLimiter, asyncRoute(async (req, res) => {
    const passwordError = validatePassword(req.body.password)
    if (passwordError) throw new ApiError(422, 'password_invalid', passwordError)
    const row = db.prepare(`SELECT * FROM email_tokens
      WHERE token_hash = ? AND purpose = 'reset_password' AND consumed_at IS NULL AND expires_at > ?`)
      .get(hashToken(req.body.token), nowIso())
    if (!row) throw new ApiError(400, 'token_invalid', '重置链接无效或已过期。')
    const passwordHash = await hashPassword(req.body.password)
    const now = nowIso()
    db.transaction(() => {
      db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(passwordHash, now, row.principal_id)
      db.prepare('UPDATE email_tokens SET consumed_at = ? WHERE id = ?').run(now, row.id)
      db.prepare("DELETE FROM auth_sessions WHERE principal_type = 'user' AND principal_id = ?").run(row.principal_id)
    })()
    audit(db, { actorType: 'user', actorId: row.principal_id, event: 'password_reset', targetType: 'user', targetId: row.principal_id })
    res.json({ ok: true, data: { message: '密码已更新，请重新登录。' } })
  }))

  router.get('/me', requireUser, (req, res) => {
    const user = db.prepare('SELECT id, email, username, bio, member_type, grade, email_verified_at, created_at, avatar_storage_name FROM users WHERE id = ?').get(req.userSession.principal_id)
    const submissions = db.prepare(`SELECT id, category, title, status, rejection_reason, created_at, updated_at
      FROM contributions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`).all(user.id)
    const application = db.prepare(`SELECT id, applicant_type, status, review_note, created_at, decided_at
      FROM staff_applications WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`).get(user.id) || null
    const moments = db.prepare(`SELECT id, body, status, rejection_reason, created_at, updated_at
      FROM moments WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`).all(user.id)
    const wallPosts = db.prepare(`SELECT id, body, is_anonymous, status, rejection_reason, created_at, updated_at
      FROM wall_posts WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`).all(user.id)
    user.avatar = user.avatar_storage_name ? `/api/avatar/${user.id}` : null
    delete user.avatar_storage_name
    res.json({ ok: true, data: { user, submissions, moments, wallPosts, staffApplication: application } })
  })

  return router
}
