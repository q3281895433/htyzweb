import process from 'node:process'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { config } from './config.js'
import { nowIso, openDatabase } from './db.js'
import { hashPassword, id, normalizeEmail, validatePassword } from './security.js'

const emailArg = process.argv.find((arg) => arg.startsWith('--email='))?.slice(8)
const passwordArg = process.argv.find((arg) => arg.startsWith('--password='))?.slice(11)
const rl = readline.createInterface({ input, output })
const email = normalizeEmail(emailArg || await rl.question('Super admin email: '))
const password = passwordArg || await rl.question('Initial password (input is visible): ')
rl.close()

if (!email) throw new Error('A valid email is required')
const passwordError = validatePassword(password)
if (passwordError) throw new Error(passwordError)

const db = openDatabase(config.dbPath)
const now = nowIso()
const passwordHash = await hashPassword(password)
const existing = db.prepare('SELECT id FROM staff_accounts WHERE email = ?').get(email)
if (existing) {
  db.prepare("UPDATE staff_accounts SET password_hash = ?, role = 'super_admin', status = 'active', activated_at = COALESCE(activated_at, ?), updated_at = ? WHERE id = ?")
    .run(passwordHash, now, now, existing.id)
  console.log('Existing staff account promoted to super admin.')
} else {
  db.prepare(`INSERT INTO staff_accounts
    (id, email, password_hash, role, status, activated_at, created_at, updated_at)
    VALUES (?, ?, ?, 'super_admin', 'active', ?, ?, ?)`)
    .run(id(), email, passwordHash, now, now, now)
  console.log('Super admin account created.')
}
db.close()
