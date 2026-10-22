import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import { DatabaseSync } from 'node:sqlite'
import { runMigrations, rollbackMigration, MIGRATIONS } from '../../src/db/migrations.js'

test('Phase 0 - Database Migrations: Reversible Up and Down', (t) => {
  const testDbPath = path.resolve('data/test_migration.db')
  fs.mkdirSync(path.dirname(testDbPath), { recursive: true })
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath)
  }

  const db = new DatabaseSync(testDbPath)

  // 1. Chạy Migration Up
  runMigrations(db)

  // Kiểm tra 18 bảng cốt lõi đã tồn tại
  const expectedTables = [
    'orders', 'payments', 'shipments', 'cases', 'promises',
    'consents', 'preferences', 'memory_facts', 'events', 'outbox',
    'jobs', 'action_audits', 'policy_versions', 'quotes', 'reservations',
    'conversations', 'messages', 'policy_snapshots', 'kill_switch_state', '_migrations'
  ]

  const existingTables = db.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
  `).all().map((r) => r.name)

  for (const table of expectedTables) {
    assert.ok(existingTables.includes(table), `Bảng ${table} phải tồn tại sau khi migrate up`)
  }

  // 2. Chạy Idempotency: chạy lại lần 2 không gây lỗi
  assert.doesNotThrow(() => {
    runMigrations(db)
  }, 'Chạy migration lần 2 phải idempotent, không văng lỗi')

  // 3. Chạy Migration Down (Rollback)
  rollbackMigration(db, 0)

  const remainingTables = db.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
  `).all().map((r) => r.name)

  assert.strictEqual(remainingTables.length, 0, 'Toàn bộ bảng phải bị xóa sạch sau khi rollback về 0')

  // 4. Migrate Up lại để sẵn sàng hoạt động
  runMigrations(db)
  const restoredTables = db.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
  `).all().map((r) => r.name)
  assert.strictEqual(restoredTables.length, expectedTables.length, 'Phải phục hồi đầy đủ bảng sau khi migrate lại')

  db.close()
  try {
    fs.unlinkSync(testDbPath)
    if (fs.existsSync(`${testDbPath}-wal`)) fs.unlinkSync(`${testDbPath}-wal`)
    if (fs.existsSync(`${testDbPath}-shm`)) fs.unlinkSync(`${testDbPath}-shm`)
  } catch {}
})
