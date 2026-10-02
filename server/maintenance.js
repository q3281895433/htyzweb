// 维护提示中间件
//
// 用途：服务器迁移期间，把网页访问引导到一个静态提示页。
//
// 设计取舍：
//   · 只拦截「页面请求」，放行 /api/ 与静态资源
//     → 维护页的 CSS/字体能正常加载，页面不会变成裸 HTML
//     → 后台健康检查、数据迁移、管理员接口仍可用
//   · 由环境变量 MAINTENANCE_NOTICE 控制，设为 0 即可立即恢复，
//     不需要改代码、不需要重新发布。
//   · 维护页本身不依赖前端构建产物，即使 dist 出问题也能显示。

import fs from 'node:fs'
import path from 'node:path'

/** 不需要拦截的路径前缀 */
const PASSTHROUGH = [
  '/api/',       // 接口（健康检查、后台操作、迁移脚本都要用）
  '/assets/',    // 前端静态资源
  '/favicon',    // 站点图标
]

/** 放行的具体文件（维护页用到的资源） */
const ALLOWED_FILES = new Set([
  '/index.html',           // 前端入口（仅静态读取，不会被当成页面返回）
  '/maintenance.html',     // 维护页自身
  '/logo.svg',
])

export function maintenanceNotice({ config }) {
  const enabled = String(process.env.MAINTENANCE_NOTICE || '').trim() === '1'
  const noticePath = path.join(config.distDir, 'maintenance.html')

  if (!enabled) {
    return (_req, _res, next) => next()
  }

  const hasNotice = fs.existsSync(noticePath)
  if (!hasNotice) {
    console.warn('[maintenance] MAINTENANCE_NOTICE=1 但找不到 maintenance.html，维护页将无法显示')
  }

  return (req, res, next) => {
    // 只处理页面请求（GET/HEAD），写操作交给正常流程
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()

    const urlPath = req.path

    // 放行接口与静态资源
    if (PASSTHROUGH.some((p) => urlPath.startsWith(p))) return next()
    if (ALLOWED_FILES.has(urlPath)) return next()

    // 带扩展名的请求（.js/.css/.png/.mp4…）放行，避免资源被拦截
    if (/\.[A-Za-z0-9]+$/.test(urlPath)) return next()

    // 其余页面请求 → 维护提示页
    if (!hasNotice) return next()

    res.set('Cache-Control', 'no-store, must-revalidate')
    res.set('Retry-After', '3600')
    res.status(503)
    return res.sendFile(noticePath)
  }
}
