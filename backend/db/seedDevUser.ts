
import { openDatabase } from './database.ts'

const db = openDatabase()

try {
  db.prepare(`
    INSERT OR IGNORE INTO users
      (auth_issuer, auth_subject)
    VALUES (?, ?)
  `).run('local-dev', 'test-user')

  console.log('Usuario de desarrollo preparado')
} finally {
  db.close()
}
