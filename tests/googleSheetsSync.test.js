import test from 'node:test'
import assert from 'node:assert'
import { getDb } from '../src/db/connection.js'
import { GoogleSheetsService, parseCsv } from '../src/integrations/googleSheetsService.js'

test('Google Sheets Sync & Delivery Care Test Suite', async (t) => {
  const db = getDb()

  await t.test('parseCsv handles typical Vietnamese order sheet headers and data', () => {
    const csv = [
      'Mã Đơn,Tên Khách,Số Điện Thoại,Tên Sản Phẩm,Tổng Tiền,Trạng Thái ĐH,Nguồn,ID Kênh',
      'QNS-TEST-001,Chị Mai,0912345678,The Daybreak Set,690000,ĐÃ XÁC NHẬN,messenger,fb_12345',
      'QNS-TEST-002,Anh Nam,0987654321,The Stillwater Set,790000,ĐÃ GIAO,messenger,fb_67890',
    ].join('\n')

    const rows = parseCsv(csv)
    assert.strictEqual(rows.length, 2)
    assert.strictEqual(rows[0]['ma đon'] || rows[0]['ma don'], 'QNS-TEST-001')
    assert.strictEqual(rows[0]['ten khach'] || rows[0]['ten'], 'Chị Mai')
    assert.strictEqual(rows[1]['trang thai đh'] || rows[1]['trang thai dh'], 'ĐÃ GIAO')
  })

  await t.test('handleDeliveryConfirmation auto-creates order when confirmedBy includes google_sheet_poller', async () => {
    const testOrderId = `QNS-TEST-${Date.now()}`
    const result = await GoogleSheetsService.handleDeliveryConfirmation(db, {
      orderId: testOrderId,
      customerName: 'Khách Hàng Test Sync',
      customerPhone: '0933112233',
      items: 'The Moonlight Set',
      channel: 'messenger',
      channelSenderId: 'fb_test_poller_999',
      carrier: 'Viettel Post',
      trackingCode: 'VTP999999',
      confirmedBy: 'google_sheet_poller (Service Account)',
    })

    assert.strictEqual(result.status, 'SUCCEEDED')
    assert.strictEqual(result.orderId, testOrderId)

    // Check order is in DB
    const order = db.prepare('SELECT * FROM orders WHERE order_id = ?').get(testOrderId)
    assert.ok(order, 'Đơn hàng phải được lưu vào CSDL')
    assert.strictEqual(order.status, 'DELIVERED')
    assert.strictEqual(order.customer_name, 'Khách Hàng Test Sync')

    // Check idempotent checkin job
    const job = db.prepare('SELECT * FROM jobs WHERE business_key = ?').get(`checkin:${testOrderId}`)
    assert.ok(job, 'Phải tạo checkin job')
    assert.strictEqual(job.status, 'COMPLETED')

    // Clean up with correct foreign key order
    db.prepare('DELETE FROM action_audits WHERE target_entity_id = ?').run(testOrderId)
    db.prepare('DELETE FROM shipments WHERE order_id = ?').run(testOrderId)
    db.prepare('DELETE FROM outbox WHERE idempotency_key = ?').run(`outbox:checkin:${testOrderId}`)
    db.prepare('DELETE FROM jobs WHERE business_key = ?').run(`checkin:${testOrderId}`)
    db.prepare('DELETE FROM orders WHERE order_id = ?').run(testOrderId)
  })
})
