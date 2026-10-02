import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { addTime, nowIso } from '../db.js'
import { parsePage, requireRoles, requireStaff } from '../middleware.js'
import { checkedPostImage, checkedVideo, cleanupUploadTemps, limitPostBody, postMediaUpload, moveImages, removeFiles } from '../uploads.js'
import { queueVideo } from '../video-worker.js'
import { applyVideoMeta } from './content.js'
import { createStaffChatRouter } from './chats.js'
import {
  ApiError,
  asyncRoute,
  audit,
  cleanText,
  clearAuthCookie,
  createEmailToken,
  createSession,
  hashPassword,
  hashToken,
  id,
  normalizeEmail,
  randomToken,
  setAuthCookie,
  validatePassword,
  verifyPassword
} from '../security.js'

const postTargets = {
  contribution: { table: 'contributions', title: 'p.title' },
  question: { table: 'questions', title: 'p.title' },
  answer: { table: 'answers', title: 'NULL' },
  moment: { table: 'moments', title: 'NULL' },
  wall: { table: 'wall_posts', title: 'NULL' },
  comment: { table: 'post_comments', title: 'NULL' }
}

export function createStaffRouter({ db, config, mailer }) {
  const router = Router()
  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: true, legacyHeaders: false })
  const newsUpload = postMediaUpload(config)

  router.post('/auth/login', loginLimiter, asyncRoute(async (req, res) => {
    const email = normalizeEmail(req.body.email)
    const password = String(req.body.password || '')
    const staff = email ? db.prepare('SELECT * FROM staff_accounts WHERE email = ?').get(email) : null
    if (!staff || !staff.password_hash || !(await verifyPassword(password, staff.password_hash))) {
      throw new ApiError(401, 'credentials_invalid', '管理员邮箱或密码不正确。')
    }
    if (staff.status !== 'active') throw new ApiError(403, 'staff_unavailable', '管理员账号尚未激活或已停用。')
    const token = createSession(db, config, 'staff', staff.id)
    setAuthCookie(res, config, 'staff', token)
    audit(db, { actorType: 'staff', actorId: staff.id, event: 'staff_logged_in', targetType: 'staff', targetId: staff.id })
    res.json({ ok: true, data: { staff: { id: staff.id, email: staff.email, role: staff.role, mustChangePassword: Boolean(staff.must_change_password) } } })
  }))

  router.post('/auth/logout', (req, res) => {
    if (req.staffSession) db.prepare('DELETE FROM auth_sessions WHERE id = ?').run(req.staffSession.id)
    clearAuthCookie(res, config, 'staff')
    res.json({ ok: true, data: { message: '管理员已退出。' } })
  })

  router.post('/auth/activate', loginLimiter, asyncRoute(async (req, res) => {
    const passwordError = validatePassword(req.body.password)
    if (passwordError) throw new ApiError(422, 'password_invalid', passwordError)
    const tokenRow = db.prepare(`SELECT * FROM email_tokens
      WHERE token_hash = ? AND purpose = 'activate_staff' AND consumed_at IS NULL AND expires_at > ?`)
      .get(hashToken(req.body.token), nowIso())
    if (!tokenRow) throw new ApiError(400, 'token_invalid', '激活链接无效或已过期。')
    const staff = db.prepare('SELECT * FROM staff_accounts WHERE id = ?').get(tokenRow.principal_id)
    if (!staff || staff.status !== 'pending_activation') throw new ApiError(409, 'activation_unavailable', '账号无需激活或当前不可激活。')
    const passwordHash = await hashPassword(req.body.password)
    const now = nowIso()
    db.transaction(() => {
      db.prepare("UPDATE staff_accounts SET password_hash = ?, status = 'active', must_change_password = 0, activated_at = ?, updated_at = ? WHERE id = ?")
        .run(passwordHash, now, now, staff.id)
      db.prepare('UPDATE email_tokens SET consumed_at = ? WHERE id = ?').run(now, tokenRow.id)
    })()
    audit(db, { actorType: 'staff', actorId: staff.id, event: 'staff_activated', targetType: 'staff', targetId: staff.id })
    res.json({ ok: true, data: { message: '管理员账号已激活，请登录。' } })
  }))

  router.use(requireStaff)

  router.post('/auth/change-password', loginLimiter, asyncRoute(async (req, res) => {
    const oldPassword = String(req.body.oldPassword || '')
    const nextPassword = String(req.body.newPassword || '')
    const passwordError = validatePassword(nextPassword)
    if (passwordError) throw new ApiError(422, 'password_invalid', passwordError)
    const staff = db.prepare('SELECT password_hash FROM staff_accounts WHERE id = ?').get(req.staffSession.principal_id)
    if (!staff || !(await verifyPassword(oldPassword, staff.password_hash))) {
      throw new ApiError(401, 'credentials_invalid', '当前密码不正确。')
    }
    if (oldPassword === nextPassword) throw new ApiError(422, 'password_unchanged', '请设置不同的新密码。')
    const nextHash = await hashPassword(nextPassword)
    const now = nowIso()
    db.transaction(() => {
      db.prepare('UPDATE staff_accounts SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?').run(nextHash, now, req.staffSession.principal_id)
      db.prepare("DELETE FROM auth_sessions WHERE principal_type = 'staff' AND principal_id = ?").run(req.staffSession.principal_id)
    })()
    clearAuthCookie(res, config, 'staff')
    audit(db, { actorType: 'staff', actorId: req.staffSession.principal_id, event: 'staff_password_changed', targetType: 'staff', targetId: req.staffSession.principal_id })
    res.json({ ok: true, data: { message: '密码已更新，请用新密码重新登录。' } })
  }))

  router.use((req, _res, next) => {
    if (req.staffSession.must_change_password) return next(new ApiError(403, 'password_change_required', '首次登录请先修改管理员密码。'))
    next()
  })

  router.use('/chats', requireRoles('super_admin'), createStaffChatRouter({ db }))

  router.get('/dashboard', (req, res) => {
    const counts = {
      publishedPosts: Object.values(postTargets).reduce((total, { table }) => total + db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE status = 'approved'`).get().count, 0),
      newSuggestions: db.prepare("SELECT COUNT(*) AS count FROM suggestions WHERE status = 'new'").get().count,
      pendingStaffApplications: req.staffSession.role === 'super_admin'
        ? db.prepare("SELECT COUNT(*) AS count FROM staff_applications WHERE status = 'pending'").get().count
        : null
    }
    const today = new Date(Date.now() + 8 * 60 * 60 * 1000)
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 13))
    const rows = db.prepare(`SELECT day, COUNT(*) AS count FROM (
      SELECT date(created_at, '+8 hours') AS day FROM moments WHERE status = 'approved'
      UNION ALL SELECT date(created_at, '+8 hours') FROM wall_posts WHERE status = 'approved'
      UNION ALL SELECT date(created_at, '+8 hours') FROM contributions WHERE status = 'approved'
      UNION ALL SELECT date(created_at, '+8 hours') FROM questions WHERE status = 'approved'
      UNION ALL SELECT date(published_at, '+8 hours') FROM news WHERE status = 'published'
    ) WHERE day >= ? GROUP BY day`).all(start.toISOString().slice(0, 10))
    const byDay = new Map(rows.map((row) => [row.day, row.count]))
    const dailyPosts = Array.from({ length: 14 }, (_, index) => {
      const day = new Date(start.getTime() + index * 86400000).toISOString().slice(0, 10)
      return { day, count: byDay.get(day) || 0 }
    })
    res.json({ ok: true, data: { counts, dailyPosts } })
  })

  router.get('/posts', (req, res, next) => {
    const type = req.query.type || 'moment'
    const target = postTargets[type]
    if (!target) return next(new ApiError(422, 'type_invalid', '请选择有效的帖子类型。'))
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit || '30', 10) || 30, 1), 50)
    const offset = Math.max(Number.parseInt(req.query.offset || '0', 10) || 0, 0)
    const parentFields = type === 'comment' ? 'p.post_type, p.post_id' : 'NULL AS post_type, NULL AS post_id'
    const bodyField = type === 'wall' ? "COALESCE(NULLIF(p.body, ''), (SELECT question FROM wall_polls WHERE wall_post_id = p.id))" : 'p.body'
    const items = db.prepare(`SELECT p.id, p.user_id, ${target.title} AS title, ${bodyField} AS body, p.status, p.created_at, p.published_at, ${parentFields},
      u.username, u.email, u.status AS user_status FROM ${target.table} p JOIN users u ON u.id = p.user_id
      ORDER BY p.created_at DESC LIMIT ? OFFSET ?`).all(limit, offset)
    res.json({ ok: true, data: { items, type, limit, offset } })
  })

  router.delete('/posts/:type/:id', (req, res, next) => {
    const target = postTargets[req.params.type]
    if (!target) return next(new ApiError(404, 'type_invalid', '帖子类型不存在。'))
    const row = db.prepare(`SELECT id, status FROM ${target.table} WHERE id = ?`).get(req.params.id)
    if (!row) return next(new ApiError(404, 'not_found', '帖子不存在。'))
    if (row.status === 'archived') return next(new ApiError(409, 'already_deleted', '帖子已经删除。'))
    const now = nowIso()
    db.transaction(() => {
      db.prepare(`UPDATE ${target.table} SET status = 'archived', updated_at = ? WHERE id = ?`).run(now, row.id)
      if (req.params.type === 'comment') db.prepare('DELETE FROM notifications WHERE comment_id = ?').run(row.id)
      else db.prepare('DELETE FROM notifications WHERE post_type = ? AND post_id = ?').run(req.params.type, row.id)
      db.prepare(`INSERT INTO moderation_actions (id, staff_id, target_type, target_id, action, note, created_at)
        VALUES (?, ?, ?, ?, 'delete', NULL, ?)`).run(id(), req.staffSession.principal_id, req.params.type, row.id, now)
      audit(db, { actorType: 'staff', actorId: req.staffSession.principal_id, event: 'post_deleted', targetType: req.params.type, targetId: row.id })
    })()
    res.json({ ok: true, data: { id: row.id, status: 'archived' } })
  })

  router.get('/users', requireRoles('super_admin', 'moderator'), (req, res) => {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit || '30', 10) || 30, 1), 50)
    const offset = Math.max(Number.parseInt(req.query.offset || '0', 10) || 0, 0)
    const items = db.prepare("SELECT id, email, username, member_type, grade, status, created_at FROM users WHERE email NOT LIKE 'deleted-%@invalid.local' ORDER BY created_at DESC LIMIT ? OFFSET ?").all(limit, offset)
    res.json({ ok: true, data: { items, limit, offset } })
  })

  router.patch('/users/:id/status', requireRoles('super_admin', 'moderator'), (req, res, next) => {
    if (!['active', 'suspended'].includes(req.body.status)) return next(new ApiError(422, 'status_invalid', '账号状态无效。'))
    const user = db.prepare('SELECT id, status FROM users WHERE id = ?').get(req.params.id)
    if (!user) return next(new ApiError(404, 'not_found', '账号不存在。'))
    if (user.status === 'pending') return next(new ApiError(409, 'email_unverified', '该账号尚未完成邮箱验证。'))
    const now = nowIso()
    db.transaction(() => {
      db.prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?').run(req.body.status, now, user.id)
      if (req.body.status === 'suspended') db.prepare("DELETE FROM auth_sessions WHERE principal_type = 'user' AND principal_id = ?").run(user.id)
      audit(db, { actorType: 'staff', actorId: req.staffSession.principal_id, event: req.body.status === 'suspended' ? 'user_suspended' : 'user_restored', targetType: 'user', targetId: user.id })
    })()
    res.json({ ok: true, data: { id: user.id, status: req.body.status } })
  })

  router.get('/staff/accounts', requireRoles('super_admin'), (req, res) => {
    const { limit, offset } = parsePage(req)
    const items = db.prepare("SELECT id, email, role, status, must_change_password, created_at FROM staff_accounts WHERE email NOT LIKE 'deleted-%@invalid.local' ORDER BY created_at DESC LIMIT ? OFFSET ?").all(limit + 1, offset)
    res.json({ ok: true, data: { items: items.slice(0, limit), limit, offset, hasMore: items.length > limit } })
  })

  router.post('/users/:id/reset-password', requireRoles('super_admin'), loginLimiter, asyncRoute(async (req, res) => {
    const user = db.prepare("SELECT id FROM users WHERE id = ? AND status = 'active'").get(req.params.id)
    if (!user) throw new ApiError(404, 'not_found', '可用用户不存在。')
    const initialPassword = `${randomToken(18)}Aa1`
    const passwordHash = await hashPassword(initialPassword)
    db.transaction(() => {
      db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(passwordHash, nowIso(), user.id)
      db.prepare("DELETE FROM auth_sessions WHERE principal_type = 'user' AND principal_id = ?").run(user.id)
      audit(db, { actorType: 'staff', actorId: req.staffSession.principal_id, event: 'user_password_reset_by_super', targetType: 'user', targetId: user.id })
    })()
    res.set('Cache-Control', 'no-store').json({ ok: true, data: { initialPassword, message: '密码已重置，所有旧会话已失效。初始密码仅显示一次。' } })
  }))

  router.post('/staff/accounts/:id/reset-password', requireRoles('super_admin'), loginLimiter, asyncRoute(async (req, res) => {
    if (req.params.id === req.staffSession.principal_id) throw new ApiError(409, 'self_change_required', '请在管理员个人入口修改自己的密码。')
    const target = db.prepare("SELECT id FROM staff_accounts WHERE id = ? AND status = 'active'").get(req.params.id)
    if (!target) throw new ApiError(404, 'not_found', '可用管理员不存在。')
    const initialPassword = `${randomToken(18)}Aa1`
    const passwordHash = await hashPassword(initialPassword)
    db.transaction(() => {
      db.prepare('UPDATE staff_accounts SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?').run(passwordHash, nowIso(), target.id)
      db.prepare("DELETE FROM auth_sessions WHERE principal_type = 'staff' AND principal_id = ?").run(target.id)
      audit(db, { actorType: 'staff', actorId: req.staffSession.principal_id, event: 'staff_password_reset_by_super', targetType: 'staff', targetId: target.id })
    })()
    res.set('Cache-Control', 'no-store').json({ ok: true, data: { initialPassword, message: '管理员密码已重置，首次登录必须修改。初始密码仅显示一次。' } })
  }))

  router.delete('/users/:id', requireRoles('super_admin'), asyncRoute(async (req, res) => {
    const user = db.prepare('SELECT id, email, avatar_storage_name FROM users WHERE id = ?').get(req.params.id)
    if (!user || user.email.startsWith('deleted-')) throw new ApiError(404, 'not_found', '用户不存在。')
    if (normalizeEmail(req.body.confirmEmail) !== user.email) throw new ApiError(422, 'confirmation_invalid', '请准确输入目标邮箱确认删除。')
    const linkedStaff = db.prepare('SELECT id, role FROM staff_accounts WHERE email = ?').get(user.email)
    if (linkedStaff?.role === 'super_admin') throw new ApiError(409, 'super_account_protected', '不能通过普通用户管理删除超级管理员关联账号。')
    const now = nowIso()
    const forgotten = `deleted-${user.id}@invalid.local`
    const unusableHash = await hashPassword(randomToken(32))
    db.transaction(() => {
      for (const table of ['moments', 'wall_posts', 'contributions', 'questions', 'answers']) {
        db.prepare(`UPDATE ${table} SET status = 'archived', updated_at = ? WHERE user_id = ?`).run(now, user.id)
      }
      db.prepare("UPDATE post_comments SET status = 'archived', updated_at = ? WHERE user_id = ?").run(now, user.id)
      db.prepare('DELETE FROM direct_messages WHERE sender_id = ? OR recipient_id = ?').run(user.id, user.id)
      db.prepare('DELETE FROM notifications WHERE actor_id = ? OR recipient_id = ?').run(user.id, user.id)
      db.prepare('DELETE FROM wall_poll_votes WHERE user_id = ?').run(user.id)
      db.prepare('DELETE FROM auth_sessions WHERE principal_id = ? AND principal_type = ?').run(user.id, 'user')
      db.prepare('DELETE FROM email_tokens WHERE principal_id = ? AND principal_type = ?').run(user.id, 'user')
      db.prepare('DELETE FROM staff_applications WHERE user_id = ?').run(user.id)
      db.prepare('DELETE FROM suggestions WHERE user_id = ?').run(user.id)
      db.prepare('UPDATE users SET email = ?, password_hash = ?, username = NULL, bio = NULL, grade = NULL, avatar_storage_name = NULL, avatar_mime_type = NULL, avatar_byte_size = NULL, status = ?, updated_at = ? WHERE id = ?')
        .run(forgotten, unusableHash, 'suspended', now, user.id)
      if (linkedStaff) {
        db.prepare('UPDATE staff_accounts SET email = ?, password_hash = ?, status = ?, updated_at = ? WHERE id = ?')
          .run(`deleted-${linkedStaff.id}@invalid.local`, unusableHash, 'suspended', now, linkedStaff.id)
        db.prepare("DELETE FROM auth_sessions WHERE principal_id = ? AND principal_type = 'staff'").run(linkedStaff.id)
      }
      audit(db, { actorType: 'staff', actorId: req.staffSession.principal_id, event: 'user_account_deleted', targetType: 'user', targetId: user.id })
    })()
    if (user.avatar_storage_name) removeFiles([config.uploadDir + '/' + user.avatar_storage_name])
    res.json({ ok: true, data: { id: user.id, message: '账号与公开身份已移除，私聊已清除，历史帖子已归档。' } })
  }))

  router.delete('/staff/accounts/:id', requireRoles('super_admin'), asyncRoute(async (req, res) => {
    if (req.params.id === req.staffSession.principal_id) throw new ApiError(409, 'self_delete_forbidden', '不能移除当前登录的超级管理员。')
    const target = db.prepare('SELECT id, email, role, status FROM staff_accounts WHERE id = ?').get(req.params.id)
    if (!target || target.email.startsWith('deleted-')) throw new ApiError(404, 'not_found', '管理员不存在。')
    if (normalizeEmail(req.body.confirmEmail) !== target.email) throw new ApiError(422, 'confirmation_invalid', '请准确输入目标邮箱确认删除。')
    if (target.role === 'super_admin' && db.prepare("SELECT COUNT(*) AS count FROM staff_accounts WHERE role = 'super_admin' AND status = 'active'").get().count <= 1) throw new ApiError(409, 'last_super_protected', '不能删除最后一个超级管理员。')
    const unusableHash = await hashPassword(randomToken(32))
    db.transaction(() => {
      db.prepare('UPDATE staff_accounts SET email = ?, password_hash = ?, status = ?, updated_at = ? WHERE id = ?')
        .run(`deleted-${target.id}@invalid.local`, unusableHash, 'suspended', nowIso(), target.id)
      db.prepare("DELETE FROM auth_sessions WHERE principal_type = 'staff' AND principal_id = ?").run(target.id)
      audit(db, { actorType: 'staff', actorId: req.staffSession.principal_id, event: 'staff_account_deleted', targetType: 'staff', targetId: target.id })
    })()
    res.json({ ok: true, data: { id: target.id, message: '管理员登录权限已移除，历史记录保留去标识归属。' } })
  }))

  router.get('/suggestions', (req, res) => {
    const items = db.prepare(`SELECT id, category, body, contact, status, created_at, updated_at
      FROM suggestions ORDER BY CASE status WHEN 'new' THEN 0 WHEN 'reviewing' THEN 1 ELSE 2 END, created_at ASC LIMIT 200`).all()
    res.json({ ok: true, data: { items, ownerQQ: config.ownerQQ } })
  })

  router.patch('/suggestions/:id', (req, res, next) => {
    if (!['reviewing', 'closed'].includes(req.body.status)) return next(new ApiError(422, 'status_invalid', '建议状态无效。'))
    const result = db.prepare('UPDATE suggestions SET status = ?, updated_at = ? WHERE id = ?')
      .run(req.body.status, nowIso(), req.params.id)
    if (!result.changes) return next(new ApiError(404, 'not_found', '建议不存在。'))
    audit(db, { actorType: 'staff', actorId: req.staffSession.principal_id, event: 'suggestion_status_changed', targetType: 'suggestion', targetId: req.params.id, metadata: { status: req.body.status } })
    res.json({ ok: true, data: { id: req.params.id, status: req.body.status } })
  })

  router.get('/news', (req, res) => {
    const rows = db.prepare(`SELECT n.id, n.title, n.body, n.status, n.published_at, n.updated_at,
      (SELECT v.id FROM post_videos v WHERE v.post_type = 'news' AND v.post_id = n.id) AS video_id,
      (SELECT v.status FROM post_videos v WHERE v.post_type = 'news' AND v.post_id = n.id) AS video_status,
      (SELECT v.poster_name FROM post_videos v WHERE v.post_type = 'news' AND v.post_id = n.id) AS video_poster,
      GROUP_CONCAT(i.id) AS image_ids
      FROM news n LEFT JOIN news_images i ON i.news_id = n.id
      GROUP BY n.id ORDER BY n.published_at DESC LIMIT 200`).all()

    // applyVideoMeta 必须作用在数组元素上；同时剔除内部的视频字段，
    // 避免把服务器存储文件名暴露给前端。
    const items = rows.map((row) => {
      const { video_status, video_poster, ...rest } = row
      return applyVideoMeta({
        ...rest,
        images: row.image_ids ? row.image_ids.split(',').filter(Boolean).map((imageId) => `/api/media/news/${imageId}`) : [],
        video: row.video_id ? `/api/media/video/${row.video_id}` : null,
        image_ids: undefined
      }, row)
    })
    res.json({ ok: true, data: { items } })
  })

  router.post('/news', requireRoles('campus_admin', 'super_admin'), limitPostBody, newsUpload.fields([{ name: 'images', maxCount: 9 }, { name: 'video', maxCount: 1 }]), cleanupUploadTemps, (req, res, next) => {
    const title = cleanText(req.body.title, { min: 1, max: 120 })
    const body = cleanText(req.body.body, { min: 0, max: 12000 })
    if (!title || body === null || (!body && !req.files?.images?.length && !req.files?.video?.length)) return next(new ApiError(422, 'news_invalid', '请填写新闻标题，并填写正文或上传图片、视频。'))
    let files, video
    try { files = (req.files?.images || []).map((file) => checkedPostImage(file, config)); video = checkedVideo(req.files?.video?.[0]) } catch (error) { return next(error) }
    const newsId = id()
    const now = nowIso()
    let written = []
    try {
      written = moveImages(config, [...files, ...(video ? [video] : [])])
      db.transaction(() => {
        db.prepare(`INSERT INTO news (id, title, body, status, created_by, published_at, updated_at)
          VALUES (?, ?, ?, 'published', ?, ?, ?)`)
          .run(newsId, title, body, req.staffSession.principal_id, now, now)
        const insertImage = db.prepare(`INSERT INTO news_images
          (id, news_id, storage_name, original_name, mime_type, byte_size, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`)
        for (const file of files) insertImage.run(file.id, newsId, file.storageName, file.originalName, file.mime, file.byteSize, now)
        if (video) db.prepare(`INSERT INTO post_videos (id, post_type, post_id, storage_name, original_name, mime_type, byte_size, created_at) VALUES (?, 'news', ?, ?, ?, ?, ?, ?)`)
          .run(video.id, newsId, video.storageName, video.originalName, video.mime, video.byteSize, now)
        if (video) queueVideo(db, video.id)
      })()
    } catch (error) {
      removeFiles(written)
      return next(error)
    }
    audit(db, { actorType: 'staff', actorId: req.staffSession.principal_id, event: 'news_published', targetType: 'news', targetId: newsId })
    res.status(201).json({ ok: true, data: { id: newsId, status: 'published', images: files.map((file) => `/api/media/news/${file.id}`), video: video ? `/api/media/video/${video.id}` : null } })
  })

  router.patch('/news/:id', requireRoles('campus_admin', 'super_admin'), (req, res, next) => {
    const title = cleanText(req.body.title, { min: 1, max: 120 })
    const body = cleanText(req.body.body, { min: 0, max: 12000 })
    const status = ['published', 'archived'].includes(req.body.status) ? req.body.status : null
    if (!title || body === null || !status) return next(new ApiError(422, 'news_invalid', '新闻标题、正文或状态无效。'))
    const result = db.transaction(() => {
      const updated = db.prepare('UPDATE news SET title = ?, body = ?, status = ?, updated_at = ? WHERE id = ?')
        .run(title, body, status, nowIso(), req.params.id)
      if (updated.changes && status === 'archived') db.prepare("DELETE FROM notifications WHERE post_type = 'news' AND post_id = ?").run(req.params.id)
      return updated
    })()
    if (!result.changes) return next(new ApiError(404, 'not_found', '新闻不存在。'))
    audit(db, { actorType: 'staff', actorId: req.staffSession.principal_id, event: 'news_updated', targetType: 'news', targetId: req.params.id, metadata: { status } })
    res.json({ ok: true, data: { id: req.params.id, status } })
  })

  router.get('/applications', requireRoles('super_admin'), (req, res) => {
    const items = db.prepare(`SELECT id, email, applicant_type, details_json, status, consent_at, review_note, created_at, decided_at
      FROM staff_applications ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at ASC LIMIT 200`).all()
      .map((item) => ({ ...item, details: JSON.parse(item.details_json), details_json: undefined }))
    res.json({ ok: true, data: { items } })
  })

  router.post('/staff/manual', requireRoles('super_admin'), loginLimiter, asyncRoute(async (req, res) => {
    const email = normalizeEmail(req.body.email)
    if (!email) throw new ApiError(422, 'email_invalid', '请输入有效邮箱。')
    const user = db.prepare('SELECT id, member_type, status FROM users WHERE email = ?').get(email)
    if (!user || user.status !== 'active') throw new ApiError(404, 'user_not_found', '数据库中没有这个可用的普通用户账号。')
    if (db.prepare('SELECT id FROM staff_accounts WHERE email = ?').get(email)) throw new ApiError(409, 'staff_exists', '该邮箱已经是管理员。')
    const role = user.member_type === 'current_student' ? 'campus_admin' : 'alumni_admin'
    const initialPassword = `${randomToken(18)}Aa1`
    const passwordHash = await hashPassword(initialPassword)
    const staffId = id()
    const now = nowIso()
    db.transaction(() => {
      db.prepare(`INSERT INTO staff_accounts (id, email, password_hash, role, status, must_change_password, activated_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'active', 1, ?, ?, ?)`).run(staffId, email, passwordHash, role, now, now, now)
      db.prepare(`UPDATE staff_applications SET status = 'approved', reviewed_by = ?, review_note = ?, decided_at = ?, purge_after = ?, updated_at = ?
        WHERE user_id = ? AND status = 'pending'`).run(req.staffSession.principal_id, '超级管理员手动添加', now, addTime({ days: 30 }), now, user.id)
      audit(db, { actorType: 'staff', actorId: req.staffSession.principal_id, event: 'staff_manually_added', targetType: 'staff', targetId: staffId, metadata: { role } })
    })()
    res.set('Cache-Control', 'no-store').status(201).json({ ok: true, data: { id: staffId, email, role, initialPassword, message: '管理员已添加。请安全地将初始密码交给本人，首次登录需修改密码。' } })
  }))

  router.post('/applications/:id/decision', requireRoles('super_admin'), asyncRoute(async (req, res) => {
    const action = req.body.action
    const note = req.body.note ? cleanText(req.body.note, { min: 2, max: 500 }) : null
    if (!['approve', 'reject'].includes(action)) throw new ApiError(422, 'action_invalid', '请选择通过或拒绝。')
    if (action === 'reject' && !note) throw new ApiError(422, 'reason_required', '拒绝申请时必须填写原因。')
    const application = db.prepare("SELECT * FROM staff_applications WHERE id = ? AND status = 'pending'").get(req.params.id)
    if (!application) throw new ApiError(404, 'not_found', '待审核申请不存在。')
    const now = nowIso()
    const purgeAfter = addTime({ days: 30 })

    if (action === 'reject') {
      db.prepare(`UPDATE staff_applications SET status = 'rejected', reviewed_by = ?, review_note = ?, decided_at = ?, purge_after = ?, updated_at = ? WHERE id = ?`)
        .run(req.staffSession.principal_id, note, now, purgeAfter, now, application.id)
      audit(db, { actorType: 'staff', actorId: req.staffSession.principal_id, event: 'staff_application_rejected', targetType: 'staff_application', targetId: application.id })
      return res.json({ ok: true, data: { id: application.id, status: 'rejected' } })
    }

    if (!mailer.configured) throw new ApiError(503, 'mail_not_configured', '邮件服务尚未配置，无法发送管理员初始密码。')
    const role = application.applicant_type === 'current_student' ? 'campus_admin' : 'alumni_admin'
    if (db.prepare('SELECT id FROM staff_accounts WHERE email = ?').get(application.email)) {
      throw new ApiError(409, 'staff_exists', '该邮箱已有管理员账号，请先核对现有账号。')
    }
    const staffId = id()
    const initialPassword = `${randomToken(18)}Aa1`
    const passwordHash = await hashPassword(initialPassword)
    db.prepare(`INSERT INTO staff_accounts (id, email, password_hash, role, status, must_change_password, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'pending_activation', 1, ?, ?)`)
      .run(staffId, application.email, passwordHash, role, now, now)
    try {
      await mailer.sendStaffInitialPassword(application.email, initialPassword)
    } catch {
      db.prepare("DELETE FROM staff_accounts WHERE id = ? AND status = 'pending_activation'").run(staffId)
      audit(db, { actorType: 'system', event: 'staff_initial_email_failed', targetType: 'staff_application', targetId: application.id })
      throw new ApiError(502, 'mail_delivery_failed', '初始密码邮件发送失败，申请仍待审批，请稍后重试。')
    }
    db.transaction(() => {
      db.prepare("UPDATE staff_accounts SET status = 'active', activated_at = ?, updated_at = ? WHERE id = ?").run(now, now, staffId)
      db.prepare(`UPDATE staff_applications SET status = 'approved', reviewed_by = ?, review_note = ?, decided_at = ?, purge_after = ?, updated_at = ? WHERE id = ?`)
        .run(req.staffSession.principal_id, note, now, purgeAfter, now, application.id)
    })()
    audit(db, { actorType: 'staff', actorId: req.staffSession.principal_id, event: 'staff_application_approved', targetType: 'staff_application', targetId: application.id })
    res.json({ ok: true, data: { id: application.id, status: 'approved', staffId, message: '申请已批准，初始密码已发送到申请邮箱。首次登录须修改密码。' } })
  }))

  router.post('/staff/:id/resend-activation', requireRoles('super_admin'), asyncRoute(async (req, res) => {
    if (!mailer.configured) throw new ApiError(503, 'mail_not_configured', '邮件服务尚未配置。')
    const staff = db.prepare("SELECT id, email FROM staff_accounts WHERE id = ? AND status = 'pending_activation'").get(req.params.id)
    if (!staff) throw new ApiError(404, 'not_found', '待激活管理员不存在。')
    const token = createEmailToken(db, 'staff', staff.id, 'activate_staff', addTime({ hours: 24 }))
    await mailer.sendStaffActivation(staff.email, token)
    res.json({ ok: true, data: { message: '激活邮件已重新发送。' } })
  }))

  router.get('/audit', requireRoles('super_admin'), (req, res) => {
    const items = db.prepare(`SELECT id, actor_type, actor_id, event_name, target_type, target_id, metadata_json, created_at
      FROM audit_events ORDER BY created_at DESC LIMIT 300`).all()
      .map((item) => ({ ...item, metadata: item.metadata_json ? JSON.parse(item.metadata_json) : null, metadata_json: undefined }))
    res.json({ ok: true, data: { items } })
  })

  return router
}
