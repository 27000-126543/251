const dayjs = require('dayjs');
const { prepare, withTransaction, getDb } = require('../db');
const { generateTxnNo } = require('../utils/helpers');
const { createOperationLog } = require('./operation-log.service');
const { sendAbnormalPointsAlert } = require('./alert.service');
const config = require('../config');
const logger = require('../utils/logger');

const ABNORMAL_CHANGE_THRESHOLD = 10000;

function createPointsAccount(empId) {
  const stmt = prepare(`
    INSERT OR IGNORE INTO points_accounts (emp_id)
    VALUES (?)
  `);
  stmt.run(empId);

  const accountStmt = prepare(`
    SELECT * FROM points_accounts WHERE emp_id = ?
  `);
  return accountStmt.get(empId);
}

function getPointsAccount(empId) {
  createPointsAccount(empId);
  const stmt = prepare(`
    SELECT * FROM points_accounts WHERE emp_id = ?
  `);
  return stmt.get(empId);
}

function getPointsRule(ruleCode) {
  const stmt = prepare(`
    SELECT * FROM points_rules WHERE rule_code = ? AND status = 1
  `);
  return stmt.get(ruleCode);
}

function validatePointsRule(empId, rule) {
  if (!rule) {
    return { valid: false, reason: '积分规则不存在或已停用' };
  }

  if (rule.max_points_per_month) {
    const startTime = dayjs().startOf('month').format('YYYY-MM-DD HH:mm:ss');
    const endTime = dayjs().endOf('month').format('YYYY-MM-DD HH:mm:ss');

    const stmt = prepare(`
      SELECT COALESCE(SUM(points), 0) as total_points
      FROM points_transactions
      WHERE emp_id = ? 
        AND source_type = ?
        AND type = 'EARN'
        AND created_at >= ?
        AND created_at <= ?
    `);

    const { total_points } = stmt.get(empId, rule.rule_code, startTime, endTime);

    if (total_points + rule.points > rule.max_points_per_month) {
      return {
        valid: false,
        reason: `本月该规则已发放${total_points}积分，超过月度上限${rule.max_points_per_month}`
      };
    }
  }

  return { valid: true };
}

function grantPoints(params) {
  const {
    emp_id,
    rule_code,
    points,
    source_type = 'MANUAL',
    source_id = null,
    remark = '',
    operator_id = null,
    operator_name = null
  } = params;

  let actualPoints = points;
  let rule = null;

  if (rule_code) {
    rule = getPointsRule(rule_code);
    const validation = validatePointsRule(emp_id, rule);
    if (!validation.valid) {
      throw new Error(validation.reason);
    }
    actualPoints = rule.points;
    source_type = rule.rule_type;
  }

  if (actualPoints <= 0) {
    throw new Error('发放积分数必须大于0');
  }

  if (Math.abs(actualPoints) > ABNORMAL_CHANGE_THRESHOLD) {
    const empStmt = prepare('SELECT name FROM employees WHERE id = ?');
    const emp = empStmt.get(emp_id);
    sendAbnormalPointsAlert(emp_id, emp?.name || '未知', actualPoints, '单次积分变动超过阈值');
  }

  const result = withTransaction(() => {
    const account = getPointsAccount(emp_id);
    const txn_no = generateTxnNo();

    const expire_at = dayjs().add(config.points.expireDays, 'day').format('YYYY-MM-DD HH:mm:ss');

    const updateStmt = prepare(`
      UPDATE points_accounts
      SET total_points = total_points + ?,
          available_points = available_points + ?,
          version = version + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND version = ?
    `);

    const updateResult = updateStmt.run(
      actualPoints,
      actualPoints,
      account.id,
      account.version
    );

    if (updateResult.changes === 0) {
      throw new Error('并发冲突，请重试');
    }

    const newBalance = account.available_points + actualPoints;

    const txnStmt = prepare(`
      INSERT INTO points_transactions
      (txn_no, emp_id, type, points, balance_after, source_type, source_id, expire_at, remark, operator_id)
      VALUES (?, ?, 'EARN', ?, ?, ?, ?, ?, ?, ?)
    `);

    txnStmt.run(
      txn_no,
      emp_id,
      actualPoints,
      newBalance,
      source_type,
      source_id,
      expire_at,
      remark || (rule ? rule.rule_name : ''),
      operator_id
    );

    createOperationLog({
      operation_type: 'GRANT_POINTS',
      module: 'POINTS',
      operator_id,
      operator_name,
      target_id: txn_no,
      before_data: { available_points: account.available_points },
      after_data: { available_points: newBalance, points: actualPoints }
    });

    return {
      txn_no,
      emp_id,
      points: actualPoints,
      balance_after: newBalance,
      expire_at
    };
  });

  logger.info(`积分发放成功: 员工=${emp_id}, 积分=${actualPoints}, 流水号=${result.txn_no}`);
  return result;
}

