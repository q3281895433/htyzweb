import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { createAuthRouter } from './routes/auth.js'
import { createContentRouter } from './routes/content.js'
import { createStaffRouter } from './routes/staff.js'
import { createSocialRouter } from './routes/social.js'
import { createEngagementRouter } from './routes/engagement.js'
import { createChatRouter } from './routes/chats.js'
import { csrfProtection, jsonErrorHandler, sessionContext } from './middleware.js'
import { ApiError } from './security.js'
import { ensureVideoSchema } from './video-queue.js'
import { maintenanceNotice } from './maintenance.js'

export function createApp({ db, config, mailer }) {
  // 视频相关字段与队列表在此确保存在。
  // 放在应用装配阶段而不是 worker 启动阶段：这样自动化测试（只创建 app、
  // 不启动 worker）以及任何只读路径都能安全查询这些列。
  ensureVideoSchema(db)

  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', 1)

  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'same-origin' },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"]
      }
    },
    referrerPolicy: { policy: 'no-referrer' },
    hsts: config.isProduction ? { maxAge: 63072000, includeSubDomains: true } : false
  }))
  app.use(express.json({ limit: '256kb' }))
  app.use(express.urlencoded({ extended: false, limit: '128kb' }))
  app.use(cookieParser())
  app.use(rateLimit({ windowMs: 60 * 1000, limit: 180, standardHeaders: true, legacyHeaders: false }))
  app.use(sessionContext(db))
  app.use(csrfProtection(config))

  app.get('/api/health', (_req, res) => {
    const dbOk = db.prepare('SELECT 1 AS ok').get().ok === 1
    res.json({ ok: true, data: { service: 'htyz-community', database: dbOk ? 'ready' : 'unavailable', mail: mailer.configured ? 'configured' : 'not_configured' } })
  })
  app.use('/api', createAuthRouter({ db, config, mailer }))
  app.use('/api', createContentRouter({ db, config }))
  app.use('/api', createSocialRouter({ db, config }))
  app.use('/api', createEngagementRouter({ db }))
  app.use('/api', createChatRouter({ db }))
  app.use('/api/htyzSlowSnow', createStaffRouter({ db, config, mailer }))

  app.use('/assets', express.static(path.join(config.distDir, 'assets'), {
    immutable: true,
    maxAge: '1y',
    fallthrough: false
  }))
  app.use(express.static(config.distDir, { index: false, maxAge: 0 }))

  // 维护提示：迁移期间把「页面访问」引导到提示页。
  // 位置必须在静态资源之后 —— 否则维护页自身的 CSS/字体也加载不了，
  // 会显示成没有样式的裸 HTML。放在这里，/api/ 与静态资源都照常可用。
  app.use(maintenanceNotice({ config }))

  app.use('/api', (_req, _res, next) => next(new ApiError(404, 'api_not_found', '接口不存在。')))
  app.get('*', (_req, res, next) => {
    const indexPath = path.join(config.distDir, 'index.html')
    if (!fs.existsSync(indexPath)) return next(new ApiError(503, 'frontend_not_built', '前端尚未构建。'))
    res.set('Cache-Control', 'no-store')
    res.sendFile(indexPath)
  })

  app.use(jsonErrorHandler)
  return app
}
