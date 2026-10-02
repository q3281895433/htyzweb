import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import request from 'supertest'
import { FFMPEG, FFPROBE, generateVideo, makeTempDir, probeFile, videoToolingAvailable } from './video-helpers.js'

// 必须在业务模块真正调用 ffmpeg 之前固定路径（worker 在模块加载时读取环境变量），
// 因此这里用动态 import 而不是静态 import。
if (FFMPEG) process.env.FFMPEG_PATH = FFMPEG
if (FFPROBE) process.env.FFPROBE_PATH = FFPROBE

const { createApp } = await import('../server/app.js')
const { nowIso, openDatabase } = await import('../server/db.js')
const { hashPassword, id } = await import('../server/security.js')
const { queueVideo, processVideoNow } = await import('../server/video-worker.js')

const onePixelPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
const smallMp4 = Buffer.from([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0])

function createHarness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'htyz-integration-'))
  const config = {
    isProduction: false,
    siteOrigin: 'http://localhost',
    sessionSecret: 'test-secret-that-is-long-enough-for-security',
    sessionDays: 60,
    uploadMaxMb: 2,
    dbPath: path.join(root, 'data', 'test.db'),
    uploadDir: path.join(root, 'uploads'),
    distDir: path.resolve('dist'),
    ownerQQ: '3281895433',
    mail: {}
  }
  const db = openDatabase(config.dbPath)
  const messages = { verification: [], reset: [], staffActivation: [], initialPassword: [] }
  const mailer = {
    configured: true,
    sendVerification: async (email, token) => messages.verification.push({ email, token }),
    sendReset: async (email, token) => messages.reset.push({ email, token }),
    sendStaffActivation: async (email, token) => messages.staffActivation.push({ email, token }),
    sendStaffInitialPassword: async (email, password) => messages.initialPassword.push({ email, password })
  }
  const app = createApp({ db, config, mailer })
  return { root, config, db, messages, app, close: () => { db.close(); fs.rmSync(root, { recursive: true, force: true }) } }
}

async function csrf(agent) {
  const response = await agent.get('/api/session').expect(200)
  return response.body.data.csrfToken
}

async function registerAndLogin(agent, harness, { email, password, memberType }) {
  const token = await csrf(agent)
  await agent.post('/api/auth/register').set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', token)
    .send({ email, password, memberType, grade: memberType === 'graduate' ? '大一' : '高一', privacyAccepted: true }).expect(201)
  await agent.post('/api/auth/login').set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', token)
    .send({ email, password }).expect(200)
  return token
}

