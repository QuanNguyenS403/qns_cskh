import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import path from 'path'
import { config } from '../config/env.js'

let dbInstance = null

export function getDb(customPath = null) {
  if (dbInstance && !customPath) {
    return dbInstance
  }

  const targetPath = customPath || config.DB_PATH
  const dbDir = path.dirname(path.resolve(targetPath))

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true })
  }

  const db = new DatabaseSync(targetPath)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec('PRAGMA busy_timeout = 5000;')

  if (!customPath) {
    dbInstance = db
  }

  return db
}

export function closeDb() {
  if (dbInstance) {
    try {
      dbInstance.close()
    } catch {}
    dbInstance = null
  }
}
