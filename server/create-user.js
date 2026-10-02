import fs from 'node:fs'
import Database from 'better-sqlite3'
import { config } from './config.js'
import { hashPassword, id, normalizeEmail, validatePassword } from './security.js'

try {
  let input = ''
  for await (const chunk of process.stdin) {
    input += chunk
    if (input.length > 512) throw new Error('输入过长。')
  }
  const [rawEmail, memberType, password] = input.split('\n')
  const email = normalizeEmail(rawEmail)
  if (!email) throw new Error('邮箱格式无效。')
  if (!['current_student', 'graduate'].includes(memberType)) throw new Error('身份类型无效。')
  const passwordError = validatePassword(password)
  if (passwordError) throw new Error(passwordError)
  if (!fs.existsSync(config.dbPath)) throw new Error('数据库文件不存在，已停止操作。')

  const db = new Database(config.dbPath)
  try {
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
      throw new Error('该邮箱已注册；脚本不会覆盖现有账号或密码。')
    }
    const now = new Date().toISOString()
    const passwordHash = await hashPassword(password)
    db.prepare(`INSERT INTO users (id, email, password_hash, member_type, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?)`).run(id(), email, passwordHash, memberType, now, now)
    console.log(`创建成功：${email}（${memberType === 'graduate' ? '毕业生' : '在校生'}）。该用户现在可以直接登录。`)
  } finally {
    db.close()
  }
} catch (error) {
  console.error(`创建失败：${error.message}`)
  process.exitCode = 1
}