test('immediate publication, post removal, account ban and staff approval workflows', async (t) => {
  const harness = createHarness()
  t.after(harness.close)
  const publicClient = request(harness.app)

  const empty = await publicClient.get('/api/public/home').expect(200)
  assert.deepEqual(empty.body.data.counts, { users: 0, contributions: 0, news: 0, questions: 0, moments: 0, wall: 0 })
  assert.equal(empty.body.data.contribution, null)
  await publicClient.get('/api/public/moments').expect(401)
  await publicClient.get('/api/public/wall').expect(401)
  await publicClient.get('/api/public/contributions').expect(401)
  await publicClient.get('/api/public/questions').expect(401)
  await publicClient.get('/api/public/news').expect(401)

  const student = request.agent(harness.app)
  const studentCsrf = await registerAndLogin(student, harness, {
    email: 'student@example.com', password: 'StudentPass123', memberType: 'current_student'
  })

  await student.patch('/api/me/profile').set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', studentCsrf)
    .send({ username: '测试同学', bio: '临时数据库中的测试资料。' }).expect(200)
  await student.post('/api/me/avatar').set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', studentCsrf)
    .attach('avatar', onePixelPng, { filename: 'avatar.png', contentType: 'image/png' }).expect(200)
  const moment = await student.post('/api/moments').set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', studentCsrf)
    .field('body', '这是一条立即发布的真实测试动态。')
    .attach('images', onePixelPng, { filename: 'moment.png', contentType: 'image/png' }).expect(201)
  const wall = await student.post('/api/wall').set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', studentCsrf)
    .field('body', '这是一条前台匿名的校园墙测试内容。').field('anonymous', 'true').expect(201)

  const contribution = await student.post('/api/contributions').set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', studentCsrf)
    .field('category', 'campus_life').field('title', "图书馆门口的雨 ' 与参数化查询").field('body', '这是一篇真实测试请求产生的投稿内容，用于验证数据库写入与立即公开读取流程。').expect(201)
  const contributionId = contribution.body.data.id
  assert.equal(contribution.body.data.status, 'approved')
  assert.equal((await student.get('/api/public/contributions')).body.data.items.length, 1)

  const question = await student.post('/api/questions').set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', studentCsrf)
    .send({ title: '如何准备大学专业选择？', body: '想了解毕业生在选择专业时重点考虑了哪些真实因素。' }).expect(201)
  const questionId = question.body.data.id

  await student.post('/api/suggestions').set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', studentCsrf)
    .send({ category: 'feature', body: '希望以后可以增加校园活动日历。', contact: '' }).expect(201)

  const application = { applicantType: 'current_student', commuteMode: 'day', className: '高二某班', studyStable: true, studentUnion: false, consent: true }
  await student.post('/api/staff-applications').set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', studentCsrf)
    .send(application).expect(403)
  assert.equal(harness.messages.verification.length, 0)
  await student.post('/api/auth/verify-for-staff').set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', studentCsrf).expect(200)
  const verification = harness.messages.verification.find((item) => item.email === 'student@example.com')
  assert.ok(verification?.token)
  await student.post('/api/auth/verify').set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', studentCsrf)
    .send({ token: verification.token }).expect(200)
  await student.post('/api/staff-applications').set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', studentCsrf)
    .send(application).expect(201)

  const now = nowIso()
  const superId = id()
  harness.db.prepare(`INSERT INTO staff_accounts (id, email, password_hash, role, status, activated_at, created_at, updated_at)
    VALUES (?, ?, ?, 'super_admin', 'active', ?, ?, ?)`)
    .run(superId, 'owner@example.com', await hashPassword('OwnerPass123'), now, now, now)

  const staff = request.agent(harness.app)
  const staffCsrf = await csrf(staff)
  await staff.post('/api/htyzSlowSnow/auth/login').set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', staffCsrf)
    .send({ email: 'owner@example.com', password: 'OwnerPass123' }).expect(200)

  await staff.get('/api/htyzSlowSnow/moderation/pending').expect(404)
  const posts = await staff.get('/api/htyzSlowSnow/posts?type=moment').expect(200)
  assert.equal(posts.body.data.items[0].id, moment.body.data.id)
  assert.equal((await student.get('/api/public/moments')).body.data.items[0].author.username, '测试同学')
  assert.equal((await student.get('/api/public/wall')).body.data.items[0].author, null)

  const published = await student.get('/api/public/contributions').expect(200)
  assert.equal(published.body.data.items[0].title, "图书馆门口的雨 ' 与参数化查询")

  const news = await staff.post('/api/htyzSlowSnow/news').set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', staffCsrf)
    .field('title', '测试发布流程').field('body', '这条记录由自动化测试创建在临时数据库中，不会进入生产数据库。')
    .attach('images', onePixelPng, { filename: 'news.png', contentType: 'image/png' }).expect(201)

  // 管理端的新闻列表曾被一次视频字段改动改坏（在对象字面量上调用 .map() 导致 500），
  // 而当时只测了「创建」没测「列表」。这里把列表读取固定住。
  const staffNews = await staff.get('/api/htyzSlowSnow/news').expect(200)
  assert.ok(Array.isArray(staffNews.body.data.items), '管理端新闻列表应返回数组')
  assert.equal(staffNews.body.data.items.length, 1)
  assert.equal(staffNews.body.data.items[0].title, '测试发布流程')
  assert.equal(staffNews.body.data.items[0].images.length, 1)
  assert.equal(staffNews.body.data.items[0].video, null)

  const publicNews = await student.get('/api/public/news').expect(200)
  assert.equal(publicNews.body.data.items.length, 1)
  assert.equal(publicNews.body.data.items[0].images.length, 1)
  await publicClient.get(publicNews.body.data.items[0].images[0]).expect(200)
  assert.equal(news.body.data.images.length, 1)

  const applications = await staff.get('/api/htyzSlowSnow/applications').expect(200)
  assert.equal(applications.body.data.items.length, 1)
  await staff.post(`/api/htyzSlowSnow/applications/${applications.body.data.items[0].id}/decision`)
    .set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', staffCsrf)
    .send({ action: 'approve', note: '测试批准' }).expect(200)
  assert.equal(harness.messages.initialPassword.length, 1)
  const initial = harness.messages.initialPassword[0]
  assert.equal(initial.email, 'student@example.com')
  const newStaff = request.agent(harness.app)
  const newStaffCsrf = await csrf(newStaff)
  await newStaff.post('/api/htyzSlowSnow/auth/login').set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', newStaffCsrf)
    .send({ email: initial.email, password: initial.password }).expect(200)
  await newStaff.get('/api/htyzSlowSnow/posts').expect(403)
  await newStaff.post('/api/htyzSlowSnow/auth/change-password').set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', newStaffCsrf)
    .send({ oldPassword: initial.password, newPassword: 'ChangedPass456' }).expect(200)
  await newStaff.post('/api/htyzSlowSnow/auth/login').set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', newStaffCsrf)
    .send({ email: initial.email, password: 'ChangedPass456' }).expect(200)
  await newStaff.get('/api/htyzSlowSnow/posts').expect(200)

  const graduate = request.agent(harness.app)
  const graduateCsrf = await registerAndLogin(graduate, harness, {
    email: 'graduate@example.com', password: 'GraduatePass123', memberType: 'graduate'
  })
  const answer = await graduate.post(`/api/questions/${questionId}/answers`).set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', graduateCsrf)
    .send({ body: '先了解课程内容、培养方案和真实就业去向，再结合自己的长期兴趣做决定。' }).expect(201)
  const publicQuestion = await student.get(`/api/public/questions/${questionId}`).expect(200)
  assert.equal(publicQuestion.body.data.answers.length, 1)
  assert.equal(publicQuestion.body.data.answers[0].authorType, 'graduate')
  await student.post(`/api/questions/${questionId}/answers`).set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', studentCsrf)
    .send({ body: '也可以先列出自己最看重的问题。' }).expect(201)
  const graduateQuestion = await graduate.post('/api/questions').set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', graduateCsrf)
    .send({ title: '毕业生也能提问吗', body: '可以' }).expect(201)
  assert.equal((await student.get(`/api/public/questions/${graduateQuestion.body.data.id}`)).body.data.authorType, 'graduate')

  await staff.delete(`/api/htyzSlowSnow/posts/contribution/${contributionId}`).set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', staffCsrf).expect(200)
  assert.equal((await student.get('/api/public/contributions')).body.data.items.length, 0)
  const userId = harness.db.prepare('SELECT id FROM users WHERE email = ?').get('student@example.com').id
  await staff.patch(`/api/htyzSlowSnow/users/${userId}/status`).set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', staffCsrf)
    .send({ status: 'suspended' }).expect(200)
  await student.get('/api/me').expect(401)
  await student.post('/api/moments').set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', studentCsrf)
    .field('body', '被封禁账号无法发帖').expect(401)

  const auditCount = harness.db.prepare('SELECT COUNT(*) AS count FROM audit_events').get().count
  assert.ok(auditCount >= 10)
})

test('csrf, role boundaries and absolute session expiry are enforced', async (t) => {
  const harness = createHarness()
  t.after(harness.close)
  const user = request.agent(harness.app)
  const token = await csrf(user)

  await user.post('/api/auth/register').send({
    email: 'blocked@example.com', password: 'BlockedPass123', memberType: 'current_student', privacyAccepted: true
  }).expect(403)

  await registerAndLogin(user, harness, {
    email: 'student2@example.com', password: 'StudentPass123', memberType: 'current_student'
  })
  await user.post('/api/htyzSlowSnow/news').set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', token)
    .send({ title: '越权', body: '普通用户不能通过管理员新闻接口发布内容。' }).expect(401)

  harness.db.prepare("UPDATE auth_sessions SET expires_at = '2000-01-01T00:00:00.000Z' WHERE principal_type = 'user'").run()
  await user.get('/api/me').expect(401)
})

