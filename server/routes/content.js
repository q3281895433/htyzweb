import path from 'node:path'
import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { nowIso } from '../db.js'
import { ApiError, asyncRoute, audit, cleanText, id } from '../security.js'
import { parsePage, requireUser } from '../middleware.js'
import { checkedPostImage, checkedVideo, cleanupUploadTemps, limitPostBody, postMediaUpload, moveImages, removeFiles } from '../uploads.js'
import { queueVideo } from '../video-worker.js'

const contributionCategories = ['campus_life', 'writing', 'photo_story', 'graduate_note']
const suggestionCategories = ['feature', 'experience', 'join_us', 'other']

/** 视频所属帖子的表名与作者字段 */
const VIDEO_POST_TABLES = {
  moment: { table: 'moments', ownerColumn: 'user_id' },
  wall: { table: 'wall_posts', ownerColumn: 'user_id' },
  contribution: { table: 'contributions', ownerColumn: 'user_id' },
  news: { table: 'news', ownerColumn: 'created_by' },
}

/**
 * 判断当前请求方能否访问该视频。
 * 规则：公开帖子（已过审）对登录用户可见；未过审时仅作者与管理员可见。
 */
export function videoAccess(db, video, req) {
  const meta = VIDEO_POST_TABLES[video.post_type]
  if (!meta) return { allowed: false, publicPost: false }
  const post = db
    .prepare(`SELECT status, ${meta.ownerColumn} AS owner_id FROM ${meta.table} WHERE id = ?`)
    .get(video.post_id)
  if (!post) return { allowed: false, publicPost: false }

  const publicPost = post.status === (video.post_type === 'news' ? 'published' : 'approved')
  const isOwner = req.userSession?.principal_id === post.owner_id
  const isStaff = Boolean(req.staffSession)
  return { allowed: publicPost || isOwner || isStaff, publicPost, post }
}

/**
 * 视频对外的统一描述。
 * 前端靠 status 决定显示「播放 / 处理中 / 处理失败」，靠 poster 显示封面，
 * 不再把未处理完的地址直接丢给 <video>（那正是「视频格式错误」的来源）。
 */
export function videoPayload(video) {
  if (!video) return null
  return {
    id: video.id,
    url: `/api/media/video/${video.id}`,
    poster: video.poster_name ? `/api/media/poster/${video.id}` : null,
    status: video.status || 'ready',
    codec: video.codec || null,
    width: video.width || null,
    height: video.height || null,
    durationSeconds: video.duration_seconds || null,
    processNote: video.process_note || null,
    errorMessage: video.error_message || null,
  }
}

/**
 * 列表/详情查询里取视频的公共 SELECT 片段。
 * 用法：在 SQL 中加 `${VIDEO_SELECT}` 与 `${VIDEO_JOIN}`。
 */
export const VIDEO_SELECT = 'v.id AS video_id, v.status AS video_status, v.poster_name AS video_poster'
export const VIDEO_JOIN = "LEFT JOIN post_videos v ON v.post_type = '{TYPE}' AND v.post_id = {ID}"

/**
 * 给响应对象补上视频封面与处理状态。
 * 会剔除内部字段（storage_name / poster_name 等），避免把服务器文件名泄露给前端。
 */
export function applyVideoMeta(obj, row) {
  obj.videoPoster = row.video_id && row.video_poster ? `/api/media/poster/${row.video_id}` : null
  obj.videoStatus = row.video_id ? (row.video_status || 'ready') : null
  delete obj.video_id
  delete obj.video_status
  delete obj.video_poster
  return obj
}

function publicContribution(row) {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    body: row.body,
    authorType: row.member_type,
    author: { id: row.user_id, username: row.username || '社区成员', grade: row.grade, avatar: row.avatar_storage_name ? `/api/avatar/${row.user_id}` : null },
    publishedAt: row.published_at,
    images: row.image_ids ? row.image_ids.split(',').filter(Boolean).map((imageId) => `/api/media/${imageId}`) : [],
    video: videoPayload(row.video_record),
    videoUrl: row.video_id ? `/api/media/video/${row.video_id}` : null
  }
}

