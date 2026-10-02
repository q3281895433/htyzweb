/**
 * 测试辅助：视频转码相关
 *
 * 测试需要真实的视频文件与可用的 ffmpeg/ffprobe：
 *   · ffprobe 要能解析容器，才能判断编码是否达标
 *   · ffmpeg 要能转码，才能验证大疆 HEVC 素材会被自动处理
 *
 * 为了不把二进制素材提交进仓库，小视频在运行时用 ffmpeg 现场生成。
 * 若本机没有 ffmpeg，则相关用例自动跳过（而不是失败）。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** 解析 ffmpeg/ffprobe：优先项目内 @ffmpeg-installer，其次 PATH */
function resolveTool(name) {
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'ia32' ? 'ia32' : 'x64'
  const pkg = { darwin: `darwin-${arch}`, win32: `win32-${arch}`, linux: `linux-${arch}` }[process.platform]
  const exe = process.platform === 'win32' ? '.exe' : ''
  const candidates = pkg
    ? [
        path.resolve('tools/dji-convert/node_modules/@ffmpeg-installer', pkg, name + exe),
        path.resolve('node_modules/@ffmpeg-installer', pkg, name + exe),
      ]
    : []
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      if (process.platform !== 'win32') {
        try { fs.chmodSync(c, 0o755) } catch { /* ignore */ }
      }
      return c
    }
  }
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8' })
  if (r.status === 0) {
    const first = (r.stdout || '').split(/\r?\n/).find(Boolean)
    if (first) return first.trim()
  }
  return null
}

export const FFMPEG = resolveTool('ffmpeg')
export const FFPROBE = resolveTool('ffprobe')
export const videoToolingAvailable = Boolean(FFMPEG && FFPROBE)

/** 让被测代码使用同一套 ffmpeg（必须在 import 业务模块之前调用） */
export function pinToolPaths() {
  if (FFMPEG) process.env.FFMPEG_PATH = FFMPEG
  if (FFPROBE) process.env.FFPROBE_PATH = FFPROBE
}

/** 生成一段真实的小视频 */
export function generateVideo(dir, { seconds = 1, size = '160x90', codec = 'libx264', pixFmt = 'yuv420p' } = {}) {
  if (!FFMPEG) return null
  fs.mkdirSync(dir, { recursive: true })
  const out = path.join(dir, `fixture-${codec}-${pixFmt}-${Date.now()}.mp4`)
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=10:duration=${seconds}`,
    '-c:v', codec, '-pix_fmt', pixFmt,
    ...(codec === 'libx264' ? ['-preset', 'ultrafast', '-crf', '35'] : []),
    ...(codec === 'libx265' ? ['-preset', 'ultrafast', '-x265-params', 'log-level=none'] : []),
    '-movflags', '+faststart', '-an', out,
  ]
  const r = spawnSync(FFMPEG, args, { encoding: 'utf8', timeout: 120_000 })
  if (r.status !== 0 || !fs.existsSync(out)) return null
  return { path: out, buffer: fs.readFileSync(out) }
}

/** 生成一段 HEVC 10-bit 视频，模拟大疆无人机素材 */
export function generateDjiLikeVideo(dir) {
  return generateVideo(dir, { seconds: 1, size: '320x180', codec: 'libx265', pixFmt: 'yuv420p10le' })
}

/** 用 ffprobe 读取规格，供断言使用 */
export function probeFile(file) {
  if (!FFPROBE) return null
  const r = spawnSync(FFPROBE, [
    '-v', 'error',
    '-show_entries', 'stream=codec_type,codec_name,profile,pix_fmt,width,height',
    '-of', 'json', file,
  ], { encoding: 'utf8', timeout: 60_000 })
  if (r.status !== 0) return null
  try {
    const j = JSON.parse(r.stdout)
    return (j.streams || []).find((s) => s.codec_type === 'video') || null
  } catch {
    return null
  }
}

/** 临时目录 */
export function makeTempDir(prefix = 'htyz-video-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}
