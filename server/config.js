import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

dotenv.config()

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const isProduction = process.env.NODE_ENV === 'production'

function intFromEnv(name, fallback, min, max) {
  const value = Number.parseInt(process.env[name] || String(fallback), 10)
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}`)
  }
  return value
}

export function createConfig(overrides = {}) {
  const config = {
    projectRoot,
    isProduction,
    host: process.env.HOST || '127.0.0.1',
    port: intFromEnv('PORT', 3000, 1, 65535),
    siteOrigin: (process.env.SITE_ORIGIN || 'http://localhost:5173').replace(/\/$/, ''),
    sessionSecret: process.env.SESSION_SECRET || 'development-only-secret-change-before-production',
    sessionDays: intFromEnv('SESSION_DAYS', 60, 1, 60),
    uploadMaxMb: intFromEnv('UPLOAD_MAX_MB', 6, 1, 12),
    dbPath: process.env.DB_PATH || path.join(projectRoot, 'data', 'htyz.db'),
    uploadDir: process.env.UPLOAD_DIR || path.join(projectRoot, 'uploads'),
    distDir: path.join(projectRoot, 'dist'),
    ownerQQ: process.env.OWNER_QQ || '3281895433',
    mail: {
      host: process.env.SMTP_HOST || '',
      port: intFromEnv('SMTP_PORT', 465, 1, 65535),
      secure: String(process.env.SMTP_SECURE || 'true').toLowerCase() === 'true',
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || '',
      from: process.env.MAIL_FROM || '',
      fromName: process.env.MAIL_FROM_NAME || '会同一中交流社区'
    },
    ...overrides
  }

  if (config.isProduction && config.sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters in production')
  }
  return config
}

export const config = createConfig()