export function createContentRouter({ db, config }) {
  const router = Router()
  const upload = postMediaUpload(config)
  const writeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false })

  router.get('/public/home', (req, res) => {
    const counts = {
      users: db.prepare("SELECT COUNT(*) AS count FROM users WHERE status = 'active'").get().count,
      contributions: db.prepare("SELECT COUNT(*) AS count FROM contributions WHERE status = 'approved'").get().count,
      news: db.prepare("SELECT COUNT(*) AS count FROM news WHERE status = 'published'").get().count,
      questions: db.prepare("SELECT COUNT(*) AS count FROM questions WHERE status = 'approved'").get().count,
      moments: db.prepare("SELECT COUNT(*) AS count FROM moments WHERE status = 'approved'").get().count,
      wall: db.prepare("SELECT COUNT(*) AS count FROM wall_posts WHERE status = 'approved'").get().count
    }
    const contribution = db.prepare(`SELECT c.*, u.member_type, u.username, u.grade, u.avatar_storage_name,
      (SELECT id FROM post_videos WHERE post_type = 'contribution' AND post_id = c.id) AS video_id,
      GROUP_CONCAT(i.id) AS image_ids
      FROM contributions c JOIN users u ON u.id = c.user_id
      LEFT JOIN contribution_images i ON i.contribution_id = c.id
      WHERE c.status = 'approved'
      GROUP BY c.id ORDER BY c.published_at DESC LIMIT 1`).get()
    const news = db.prepare(`SELECT n.id, n.title, n.body, n.published_at,
      (SELECT id FROM post_videos WHERE post_type = 'news' AND post_id = n.id) AS video_id,
      GROUP_CONCAT(i.id) AS image_ids
      FROM news n LEFT JOIN news_images i ON i.news_id = n.id
      WHERE n.status = 'published' GROUP BY n.id ORDER BY n.published_at DESC LIMIT 1`).get() || null
    if (news) {
      news.images = news.image_ids ? news.image_ids.split(',').filter(Boolean).map((imageId) => `/api/media/news/${imageId}`) : []
      news.video = news.video_id ? `/api/media/video/${news.video_id}` : null
      delete news.image_ids
    }
    const question = db.prepare(`SELECT q.id, q.title, q.body, q.published_at,
      (SELECT COUNT(*) FROM answers a WHERE a.question_id = q.id AND a.status = 'approved') AS answer_count
      FROM questions q WHERE q.status = 'approved' ORDER BY q.published_at DESC LIMIT 1`).get() || null
    res.json({ ok: true, data: { counts, contribution: contribution ? publicContribution(contribution) : null, news, question } })
  })

  router.use('/public', requireUser)

  router.get('/public/contributions', (req, res) => {
    const { limit, offset } = parsePage(req)
    const category = contributionCategories.includes(req.query.category) ? req.query.category : null
    const rows = db.prepare(`SELECT c.*, u.member_type, u.username, u.grade, u.avatar_storage_name,
      (SELECT id FROM post_videos WHERE post_type = 'contribution' AND post_id = c.id) AS video_id, GROUP_CONCAT(i.id) AS image_ids
      FROM contributions c JOIN users u ON u.id = c.user_id
      LEFT JOIN contribution_images i ON i.contribution_id = c.id
      WHERE c.status = 'approved' AND (? IS NULL OR c.category = ?)
      GROUP BY c.id ORDER BY c.published_at DESC LIMIT ? OFFSET ?`)
      .all(category, category, limit, offset)
    res.json({ ok: true, data: { items: rows.map(publicContribution), limit, offset } })
  })

  router.get('/public/contributions/:id', (req, res, next) => {
    const row = db.prepare(`SELECT c.*, u.member_type, u.username, u.grade, u.avatar_storage_name,
      (SELECT id FROM post_videos WHERE post_type = 'contribution' AND post_id = c.id) AS video_id, GROUP_CONCAT(i.id) AS image_ids
      FROM contributions c JOIN users u ON u.id = c.user_id
      LEFT JOIN contribution_images i ON i.contribution_id = c.id
      WHERE c.id = ? AND c.status = 'approved' GROUP BY c.id`).get(req.params.id)
    if (!row) return next(new ApiError(404, 'not_found', '没有找到这篇投稿。'))
    res.json({ ok: true, data: publicContribution(row) })
  })

  router.post('/contributions', requireUser, writeLimiter, limitPostBody, upload.fields([{ name: 'images', maxCount: 9 }, { name: 'video', maxCount: 1 }]), cleanupUploadTemps, (req, res, next) => {
    const category = req.body.category
    const title = cleanText(req.body.title, { min: 1, max: 100 })
    const body = cleanText(req.body.body, { min: 0, max: 12000 })
    if (!contributionCategories.includes(category)) return next(new ApiError(422, 'category_invalid', '请选择有效投稿分类。'))
    if (!title) return next(new ApiError(422, 'title_invalid', '请填写标题，最多 100 字。'))
    const uploadedImages = req.files?.images || []
    if (body === null || (!body && !uploadedImages.length && !req.files?.video?.length)) return next(new ApiError(422, 'body_invalid', '请填写正文或上传图片、视频。'))

    let files, video
    try { files = uploadedImages.map((file) => checkedPostImage(file, config)); video = checkedVideo(req.files?.video?.[0]) } catch (error) { return next(error) }

    const contributionId = id()
    const now = nowIso()
    let written = []
    try {
      written = moveImages(config, [...files, ...(video ? [video] : [])])
      db.transaction(() => {
        db.prepare(`INSERT INTO contributions
          (id, user_id, category, title, body, status, published_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'approved', ?, ?, ?)`)
          .run(contributionId, req.userSession.principal_id, category, title, body, now, now, now)
        const insertImage = db.prepare(`INSERT INTO contribution_images
          (id, contribution_id, storage_name, original_name, mime_type, byte_size, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`)
        for (const file of files) {
          insertImage.run(file.id, contributionId, file.storageName, file.originalName, file.mime, file.byteSize, now)
        }
        if (video) db.prepare(`INSERT INTO post_videos (id, post_type, post_id, storage_name, original_name, mime_type, byte_size, created_at) VALUES (?, 'contribution', ?, ?, ?, ?, ?, ?)`)
          .run(video.id, contributionId, video.storageName, video.originalName, video.mime, video.byteSize, now)
        if (video) queueVideo(db, video.id)
      })()
    } catch (error) {
      removeFiles(written)
      return next(error)
    }
    audit(db, { actorType: 'user', actorId: req.userSession.principal_id, event: 'contribution_submitted', targetType: 'contribution', targetId: contributionId })
    res.status(201).json({ ok: true, data: { id: contributionId, status: 'approved', message: '投稿已发布。' } })
  })

  router.get('/media/:id', (req, res, next) => {
    const image = db.prepare(`SELECT i.*, c.status, c.user_id FROM contribution_images i
      JOIN contributions c ON c.id = i.contribution_id WHERE i.id = ?`).get(req.params.id)
    if (!image) return next(new ApiError(404, 'not_found', '图片不存在。'))
    const mayView = image.status === 'approved'
      || req.userSession?.principal_id === image.user_id
      || Boolean(req.staffSession)
    if (!mayView) return next(new ApiError(404, 'not_found', '图片不存在。'))
    res.set({
      'Content-Type': image.mime_type,
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': image.status === 'approved' ? 'public, max-age=86400' : 'private, no-store'
    })
    res.sendFile(path.join(config.uploadDir, image.storage_name))
  })

  router.get('/media/news/:id', (req, res, next) => {
    const image = db.prepare(`SELECT i.*, n.status FROM news_images i
      JOIN news n ON n.id = i.news_id WHERE i.id = ?`).get(req.params.id)
    if (!image || image.status !== 'published') return next(new ApiError(404, 'not_found', '图片不存在。'))
    res.set({
      'Content-Type': image.mime_type,
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=86400'
    })
    res.sendFile(path.join(config.uploadDir, image.storage_name))
  })

  // ------------------------------------------------------------
  // 视频播放
  // 自动转码完成后，这里返回的一定是浏览器可直接播放的 H.264 MP4。
  // ------------------------------------------------------------
  router.get('/media/video/:id', requireUser, (req, res, next) => {
    const video = db.prepare('SELECT * FROM post_videos WHERE id = ?').get(req.params.id)
    if (!video) return next(new ApiError(404, 'not_found', '视频不存在。'))
    const access = videoAccess(db, video, req)
    if (!access.allowed) return next(new ApiError(404, 'not_found', '视频不存在。'))

    // 转码尚未完成或失败时不返回可播地址，给出明确的 JSON 说明。
    // 前端据此显示「处理中」或「处理失败」，而不是让 <video> 报「格式错误」。
    if (video.status === 'processing') {
      return res.status(409).json({
        ok: false,
        error: { code: 'video_processing', message: '视频正在处理中，请稍候。' },
        data: { status: 'processing', progressNote: video.process_note || null }
      })
    }
    if (video.status === 'failed') {
      return res.status(422).json({
        ok: false,
        error: { code: 'video_failed', message: video.error_message || '视频处理失败。' },
        data: { status: 'failed' }
      })
    }

    res.set({
      'Content-Type': 'video/mp4',
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': access.publicPost ? 'private, max-age=86400' : 'private, no-store'
    })
    res.sendFile(path.join(config.uploadDir, video.storage_name), { acceptRanges: true })
  })

  /** 视频封面图（转码时自动抽取，列表页只加载它，不加载视频本体） */
  router.get('/media/poster/:id', (req, res, next) => {
    const video = db.prepare('SELECT * FROM post_videos WHERE id = ?').get(req.params.id)
    if (!video) return next(new ApiError(404, 'not_found', '视频不存在。'))
    const access = videoAccess(db, video, req)
    if (!access.allowed) return next(new ApiError(404, 'not_found', '视频不存在。'))
    if (!video.poster_name) return next(new ApiError(404, 'poster_not_ready', '封面尚未生成。'))
    res.set({
      'Content-Type': 'image/jpeg',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': access.publicPost ? 'public, max-age=604800' : 'private, no-store'
    })
    res.sendFile(path.join(config.uploadDir, video.poster_name))
  })

  /** 视频处理状态（上传后前端轮询，处理完成即自动变为可播放） */
  router.get('/media/video/:id/status', requireUser, (req, res, next) => {
    const video = db.prepare('SELECT * FROM post_videos WHERE id = ?').get(req.params.id)
    if (!video) return next(new ApiError(404, 'not_found', '视频不存在。'))
    const access = videoAccess(db, video, req)
    if (!access.allowed) return next(new ApiError(404, 'not_found', '视频不存在。'))
    res.json({
      ok: true,
      data: {
        id: video.id,
        status: video.status || 'ready',
        processNote: video.process_note || null,
        errorMessage: video.error_message || null,
        hasPoster: Boolean(video.poster_name),
        codec: video.codec || null,
        width: video.width || null,
        height: video.height || null,
        durationSeconds: video.duration_seconds || null
      }
    })
  })

  router.get('/public/news', (req, res) => {
    const { limit, offset } = parsePage(req)
    const rows = db.prepare(`SELECT n.id, n.title, n.body, n.published_at, n.updated_at,
      (SELECT v.id FROM post_videos v WHERE v.post_type = 'news' AND v.post_id = n.id) AS video_id,
      (SELECT v.status FROM post_videos v WHERE v.post_type = 'news' AND v.post_id = n.id) AS video_status,
      (SELECT v.poster_name FROM post_videos v WHERE v.post_type = 'news' AND v.post_id = n.id) AS video_poster,
      GROUP_CONCAT(i.id) AS image_ids
      FROM news n LEFT JOIN news_images i ON i.news_id = n.id
      WHERE n.status = 'published' GROUP BY n.id ORDER BY n.published_at DESC LIMIT ? OFFSET ?`).all(limit, offset)
      .map((row) => {
        const { video_status, video_poster, ...rest } = row
        return applyVideoMeta({
          ...rest,
          images: row.image_ids ? row.image_ids.split(',').filter(Boolean).map((imageId) => `/api/media/news/${imageId}`) : [],
          video: row.video_id ? `/api/media/video/${row.video_id}` : null,
          image_ids: undefined
        }, row)
      })
    res.json({ ok: true, data: { items: rows, limit, offset } })
  })

  router.get('/public/questions', (req, res) => {
    const { limit, offset } = parsePage(req)
    const rows = db.prepare(`SELECT q.id, q.title, q.body, q.published_at, u.id AS authorId, u.username AS authorName, u.grade, u.member_type AS authorType,
      (SELECT COUNT(*) FROM answers a WHERE a.question_id = q.id AND a.status = 'approved') AS answer_count
      FROM questions q JOIN users u ON u.id = q.user_id WHERE q.status = 'approved' ORDER BY q.published_at DESC LIMIT ? OFFSET ?`).all(limit, offset)
    res.json({ ok: true, data: { items: rows, limit, offset } })
  })

  router.get('/public/questions/:id', (req, res, next) => {
    const question = db.prepare(`SELECT q.id, q.title, q.body, q.published_at, u.id AS authorId, u.username AS authorName, u.grade, u.member_type AS authorType FROM questions q JOIN users u ON u.id = q.user_id WHERE q.id = ? AND q.status = 'approved'`).get(req.params.id)
    if (!question) return next(new ApiError(404, 'not_found', '问题不存在。'))
    const answers = db.prepare(`SELECT a.id, a.body, a.published_at, u.id AS authorId, u.username AS authorName, u.grade, u.member_type AS authorType FROM answers a JOIN users u ON u.id = a.user_id
      WHERE a.question_id = ? AND a.status = 'approved' ORDER BY a.published_at ASC`).all(question.id)
    res.json({ ok: true, data: { ...question, answers } })
  })

  router.post('/questions', requireUser, writeLimiter, (req, res, next) => {
    const title = cleanText(req.body.title, { min: 1, max: 100 })
    const body = cleanText(req.body.body, { min: 1, max: 5000 })
    if (!title || !body) return next(new ApiError(422, 'question_invalid', '请填写问题标题与说明。'))
    const questionId = id()
    const now = nowIso()
    db.prepare(`INSERT INTO questions (id, user_id, title, body, status, published_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'approved', ?, ?, ?)`)
      .run(questionId, req.userSession.principal_id, title, body, now, now, now)
    audit(db, { actorType: 'user', actorId: req.userSession.principal_id, event: 'question_submitted', targetType: 'question', targetId: questionId })
    res.status(201).json({ ok: true, data: { id: questionId, status: 'approved', message: '问题已发布。' } })
  })

  router.post('/questions/:id/answers', requireUser, writeLimiter, (req, res, next) => {
    const question = db.prepare("SELECT id FROM questions WHERE id = ? AND status = 'approved'").get(req.params.id)
    if (!question) return next(new ApiError(404, 'not_found', '问题不存在或尚未公开。'))
    const body = cleanText(req.body.body, { min: 1, max: 5000 })
    if (!body) return next(new ApiError(422, 'answer_invalid', '请填写回答。'))
    const answerId = id()
    const now = nowIso()
    db.prepare(`INSERT INTO answers (id, question_id, user_id, body, status, published_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'approved', ?, ?, ?)`)
      .run(answerId, question.id, req.userSession.principal_id, body, now, now, now)
    audit(db, { actorType: 'user', actorId: req.userSession.principal_id, event: 'answer_submitted', targetType: 'answer', targetId: answerId })
    res.status(201).json({ ok: true, data: { id: answerId, status: 'approved', message: '回答已发布。' } })
  })

  router.post('/suggestions', requireUser, writeLimiter, (req, res, next) => {
    const category = req.body.category
    const body = cleanText(req.body.body, { min: 1, max: 3000 })
    const contact = req.body.contact ? cleanText(req.body.contact, { min: 2, max: 100 }) : null
    if (!suggestionCategories.includes(category)) return next(new ApiError(422, 'category_invalid', '请选择建议类型。'))
    if (!body) return next(new ApiError(422, 'suggestion_invalid', '请填写建议内容。'))
    const suggestionId = id()
    const now = nowIso()
    db.prepare(`INSERT INTO suggestions (id, user_id, category, body, contact, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'new', ?, ?)`)
      .run(suggestionId, req.userSession.principal_id, category, body, contact, now, now)
    audit(db, { actorType: 'user', actorId: req.userSession.principal_id, event: 'suggestion_submitted', targetType: 'suggestion', targetId: suggestionId })
    res.status(201).json({ ok: true, data: { id: suggestionId, message: '建议已提交给网站负责人。' } })
  })

  router.post('/staff-applications', requireUser, writeLimiter, (req, res, next) => {
    const userId = req.userSession.principal_id
    if (!db.prepare('SELECT email_verified_at FROM users WHERE id = ?').get(userId)?.email_verified_at) return next(new ApiError(403, 'email_unverified', '申请管理员前请先验证注册邮箱。'))
    const existing = db.prepare("SELECT id FROM staff_applications WHERE user_id = ? AND status = 'pending'").get(userId)
    if (existing) return next(new ApiError(409, 'application_pending', '你已经有一份待审核的管理员申请。'))
    const applicantType = req.body.applicantType
    if (applicantType !== req.userSession.member_type) return next(new ApiError(422, 'applicant_type_mismatch', '申请类型需要与注册身份一致。'))
    if (req.body.consent !== true) return next(new ApiError(422, 'consent_required', '请确认管理员申请信息的使用与清理说明。'))

    let details
    if (applicantType === 'current_student') {
      const commuteMode = ['day', 'boarding'].includes(req.body.commuteMode) ? req.body.commuteMode : null
      const className = cleanText(req.body.className, { min: 1, max: 40 })
      const studyStable = typeof req.body.studyStable === 'boolean' ? req.body.studyStable : null
      const studentUnion = typeof req.body.studentUnion === 'boolean' ? req.body.studentUnion : null
      if (!commuteMode || !className || studyStable === null || studentUnion === null) {
        return next(new ApiError(422, 'student_details_incomplete', '请完整填写走读/住校、班级、学习状态和学生会情况。'))
      }
      details = { commuteMode, className, studyStable, studentUnion }
    } else {
      const collegeYear = cleanText(req.body.collegeYear, { min: 1, max: 20 })
      const major = cleanText(req.body.major, { min: 1, max: 80 })
      if (!collegeYear || !major) return next(new ApiError(422, 'graduate_details_incomplete', '请填写年级和专业。'))
      details = { collegeYear, major }
    }

    const applicationId = id()
    const now = nowIso()
    db.prepare(`INSERT INTO staff_applications
      (id, user_id, email, applicant_type, details_json, status, consent_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`)
      .run(applicationId, userId, req.userSession.email, applicantType, JSON.stringify(details), now, now, now)
    audit(db, { actorType: 'user', actorId: userId, event: 'staff_application_submitted', targetType: 'staff_application', targetId: applicationId })
    res.status(201).json({ ok: true, data: { id: applicationId, status: 'pending', message: '管理员申请已提交。审核结果会通过邮件通知。' } })
  })

  return router
}
