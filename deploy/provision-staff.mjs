import readline from 'node:readline'
import { config } from '../server/config.js'
import { nowIso, openDatabase } from '../server/db.js'
import { hashPassword, id, normalizeEmail, validatePassword } from '../server/security.js'

const lines = readline.createInterface({ input: process.stdin, terminal: false })
let line
for await (const value of lines) {
  line = value
  lines.close()
  break
}
if (!line) throw new Error('Provide one JSON line on stdin with an accounts array.')

const input = JSON.parse(line)
if (!Array.isArray(input.accounts) || input.accounts.length < 1 || input.accounts.length > 5) {
  throw new Error('Expected 1–5 accounts.')
}
const accounts = []
for (const account of input.accounts) {
  const email = normalizeEmail(account.email)
  const role = account.role
  if (!email || !['super_admin', 'moderator', 'campus_admin', 'alumni_admin'].includes(role)) {
    throw new Error('Invalid staff email or role.')
  }
  const passwordError = validatePassword(account.password)
  if (passwordError) throw new Error(passwordError)
  accounts.push({ email, role, passwordHash: await hashPassword(account.password) })
}
if (new Set(accounts.map(({ email }) => email)).size !== accounts.length) throw new Error('Duplicate email in input.')

const db = openDatabase(config.dbPath)
try {
  for (const { email } of accounts) {
    if (db.prepare('SELECT id FROM staff_accounts WHERE email = ?').get(email)) {
      throw new Error(`Staff account already exists: ${email}`)
    }
  }
  const now = nowIso()
  db.transaction(() => {
    const insert = db.prepare(`INSERT INTO staff_accounts
      (id, email, password_hash, role, status, must_change_password, activated_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', 1, ?, ?, ?)`) 
    for (const { email, role, passwordHash } of accounts) {
      insert.run(id(), email, passwordHash, role, now, now, now)
    }
  })()
  console.log(`Created ${accounts.length} staff accounts; first login requires a password change.`)
} finally {
  db.close()
}
