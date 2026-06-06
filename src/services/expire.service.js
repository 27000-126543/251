const dayjs = require('dayjs');
const { prepare, withTransaction } = require('../db');
const config = require('../config');
const { createOperationLog } = require('./operation-log.service');
const { createAlert, sendWechatAlert } = require('./alert.service');
const { generateTxnNo } = require('../utils/helpers');
const logger = require('../utils/logger');

function scanExpiringPoints() {
  const warningDate = dayjs().add(config.points.expireWarningDays, 'day').format('YYYY-MM-DD HH:mm:ss');
  const now = dayjs().format('YYYY-MM-DD HH:mm:ss');

  const stmt = prepare(`
    SELECT 
      pt.emp_id,
      e.name as emp_name,
      SUM(pt.points) as expiring_points,
      MIN(pt.expire_at) as earliest_expire_at
    FROM points_transactions pt
    INNER JOIN employees e ON pt.emp_id = e.id
    WHERE pt.type = 'EARN'
      AND pt.expire_at <= ?
      AND pt.expire_at > ?
      AND pt.points > 0
    GROUP BY pt.emp_id
    HAVING expiring_points > 0
  `);

  const expiringList = stmt.all(warningDate, now);

  for (const item of expiringList) {
    const existingWarningStmt = prepare(`
      SELECT * FROM points_expire_warnings
      WHERE emp_id = ? AND expire_at = ? AND status = 'PENDING'
    `);
    const existing = existingWarningStmt.get(item.emp_id, item.earliest_expire_at);

    if (!existing) {
      const insertStmt = prepare(`
        INSERT INTO points_expire_warnings
        (emp_id, expiring_points, expire_at, warning_sent_at, warning_count, status)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP, 1, 'PENDING')
      `);
      insertStmt.run(item.emp_id, item.expiring_points, item.earliest_expire_at);

      const title = '⏰ 积分即将过期提醒';
      const content = `
员工: ${item.emp_name}
即将过期积分: ${item.expiring_points}
过期时间: ${dayjs(item.earliest_expire_at).format('YYYY-MM-DD HH:mm:ss')}
请及时使用，避免积分过期清零
      `.trim();

      createAlert({
        alert_type: 'POINTS_EXPIRE_WARNING',
        level: 'INFO',
        title,
        content
      });

      logger.info(`积分过期提醒: 员工=${item.emp_name}, 即将过期=${item.expiring_points}, 过期时间=${item.earliest_expire_at}`);
    }
  }

  return expiringList;
}

function expirePoints() {
  const now = dayjs().format('YYYY-MM-DD HH:mm:ss');

  const toExpireStmt = prepare(`
    SELECT 
      pt.emp_id,
      e.name as emp_name,
      SUM(pt.points) as expired_points
    FROM points_transactions pt
    INNER JOIN employees e ON pt.emp_id = e.id
    WHERE pt.type = 'EARN'
      AND pt.expire_at <= ?
      AND pt.points > 0
    GROUP BY pt.emp_id
    HAVING expired_points > 0
  `);

  const expiredList = toExpireStmt.all(now);

  const results = [];

  for (const item of expiredList) {
    try {
      const result = withTransaction(() => {
        const accountStmt = prepare(`
          SELECT * FROM points_accounts WHERE emp_id = ?
        `);
        const account = accountStmt.get(item.emp_id);

        if (!account) {
          return null;
        }

        const actualExpirePoints = Math.min(item.expired_points, account.available_points);
        if (actualExpirePoints <= 0) {
          return null;
        }

        const updateStmt = prepare(`
          UPDATE points_accounts
          SET available_points = available_points - ?,
              expired_points = expired_points + ?,
              version = version + 1,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND version = ?
        `);

        const updateResult = updateStmt.run(
          actualExpirePoints,
          actualExpirePoints,
          account.id,
          account.version
        );

        if (updateResult.changes === 0) {
          throw new Error('并发冲突');
        }

        const txn_no = generateTxnNo();
        const txnStmt = prepare(`
          INSERT INTO points_transactions
          (txn_no, emp_id, type, points, balance_after, source_type, remark)
          VALUES (?, ?, 'EXPIRE', ?, ?, 'SYSTEM', ?)
        `);

        txnStmt.run(
          txn_no,
          item.emp_id,
          -actualExpirePoints,
          account.available_points - actualExpirePoints,
          '积分过期自动清零'
        );

        const updateWarningStmt = prepare(`
          UPDATE points_expire_warnings
          SET status = 'EXPIRED'
          WHERE emp_id = ? AND status = 'PENDING'
        `);
        updateWarningStmt.run(item.emp_id);

        createOperationLog({
          operation_type: 'EXPIRE_POINTS',
          module: 'POINTS',
          target_id: item.emp_id.toString(),
          after_data: { expired_points: actualExpirePoints }
        });

        const title = '⚠️ 积分已过期清零';
        const content = `
员工: ${item.emp_name}
过期积分: ${actualExpirePoints}
处理时间: ${now}
        `.trim();

        createAlert({
          alert_type: 'POINTS_EXPIRED',
          level: 'WARNING',
          title,
          content
        });

        return {
          emp_id: item.emp_id,
          emp_name: item.emp_name,
          expired_points: actualExpirePoints
        };
      });

      if (result) {
        results.push(result);
        logger.info(`积分过期清零: 员工=${result.emp_name}, 积分=${result.expired_points}`);
      }
    } catch (error) {
      logger.error(`积分过期处理失败: 员工=${item.emp_id}, 错误=${error.message}`);
    }
  }

  return results;
}

function getExpireWarnings(params = {}) {
  const { emp_id, status, page = 1, page_size = 20 } = params;

  let whereConditions = [];
  let queryParams = [];

  if (emp_id) {
    whereConditions.push('ew.emp_id = ?');
    queryParams.push(emp_id);
  }
  if (status) {
    whereConditions.push('ew.status = ?');
    queryParams.push(status);
  }

  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

  const countStmt = prepare(`
    SELECT COUNT(*) as total 
    FROM points_expire_warnings ew
    ${whereClause}
  `);
  const { total } = countStmt.get(...queryParams);

  const offset = (page - 1) * page_size;
  const dataStmt = prepare(`
    SELECT ew.*, e.name as emp_name
    FROM points_expire_warnings ew
    LEFT JOIN employees e ON ew.emp_id = e.id
    ${whereClause}
    ORDER BY ew.expire_at ASC
    LIMIT ? OFFSET ?
  `);
  queryParams.push(page_size, offset);
  const list = dataStmt.all(...queryParams);

  return {
    list,
    total,
    page,
    page_size,
    total_pages: Math.ceil(total / page_size)
  };
}

module.exports = {
  scanExpiringPoints,
  expirePoints,
  getExpireWarnings
};
