import { config } from './config.js'
import { openDatabase, purgeExpired } from './db.js'
import { createMailer } from './mail.js'
import { createApp } from './app.js'
import { startVideoWorker } from './video-worker.js'

const db = openDatabase(config.dbPath)
const mailer = createMailer(config)
const app = createApp({ db, config, mailer })

purgeExpired(db)
const cleanupTimer = setInterval(() => purgeExpired(db), 6 * 60 * 60 * 1000)
cleanupTimer.unref()

// 视频自动转码：上传后在后台把大疆等 HEVC 素材转成浏览器可直接播放的格式。
// 队列串行 + ffmpeg nice 降优先级，实测不影响网站响应。
const videoWorker = startVideoWorker(db, config)

const server = app.listen(config.port, config.host, () => {
  console.log(`htyz-community listening on ${config.host}:${config.port}`)
  console.log(`mail transport: ${mailer.configured ? 'configured' : 'not configured'}`)
})

function shutdown(signal) {
  console.log(`${signal} received, shutting down`)
  try { videoWorker.stop() } catch { /* ignore */ }
  server.close(() => {
    db.close()
    process.exit(0)
  })
  setTimeout(() => process.exit(1), 10_000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
