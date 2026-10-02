/**
 * 视频自动转码 worker
 * ------------------------------------------------------------
 * 上传完成后由队列驱动，在后台把视频处理成浏览器可直接播放的格式。
 *
 * 处理策略（按代价从低到高）：
 *   1. 已经是 H.264 8-bit 且分辨率不超标  → 只做 faststart 重封装（秒级，无损）
 *   2. 其他情况                        → 转码为 1080p H.264 8-bit bt709
 *
 * 为什么分辨率是 1080p：实测 1 核上编码 1080p veryfast 约 100fps。
 * 4K 编码只有约 1/4 速度，且体积大、弱网看不了；无人机 4K 素材降到
 * 1080p 后画质仍然很好，而体积可减少 80% 以上。
 *
 * 资源保护：
 *   · 并发恒为 1（队列串行），避免 1 核机器互相争抢
 *   · ffmpeg 加 nice 优先级，保证 nginx/node 优先获得 CPU
 *   · 每个任务有硬性超时，防止卡死占用队列
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {
  claimNextJob, finishJob, recoverStuckJobs, enqueueVideo, cleanupTempFiles, ensureVideoSchema,
} from './video-queue.js'
import { nowIso } from './db.js'

// ------------------------------------------------------------
// 可调参数
// ------------------------------------------------------------
const CONFIG = {
  maxWidth: Number(process.env.VIDEO_MAX_WIDTH || 1920),   // 输出最大宽度
  preset: process.env.VIDEO_PRESET || 'veryfast',          // x264 preset
  crf: Number(process.env.VIDEO_CRF || 24),                // 画质（越小越好）
  audioBitrate: process.env.VIDEO_AUDIO_BITRATE || '128k',
  jobTimeoutMs: Number(process.env.VIDEO_JOB_TIMEOUT_MS || 15 * 60 * 1000), // 单任务上限 15 分钟
  posterWidth: Number(process.env.VIDEO_POSTER_WIDTH || 1280),
  pollIntervalMs: Number(process.env.VIDEO_POLL_MS || 3000), // 空闲时的轮询间隔
  niceLevel: Number(process.env.VIDEO_NICE || 10),
}

let running = false
let stopped = false
let currentChild = null

// ------------------------------------------------------------
// 定位 ffmpeg / ffprobe（优先环境变量，其次 PATH）
// ------------------------------------------------------------
function resolveTool(envKey, name) {
  const fromEnv = process.env[envKey]
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8' })
  if (r.status === 0) {
    const first = (r.stdout || '').split(/\r?\n/).find(Boolean)
    if (first) return first.trim()
  }
  return null
}

export const FFMPEG = resolveTool('FFMPEG_PATH', 'ffmpeg')
export const FFPROBE = resolveTool('FFPROBE_PATH', 'ffprobe')
export const toolsAvailable = Boolean(FFMPEG && FFPROBE)

// ------------------------------------------------------------
// 探测
// ------------------------------------------------------------
function probe(file) {
  if (!FFPROBE) return null
  const r = spawnSync(FFPROBE, [
    '-v', 'error',
    '-show_entries', 'stream=index,codec_type,codec_name,profile,pix_fmt,width,height,r_frame_rate,channels',
    '-show_entries', 'format=format_name,duration,size',
    '-of', 'json', file,
  ], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 60_000 })

  if (r.status !== 0) return null
  try {
    const j = JSON.parse(r.stdout)
    const v = (j.streams || []).find((s) => s.codec_type === 'video')
    const a = (j.streams || []).find((s) => s.codec_type === 'audio')
    if (!v) return null
    return {
      format: j.format?.format_name || '',
      duration: parseFloat(j.format?.duration || '0') || 0,
      video: {
        codec: (v.codec_name || '').toLowerCase(),
        profile: v.profile || '',
        pixFmt: (v.pix_fmt || '').toLowerCase(),
        width: v.width || 0,
        height: v.height || 0,
      },
      audio: a ? { codec: (a.codec_name || '').toLowerCase(), channels: a.channels || 0 } : null,
    }
  } catch {
    return null
  }
}

/** 判断能否被浏览器直接播放（无需重编码） */
function isBrowserReady(info) {
  if (!info) return false
  const v = info.video
  if (v.codec !== 'h264') return false
  if (/10le|10be|p010|12le|12be/.test(v.pixFmt)) return false
  if (/10/.test(v.profile)) return false
  if (!/yuvj?420p/.test(v.pixFmt)) return false
  if (v.width > CONFIG.maxWidth) return false
  if (info.audio && !['aac', 'mp3'].includes(info.audio.codec)) return false
  return true
}