test('manual administrator fallback requires an existing user and image-only posts accept nine images', async (t) => {
  const harness = createHarness()
  t.after(harness.close)
  const user = request.agent(harness.app)
  const userCsrf = await registerAndLogin(user, harness, { email: 'manual@example.com', password: 'ManualUser123', memberType: 'graduate' })
  assert.equal(harness.messages.verification.length, 0)
  const wallRequest = user.post('/api/wall').set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', userCsrf).field('body', '')
  for (let index = 0; index < 9; index += 1) wallRequest.attach('images', onePixelPng, { filename: `wall-${index}.png`, contentType: 'image/png' })
  await wallRequest.expect(201)
  const contributionRequest = user.post('/api/contributions').set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', userCsrf)
    .field('category', 'photo_story').field('title', '图').field('body', '')
  for (let index = 0; index < 9; index += 1) contributionRequest.attach('images', onePixelPng, { filename: `contribution-${index}.png`, contentType: 'image/png' })
  await contributionRequest.expect(201)

  const now = nowIso()
  const superId = id()
  harness.db.prepare(`INSERT INTO staff_accounts (id, email, password_hash, role, status, activated_at, created_at, updated_at)
    VALUES (?, ?, ?, 'super_admin', 'active', ?, ?, ?)`).run(superId, 'owner-manual@example.com', await hashPassword('OwnerManual123'), now, now, now)
  const staff = request.agent(harness.app)
  const staffCsrf = await csrf(staff)
  const manualLogin = await staff.post('/api/htyzSlowSnow/auth/login').set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', staffCsrf)
    .send({ email: 'owner-manual@example.com', password: 'OwnerManual123' })
  assert.equal(manualLogin.status, 200, JSON.stringify(manualLogin.body))
  await staff.post('/api/htyzSlowSnow/staff/manual').set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', staffCsrf)
    .send({ email: 'absent@example.com' }).expect(404)
  const added = await staff.post('/api/htyzSlowSnow/staff/manual').set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', staffCsrf)
    .send({ email: 'manual@example.com' }).expect(201)
  assert.equal(added.body.data.role, 'alumni_admin')
  assert.ok(added.body.data.initialPassword.length >= 20)
  assert.equal(harness.messages.initialPassword.length, 0)
  await staff.post('/api/htyzSlowSnow/staff/manual').set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', staffCsrf)
    .send({ email: 'manual@example.com' }).expect(409)
  const newsRequest = staff.post('/api/htyzSlowSnow/news').set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', staffCsrf)
    .field('title', '图片新闻').field('body', '')
  for (let index = 0; index < 9; index += 1) newsRequest.attach('images', onePixelPng, { filename: `news-${index}.png`, contentType: 'image/png' })
  const news = await newsRequest.expect(201)
  assert.equal(news.body.data.images.length, 9)
  assert.equal(fs.readdirSync(harness.config.uploadDir).filter((name) => name.startsWith('.incoming-')).length, 0)
  assert.equal(fs.readdirSync(harness.config.uploadDir).length, 27)
  await user.post('/api/moments').set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', userCsrf)
    .field('body', '非法图片应该被拒绝。').attach('images', Buffer.from('not-an-image'), { filename: 'invalid.png', contentType: 'image/png' }).expect(415)
  await user.post('/api/wall').set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', userCsrf)
    .field('body', '字'.repeat(2001)).attach('images', onePixelPng, { filename: 'invalid-body.png', contentType: 'image/png' }).expect(422)
  assert.equal(fs.readdirSync(harness.config.uploadDir).filter((name) => name.startsWith('.incoming-')).length, 0)
  assert.equal(fs.readdirSync(harness.config.uploadDir).length, 27)
})

test('legacy pending posts become public once when the database opens', async (t) => {
  const harness = createHarness()
  t.after(harness.close)
  const now = nowIso()
  const userId = id()
  const postId = id()
  harness.db.prepare(`INSERT INTO users (id, email, password_hash, member_type, status, created_at, updated_at)
    VALUES (?, 'legacy@example.com', 'unused-hash', 'current_student', 'active', ?, ?)`).run(userId, now, now)
  harness.db.prepare(`INSERT INTO wall_posts (id, user_id, body, status, created_at, updated_at)
    VALUES (?, ?, '旧版待发布内容', 'pending', ?, ?)`).run(postId, userId, now, now)
  const reopened = openDatabase(harness.config.dbPath)
  reopened.close()
  const row = harness.db.prepare('SELECT status, published_at FROM wall_posts WHERE id = ?').get(postId)
  assert.equal(row.status, 'approved')
  assert.ok(row.published_at)
})

