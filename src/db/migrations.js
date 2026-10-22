/**
 * Reversible Database Migrations Manager for QuanNguyenS CSKH
 * Implements Phase 0 requirements:
 * 17 tables, unique transaction constraints, outbox, promises, cases, audit logs.
 */

export const MIGRATIONS = [
  {
    version: 1,
    name: '001_initial_cskh_core_schema',
    up(db) {
      db.exec(`
        -- 1. Bảng migration tracking
        CREATE TABLE IF NOT EXISTS _migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL
        );

        -- 2. Bảng orders (Nguồn sự thật đơn hàng phía CSKH)
        CREATE TABLE IF NOT EXISTS orders (
          order_id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          shop_id TEXT NOT NULL,
          customer_id TEXT,
          customer_name TEXT NOT NULL,
          customer_phone TEXT NOT NULL,
          customer_email TEXT,
          shipping_address TEXT NOT NULL,
          items_json TEXT NOT NULL,
          subtotal INTEGER NOT NULL,
          shipping_fee INTEGER NOT NULL DEFAULT 0,
          discount INTEGER NOT NULL DEFAULT 0,
          total INTEGER NOT NULL,
          currency TEXT NOT NULL DEFAULT 'VND',
          status TEXT NOT NULL DEFAULT 'PENDING',
          payment_status TEXT NOT NULL DEFAULT 'UNPAID',
          source TEXT NOT NULL DEFAULT 'web',
          policy_version_id TEXT,
          version INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(customer_phone);
        CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
        CREATE INDEX IF NOT EXISTS idx_orders_tenant_shop ON orders(tenant_id, shop_id);

        -- 3. Bảng payments (Ràng buộc duy nhất gateway + transaction_id chống trùng tiền)
        CREATE TABLE IF NOT EXISTS payments (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          shop_id TEXT NOT NULL,
          order_id TEXT NOT NULL,
          gateway TEXT NOT NULL,
          transaction_id TEXT NOT NULL,
          amount INTEGER NOT NULL,
          currency TEXT NOT NULL DEFAULT 'VND',
          status TEXT NOT NULL DEFAULT 'PENDING',
          paid_at TEXT,
          raw_payload TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(gateway, transaction_id),
          FOREIGN KEY (order_id) REFERENCES orders(order_id)
        );
        CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
        CREATE INDEX IF NOT EXISTS idx_payments_tx ON payments(gateway, transaction_id);

        -- 4. Bảng shipments (Kiện hàng & vận đơn đối tác)
        CREATE TABLE IF NOT EXISTS shipments (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          shop_id TEXT NOT NULL,
          order_id TEXT NOT NULL,
          carrier TEXT NOT NULL DEFAULT 'Viettel Post',
          tracking_code TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'CREATED',
          shipped_at TEXT,
          delivered_at TEXT,
          last_sync_at TEXT,
          raw_carrier_data TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (order_id) REFERENCES orders(order_id)
        );
        CREATE INDEX IF NOT EXISTS idx_shipments_tracking ON shipments(tracking_code);
        CREATE INDEX IF NOT EXISTS idx_shipments_order ON shipments(order_id);

        -- 5. Bảng cases (Hồ sơ yêu cầu hỗ trợ / khiếu nại)
        CREATE TABLE IF NOT EXISTS cases (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          shop_id TEXT NOT NULL,
          order_id TEXT,
          customer_id TEXT,
          issue_type TEXT NOT NULL,
          priority TEXT NOT NULL DEFAULT 'P2',
          status TEXT NOT NULL DEFAULT 'OPEN',
          owner_role TEXT NOT NULL DEFAULT 'cs_agent',
          owner_id TEXT,
          summary TEXT NOT NULL,
          resolution_notes TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          closed_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);
        CREATE INDEX IF NOT EXISTS idx_cases_order ON cases(order_id);

        -- 6. Bảng promises (Sổ cam kết lời hứa cập nhật theo mốc)
        CREATE TABLE IF NOT EXISTS promises (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          shop_id TEXT NOT NULL,
          case_id TEXT,
          order_id TEXT,
          customer_id TEXT,
          promise_text TEXT NOT NULL,
          due_at TEXT NOT NULL,
          owner_role TEXT NOT NULL DEFAULT 'workflow',
          owner_id TEXT,
          status TEXT NOT NULL DEFAULT 'PENDING',
          fulfilled_at TEXT,
          result_summary TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (case_id) REFERENCES cases(id)
        );
        CREATE INDEX IF NOT EXISTS idx_promises_due ON promises(due_at, status);

        -- 7. Bảng consents (Sổ đồng thuận & quyền liên hệ)
        CREATE TABLE IF NOT EXISTS consents (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          shop_id TEXT NOT NULL,
          customer_id TEXT NOT NULL,
          purpose TEXT NOT NULL,
          channel TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'GRANTED',
          evidence_type TEXT NOT NULL,
          evidence_ref TEXT,
          version TEXT NOT NULL,
          recorded_at TEXT NOT NULL,
          revoked_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_consents_lookup ON consents(customer_id, purpose, channel, status);

        -- 8. Bảng preferences (Sở thích & lựa chọn cá nhân)
        CREATE TABLE IF NOT EXISTS preferences (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          shop_id TEXT NOT NULL,
          customer_id TEXT NOT NULL,
          key TEXT NOT NULL,
          value_json TEXT NOT NULL,
          source TEXT NOT NULL,
          purpose TEXT NOT NULL,
          consent_id TEXT,
          recorded_at TEXT NOT NULL,
          expires_at TEXT,
          updated_at TEXT NOT NULL,
          UNIQUE(customer_id, key)
        );

        -- 9. Bảng memory_facts (Trí nhớ 4 lớp có nguồn, mục đích, TTL)
        CREATE TABLE IF NOT EXISTS memory_facts (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          shop_id TEXT NOT NULL,
          customer_id TEXT NOT NULL,
          attribute TEXT NOT NULL,
          value_json TEXT NOT NULL,
          source_type TEXT NOT NULL,
          source_message_id TEXT,
          purpose TEXT NOT NULL,
          assertion_status TEXT NOT NULL DEFAULT 'confirmed',
          needs_consent INTEGER NOT NULL DEFAULT 0,
          consent_record_id TEXT,
          recorded_at TEXT NOT NULL,
          review_after TEXT,
          expires_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_memory_customer ON memory_facts(customer_id, attribute);

        -- 10. Bảng events (Cổng sự kiện bền vững, chống trùng nguồn)
        CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY,
          event_id TEXT NOT NULL,
          source TEXT NOT NULL,
          tenant_id TEXT NOT NULL,
          shop_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          entity_version INTEGER DEFAULT 1,
          occurred_at TEXT NOT NULL,
          received_at TEXT NOT NULL,
          correlation_id TEXT,
          payload_json TEXT NOT NULL,
          signature_verified INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          UNIQUE(source, event_id)
        );
        CREATE INDEX IF NOT EXISTS idx_events_lookup ON events(source, event_id);
        CREATE INDEX IF NOT EXISTS idx_events_entity ON events(entity_type, entity_id);

        -- 11. Bảng outbox (Hộp thư gửi tin có trạng thái và kiểm duyệt runtime)
        CREATE TABLE IF NOT EXISTS outbox (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          shop_id TEXT NOT NULL,
          channel TEXT NOT NULL,
          recipient_id TEXT NOT NULL,
          message_type TEXT NOT NULL,
          content_json TEXT NOT NULL,
          idempotency_key TEXT UNIQUE NOT NULL,
          status TEXT NOT NULL DEFAULT 'PENDING',
          eligible_after TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          last_attempt_at TEXT,
          provider_message_id TEXT,
          error_message TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_outbox_eligible ON outbox(status, eligible_after);

        -- 12. Bảng jobs (Quản lý Job nền có lease token chống race condition)
        CREATE TABLE IF NOT EXISTS jobs (
          id TEXT PRIMARY KEY,
          business_key TEXT UNIQUE NOT NULL,
          job_type TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'READY',
          lease_token TEXT,
          lease_expires_at TEXT,
          eligible_after TEXT NOT NULL,
          expires_at TEXT,
          attempts INTEGER NOT NULL DEFAULT 0,
          max_attempts INTEGER NOT NULL DEFAULT 5,
          last_error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_jobs_ready ON jobs(status, eligible_after);

        -- 13. Bảng action_audits (Nhật ký hành động đã che dữ liệu nhạy cảm)
        CREATE TABLE IF NOT EXISTS action_audits (
          id TEXT PRIMARY KEY,
          operation_id TEXT UNIQUE NOT NULL,
          tenant_id TEXT NOT NULL,
          shop_id TEXT NOT NULL,
          actor_type TEXT NOT NULL,
          actor_id TEXT NOT NULL,
          action_name TEXT NOT NULL,
          target_entity_type TEXT NOT NULL,
          target_entity_id TEXT NOT NULL,
          input_payload_redacted TEXT,
          result_status TEXT NOT NULL,
          result_envelope TEXT,
          evidence_ref TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_audits_op ON action_audits(operation_id);
        CREATE INDEX IF NOT EXISTS idx_audits_action ON action_audits(action_name);

        -- 14. Bảng policy_versions (Quản lý phiên bản chính sách: DRAFT vs APPROVED)
        CREATE TABLE IF NOT EXISTS policy_versions (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          shop_id TEXT NOT NULL,
          policy_type TEXT NOT NULL,
          version TEXT NOT NULL,
          effective_date TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'DRAFT',
          content_json TEXT NOT NULL,
          approved_by TEXT,
          approved_at TEXT,
          created_at TEXT NOT NULL,
          UNIQUE(shop_id, policy_type, version)
        );

        -- 15. Bảng quotes (Báo giá chuẩn máy chủ tính, có TTL)
        CREATE TABLE IF NOT EXISTS quotes (
          id TEXT PRIMARY KEY,
          quote_id TEXT UNIQUE NOT NULL,
          tenant_id TEXT NOT NULL,
          shop_id TEXT NOT NULL,
          items_json TEXT NOT NULL,
          subtotal INTEGER NOT NULL,
          shipping_fee INTEGER NOT NULL DEFAULT 0,
          discount INTEGER NOT NULL DEFAULT 0,
          total INTEGER NOT NULL,
          currency TEXT NOT NULL DEFAULT 'VND',
          policy_snapshot_id TEXT,
          pricing_rules_applied_json TEXT,
          expires_at TEXT NOT NULL,
          is_consumed INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_quotes_id ON quotes(quote_id);

        -- 16. Bảng reservations (Giữ tồn kho có hạn thật)
        CREATE TABLE IF NOT EXISTS reservations (
          id TEXT PRIMARY KEY,
          reservation_id TEXT UNIQUE NOT NULL,
          tenant_id TEXT NOT NULL,
          shop_id TEXT NOT NULL,
          sku TEXT NOT NULL,
          quantity INTEGER NOT NULL,
          order_id TEXT,
          status TEXT NOT NULL DEFAULT 'ACTIVE',
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_reservations_sku ON reservations(sku, status);

        -- 17. Bảng conversations & messages (Lưu trữ phiên hội thoại & đa kênh)
        CREATE TABLE IF NOT EXISTS conversations (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          shop_id TEXT NOT NULL,
          channel TEXT NOT NULL,
          channel_conversation_id TEXT NOT NULL,
          customer_id TEXT,
          conversation_owner TEXT NOT NULL DEFAULT 'BOT',
          status TEXT NOT NULL DEFAULT 'ACTIVE',
          last_interaction_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(channel, channel_conversation_id)
        );

        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          sender_type TEXT NOT NULL,
          sender_id TEXT,
          content_text TEXT NOT NULL,
          payload_json TEXT,
          direction TEXT NOT NULL DEFAULT 'INBOUND',
          provider_message_id TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (conversation_id) REFERENCES conversations(id)
        );
        CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
      `)
    },
    down(db) {
      db.exec(`
        DROP TABLE IF EXISTS messages;
        DROP TABLE IF EXISTS conversations;
        DROP TABLE IF EXISTS reservations;
        DROP TABLE IF EXISTS quotes;
        DROP TABLE IF EXISTS policy_versions;
        DROP TABLE IF EXISTS action_audits;
        DROP TABLE IF EXISTS jobs;
        DROP TABLE IF EXISTS outbox;
        DROP TABLE IF EXISTS events;
        DROP TABLE IF EXISTS memory_facts;
        DROP TABLE IF EXISTS preferences;
        DROP TABLE IF EXISTS consents;
        DROP TABLE IF EXISTS promises;
        DROP TABLE IF EXISTS cases;
        DROP TABLE IF EXISTS shipments;
        DROP TABLE IF EXISTS payments;
        DROP TABLE IF EXISTS orders;
        DROP TABLE IF EXISTS _migrations;
      `)
    },
  },
]