// ------------------------------------------------------------
// 执行外部命令（带超时 + nice）
// ------------------------------------------------------------
function run(cmd, args, { timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    currentChild = child

    let stderrTail = ''
    let settled = false
    const timer = setTimeout(() => {
      if (!settled) {
        try { child.kill('SIGKILL') } catch { /* ignore */ }
      }
    }, timeoutMs)

    child.stderr.on('data', (buf) => {
      const text = buf.toString()
      const lines = text.split(/[\r\n]+/).filter((l) => l.trim() && !/^(frame|size|video|fps|bitrate|speed|out_time)/.test(l))
      if (lines.length) stderrTail = lines.slice(-6).join('\n')
    })

    const done = (code, extra = '') => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      currentChild = null
      resolve({ code, stderr: (stderrTail + (extra ? '\n' + extra : '')).trim() })
    }

    child.on('error', (e) => done(-1, String(e.message || e)))
    child.on('close', (code, signal) => {
      if (signal === 'SIGKILL') return done(-1, `处理超时（超过 ${Math.round(timeoutMs / 1000)} 秒）`)
      done(code ?? -1)
    })
  })
}

/** 让 ffmpeg 以较低优先级运行，保证网站进程优先拿到 CPU */
function niceArgs() {
  if (process.platform === 'win32') return { cmd: FFMPEG, prefix: [] }
  return { cmd: 'nice', prefix: ['-n', String(CONFIG.niceLevel), FFMPEG] }
}

// ------------------------------------------------------------
// 核心处理
// ------------------------------------------------------------

/** 只重封装：把 moov 前置，不重新编码，无损且极快 */
async function rewrap(sourcePath, outputPath) {
  const { cmd, prefix } = niceArgs()
  return run(cmd, [
    ...prefix,
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-i', sourcePath,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-c', 'copy',
    '-movflags', '+faststart',
    '-map_metadata', '-1',
    outputPath,
  ], { timeoutMs: 120_000 })
}

/** 转码为浏览器通用格式 */
async function transcode(sourcePath, outputPath) {
  const { cmd, prefix } = niceArgs()
  const scale = `scale='if(gt(iw,${CONFIG.maxWidth}),${CONFIG.maxWidth},iw)':-2:flags=lanczos`

  return run(cmd, [
    ...prefix,
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-i', sourcePath,
    '-vf', `${scale},format=yuv420p`,
    '-c:v', 'libx264',
    '-profile:v', 'high',
    '-level', '4.1',
    '-preset', CONFIG.preset,
    '-crf', String(CONFIG.crf),
    '-pix_fmt', 'yuv420p',
    // 统一到网页标准色彩，修正大疆 HLG / D-Log 偏色
    '-color_primaries', 'bt709',
    '-color_trc', 'bt709',
    '-colorspace', 'bt709',
    '-c:a', 'aac',
    '-b:a', CONFIG.audioBitrate,
    '-ac', '2',
    '-movflags', '+faststart',
    // 清除大疆写入的 GPS / 飞行轨迹 / 设备序列号
    '-map_metadata', '-1',
    outputPath,
  ], { timeoutMs: CONFIG.jobTimeoutMs })
}

/** 抽取封面帧 */
async function extractPoster(sourcePath, outputPath, duration) {
  const { cmd, prefix } = niceArgs()
  // 取 10% 处（避免片头黑帧），短片则取第 1 秒
  const seek = duration > 3 ? Math.min(duration * 0.1, 5) : Math.min(duration / 2, 1)
  const r = await run(cmd, [
    ...prefix,
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-ss', seek.toFixed(2),
    '-i', sourcePath,
    '-frames:v', '1',
    '-vf', `scale='if(gt(iw,${CONFIG.posterWidth}),${CONFIG.posterWidth},iw)':-2`,
    '-q:v', '4',
    '-map_metadata', '-1',
    outputPath,
  ], { timeoutMs: 60_000 })
  return r.code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0
}

