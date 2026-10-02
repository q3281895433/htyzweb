/**
 * 视频自动转码队列
 * ------------------------------------------------------------
 * 设计要点：
 *   1. 任务落库（video_jobs 表），进程重启/断电不丢任务
 *   2. 同一时刻只跑 1 个 ffmpeg（1 核机器，避免互相争抢）
 *   3. 启动时把 processing 状态的僵尸任务重新排队
 *   4. 失败可重试，超过上限标记 failed 并给出可读原因
 *   5. 全程不改原文件名，转码产物写到临时目录后再原子替换
 */
import fs from 'node:fs'
import path from 'node:path'
import { id } from './security.js'
import { nowIso } from './db.js'

// ------------------------------------------------------------
// 建表与迁移
// ------------------------------------------------------------

const JOB_SCHEMA = `
CREATE TABLE IF NOT EXISTS video_jobs (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','processing','done','failed','skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 0,
  result_note TEXT,
  error_message TEXT,
  queued_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  duration_ms INTEGER,
  UNIQUE(video_id)
);
CREATE INDEX IF NOT EXISTS video_jobs_status_idx ON video_jobs(status, priority DESC, queued_at);
`

/** 给 post_videos 补齐转码相关字段 */
function ensureVideoColumns(db) {
  const columns = db.prepare('PRAGMA table_info(post_videos)').all().map((c) => c.name)
  const add = (name, def) => {
    if (!columns.includes(name)) db.exec(`ALTER TABLE post_videos ADD COLUMN ${name} ${def}`)
  }
  add('status', "TEXT NOT NULL DEFAULT 'ready'")   // processing | ready | failed
  add('codec', 'TEXT')                              // h264 / hevc / ...
  add('pix_fmt', 'TEXT')
  add('width', 'INTEGER')
  add('height', 'INTEGER')
  add('duration_seconds', 'REAL')
  add('poster_name', 'TEXT')                        // 封面图文件名
  add('process_note', 'TEXT')                       // 处理说明（转码/仅重封装/无需处理）
  add('error_message', 'TEXT')
}

export function ensureVideoSchema(db) {
  db.exec(JOB_SCHEMA)
  ensureVideoColumns(db)
}

// ------------------------------------------------------------
// 入队
// ------------------------------------------------------------

/** 把视频加入转码队列（重复调用幂等） */
export function enqueueVideo(db, videoId, { priority = 0 } = {}) {
  const now = nowIso()
  db.prepare(`INSERT INTO video_jobs (id, video_id, status, priority, queued_at)
              VALUES (?, ?, 'queued', ?, ?)
              ON CONFLICT(video_id) DO UPDATE SET
                status = CASE WHEN video_jobs.status IN ('done') THEN video_jobs.status ELSE 'queued' END,
                priority = excluded.priority,
                queued_at = excluded.queued_at,
                error_message = NULL`)
    .run(id(), videoId, priority, now)
}

// ------------------------------------------------------------
// 取出下一个任务
// ------------------------------------------------------------

function claimNextJob(db) {
  const job = db.prepare(`SELECT * FROM video_jobs
                          WHERE status = 'queued' AND attempts < 3
                          ORDER BY priority DESC, queued_at ASC LIMIT 1`).get()
  if (!job) return null

  const updated = db.prepare(`UPDATE video_jobs
                              SET status = 'processing', started_at = ?, attempts = attempts + 1
                              WHERE id = ? AND status = 'queued'`).run(nowIso(), job.id)
  if (updated.changes === 0) return null
  return db.prepare('SELECT * FROM video_jobs WHERE id = ?').get(job.id)
}

function finishJob(db, jobId, status, { note = null, error = null, durationMs = null } = {}) {
  db.prepare(`UPDATE video_jobs
              SET status = ?, finished_at = ?, result_note = ?, error_message = ?, duration_ms = ?
              WHERE id = ?`)
    .run(status, nowIso(), note, error, durationMs, jobId)
}

/**
 * 启动时恢复：把上次异常退出时卡在 processing 的任务重新排队。
 * 同时清理转码过程中留下的临时文件。
 */
export function recoverStuckJobs(db) {
  const stuck = db.prepare("SELECT * FROM video_jobs WHERE status = 'processing'").all()
  for (const job of stuck) {
    if (job.attempts >= 3) {
      finishJob(db, job.id, 'failed', { error: '处理中断且已超过重试次数。' })
    } else {
      db.prepare("UPDATE video_jobs SET status = 'queued', started_at = NULL WHERE id = ?").run(job.id)
    }
  }
  return stuck.length
}

/** 清理未被引用的临时文件（.incoming-* / .transcode-*） */
export function cleanupTempFiles(db, uploadDir, maxAgeMinutes = 30) {
  let removed = 0
  const cutoff = Date.now() - maxAgeMinutes * 60 * 1000
  let entries = []
  try { entries = fs.readdirSync(uploadDir) } catch { return 0 }

  const referenced = new Set(
    db.prepare('SELECT storage_name FROM post_videos').all().map((r) => r.storage_name)
      .concat(db.prepare('SELECT poster_name FROM post_videos WHERE poster_name IS NOT NULL').all().map((r) => r.poster_name))
  )

  for (const name of entries) {
    const isTemp = name.startsWith('.incoming-') || name.startsWith('.transcode-') || name.startsWith('.poster-')
    if (!isTemp) continue
    if (referenced.has(name)) continue
    const full = path.join(uploadDir, name)
    try {
      const st = fs.statSync(full)
      if (st.mtimeMs < cutoff) { fs.unlinkSync(full); removed += 1 }
    } catch { /* ignore */ }
  }
  return removed
}

export { claimNextJob, finishJob }
