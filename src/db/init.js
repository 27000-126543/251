const Database = require('better-sqlite3');
const config = require('../config');
const path = require('path');
const fs = require('fs');

function initDatabase() {
  const dbDir = path.dirname(config.db.path);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const db = new Database(config.db.path);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -10000');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS departments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dept_code VARCHAR(50) UNIQUE NOT NULL,
      dept_name VARCHAR(100) NOT NULL,
      parent_id INTEGER,
      manager_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      emp_no VARCHAR(50) UNIQUE NOT NULL,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(100),
      phone VARCHAR(20),
      dept_id INTEGER,
      position VARCHAR(100),
      level VARCHAR(50),
      status INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (dept_id) REFERENCES departments(id)
    );

    CREATE TABLE IF NOT EXISTS points_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      emp_id INTEGER UNIQUE NOT NULL,
      total_points INTEGER DEFAULT 0,
      available_points INTEGER DEFAULT 0,
      frozen_points INTEGER DEFAULT 0,
      expired_points INTEGER DEFAULT 0,
      version INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (emp_id) REFERENCES employees(id)
    );

    CREATE TABLE IF NOT EXISTS points_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      txn_no VARCHAR(64) UNIQUE NOT NULL,
      emp_id INTEGER NOT NULL,
      type VARCHAR(20) NOT NULL,
      points INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      source_type VARCHAR(50),
      source_id VARCHAR(64),
      expire_at DATETIME,
      remark VARCHAR(500),
      operator_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (emp_id) REFERENCES employees(id)
    );

    CREATE INDEX IF NOT EXISTS idx_txn_emp ON points_transactions(emp_id);
    CREATE INDEX IF NOT EXISTS idx_txn_created ON points_transactions(created_at);
    CREATE INDEX IF NOT EXISTS idx_txn_expire ON points_transactions(expire_at);

    CREATE TABLE IF NOT EXISTS points_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_code VARCHAR(50) UNIQUE NOT NULL,
      rule_name VARCHAR(100) NOT NULL,
      rule_type VARCHAR(20) NOT NULL,
      points INTEGER NOT NULL,
      conditions TEXT,
      max_points_per_month INTEGER,
      status INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_code VARCHAR(50) UNIQUE NOT NULL,
      supplier_name VARCHAR(200) NOT NULL,
      contact_name VARCHAR(100),
      contact_phone VARCHAR(20),
      rating DECIMAL(3,2) DEFAULT 0,
      total_orders INTEGER DEFAULT 0,
      status INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_code VARCHAR(50) UNIQUE NOT NULL,
      product_name VARCHAR(200) NOT NULL,
      category VARCHAR(100),
      points_price INTEGER NOT NULL,
      market_price DECIMAL(10,2),
      stock INTEGER DEFAULT 0,
      safety_stock INTEGER DEFAULT 10,
      description TEXT,
      image_url VARCHAR(500),
      status INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_product_category ON products(category);
    CREATE INDEX IF NOT EXISTS idx_product_status ON products(status);

    CREATE TABLE IF NOT EXISTS product_suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      supplier_id INTEGER NOT NULL,
      supplier_price DECIMAL(10,2) NOT NULL,
      supply_days INTEGER,
      priority INTEGER DEFAULT 1,
      status INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
      UNIQUE(product_id, supplier_id)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_no VARCHAR(64) UNIQUE NOT NULL,
      emp_id INTEGER NOT NULL,
      total_points INTEGER NOT NULL,
      status VARCHAR(20) NOT NULL,
      shipping_address TEXT,
      contact_name VARCHAR(100),
      contact_phone VARCHAR(20),
      approval_status VARCHAR(20) DEFAULT 'PENDING',
      current_approver_level INTEGER DEFAULT 0,
      delivery_fee INTEGER DEFAULT 0,
      remark VARCHAR(500),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (emp_id) REFERENCES employees(id)
    );

    CREATE INDEX IF NOT EXISTS idx_order_emp ON orders(emp_id);
    CREATE INDEX IF NOT EXISTS idx_order_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_order_created ON orders(created_at);

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      product_name VARCHAR(200) NOT NULL,
      points_price INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      subtotal_points INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      approval_no VARCHAR(64) UNIQUE NOT NULL,
      order_id INTEGER NOT NULL,
      order_no VARCHAR(64) NOT NULL,
      emp_id INTEGER NOT NULL,
      total_points INTEGER NOT NULL,
      approver_level INTEGER NOT NULL,
      approver_id INTEGER,
      approver_name VARCHAR(100),
      status VARCHAR(20) DEFAULT 'PENDING',
      approval_comment VARCHAR(500),
      approved_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );

    CREATE INDEX IF NOT EXISTS idx_approval_order ON approvals(order_id);
    CREATE INDEX IF NOT EXISTS idx_approval_status ON approvals(status);

    CREATE TABLE IF NOT EXISTS logistics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      logistics_no VARCHAR(64) UNIQUE NOT NULL,
      order_id INTEGER NOT NULL,
      order_no VARCHAR(64) NOT NULL,
      courier_company VARCHAR(100),
      tracking_no VARCHAR(100),
      status VARCHAR(20) DEFAULT 'PENDING',
      shipped_at DATETIME,
      signed_at DATETIME,
      signed_by VARCHAR(100),
      remark VARCHAR(500),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );

    CREATE TABLE IF NOT EXISTS return_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      return_no VARCHAR(64) UNIQUE NOT NULL,
      order_id INTEGER NOT NULL,
      order_no VARCHAR(64) NOT NULL,
      emp_id INTEGER NOT NULL,
      return_reason TEXT,
      return_points INTEGER NOT NULL,
      delivery_fee_deducted INTEGER DEFAULT 0,
      actual_refund_points INTEGER NOT NULL,
      status VARCHAR(20) DEFAULT 'PENDING',
      processed_at DATETIME,
      operator_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );

    CREATE TABLE IF NOT EXISTS satisfaction_surveys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      survey_no VARCHAR(64) UNIQUE NOT NULL,
      order_id INTEGER NOT NULL,
      emp_id INTEGER NOT NULL,
      rating INTEGER,
      comment TEXT,
      submitted_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );

    CREATE TABLE IF NOT EXISTS purchase_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pr_no VARCHAR(64) UNIQUE NOT NULL,
      product_id INTEGER NOT NULL,
      product_name VARCHAR(200) NOT NULL,
      quantity INTEGER NOT NULL,
      estimated_points INTEGER,
      status VARCHAR(20) DEFAULT 'PENDING',
      supplier_allocations TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS points_expire_warnings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      emp_id INTEGER NOT NULL,
      expiring_points INTEGER NOT NULL,
      expire_at DATETIME NOT NULL,
      warning_sent_at DATETIME,
      warning_count INTEGER DEFAULT 0,
      status VARCHAR(20) DEFAULT 'PENDING',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (emp_id) REFERENCES employees(id)
    );

    CREATE INDEX IF NOT EXISTS idx_warning_expire ON points_expire_warnings(expire_at);

    CREATE TABLE IF NOT EXISTS operation_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      log_no VARCHAR(64) UNIQUE NOT NULL,
      operation_type VARCHAR(50) NOT NULL,
      module VARCHAR(50) NOT NULL,
      operator_id INTEGER,
      operator_name VARCHAR(100),
      target_id VARCHAR(64),
      before_data TEXT,
      after_data TEXT,
      ip VARCHAR(50),
      user_agent VARCHAR(500),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_log_module ON operation_logs(module);
    CREATE INDEX IF NOT EXISTS idx_log_created ON operation_logs(created_at);

    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alert_no VARCHAR(64) UNIQUE NOT NULL,
      alert_type VARCHAR(50) NOT NULL,
      level VARCHAR(20) DEFAULT 'INFO',
      title VARCHAR(200) NOT NULL,
      content TEXT,
      target_channels VARCHAR(500),
      is_sent INTEGER DEFAULT 0,
      sent_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  console.log('数据库初始化完成');
  return db;
}

module.exports = initDatabase;