// ------------------------------------------------------------
// 处理单个视频
// ------------------------------------------------------------
async function processVideo(db, config, job) {
  const t0 = Date.now()
  const video = db.prepare('SELECT * FROM post_videos WHERE id = ?').get(job.video_id)
  if (!video) {
    finishJob(db, job.id, 'skipped', { note: '视频记录已不存在（帖子可能已删除）' })
    return
  }

  const uploadDir = config.uploadDir
  const sourcePath = path.join(uploadDir, video.storage_name)

  if (!fs.existsSync(sourcePath)) {
    db.prepare("UPDATE post_videos SET status = 'failed', error_message = ? WHERE id = ?")
      .run('视频文件丢失。', video.id)
    finishJob(db, job.id, 'failed', { error: '视频文件丢失。' })
    return
  }

  const info = probe(sourcePath)
  if (!info) {
    db.prepare("UPDATE post_videos SET status = 'failed', error_message = ? WHERE id = ?")
      .run('无法解析视频文件，可能已损坏。', video.id)
    finishJob(db, job.id, 'failed', { error: '无法解析视频文件。' })
    return
  }

  const uploadId = path.parse(video.storage_name).name
  const tmpOut = path.join(uploadDir, `.transcode-${uploadId}.mp4`)
  const tmpPoster = path.join(uploadDir, `.poster-${uploadId}.jpg`)

  const removeTmp = () => {
    for (const f of [tmpOut, tmpPoster]) {
      try { fs.unlinkSync(f) } catch { /* ignore */ }
    }
  }

  try {
    const browserReady = isBrowserReady(info)
    let note
    let result

    if (browserReady) {
      // 已合规：仅重封装，无损且秒级完成
      result = await rewrap(sourcePath, tmpOut)
      note = '无需转码（原文件已兼容浏览器），仅优化为可边下边播'
      if (result.code !== 0) {
        // 重封装失败不影响播放，保留原文件
        fs.rmSync(tmpOut, { force: true })
        note = '原文件已兼容浏览器，无需处理'
        result = { code: 0, stderr: '' }
      }
    } else {
      result = await transcode(sourcePath, tmpOut)
      const reasons = []
      if (info.video.codec !== 'h264') reasons.push(`编码 ${info.video.codec.toUpperCase()}→H.264`)
      if (/10/.test(info.video.pixFmt) || /10/.test(info.video.profile)) reasons.push('10-bit→8-bit')
      if (info.video.width > CONFIG.maxWidth) reasons.push(`${info.video.width}px→${CONFIG.maxWidth}px`)
      if (info.video.codec === 'h264' && !reasons.length) reasons.push('统一为网页标准格式')
      note = '已转码：' + reasons.join('、')
    }

    if (result.code !== 0) {
      const msg = result.stderr || '转码失败'
      db.prepare("UPDATE post_videos SET status = 'failed', error_message = ? WHERE id = ?").run(msg, video.id)
      finishJob(db, job.id, 'failed', { error: msg, durationMs: Date.now() - t0 })
      removeTmp()
      return
    }

    // 用转码结果原子替换原文件（同名 → 前端 URL 不变，无需改数据库引用）
    const newSize = fs.statSync(tmpOut).size
    if (newSize > 0) {
      fs.renameSync(tmpOut, sourcePath)
    }

    // 抽封面（失败不影响视频可播）
    const posterName = `.poster-${uploadId}.jpg` // 先占位，成功后改名
    let posterFinal = null
    if (await extractPoster(sourcePath, tmpPoster, info.duration)) {
      posterFinal = `${uploadId}-poster.jpg`
      fs.renameSync(tmpPoster, path.join(uploadDir, posterFinal))
    }

    // 重新探测最终规格
    const finalInfo = probe(sourcePath) || info
    const finalSize = fs.statSync(sourcePath).size
    const secs = Math.round((Date.now() - t0) / 1000)
    const sizeNote = newSize > 0 && video.byte_size > 0
      ? `，体积 ${(video.byte_size / 1048576).toFixed(1)}MB → ${(finalSize / 1048576).toFixed(1)}MB`
      : ''

    db.prepare(`UPDATE post_videos
                SET status = 'ready', codec = ?, pix_fmt = ?, width = ?, height = ?,
                    duration_seconds = ?, poster_name = ?, byte_size = ?,
                    process_note = ?, error_message = NULL
                WHERE id = ?`)
      .run(finalInfo.video.codec, finalInfo.video.pixFmt, finalInfo.video.width, finalInfo.video.height,
        finalInfo.duration, posterFinal, finalSize, `${note}（耗时 ${secs} 秒${sizeNote}）`, video.id)

    finishJob(db, job.id, 'done', { note, durationMs: Date.now() - t0 })
    console.log(`[video] ✅ ${video.storage_name} → ${finalInfo.video.codec} ${finalInfo.video.width}x${finalInfo.video.height} (${secs}s)`)
  } catch (error) {
    db.prepare("UPDATE post_videos SET status = 'failed', error_message = ? WHERE id = ?")
      .run(String(error?.message || error), video.id)
    finishJob(db, job.id, 'failed', { error: String(error?.message || error), durationMs: Date.now() - t0 })
    console.error(`[video] ❌ ${video.storage_name}:`, error)
    removeTmp()
  }
}

