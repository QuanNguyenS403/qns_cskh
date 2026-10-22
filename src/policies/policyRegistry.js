/**
 * POLICY REGISTRY & VERSIONING (Blueprint §8, §16.2, Gates B04, T07, T42)
 * 
 * - Quản lý phiên bản chính sách: DRAFT vs APPROVED.
 * - Tuyệt đối không hard-code chính sách vào prompt/logic.
 * - Chính sách chưa APPROVED (hoặc đang DRAFT) thì không được nhắc như quyền lợi đang áp dụng (B04, T07).
 * - Đóng băng chính sách vào snapshot tại thời điểm tạo đơn/quote (T42): Đơn cũ luôn giữ quyền đã cam kết.
 */

import crypto from 'node:crypto'

export const POLICY_TYPES = {
  SHIPPING: 'shipping',
  RETURNS: 'returns',
  PRICING: 'pricing',
  PRIVACY: 'privacy',
  COD_INSPECTION: 'cod_inspection',
}

/**
 * Đăng ký hoặc cập nhật một phiên bản chính sách
 */
export function registerPolicy(db, {
  tenantId = 'default',
  shopId = 'quannguyens',
  policyType,
  version,
  effectiveDate = new Date().toISOString(),
  status = 'DRAFT', // DRAFT | APPROVED
  content,
  approvedBy = null,
}) {
  if (!policyType || !version || !content) {
    throw new Error('policyType, version và content là bắt buộc')
  }

  const id = `POL-${shopId}-${policyType}-${version}`
  const now = new Date().toISOString()
  const contentJson = typeof content === 'string' ? content : JSON.stringify(content)
  const approvedAt = status === 'APPROVED' ? (approvedBy ? now : null) : null

  const stmt = db.prepare(`
    INSERT INTO policy_versions (
      id, tenant_id, shop_id, policy_type, version, effective_date,
      status, content_json, approved_by, approved_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(shop_id, policy_type, version) DO UPDATE SET
      effective_date = excluded.effective_date,
      status = excluded.status,
      content_json = excluded.content_json,
      approved_by = excluded.approved_by,
      approved_at = excluded.approved_at
  `)

  stmt.run(
    id,
    tenantId,
    shopId,
    policyType,
    version,
    effectiveDate,
    status,
    contentJson,
    approvedBy,
    approvedAt,
    now
  )

  return {
    id,
    policyType,
    version,
    status,
    effectiveDate,
    content,
  }
}

/**
 * Phê duyệt chính sách (Chuyển từ DRAFT -> APPROVED)
 */
export function approvePolicy(db, { shopId = 'quannguyens', policyType, version, approvedBy }) {
  if (!approvedBy) {
    throw new Error('approvedBy là bắt buộc khi duyệt chính sách')
  }

  const now = new Date().toISOString()
  const stmt = db.prepare(`
    UPDATE policy_versions
    SET status = 'APPROVED', approved_by = ?, approved_at = ?
    WHERE shop_id = ? AND policy_type = ? AND version = ?
  `)

  const info = stmt.run(approvedBy, now, shopId, policyType, version)
  if (info.changes === 0) {
    throw new Error(`Không tìm thấy chính sách ${policyType} phiên bản ${version} để duyệt`)
  }

  return { shopId, policyType, version, status: 'APPROVED', approvedBy, approvedAt: now }
}

/**
 * Lấy chính sách đang ĐÃ DUYỆT (APPROVED) và có hiệu lực mới nhất
 * Nếu chưa duyệt (hoặc chỉ có DRAFT), trả về null -> Agent không được hứa trước (B04, T07)
 */
export function getApprovedPolicy(db, { shopId = 'quannguyens', policyType }) {
  const now = new Date().toISOString()
  const row = db.prepare(`
    SELECT * FROM policy_versions
    WHERE shop_id = ? AND policy_type = ? AND status = 'APPROVED' AND effective_date <= ?
    ORDER BY effective_date DESC, created_at DESC
    LIMIT 1
  `).get(shopId, policyType, now)

  if (!row) return null

  return {
    id: row.id,
    tenantId: row.tenant_id,
    shopId: row.shop_id,
    policyType: row.policy_type,
    version: row.version,
    effectiveDate: row.effective_date,
    status: row.status,
    content: JSON.parse(row.content_json),
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
  }
}

/**
 * Lấy tất cả các chính sách đã duyệt hiện hành của shop
 */
export function getAllApprovedPolicies(db, shopId = 'quannguyens') {
  const types = Object.values(POLICY_TYPES)
  const policies = {}
  for (const t of types) {
    policies[t] = getApprovedPolicy(db, { shopId, policyType: t })
  }
  return policies
}

/**
 * Lấy chi tiết phiên bản chính sách cụ thể (bất kể trạng thái)
 */
export function getPolicyVersion(db, { shopId = 'quannguyens', policyType, version }) {
  const row = db.prepare(`
    SELECT * FROM policy_versions
    WHERE shop_id = ? AND policy_type = ? AND version = ?
  `).get(shopId, policyType, version)

  if (!row) return null

  return {
    id: row.id,
    tenantId: row.tenant_id,
    shopId: row.shop_id,
    policyType: row.policy_type,
    version: row.version,
    effectiveDate: row.effective_date,
    status: row.status,
    content: JSON.parse(row.content_json),
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
  }
}

/**
 * Đóng băng chính sách thành Snapshot gắn liền với Đơn hàng / Báo giá (T42)
 * Đảm bảo đơn cũ luôn lưu giữ nguyên văn điều khoản cam kết tại thời điểm mua.
 */
