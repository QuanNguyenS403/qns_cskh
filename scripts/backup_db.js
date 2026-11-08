import fs from 'node:fs'
import path from 'node:path'
import { getDb } from '../src/db/connection.js'

export function backupDatabase() {
  const db = getDb()
  const backupDir = path.resolve(process.cwd(), 'data/backups')
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true })
  }

  const now = new Date()
  const dateStr = now.toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const targetFile = path.join(backupDir, `cskh_backup_${dateStr}.db`)

  try {
    // Checkpoint WAL first
    db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').run()
    // SQLite safe VACUUM INTO backup
    db.prepare('VACUUM INTO ?').run(targetFile)
    console.log(`✅ [DB BACKUP] Đã sao lưu database an toàn tới: ${targetFile}`)

    // Keep only last 14 backups
    const files = fs.readdirSync(backupDir)
      .filter((f) => f.startsWith('cskh_backup_') && f.endsWith('.db'))
      .sort()

    if (files.length > 14) {
      const toDelete = files.slice(0, files.length - 14)
      for (const f of toDelete) {
        fs.unlinkSync(path.join(backupDir, f))
      }
    }

    return { success: true, file: targetFile }
  } catch (err) {
    console.error('🚨 [DB BACKUP ERROR]:', err.message)
    return { success: false, error: err.message }
  }
}

if (process.argv[1] && process.argv[1].endsWith('backup_db.js')) {
  backupDatabase()
}