// ------------------------------------------------------------
// 队列循环
// ------------------------------------------------------------
async function tick(db, config) {
  if (running || stopped) return
  const job = claimNextJob(db)
  if (!job) return
  running = true
  try {
    await processVideo(db, config, job)
  } catch (error) {
    finishJob(db, job.id, 'failed', { error: String(error?.message || error) })
    console.error('[video] worker 异常:', error)
  } finally {
    running = false
  }
}

// ------------------------------------------------------------
// 对外入口
// ------------------------------------------------------------

/** worker 实例（单例），由 startVideoWorker 设置 */
let worker = null

/**
 * 同步处理某个视频任务直到结束（不并发）。
 *
 * 用途：
 *   · 自动化测试：需要确定性地等待转码完成，而不是轮询定时器
 *   · 运维：进程外手动补跑某个卡住的任务
 *
 * @returns {Promise<{ok: boolean, status?: string, error?: string}>}
 */
export async function processVideoNow(db, config, videoId) {
  ensureVideoSchema(db)
  const job = db.prepare('SELECT * FROM video_jobs WHERE video_id = ?').get(videoId)
  if (!job) return { ok: false, error: 'not_queued' }
  if (job.status === 'done') return { ok: true, status: 'done' }

  db.prepare("UPDATE video_jobs SET status = 'processing', started_at = ?, attempts = attempts + 1 WHERE id = ?")
    .run(nowIso(), job.id)
  const claimed = db.prepare('SELECT * FROM video_jobs WHERE id = ?').get(job.id)

  await processVideo(db, config, claimed)

  const after = db.prepare('SELECT status, error_message FROM video_jobs WHERE id = ?').get(job.id)
  return { ok: after.status === 'done', status: after.status, error: after.error_message || undefined }
}

/**
 * 上传视频后调用：入队并立即唤醒 worker。
 * 路由层只需 `queueVideo(db, video.id)` 一行，不必关心队列细节。
 */
export function queueVideo(db, videoId) {
  try {
    ensureVideoSchema(db)
    db.prepare("UPDATE post_videos SET status = 'processing' WHERE id = ? AND status = 'ready'").run(videoId)
    enqueueVideo(db, videoId)
    if (worker) worker.kick()
    return true
  } catch (error) {
    console.error('[video] 入队失败:', error)
    return false
  }
}

/**
 * 启动 worker
 * @returns {{ stop: Function, kick: Function }}
 */
export function startVideoWorker(db, config) {
  ensureVideoSchema(db)

  if (!toolsAvailable) {
    console.warn('[video] 未找到 ffmpeg/ffprobe，视频将不做自动处理（仍可上传，但大疆等格式可能无法播放）')
    worker = { stop() {}, kick() {} }
    return worker
  }

  const recovered = recoverStuckJobs(db)
  if (recovered > 0) console.log(`[video] 恢复 ${recovered} 个中断的任务`)

  // 启动时清理一次残留临时文件
  try { cleanupTempFiles(db, config.uploadDir) } catch { /* ignore */ }

  const timer = setInterval(() => { tick(db, config).catch(() => {}) }, CONFIG.pollIntervalMs)
  timer.unref()

  // 定期清理临时文件
  const janitor = setInterval(() => {
    try { cleanupTempFiles(db, config.uploadDir) } catch { /* ignore */ }
  }, 30 * 60 * 1000)
  janitor.unref()

  tick(db, config).catch(() => {})

  console.log(`[video] 自动转码已启动（输出 ≤${CONFIG.maxWidth}px / H.264 / preset=${CONFIG.preset} / crf=${CONFIG.crf}）`)

  worker = {
    /** 有新任务时立即触发一次，减少等待 */
    kick() { tick(db, config).catch(() => {}) },
    stop() {
      stopped = true
      clearInterval(timer)
      clearInterval(janitor)
      if (currentChild) { try { currentChild.kill('SIGKILL') } catch { /* ignore */ } }
    },
  }
  return worker
}

export { enqueueVideo }
export const VIDEO_CONFIG = CONFIG
