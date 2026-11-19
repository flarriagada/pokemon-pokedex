
import { openDatabase } from './database.ts'

const db = openDatabase()

try {
  
  const users = db.prepare(
    'SELECT COUNT(*) AS total FROM users'
  ).get()
//Contamos cartas
  const cards = db.prepare(
    'SELECT COUNT(*) AS total FROM user_cards'
  ).get()

  // Contamos las sesiones registradas en la base de datos.
  const sessions = db.prepare(
    'SELECT COUNT(*) AS total FROM sessions'
  ).get()


  console.log('Base de datos inicializada')
  console.log('Usuarios:', users?.total)
  console.log('Cartas registradas:', cards?.total)
  console.log('Sesiones:', sessions?.total)
} finally {
  db.close()
}
