
import { openDatabase } from './database.ts'

const db = openDatabase()

try {
  const users = db.prepare(
    'SELECT COUNT(*) AS total FROM users'
  ).get()

  const cards = db.prepare(
    'SELECT COUNT(*) AS total FROM user_cards'
  ).get()

  console.log('Base de datos inicializada')
  console.log('Usuarios:', users?.total)
  console.log('Cartas registradas:', cards?.total)
} finally {
  db.close()
}
