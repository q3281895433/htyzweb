import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const email = String(process.argv[2] || '').trim().toLowerCase()
if (!/^\d+@qq\.com$/.test(email)) throw new Error('Expected a QQ mailbox address as the first argument.')

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const authorizationCode = await new Promise((resolve) => rl.question('QQ SMTP authorization code: ', resolve))
rl.close()
if (!/^[A-Za-z0-9]{12,64}$/.test(authorizationCode)) throw new Error('Authorization code format is invalid.')

const envPath = '/opt/htyz/.env'
const original = fs.readFileSync(envPath, 'utf8')
const stats = fs.statSync(envPath)
const updates = {
  SMTP_HOST: 'smtp.qq.com',
  SMTP_PORT: '465',
  SMTP_SECURE: 'true',
  SMTP_USER: email,
  SMTP_PASS: authorizationCode,
  MAIL_FROM: email,
  MAIL_FROM_NAME: '会同一中学生社区中心'
}
const seen = new Set()
const lines = original.trimEnd().split('\n').map((line) => {
  const match = /^([A-Z_]+)=/.exec(line)
  if (!match || !Object.hasOwn(updates, match[1])) return line
  seen.add(match[1])
  return `${match[1]}=${updates[match[1]]}`
})
for (const [key, value] of Object.entries(updates)) {
  if (!seen.has(key)) lines.push(`${key}=${value}`)
}
const temporaryPath = path.join(path.dirname(envPath), `.env.smtp-${process.pid}`)
try {
  fs.writeFileSync(temporaryPath, `${lines.join('\n')}\n`, { mode: stats.mode & 0o777, flag: 'wx' })
  fs.chownSync(temporaryPath, stats.uid, stats.gid)
  fs.chmodSync(temporaryPath, stats.mode & 0o777)
  fs.renameSync(temporaryPath, envPath)
} catch (error) {
  try { fs.unlinkSync(temporaryPath) } catch {}
  throw error
}
console.log(`SMTP configuration saved for ${email}; authorization code is not printed.`)