function deductPoints(params) {
  const {
    emp_id,
    points,
    source_type = 'EXCHANGE',
    source_id = null,
    remark = '',
    operator_id = null,
    operator_name = null
  } = params;

  if (points <= 0) {
    throw new Error('扣减积分数必须大于0');
  }

  if (Math.abs(points) > ABNORMAL_CHANGE_THRESHOLD) {
    const empStmt = prepare('SELECT name FROM employees WHERE id = ?');
    const emp = empStmt.get(emp_id);
    sendAbnormalPointsAlert(emp_id, emp?.name || '未知', -points, '单次积分扣减超过阈值');
  }

  const result = withTransaction(() => {
    const account = getPointsAccount(emp_id);

    if (account.available_points < points) {
      throw new Error(`积分不足，当前可用: ${account.available_points}, 需要: ${points}`);
    }

    const txn_no = generateTxnNo();

    const updateStmt = prepare(`
      UPDATE points_accounts
      SET available_points = available_points - ?,
          version = version + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND version = ?
    `);

    const updateResult = updateStmt.run(
      points,
      account.id,
      account.version
    );

    if (updateResult.changes === 0) {
      throw new Error('并发冲突，请重试');
    }

    const newBalance = account.available_points - points;

    const txnStmt = prepare(`
      INSERT INTO points_transactions
      (txn_no, emp_id, type, points, balance_after, source_type, source_id, remark, operator_id)
      VALUES (?, ?, 'DEDUCT', ?, ?, ?, ?, ?, ?)
    `);

    txnStmt.run(
      txn_no,
      emp_id,
      -points,
      newBalance,
      source_type,
      source_id,
      remark,
      operator_id
    );

    createOperationLog({
      operation_type: 'DEDUCT_POINTS',
      module: 'POINTS',
      operator_id,
      operator_name,
      target_id: txn_no,
      before_data: { available_points: account.available_points },
      after_data: { available_points: newBalance, points: -points }
    });

    return {
      txn_no,
      emp_id,
      points: -points,
      balance_after: newBalance
    };
  });

  logger.info(`积分扣减成功: 员工=${emp_id}, 积分=-${points}, 流水号=${result.txn_no}`);
  return result;
}

function freezePoints(emp_id, points, source_id = null) {
  return withTransaction(() => {
    const account = getPointsAccount(emp_id);

    if (account.available_points < points) {
      throw new Error(`积分不足，当前可用: ${account.available_points}, 需要: ${points}`);
    }

    const updateStmt = prepare(`
      UPDATE points_accounts
      SET available_points = available_points - ?,
          frozen_points = frozen_points + ?,
          version = version + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND version = ?
    `);

    const result = updateStmt.run(points, points, account.id, account.version);

    if (result.changes === 0) {
      throw new Error('并发冲突，请重试');
    }

    return {
      emp_id,
      before_available: account.available_points,
      after_available: account.available_points - points,
      before_frozen: account.frozen_points,
      after_frozen: account.frozen_points + points
    };
  });
}

function unfreezePoints(emp_id, points, source_id = null) {
  return withTransaction(() => {
    const account = getPointsAccount(emp_id);

    if (account.frozen_points < points) {
      throw new Error(`冻结积分不足，当前冻结: ${account.frozen_points}, 需要: ${points}`);
    }

    const updateStmt = prepare(`
      UPDATE points_accounts
      SET available_points = available_points + ?,
          frozen_points = frozen_points - ?,
          version = version + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND version = ?
    `);

    const result = updateStmt.run(points, points, account.id, account.version);

    if (result.changes === 0) {
      throw new Error('并发冲突，请重试');
    }

    return {
      emp_id,
      before_available: account.available_points,
      after_available: account.available_points + points,
      before_frozen: account.frozen_points,
      after_frozen: account.frozen_points - points
    };
  });
}