test('all public post types support comments, likes and private notifications', async (t) => {
  const harness = createHarness()
  t.after(harness.close)
  const publicClient = request(harness.app)
  const owner = request.agent(harness.app)
  const visitor = request.agent(harness.app)
  const ownerCsrf = await registerAndLogin(owner, harness, { email: 'owner-posts@example.com', password: 'OwnerPosts123', memberType: 'current_student' })
  const visitorCsrf = await registerAndLogin(visitor, harness, { email: 'visitor@example.com', password: 'VisitorPass123', memberType: 'graduate' })

  const moment = await owner.post('/api/moments').set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', ownerCsrf)
    .field('body', '这是一条可以点赞和评论的测试动态。').expect(201)
  const wall = await owner.post('/api/wall').set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', ownerCsrf)
    .field('body', '匿名校园墙测试内容。').field('anonymous', 'true').expect(201)
  const contribution = await owner.post('/api/contributions').set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', ownerCsrf)
    .field('category', 'campus_life').field('title', '测试投稿').field('body', '这篇投稿在临时测试数据库中验证点赞评论功能，不会进入生产环境。').expect(201)
  const question = await owner.post('/api/questions').set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', ownerCsrf)
    .send({ title: '测试问题', body: '这是用于验证评论和点赞的真实测试请求。' }).expect(201)
  const answer = await visitor.post(`/api/questions/${question.body.data.id}/answers`)
    .set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', visitorCsrf)
    .send({ body: '这是毕业生用于验证互动的测试回答。' }).expect(201)
  const now = nowIso()
  const staffId = id()
  const newsId = id()
  harness.db.prepare(`INSERT INTO staff_accounts (id, email, role, status, activated_at, created_at, updated_at)
    VALUES (?, 'news-staff@example.com', 'super_admin', 'active', ?, ?, ?)`).run(staffId, now, now, now)
  harness.db.prepare(`INSERT INTO news (id, title, body, status, created_by, published_at, updated_at)
    VALUES (?, '测试新闻', '用于验证互动功能的临时新闻内容。', 'published', ?, ?, ?)`).run(newsId, staffId, now, now)

  const posts = [
    ['moment', moment.body.data.id], ['wall', wall.body.data.id], ['contribution', contribution.body.data.id],
    ['question', question.body.data.id], ['answer', answer.body.data.id], ['news', newsId]
  ]
  for (const [type, postId] of posts) {
    const writer = type === 'answer' ? owner : visitor
    const token = type === 'answer' ? ownerCsrf : visitorCsrf
    const comment = await writer.post(`/api/posts/${type}/${postId}/comments`)
      .set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', token)
      .send({ body: `给${type}留下友善的测试评论。`, anonymous: type === 'wall' }).expect(201)
    assert.equal(comment.body.data.comments, 1)
    const liked = await writer.put(`/api/posts/${type}/${postId}/like`)
      .set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', token).expect(200)
    assert.equal(liked.body.data.likes, 1)
    assert.equal(liked.body.data.liked, true)
    assert.equal((await owner.get(`/api/public/posts/${type}/${postId}/comments`).expect(200)).body.data.total, 1)
    assert.equal((await owner.get(`/api/public/posts/${type}/${postId}`).expect(200)).body.data.type, type)
  }

  const wallComment = (await owner.get(`/api/public/posts/wall/${wall.body.data.id}/comments`)).body.data.items[0]
  assert.equal(wallComment.anonymous, true)
  assert.equal(wallComment.author, null)
  assert.equal((await owner.get(`/api/public/posts/wall/${wall.body.data.id}`)).body.data.author, null)
  const ownerWallReply = await owner.post(`/api/posts/wall/${wall.body.data.id}/comments`)
    .set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', ownerCsrf)
    .send({ body: '匿名发帖者回复仍然保持匿名。', anonymous: false }).expect(201)
  const wallReplies = (await owner.get(`/api/public/posts/wall/${wall.body.data.id}/comments`)).body.data.items
  assert.equal(wallReplies.find((item) => item.id === ownerWallReply.body.data.id).author, null)
  await owner.delete(`/api/comments/${ownerWallReply.body.data.id}`)
    .set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', ownerCsrf).expect(200)
  const ownerMessages = await owner.get('/api/notifications').expect(200)
  assert.equal(ownerMessages.body.data.unread, 8)
  assert.ok(ownerMessages.body.data.items.some((item) => item.actor === '匿名同学' && item.kind === 'comment'))
  assert.ok(ownerMessages.body.data.items.every((item) => !('email' in item)))
  assert.ok(ownerMessages.body.data.items.every((item) => item.path.startsWith('/post/')))
  assert.equal((await visitor.get('/api/notifications').expect(200)).body.data.unread, 2)
  const anonymous = request.agent(harness.app)
  const anonymousCsrf = await csrf(anonymous)
  await anonymous.post(`/api/posts/moment/${moment.body.data.id}/comments`)
    .set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', anonymousCsrf)
    .send({ body: '未登录不能发评论。' }).expect(401)

  await visitor.put(`/api/posts/moment/${moment.body.data.id}/like`)
    .set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', visitorCsrf).expect(200)
  await visitor.post(`/api/posts/moment/${moment.body.data.id}/comments`)
    .set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', visitorCsrf)
    .send({ body: 'x' }).expect(422)
  assert.equal((await owner.get('/api/notifications/unread-count').expect(200)).body.data.count, 8)
  const first = ownerMessages.body.data.items[0]
  await visitor.post(`/api/notifications/${first.id}/read`)
    .set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', visitorCsrf).expect(404)
  await owner.post(`/api/notifications/${first.id}/read`)
    .set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', ownerCsrf).expect(200)
  assert.equal((await owner.get('/api/notifications/unread-count').expect(200)).body.data.count, 7)
  await owner.post('/api/notifications/read-all').set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', ownerCsrf).expect(200)
  assert.equal((await owner.get('/api/notifications/unread-count').expect(200)).body.data.count, 0)

  const commentId = wallComment.id
  await owner.delete(`/api/comments/${commentId}`).set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', ownerCsrf).expect(403)
  await visitor.delete(`/api/comments/${commentId}`).set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', visitorCsrf).expect(200)
  assert.equal((await owner.get(`/api/public/posts/wall/${wall.body.data.id}/comments`)).body.data.total, 0)

  const staff = request.agent(harness.app)
  const staffCsrf = await csrf(staff)
  harness.db.prepare('UPDATE staff_accounts SET password_hash = ? WHERE id = ?').run(await hashPassword('StaffPassword123'), staffId)
  const newsStaffLogin = await staff.post('/api/htyzSlowSnow/auth/login').set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', staffCsrf)
    .send({ email: 'news-staff@example.com', password: 'StaffPassword123' })
  assert.equal(newsStaffLogin.status, 200, JSON.stringify(newsStaffLogin.body))
  const comments = await staff.get('/api/htyzSlowSnow/posts?type=comment').expect(200)
  assert.equal(comments.body.data.items.length, 7)
  assert.ok(comments.body.data.items.some((item) => item.id === ownerWallReply.body.data.id && item.status === 'archived'))
  const momentCommentId = comments.body.data.items.find((item) => item.post_type === 'moment').id
  await staff.delete(`/api/htyzSlowSnow/posts/comment/${momentCommentId}`)
    .set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', staffCsrf).expect(200)
  assert.equal((await owner.get(`/api/public/posts/moment/${moment.body.data.id}/comments`)).body.data.total, 0)
  await staff.delete(`/api/htyzSlowSnow/posts/moment/${moment.body.data.id}`)
    .set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', staffCsrf).expect(200)
  await owner.get(`/api/public/posts/moment/${moment.body.data.id}/engagement`).expect(404)
  await visitor.put(`/api/posts/moment/${moment.body.data.id}/like`)
    .set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', visitorCsrf).expect(404)
  const visitorId = harness.db.prepare('SELECT id FROM users WHERE email = ?').get('visitor@example.com').id
  await staff.patch(`/api/htyzSlowSnow/users/${visitorId}/status`)
    .set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', staffCsrf).send({ status: 'suspended' }).expect(200)
  await visitor.post(`/api/posts/wall/${wall.body.data.id}/comments`)
    .set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', visitorCsrf)
    .send({ body: '封禁后不能继续评论。' }).expect(401)
  await visitor.put(`/api/posts/wall/${wall.body.data.id}/like`)
    .set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', visitorCsrf).expect(401)
})