export function createPolicySnapshot(db, {
  tenantId = 'default',
  shopId = 'quannguyens',
  orderId = null,
  quoteId = null,
}) {
  const approvedPolicies = getAllApprovedPolicies(db, shopId)
  const snapshotId = `SNAP-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
  const now = new Date().toISOString()
  const snapshotData = {
    snapshotId,
    shopId,
    createdAt: now,
    policies: approvedPolicies,
  }

  db.prepare(`
    INSERT INTO policy_snapshots (id, tenant_id, shop_id, order_id, quote_id, snapshot_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    snapshotId,
    tenantId,
    shopId,
    orderId,
    quoteId,
    JSON.stringify(snapshotData),
    now
  )

  return snapshotData
}

/**
 * Lấy snapshot chính sách của đơn hàng hoặc mã snapshot
 */
export function getPolicySnapshot(db, { snapshotId = null, orderId = null }) {
  let row = null
  if (snapshotId) {
    row = db.prepare(`SELECT * FROM policy_snapshots WHERE id = ?`).get(snapshotId)
  } else if (orderId) {
    row = db.prepare(`SELECT * FROM policy_snapshots WHERE order_id = ? ORDER BY created_at DESC LIMIT 1`).get(orderId)
  }

  if (!row) return null

  return JSON.parse(row.snapshot_json)
}

/**
 * Đánh giá điều khoản đơn hàng dựa trên Snapshot (T42)
 * Nếu đơn hàng có snapshot, dùng snapshot; không tự ý áp dụng chính sách mới.
 */
export function getApplicableOrderPolicy(db, { orderId, policyType, shopId = 'quannguyens' }) {
  if (orderId) {
    const snapshot = getPolicySnapshot(db, { orderId })
    if (snapshot && snapshot.policies && snapshot.policies[policyType]) {
      return {
        source: 'order_snapshot',
        snapshotId: snapshot.snapshotId,
        policy: snapshot.policies[policyType],
      }
    }
  }

  // Nếu không có snapshot cũ, lấy chính sách đã duyệt hiện tại
  const currentApproved = getApprovedPolicy(db, { shopId, policyType })
  return {
    source: 'current_approved',
    snapshotId: null,
    policy: currentApproved,
  }
}

/**
 * Khởi tạo dữ liệu chính sách mặc định cho QuanNguyenS
 */
export function seedDefaultPolicies(db, shopId = 'quannguyens', approved = true) {
  const status = approved ? 'APPROVED' : 'DRAFT'
  const approvedBy = approved ? 'shop_owner_quan' : null

  // 1. Chính sách đổi/trả v1.0
  registerPolicy(db, {
    shopId,
    policyType: POLICY_TYPES.RETURNS,
    version: 'v1.0',
    status,
    approvedBy,
    content: {
      exchangeWindowDays: 7, // Hạn đổi size trong 7 ngày từ khi nhận
      returnWindowDays: 7,   // Hạn trả hàng
      conditions: [
        'Sản phẩm còn nguyên tem mác, chưa qua giặt ủi hoặc sử dụng',
        'Còn nguyên hóa đơn hoặc mã đơn hàng đối chiếu',
        'Không có mùi lạ, không dơ bẩn hoặc rách hỏng do tác động ngoài',
      ],
      shippingFeePayer: {
        defectiveOrWrongItem: 'shop_pays_100', // Lỗi do shop: shop chịu 100% phí ship 2 chiều
        sizeExchangePreference: 'customer_or_shared', // Đổi size theo ý khách: hỗ trợ theo quy định
      },
      refundProcessingDays: 3, // Hoàn tiền trong 3 ngày làm việc sau khi nhận lại hàng
    },
  })

  // 2. Chính sách vận chuyển & phí ship v1.0
  registerPolicy(db, {
    shopId,
    policyType: POLICY_TYPES.SHIPPING,
    version: 'v1.0',
    status,
    approvedBy,
    content: {
      standardShippingFee: 30000, // Phí ship chuẩn 30.000đ toàn quốc
      freeshipThreshold: 500000,  // Freeship cho đơn từ 500.000đ (tính sau khi trừ giảm giá)
      deliveryEstimateDays: {
        hanoi_hcm: '1–2 ngày làm việc',
        provinces: '2–4 ngày làm việc',
      },
      carrier: 'Viettel Post',
    },
  })

  // 3. Chính sách giá và chiết khấu thanh toán v1.0
  registerPolicy(db, {
    shopId,
    policyType: POLICY_TYPES.PRICING,
    version: 'v1.0',
    status,
    approvedBy,
    content: {
      bankTransferDiscountPct: 5, // Giảm 5% khi chuyển khoản VietQR
      quoteTtlMinutes: 30,        // Báo giá có hiệu lực 30 phút
      currency: 'VND',
    },
  })

  // 4. Chính sách đồng kiểm COD v1.0 (Ban đầu DRAFT trừ khi shop duyệt)
  registerPolicy(db, {
    shopId,
    policyType: POLICY_TYPES.COD_INSPECTION,
    version: 'v1.0',
    status: 'APPROVED',
    approvedBy: 'shop_owner_quan',
    content: {
      allowInspection: true,
      inspectionCondition: 'Đồng kiểm ngoại quan: Được mở gói kiểm tra mẫu mã, số lượng và màu sắc trước khi thanh toán. Không thử đồ.',
    },
  })

  // 5. Chính sách bảo mật & dữ liệu v1.0
  registerPolicy(db, {
    shopId,
    policyType: POLICY_TYPES.PRIVACY,
    version: 'v1.0',
    status: 'APPROVED',
    approvedBy: 'shop_owner_quan',
    content: {
      dataRetentionDays: 365,
      measurementRetentionRequiresConsent: true,
      allowDataPurgeRequest: true,
      marketingRequiresOptIn: true,
    },
  })
}
