const { prepare, getDb } = require('../db');
const { generateLogNo, safeJsonStringify } = require('../utils/helpers');

function createOperationLog(params) {
  const {
    operation_type,
    module,
    operator_id = null,
    operator_name = null,
    target_id = null,
    before_data = null,
    after_data = null,
    ip = null,
    user_agent = null
  } = params;

  const log_no = generateLogNo();

  const stmt = prepare(`
    INSERT INTO operation_logs 
    (log_no, operation_type, module, operator_id, operator_name, target_id, before_data, after_data, ip, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    log_no,
    operation_type,
    module,
    operator_id,
    operator_name,
    target_id,
    before_data ? safeJsonStringify(before_data) : null,
    after_data ? safeJsonStringify(after_data) : null,
    ip,
    user_agent
  );

  return { log_no, ...params };
}

function getOperationLogs(params = {}) {
  const {
    module,
    operation_type,
    operator_id,
    target_id,
    start_time,
    end_time,
    page = 1,
    page_size = 20
  } = params;

  let whereConditions = [];
  let queryParams = [];

  if (module) {
    whereConditions.push('module = ?');
    queryParams.push(module);
  }
  if (operation_type) {
    whereConditions.push('operation_type = ?');
    queryParams.push(operation_type);
  }
  if (operator_id) {
    whereConditions.push('operator_id = ?');
    queryParams.push(operator_id);
  }
  if (target_id) {
    whereConditions.push('target_id = ?');
    queryParams.push(target_id);
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

  const countStmt = prepare(`SELECT COUNT(*) as total FROM operation_logs ${whereClause}`);
  const { total } = countStmt.get(...queryParams);

  const offset = (page - 1) * page_size;
  const dataStmt = prepare(`
    SELECT * FROM operation_logs ${whereClause}
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

module.exports = {
  createOperationLog,
  getOperationLogs
};