test('comment replies keep their parent, notify the target, and never expose anonymous wall authors', async (t) => {
  const harness = createHarness()
  t.after(harness.close)
  const owner = request.agent(harness.app)
  const visitor = request.agent(harness.app)
  const ownerCsrf = await registerAndLogin(owner, harness, { email: 'reply-owner@example.com', password: 'ReplyOwner123', memberType: 'current_student' })
  const visitorCsrf = await registerAndLogin(visitor, harness, { email: 'reply-visitor@example.com', password: 'ReplyVisitor123', memberType: 'graduate' })
  const wall = await owner.post('/api/wall').set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', ownerCsrf)
    .field('body', '匿名校园墙回复测试。').field('anonymous', 'true').expect(201)
  const wallId = wall.body.data.id
  const first = await owner.post(`/api/posts/wall/${wallId}/comments`)
    .set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', ownerCsrf)
    .send({ body: '匿名发帖人的第一条评论。', anonymous: false }).expect(201)
  const reply = await visitor.post(`/api/posts/wall/${wallId}/comments`)
    .set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', visitorCsrf)
    .send({ body: '回复这条评论。', parentCommentId: first.body.data.id }).expect(201)
  const comments = await visitor.get(`/api/public/posts/wall/${wallId}/comments?focus=${reply.body.data.id}`).expect(200)
  assert.equal(comments.body.data.items.find((item) => item.id === reply.body.data.id).replyTo.name, '匿名同学')
  assert.equal(harness.db.prepare('SELECT parent_comment_id FROM post_comments WHERE id = ?').get(reply.body.data.id).parent_comment_id, first.body.data.id)
  const messages = await owner.get('/api/notifications').expect(200)
  assert.equal(messages.body.data.items.length, 1)
  assert.equal(messages.body.data.items[0].isReply, true)
  assert.ok(messages.body.data.items[0].path.endsWith(`#comment-${reply.body.data.id}`))
  await owner.delete(`/api/comments/${first.body.data.id}`)
    .set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', ownerCsrf).expect(200)
  const afterDelete = await visitor.get(`/api/public/posts/wall/${wallId}/comments`).expect(200)
  assert.equal(afterDelete.body.data.items[0].replyTo.name, '已删除的评论')
  await visitor.post(`/api/posts/wall/${wallId}/comments`)
    .set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', visitorCsrf)
    .send({ body: '不应回复已删除评论。', parentCommentId: first.body.data.id }).expect(422)
  await request(harness.app).get(`/api/public/posts/wall/${wallId}/comments`).expect(401)
})