export function runMigrations(db) {
  // Đảm bảo bảng _migrations tồn tại
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `)

  const appliedVersions = db.prepare('SELECT version FROM _migrations').all().map((r) => r.version)

  for (const migration of MIGRATIONS) {
    if (!appliedVersions.includes(migration.version)) {
      console.log(`[MIGRATION UP] Đang áp dụng migration v${migration.version}: ${migration.name}...`)
      migration.up(db)
      db.prepare(`
        INSERT INTO _migrations (version, name, applied_at)
        VALUES (?, ?, ?)
      `).run(migration.version, migration.name, new Date().toISOString())
      console.log(`[MIGRATION UP] Thành công: v${migration.version}`)
    }
  }
}

export function rollbackMigration(db, targetVersion = 0) {
  const appliedMigrations = db.prepare('SELECT version, name FROM _migrations ORDER BY version DESC').all()

  for (const m of appliedMigrations) {
    if (m.version > targetVersion) {
      const migrationDef = MIGRATIONS.find((def) => def.version === m.version)
      if (migrationDef && migrationDef.down) {
        console.log(`[MIGRATION DOWN] Đang rollback migration v${m.version}: ${m.name}...`)
        migrationDef.down(db)
        try {
          db.prepare('DELETE FROM _migrations WHERE version = ?').run(m.version)
        } catch {}
        console.log(`[MIGRATION DOWN] Đã hoàn tác: v${m.version}`)
      }
    }
  }
}
