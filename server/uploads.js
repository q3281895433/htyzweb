import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import multer from 'multer'
import { ApiError, id } from './security.js'

export function imageUpload(config, { maxMb = config.uploadMaxMb, files = 9, fields = 8 } = {}) {
  fs.mkdirSync(config.uploadDir, { recursive: true, mode: 0o750 })
  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, callback) => callback(null, config.uploadDir),
      filename: (_req, _file, callback) => callback(null, `.incoming-${id()}`)
    }),
    limits: { fileSize: maxMb * 1024 * 1024, files, fields }
  })
}

export function postMediaUpload(config) {
  fs.mkdirSync(config.uploadDir, { recursive: true, mode: 0o750 })
  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, callback) => callback(null, config.uploadDir),
      filename: (_req, _file, callback) => callback(null, `.incoming-${id()}`)
    }),
    limits: { fileSize: 50 * 1024 * 1024, files: 10, fields: 8 }
  })
}

export function limitPostBody(req, _res, next) {
  const length = Number(req.get('content-length'))
  if (Number.isFinite(length) && length > 110 * 1024 * 1024) return next(new ApiError(413, 'upload_too_large', '本次图片和视频总量不能超过 110MB。'))
  next()
}

export function cleanupUploadTemps(req, res, next) {
  const paths = [...(Array.isArray(req.files) ? req.files : Object.values(req.files || {}).flat()), req.file].filter(Boolean).map((file) => file.path)
  let cleaned = false
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    for (const filePath of paths) {
      try { fs.unlinkSync(filePath) } catch (error) { if (error.code !== 'ENOENT') console.error(error) }
    }
  }
  res.once('finish', cleanup)
  res.once('close', cleanup)
  next()
}

export function checkedImage(file) {
  if (file.size > 12 * 1024 * 1024) throw new ApiError(413, 'image_too_large', '单张图片不能超过 12MB。')
  const header = Buffer.alloc(12)
  const handle = fs.openSync(file.path, 'r')
  let bytes
  try { bytes = fs.readSync(handle, header, 0, header.length, 0) } finally { fs.closeSync(handle) }
  const magic = header.subarray(0, bytes)
  const type = magic.length >= 3 && magic.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ? { mime: 'image/jpeg', ext: 'jpg' }
    : magic.length >= 8 && magic.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? { mime: 'image/png', ext: 'png' }
      : magic.length >= 12 && magic.subarray(0, 4).toString() === 'RIFF' && magic.subarray(8, 12).toString() === 'WEBP' ? { mime: 'image/webp', ext: 'webp' }
        : null
  if (!type) throw new ApiError(415, 'image_type_invalid', '仅支持真实的 JPG、PNG 或 WebP 图片。')
  return {
    id: id(), storageName: `${id()}.${type.ext}`,
    originalName: path.basename(file.originalname).slice(0, 120),
    sourcePath: file.path, byteSize: file.size, ...type
  }
}

export function checkedPostImage(file, config) {
  if (file.size > config.uploadMaxMb * 1024 * 1024) throw new ApiError(413, 'image_too_large', `单张图片不能超过 ${config.uploadMaxMb}MB。`)
  return checkedImage(file)
}

export function checkedVideo(file) {
  if (!file) return null
  const header = Buffer.alloc(16)
  const handle = fs.openSync(file.path, 'r')
  let bytes
  try { bytes = fs.readSync(handle, header, 0, header.length, 0) } finally { fs.closeSync(handle) }
  const magic = header.subarray(0, bytes)
  const type = magic.length >= 12 && magic.subarray(4, 8).toString() === 'ftyp' ? { mime: 'video/mp4', ext: 'mp4' }
    : magic.length >= 4 && magic.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) ? { mime: 'video/webm', ext: 'webm' } : null
  if (!type) throw new ApiError(415, 'video_type_invalid', '仅支持真实的 MP4 或 WebM 视频。')
  return { id: id(), storageName: `${id()}.${type.ext}`, originalName: path.basename(file.originalname).slice(0, 120), sourcePath: file.path, byteSize: file.size, ...type }
}

let optimizerBusy = false

export async function optimizeUploadTemps(req, _res, next) {
  if (optimizerBusy) return next()
  optimizerBusy = true
  try {
    const files = [...(Array.isArray(req.files) ? req.files : Object.values(req.files || {}).flat()), req.file].filter(Boolean)
    const deadline = Date.now() + 25000
    for (const file of files) {
      if (Date.now() >= deadline) break
      let type
      try { type = file.fieldname === 'video' ? checkedVideo(file) : checkedImage(file) } catch { continue }
      const ext = type.ext
      const output = `${file.path}.optimized.${ext}`
      let command, args
      if (ext === 'jpg') { command = 'jpegtran'; args = ['-copy', 'all', '-optimize', '-outfile', output, file.path] }
      else if (ext === 'png') { command = 'optipng'; args = ['-o1', '-out', output, file.path] }
      else if (ext === 'mp4' || ext === 'webm') {
        command = 'ffmpeg'
        args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-threads', '1', '-i', file.path, '-map', '0', '-c', 'copy', '-map_metadata', '0', ...(ext === 'mp4' ? ['-movflags', '+faststart'] : []), output]
      } else continue
      const timeout = Math.min(ext === 'mp4' || ext === 'webm' ? 15000 : 6000, deadline - Date.now())
      try {
        if (await runOptimizer(command, args, timeout)) {
          const size = fs.statSync(output).size
          if (size > 0 && size < file.size) { fs.renameSync(output, file.path); file.size = size }
        }
      } catch { /* The original upload remains available if optimization fails. */ }
      removeFiles([output])
    }
  } finally { optimizerBusy = false; next() }
}

function runOptimizer(command, args, timeout) {
  return new Promise((resolve) => {
    let settled = false
    const child = spawn(command, args, { stdio: 'ignore' })
    try { os.setPriority(child.pid, 15) } catch { /* Not all platforms allow priority changes. */ }
    const finish = (ok) => { if (!settled) { settled = true; clearTimeout(timer); resolve(ok) } }
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(false) }, timeout)
    child.once('error', () => finish(false))
    child.once('close', (code) => finish(code === 0))
  })
}

export function removeFiles(paths) {
  for (const filePath of paths) {
    try { fs.unlinkSync(filePath) } catch (error) { if (error.code !== 'ENOENT') console.error(error) }
  }
}

export function moveImages(config, files) {
  const moved = []
  try {
    for (const file of files) {
      const destination = path.join(config.uploadDir, file.storageName)
      fs.linkSync(file.sourcePath, destination)
      moved.push(destination)
      fs.chmodSync(destination, 0o640)
      fs.unlinkSync(file.sourcePath)
    }
    return moved
  } catch (error) {
    removeFiles(moved)
    throw error
  }
}