test('only authors can remove their own posts, including anonymous wall posts', async (t) => {
  const harness = createHarness()
  t.after(harness.close)
  const author = request.agent(harness.app)
  const other = request.agent(harness.app)
  const authorCsrf = await registerAndLogin(author, harness, { email: 'author@example.com', password: 'AuthorPass123', memberType: 'current_student' })
  const otherCsrf = await registerAndLogin(other, harness, { email: 'reader@example.com', password: 'ReaderPass123', memberType: 'graduate' })
  const origin = harness.config.siteOrigin

  const moment = await author.post('/api/moments').set('Origin', origin).set('X-CSRF-Token', authorCsrf).field('body', '我的动态').expect(201)
  const wall = await author.post('/api/wall').set('Origin', origin).set('X-CSRF-Token', authorCsrf).field('body', '我的匿名墙').field('anonymous', 'true').expect(201)
  const contribution = await author.post('/api/contributions').set('Origin', origin).set('X-CSRF-Token', authorCsrf)
    .field('category', 'campus_life').field('title', '我的投稿').field('body', '正文').expect(201)
  const question = await author.post('/api/questions').set('Origin', origin).set('X-CSRF-Token', authorCsrf)
    .send({ title: '我的问题', body: '问题描述' }).expect(201)
  const answer = await author.post(`/api/questions/${question.body.data.id}/answers`).set('Origin', origin).set('X-CSRF-Token', authorCsrf)
    .send({ body: '我的回答' }).expect(201)

  const momentId = moment.body.data.id
  await other.put(`/api/posts/moment/${momentId}/like`).set('Origin', origin).set('X-CSRF-Token', otherCsrf).expect(200)
  await other.post(`/api/posts/moment/${momentId}/comments`).set('Origin', origin).set('X-CSRF-Token', otherCsrf)
    .send({ body: '公开评论' }).expect(201)
  const posts = [
    ['moment', momentId], ['wall', wall.body.data.id], ['contribution', contribution.body.data.id],
    ['answer', answer.body.data.id], ['question', question.body.data.id]
  ]
  for (const [type, postId] of posts) {
    assert.equal((await author.get(`/api/public/posts/${type}/${postId}/engagement`)).body.data.canDelete, true)
    assert.equal((await other.get(`/api/public/posts/${type}/${postId}/engagement`)).body.data.canDelete, false)
    await other.delete(`/api/posts/${type}/${postId}`).set('Origin', origin).set('X-CSRF-Token', otherCsrf).expect(403)
    await author.delete(`/api/posts/${type}/${postId}`).set('Origin', origin).set('X-CSRF-Token', authorCsrf).expect(200)
    await author.get(`/api/public/posts/${type}/${postId}`).expect(404)
    await other.delete(`/api/posts/${type}/${postId}`).set('Origin', origin).set('X-CSRF-Token', otherCsrf).expect(404)
  }
  await author.delete(`/api/posts/news/${momentId}`).set('Origin', origin).set('X-CSRF-Token', authorCsrf).expect(403)
  assert.equal((await author.get('/api/public/moments')).body.data.items.length, 0)
  assert.equal((await author.get('/api/public/wall')).body.data.items.length, 0)
  assert.equal((await author.get('/api/public/contributions')).body.data.items.length, 0)
  assert.equal((await author.get('/api/public/questions')).body.data.items.length, 0)
  assert.equal((await author.get('/api/notifications')).body.data.items.length, 0)
  assert.equal(harness.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_name = 'post_deleted_by_author'").get().count, 5)
})

test('grades, video range, chats and super-admin-only account actions', async (t) => {
  const harness = createHarness()
  t.after(harness.close)
  const alice = request.agent(harness.app)
  const bob = request.agent(harness.app)
  const aliceCsrf = await registerAndLogin(alice, harness, { email: 'alice@example.com', password: 'AlicePass123', memberType: 'current_student' })
  const bobCsrf = await registerAndLogin(bob, harness, { email: 'bob@example.com', password: 'BobPass12345', memberType: 'graduate' })
  const aliceId = harness.db.prepare('SELECT id FROM users WHERE email = ?').get('alice@example.com').id
  const bobId = harness.db.prepare('SELECT id FROM users WHERE email = ?').get('bob@example.com').id
  assert.equal((await alice.get('/api/session')).body.data.user.grade, '高一')
  assert.equal((await alice.get('/api/public/users')).body.data.items[0].id, bobId)
  assert.equal((await alice.get('/api/public/users')).body.data.items[0].email, undefined)
  await alice.patch('/api/me/grade').set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', aliceCsrf)
    .send({ grade: '高三' }).expect(200)
  assert.equal((await alice.get('/api/session')).body.data.user.grade, '高三')
  await alice.patch('/api/me/grade').set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', aliceCsrf)
    .send({ grade: '已工作' }).expect(422)

  const wall = await alice.post('/api/wall').set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', aliceCsrf)
    .field('body', '默认展示作者的校园墙。').expect(201)
  assert.equal((await bob.get('/api/public/wall')).body.data.items[0].anonymous, false)
  const moment = await alice.post('/api/moments').set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', aliceCsrf)
    .field('body', '').attach('video', smallMp4, { filename: 'clip.mp4', contentType: 'video/mp4' }).expect(201)
  const item = (await bob.get('/api/public/moments')).body.data.items[0]
  assert.equal(item.id, moment.body.data.id)
  assert.equal(item.author.grade, '高三')
  assert.ok(item.video, '上传后应立即返回视频地址')
  assert.ok(item.videoStatus, '应带出视频处理状态')

  // 处理中：不把未完成的字节流交给 <video>，而是返回明确的 409 + 状态说明。
  // 这正是「视频格式错误」的修复点 —— 前端据此显示「处理中」而不是报格式错误。
  const processing = harness.db.prepare("SELECT status FROM post_videos WHERE post_id = ?").get(moment.body.data.id)
  assert.equal(processing.status, 'processing')
  const duringProcessing = await bob.get(item.video).set('Range', 'bytes=0-3')
  assert.equal(duringProcessing.status, 409)
  assert.equal(duringProcessing.body.error.code, 'video_processing')

  // 未登录仍被拦截
  await request(harness.app).get(item.video).expect(401)

  // 帖子被作者删除（archived）后，视频对其他成员应表现为「不存在」（404 而非 403，
  // 避免暴露帖子曾经存在）。作者本人仍可访问自己的内容。
  harness.db.prepare("UPDATE moments SET status = 'archived' WHERE id = ?").run(moment.body.data.id)
  const mallory = request.agent(harness.app)
  await registerAndLogin(mallory, harness, { email: 'mallory@example.com', password: 'MalloryPass123', memberType: 'graduate' })
  await mallory.get(item.video).expect(404)
  const authorStillSees = await alice.get(`/api/media/video/${harness.db.prepare('SELECT id FROM post_videos WHERE post_id = ?').get(moment.body.data.id).id}`)
  assert.equal(authorStillSees.status, 409, '作者应仍能访问，此时仍在处理中')
  harness.db.prepare("UPDATE moments SET status = 'approved' WHERE id = ?").run(moment.body.data.id)

  // 非法视频（只有 ftyp 头，ffprobe 无法解析）会被标记失败并给出可读原因
  await alice.post('/api/moments').set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', aliceCsrf)
    .field('body', '').attach('video', onePixelPng, { filename: 'fake.mp4', contentType: 'video/mp4' }).expect(415)

  const message = await alice.post(`/api/chats/${bobId}/messages`).set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', aliceCsrf)
    .send({ body: '你好，想问一下选课经验。' }).expect(201)
  assert.equal((await bob.get('/api/chats/unread-count')).body.data.count, 1)
  assert.equal((await bob.get(`/api/chats/${aliceId}`)).body.data.items[0].body, '你好，想问一下选课经验。')
  await bob.post(`/api/chats/${aliceId}/read`).set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', bobCsrf).expect(200)
  assert.equal((await alice.get(`/api/chats/${bobId}`)).body.data.items[0].readAt !== null, true)
  await alice.post(`/api/chats/${bobId}/messages`).set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', aliceCsrf)
    .send({ body: { html: '<img>' } }).expect(422)

  const now = nowIso()
  const superId = id()
  harness.db.prepare(`INSERT INTO staff_accounts (id, email, password_hash, role, status, activated_at, created_at, updated_at)
    VALUES (?, ?, ?, 'super_admin', 'active', ?, ?, ?)`).run(superId, 'super-chat@example.com', await hashPassword('SuperChat123'), now, now, now)
  const staff = request.agent(harness.app)
  const staffCsrf = await csrf(staff)
  await staff.post('/api/htyzSlowSnow/auth/login').set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', staffCsrf)
    .send({ email: 'super-chat@example.com', password: 'SuperChat123' }).expect(200)
  await alice.get('/api/htyzSlowSnow/chats').expect(401)
  assert.equal((await staff.get('/api/htyzSlowSnow/chats')).body.data.items.length, 1)
  assert.equal((await staff.get(`/api/htyzSlowSnow/chats/${aliceId}/${bobId}`)).body.data.items[0].body, '你好，想问一下选课经验。')
  await staff.patch(`/api/htyzSlowSnow/chats/messages/${message.body.data.id}/retain`).set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', staffCsrf).expect(200)
  await staff.delete(`/api/htyzSlowSnow/chats/messages/${message.body.data.id}`).set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', staffCsrf).expect(200)
  assert.equal((await bob.get(`/api/chats/${aliceId}`)).body.data.items.length, 0)
  assert.equal(harness.db.prepare('SELECT body FROM direct_messages WHERE id = ?').get(message.body.data.id).body, '')
  for (let index = 0; index < 3; index += 1) {
    harness.db.prepare('INSERT INTO direct_messages (id, sender_id, recipient_id, body, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id(), bobId, aliceId, `分页消息 ${index}`, new Date(Date.now() + index * 1000).toISOString())
  }
  const firstChatPage = (await staff.get(`/api/htyzSlowSnow/chats/${aliceId}/${bobId}?limit=2`)).body.data
  const secondChatPage = (await staff.get(`/api/htyzSlowSnow/chats/${aliceId}/${bobId}?limit=2&offset=2`)).body.data
  assert.equal(firstChatPage.items.length, 2)
  assert.equal(firstChatPage.hasMore, true)
  assert.equal(secondChatPage.items.length, 1)
  assert.equal(secondChatPage.hasMore, false)
  const extraStaffId = id()
  harness.db.prepare(`INSERT INTO staff_accounts (id, email, password_hash, role, status, activated_at, created_at, updated_at)
    VALUES (?, ?, ?, 'campus_admin', 'active', ?, ?, ?)`).run(extraStaffId, 'extra-staff@example.com', await hashPassword('ExtraStaff123'), now, now, now)
  const accountPage = (await staff.get('/api/htyzSlowSnow/staff/accounts?limit=1')).body.data
  assert.equal(accountPage.items.length, 1)
  assert.equal(accountPage.hasMore, true)
  assert.equal((await staff.get('/api/htyzSlowSnow/staff/accounts?limit=1&offset=1')).body.data.items.length, 1)
  assert.equal((await staff.get('/api/htyzSlowSnow/dashboard')).body.data.dailyPosts.length, 14)

  const reset = await staff.post(`/api/htyzSlowSnow/users/${aliceId}/reset-password`).set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', staffCsrf).expect(200)
  assert.ok(reset.body.data.initialPassword)
  assert.equal(reset.body.data.password_hash, undefined)
  await alice.get('/api/me').expect(401)
  await alice.post('/api/auth/login').set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', aliceCsrf)
    .send({ email: 'alice@example.com', password: 'AlicePass123' }).expect(401)
  await alice.post('/api/auth/login').set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', aliceCsrf)
    .send({ email: 'alice@example.com', password: reset.body.data.initialPassword }).expect(200)
  await staff.delete(`/api/htyzSlowSnow/users/${aliceId}`).set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', staffCsrf)
    .send({ confirmEmail: 'wrong@example.com' }).expect(422)
  await staff.delete(`/api/htyzSlowSnow/users/${aliceId}`).set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', staffCsrf)
    .send({ confirmEmail: 'alice@example.com' }).expect(200)
  assert.equal((await bob.get('/api/public/wall')).body.data.items.some((entry) => entry.id === wall.body.data.id), false)
  assert.equal((await bob.get('/api/public/users')).body.data.items.some((entry) => entry.id === aliceId), false)
})

test('campus-wall polls hide all results until each member votes', async (t) => {
  const harness = createHarness()
  t.after(harness.close)
  const owner = request.agent(harness.app)
  const voter = request.agent(harness.app)
  const observer = request.agent(harness.app)
  const ownerCsrf = await registerAndLogin(owner, harness, { email: 'poll-owner@example.com', password: 'OwnerPass123', memberType: 'current_student' })
  const voterCsrf = await registerAndLogin(voter, harness, { email: 'poll-voter@example.com', password: 'VoterPass123', memberType: 'graduate' })
  await registerAndLogin(observer, harness, { email: 'poll-observer@example.com', password: 'ObserverPass123', memberType: 'current_student' })
  const origin = harness.config.siteOrigin
  await request(harness.app).post('/api/wall/polls').send({ question: '午休去哪？', options: ['图书馆', '操场'] }).expect(403)
  await owner.post('/api/wall/polls').set('Origin', origin).send({ question: '午休去哪？', options: ['图书馆', '操场'] }).expect(403)
  await owner.post('/api/wall/polls').set('Origin', origin).set('X-CSRF-Token', ownerCsrf)
    .send({ question: '午休去哪？', options: ['图书馆', '图书馆'] }).expect(422)
  const created = await owner.post('/api/wall/polls').set('Origin', origin).set('X-CSRF-Token', ownerCsrf)
    .send({ question: '午休去哪？', options: ['图书馆', '操场'], anonymous: true }).expect(201)
  const { id: postId, pollId } = created.body.data
  const before = (await voter.get('/api/public/wall')).body.data.items.find((item) => item.id === postId)
  assert.equal(before.body, '')
  assert.equal(before.anonymous, true)
  assert.equal(before.author, null)
  assert.equal(before.poll.question, '午休去哪？')
  assert.equal(before.poll.myOptionId, null)
  assert.equal(before.poll.totalVotes, undefined)
  assert.equal(before.poll.options[0].votes, undefined)
  assert.equal(before.poll.options[0].percent, undefined)
  const firstOption = before.poll.options[0].id
  const secondOption = before.poll.options[1].id
  const detailBefore = (await voter.get(`/api/public/posts/wall/${postId}`)).body.data
  assert.equal(detailBefore.poll.totalVotes, undefined)
  assert.equal(detailBefore.poll.options[0].votes, undefined)
  await voter.post(`/api/wall/polls/${pollId}/votes`).set('Origin', origin).set('X-CSRF-Token', voterCsrf)
    .send({ optionId: id() }).expect(422)
  const voted = await voter.post(`/api/wall/polls/${pollId}/votes`).set('Origin', origin).set('X-CSRF-Token', voterCsrf)
    .send({ optionId: firstOption }).expect(200)
  assert.equal(voted.body.data.poll.myOptionId, firstOption)
  assert.equal(voted.body.data.poll.totalVotes, 1)
  assert.deepEqual(voted.body.data.poll.options.map((option) => [option.votes, option.percent]), [[1, 100], [0, 0]])
  await voter.post(`/api/wall/polls/${pollId}/votes`).set('Origin', origin).set('X-CSRF-Token', voterCsrf)
    .send({ optionId: secondOption }).expect(409)
  assert.equal((await voter.get(`/api/public/posts/wall/${postId}`)).body.data.poll.totalVotes, 1)
  const unvoted = (await observer.get('/api/public/wall')).body.data.items.find((item) => item.id === postId).poll
  assert.equal(unvoted.totalVotes, undefined)
  assert.equal(unvoted.options[0].votes, undefined)
  assert.equal((await owner.get(`/api/public/posts/wall/${postId}`)).body.data.poll.totalVotes, undefined)
  assert.equal(harness.db.prepare('SELECT COUNT(*) AS count FROM wall_poll_votes WHERE poll_id = ?').get(pollId).count, 1)
  await owner.delete(`/api/posts/wall/${postId}`).set('Origin', origin).set('X-CSRF-Token', ownerCsrf).expect(200)
  await voter.post(`/api/wall/polls/${pollId}/votes`).set('Origin', origin).set('X-CSRF-Token', voterCsrf)
    .send({ optionId: secondOption }).expect(404)
})

// ============================================================
// 视频自动处理流水线
// 大疆无人机默认录制 H.265/HEVC + 10-bit，浏览器无法播放。
// 上传后应由后台 worker 自动转成 H.264 8-bit，用户无需做任何事。
// ============================================================
test('大疆 HEVC 10-bit 视频自动转码为浏览器可播放格式', { skip: !videoToolingAvailable && '本机没有 ffmpeg/ffprobe' }, async (t) => {
  const harness = createHarness()
  t.after(harness.close)

  const fixtureDir = makeTempDir('htyz-video-fixture-')
  t.after(() => fs.rmSync(fixtureDir, { recursive: true, force: true }))

  // 造一段仿大疆素材：HEVC + 10-bit
  const source = generateVideo(fixtureDir, { seconds: 1, size: '320x180', codec: 'libx265', pixFmt: 'yuv420p10le' })
  assert.ok(source, '应能生成 HEVC 测试素材')

  const before = probeFile(source.path)
  assert.equal(before.codec_name, 'hevc', '测试素材应为 HEVC')
  assert.match(before.pix_fmt, /10/, '测试素材应为 10-bit')

  const alice = request.agent(harness.app)
  const csrfToken = await registerAndLogin(alice, harness, { email: 'dji@example.com', password: 'DjiPass12345', memberType: 'graduate' })

  const created = await alice.post('/api/moments')
    .set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', csrfToken)
    .field('body', '用无人机拍的校园').attach('video', source.buffer, { filename: 'DJI_0001.MP4', contentType: 'video/mp4' })
    .expect(201)

  const videoId = harness.db.prepare('SELECT id FROM post_videos WHERE post_id = ?').get(created.body.data.id).id

  // 上传后进入处理中
  assert.equal(harness.db.prepare('SELECT status FROM post_videos WHERE id = ?').get(videoId).status, 'processing')

  // 跑一次 worker（测试里同步执行，避免依赖定时器）
  const result = await processVideoNow(harness.db, harness.config, videoId)
  assert.equal(result.ok, true, `转码应成功：${result.error || ''}`)

  const row = harness.db.prepare('SELECT * FROM post_videos WHERE id = ?').get(videoId)
  assert.equal(row.status, 'ready')
  assert.equal(row.codec, 'h264', '应转为 H.264')
  assert.equal(row.pix_fmt, 'yuv420p', '应转为 8-bit')
  assert.ok(row.width <= 1920, '宽度不应超过 1080p 上限')
  assert.match(row.process_note || '', /已转码/, '应记录转码说明')

  // 封面图应已生成
  assert.ok(row.poster_name, '应生成封面图')
  assert.ok(fs.existsSync(path.join(harness.config.uploadDir, row.poster_name)), '封面文件应存在')

  // 转码产物确实是 H.264 8-bit
  const after = probeFile(path.join(harness.config.uploadDir, row.storage_name))
  assert.equal(after.codec_name, 'h264')
  assert.equal(after.pix_fmt, 'yuv420p')

  // 播放：Range 请求应返回 206，且是有效 MP4
  const played = await alice.get(`/api/media/video/${videoId}`).set('Range', 'bytes=0-1023').expect(206)
  assert.match(played.headers['content-type'], /video\/mp4/)
  assert.equal(played.headers['accept-ranges'], 'bytes')
  assert.equal(played.body.subarray(4, 8).toString(), 'ftyp')

  // 封面接口可用
  await alice.get(`/api/media/poster/${videoId}`).expect(200).expect('Content-Type', /image\/jpeg/)

  // 状态接口应报告 ready（前端据此把「处理中」切换为可播放）
  const statusResponse = await alice.get(`/api/media/video/${videoId}/status`).expect(200)
  assert.equal(statusResponse.body.data.status, 'ready')
  assert.equal(statusResponse.body.data.hasPoster, true)

  // 列表接口应带出封面与状态，且不泄露服务器文件名
  const list = await alice.get('/api/public/moments').expect(200)
  const listed = list.body.data.items[0]
  assert.equal(listed.videoStatus, 'ready')
  assert.match(listed.videoPoster, /^\/api\/media\/poster\//)
  const serialized = JSON.stringify(listed)
  assert.ok(!serialized.includes(row.storage_name), '不应把服务器存储文件名暴露给前端')
  assert.ok(!serialized.includes(row.poster_name), '不应把封面文件名暴露给前端')
})

test('已兼容的视频只重封装不重编码', { skip: !videoToolingAvailable && '本机没有 ffmpeg/ffprobe' }, async (t) => {
  const harness = createHarness()
  t.after(harness.close)
  const fixtureDir = makeTempDir('htyz-video-rw-')
  t.after(() => fs.rmSync(fixtureDir, { recursive: true, force: true }))

  const source = generateVideo(fixtureDir, { seconds: 1, size: '320x180', codec: 'libx264', pixFmt: 'yuv420p' })
  assert.ok(source)

  const alice = request.agent(harness.app)
  const csrfToken = await registerAndLogin(alice, harness, { email: 'small@example.com', password: 'SmallPass123', memberType: 'graduate' })

  const created = await alice.post('/api/moments')
    .set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', csrfToken)
    .field('body', '已经是通用格式').attach('video', source.buffer, { filename: 'ok.mp4', contentType: 'video/mp4' })
    .expect(201)

  const videoId = harness.db.prepare('SELECT id FROM post_videos WHERE post_id = ?').get(created.body.data.id).id
  const result = await processVideoNow(harness.db, harness.config, videoId)
  assert.equal(result.ok, true)

  const row = harness.db.prepare('SELECT * FROM post_videos WHERE id = ?').get(videoId)
  assert.equal(row.status, 'ready')
  assert.equal(row.codec, 'h264')
  assert.match(row.process_note || '', /无需转码/, '合规视频不应重新编码')
  await alice.get(`/api/media/video/${videoId}`).set('Range', 'bytes=0-3').expect(206)
})

test('无法解析的视频标记为失败并给出可读原因', { skip: !videoToolingAvailable && '本机没有 ffmpeg/ffprobe' }, async (t) => {
  const harness = createHarness()
  t.after(harness.close)

  const alice = request.agent(harness.app)
  const csrfToken = await registerAndLogin(alice, harness, { email: 'broken@example.com', password: 'BrokenPass123', memberType: 'graduate' })

  // 构造一个 ftyp 合法、但内容不是真视频的文件（能通过 magic number 校验）
  const fake = Buffer.concat([
    Buffer.from([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]),
    Buffer.alloc(64, 0x11),
  ])
  const created = await alice.post('/api/moments')
    .set('Origin', harness.config.siteOrigin).set('X-CSRF-Token', csrfToken)
    .field('body', '损坏的视频').attach('video', fake, { filename: 'broken.mp4', contentType: 'video/mp4' })
    .expect(201)

  const videoId = harness.db.prepare('SELECT id FROM post_videos WHERE post_id = ?').get(created.body.data.id).id
  const result = await processVideoNow(harness.db, harness.config, videoId)
  assert.equal(result.ok, false, '损坏视频应处理失败')

  const row = harness.db.prepare('SELECT * FROM post_videos WHERE id = ?').get(videoId)
  assert.equal(row.status, 'failed')
  assert.ok(row.error_message, '应记录失败原因')

  // 播放接口应返回可读错误，而不是把坏字节丢给 <video>
  const played = await alice.get(`/api/media/video/${videoId}`)
  assert.equal(played.status, 422)
  assert.equal(played.body.error.code, 'video_failed')
})