function deductFrozenPoints(params) {
  const {
    emp_id,
    points,
    source_type = 'EXCHANGE',
    source_id = null,
    remark = '',
    operator_id = null,
    operator_name = null
  } = params;

  if (points <= 0) {
    throw new Error('扣减积分数必须大于0');
  }

  if (Math.abs(points) > ABNORMAL_CHANGE_THRESHOLD) {
    const empStmt = prepare('SELECT name FROM employees WHERE id = ?');
    const emp = empStmt.get(emp_id);
    sendAbnormalPointsAlert(emp_id, emp?.name || '未知', -points, '单次积分扣减超过阈值');
  }

  const result = withTransaction(() => {
    const account = getPointsAccount(emp_id);

    if (account.frozen_points < points) {
      throw new Error(`冻结积分不足，当前冻结: ${account.frozen_points}, 需要: ${points}`);
    }

    const txn_no = generateTxnNo();

    const updateStmt = prepare(`
      UPDATE points_accounts
      SET frozen_points = frozen_points - ?,
          version = version + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND version = ?
    `);

    const updateResult = updateStmt.run(
      points,
      account.id,
      account.version
    );

    if (updateResult.changes === 0) {
      throw new Error('并发冲突，请重试');
    }

    const newBalance = account.available_points;

    const txnStmt = prepare(`
      INSERT INTO points_transactions
      (txn_no, emp_id, type, points, balance_after, source_type, source_id, remark, operator_id)
      VALUES (?, ?, 'DEDUCT', ?, ?, ?, ?, ?, ?)
    `);

    txnStmt.run(
      txn_no,
      emp_id,
      -points,
      newBalance,
      source_type,
      source_id,
      remark,
      operator_id
    );

    createOperationLog({
      operation_type: 'DEDUCT_FROZEN_POINTS',
      module: 'POINTS',
      operator_id,
      operator_name,
      target_id: txn_no,
      before_data: { frozen_points: account.frozen_points, available_points: account.available_points },
      after_data: { frozen_points: account.frozen_points - points, available_points: newBalance, points: -points }
    });

    return {
      txn_no,
      emp_id,
      points: -points,
      balance_after: newBalance,
      before_frozen: account.frozen_points,
      after_frozen: account.frozen_points - points
    };
  });

  logger.info(`冻结积分扣减成功: 员工=${emp_id}, 积分=-${points}, 流水号=${result.txn_no}`);
  return result;
}

function getPointsTransactions(params = {}) {
  const {
    emp_id,
    type,
    source_type,
    start_time,
    end_time,
    page = 1,
    page_size = 20
  } = params;

  let whereConditions = [];
  let queryParams = [];

  if (emp_id) {
    whereConditions.push('emp_id = ?');
    queryParams.push(emp_id);
  }
  if (type) {
    whereConditions.push('type = ?');
    queryParams.push(type);
  }
  if (source_type) {
    whereConditions.push('source_type = ?');
    queryParams.push(source_type);
  }
  if (start_time) {
    whereConditions.push('created_at >= ?');
    queryParams.push(start_time);
  }
  if (end_time) {
    whereConditions.push('created_at <= ?');
    queryParams.push(end_time);
  }

  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

  const countStmt = prepare(`SELECT COUNT(*) as total FROM points_transactions ${whereClause}`);
  const { total } = countStmt.get(...queryParams);

  const offset = (page - 1) * page_size;
  const dataStmt = prepare(`
    SELECT * FROM points_transactions ${whereClause}
    ORDER BY created_at DESC
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

function getPointsStatistics(params = {}) {
  const { start_time, end_time, dept_id } = params;

  let whereConditions = ['pt.type = ?'];
  let queryParams = ['EARN'];

  if (start_time) {
    whereConditions.push('pt.created_at >= ?');
    queryParams.push(start_time);
  }
  if (end_time) {
    whereConditions.push('pt.created_at <= ?');
    queryParams.push(end_time);
  }
  if (dept_id) {
    whereConditions.push('e.dept_id = ?');
    queryParams.push(dept_id);
  }

  const whereClause = whereConditions.join(' AND ');

  const stmt = prepare(`
    SELECT 
      e.dept_id,
      d.dept_name,
      COUNT(DISTINCT pt.emp_id) as emp_count,
      COUNT(pt.id) as txn_count,
      SUM(pt.points) as total_points
    FROM points_transactions pt
    INNER JOIN employees e ON pt.emp_id = e.id
    LEFT JOIN departments d ON e.dept_id = d.id
    WHERE ${whereClause}
    GROUP BY e.dept_id
    ORDER BY total_points DESC
  `);

  return stmt.all(...queryParams);
}

module.exports = {
  createPointsAccount,
  getPointsAccount,
  getPointsRule,
  validatePointsRule,
  grantPoints,
  deductPoints,
  freezePoints,
  unfreezePoints,
  deductFrozenPoints,
  getPointsTransactions,
  getPointsStatistics
};
