import process from 'node:process'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { config } from './config.js'
import { addTime, nowIso, openDatabase } from './db.js'
import { createMailer } from './mail.js'
import { audit, createEmailToken, id, normalizeEmail } from './security.js'

const emailArg = process.argv.find((arg) => arg.startsWith('--email='))?.slice(8)
const rl = readline.createInterface({ input, output })
const email = normalizeEmail(emailArg || await rl.question('Super admin email: '))
rl.close()

if (!email) throw new Error('A valid email is required')

const db = openDatabase(config.dbPath)
const mailer = createMailer(config)

if (!mailer.configured) {
  db.close()
  throw new Error('SMTP must be configured before bootstrapping the super admin')
}

const now = nowIso()
const existing = db.prepare('SELECT * FROM staff_accounts WHERE email = ?').get(email)
if (existing?.status === 'active' && existing.role === 'super_admin') {
  db.close()
  throw new Error('This email is already an active super admin')
}

const staffId = existing?.id || id()
db.transaction(() => {
  if (existing) {
    db.prepare("UPDATE staff_accounts SET password_hash = NULL, role = 'super_admin', status = 'pending_activation', updated_at = ? WHERE id = ?")
      .run(now, staffId)
  } else {
    db.prepare(`INSERT INTO staff_accounts (id, email, role, status, created_at, updated_at)
      VALUES (?, ?, 'super_admin', 'pending_activation', ?, ?)`).run(staffId, email, now, now)
  }
})()

const token = createEmailToken(db, 'staff', staffId, 'activate_staff', addTime({ hours: 24 }))
try {
  await mailer.sendStaffActivation(email, token)
  audit(db, { actorType: 'system', event: 'super_admin_bootstrap_sent', targetType: 'staff', targetId: staffId })
  console.log(`Super admin activation email sent to ${email}.`)
} catch (error) {
  audit(db, { actorType: 'system', event: 'super_admin_bootstrap_email_failed', targetType: 'staff', targetId: staffId })
  throw error
} finally {
  db.close()
}
