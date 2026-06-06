const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const { prepare } = require('../db');
const logger = require('../utils/logger');

async function exportPointsTransactions(params, outputPath) {
  const {
    emp_id,
    dept_id,
    type,
    source_type,
    start_time,
    end_time
  } = params;

  let whereConditions = [];
  let queryParams = [];

  if (emp_id) {
    whereConditions.push('pt.emp_id = ?');
    queryParams.push(emp_id);
  }
  if (dept_id) {
    whereConditions.push('e.dept_id = ?');
    queryParams.push(dept_id);
  }
  if (type) {
    whereConditions.push('pt.type = ?');
    queryParams.push(type);
  }
  if (source_type) {
    whereConditions.push('pt.source_type = ?');
    queryParams.push(source_type);
  }
  if (start_time) {
    whereConditions.push('pt.created_at >= ?');
    queryParams.push(start_time);
  }
  if (end_time) {
    whereConditions.push('pt.created_at <= ?');
    queryParams.push(end_time);
  }

  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

  const stmt = prepare(`
    SELECT 
      pt.txn_no,
      e.emp_no,
      e.name as emp_name,
      d.dept_name,
      pt.type,
      pt.points,
      pt.balance_after,
      pt.source_type,
      pt.remark,
      pt.expire_at,
      pt.created_at
    FROM points_transactions pt
    INNER JOIN employees e ON pt.emp_id = e.id
    LEFT JOIN departments d ON e.dept_id = d.id
    ${whereClause}
    ORDER BY pt.created_at DESC
  `);

  const data = stmt.all(...queryParams);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('积分流水');

  sheet.columns = [
    { header: '流水号', key: 'txn_no', width: 30 },
    { header: '员工号', key: 'emp_no', width: 15 },
    { header: '员工姓名', key: 'emp_name', width: 15 },
    { header: '部门', key: 'dept_name', width: 20 },
    { header: '类型', key: 'type', width: 10 },
    { header: '积分变动', key: 'points', width: 12 },
    { header: '变动后余额', key: 'balance_after', width: 15 },
    { header: '来源类型', key: 'source_type', width: 15 },
    { header: '备注', key: 'remark', width: 30 },
    { header: '过期时间', key: 'expire_at', width: 20 },
    { header: '创建时间', key: 'created_at', width: 20 }
  ];

  sheet.addRows(data);

  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  await workbook.xlsx.writeFile(outputPath);
  logger.info(`积分流水导出成功: ${outputPath}, 共${data.length}条记录`);

  return { path: outputPath, count: data.length };
}

async function exportOrders(params, outputPath) {
  const {
    emp_id,
    dept_id,
    status,
    approval_status,
    start_time,
    end_time
  } = params;

  let whereConditions = [];
  let queryParams = [];

  if (emp_id) {
    whereConditions.push('o.emp_id = ?');
    queryParams.push(emp_id);
  }
  if (dept_id) {
    whereConditions.push('e.dept_id = ?');
    queryParams.push(dept_id);
  }
  if (status) {
    whereConditions.push('o.status = ?');
    queryParams.push(status);
  }
  if (approval_status) {
    whereConditions.push('o.approval_status = ?');
    queryParams.push(approval_status);
  }
  if (start_time) {
    whereConditions.push('o.created_at >= ?');
    queryParams.push(start_time);
  }
  if (end_time) {
    whereConditions.push('o.created_at <= ?');
    queryParams.push(end_time);
  }

  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

  const stmt = prepare(`
    SELECT 
      o.order_no,
      e.emp_no,
      e.name as emp_name,
      d.dept_name,
      o.total_points,
      o.status,
      o.approval_status,
      o.current_approver_level,
      o.contact_name,
      o.contact_phone,
      o.shipping_address,
      o.delivery_fee,
      o.remark,
      o.created_at
    FROM orders o
    INNER JOIN employees e ON o.emp_id = e.id
    LEFT JOIN departments d ON e.dept_id = d.id
    ${whereClause}
    ORDER BY o.created_at DESC
  `);

  const data = stmt.all(...queryParams);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('兑换订单');

  sheet.columns = [
    { header: '订单号', key: 'order_no', width: 30 },
    { header: '员工号', key: 'emp_no', width: 15 },
    { header: '员工姓名', key: 'emp_name', width: 15 },
    { header: '部门', key: 'dept_name', width: 20 },
    { header: '总积分', key: 'total_points', width: 12 },
    { header: '订单状态', key: 'status', width: 15 },
    { header: '审批状态', key: 'approval_status', width: 15 },
    { header: '审批级别', key: 'current_approver_level', width: 10 },
    { header: '联系人', key: 'contact_name', width: 15 },
    { header: '联系电话', key: 'contact_phone', width: 15 },
    { header: '收货地址', key: 'shipping_address', width: 40 },
    { header: '配送费', key: 'delivery_fee', width: 10 },
    { header: '备注', key: 'remark', width: 30 },
    { header: '创建时间', key: 'created_at', width: 20 }
  ];

  sheet.addRows(data);

  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  await workbook.xlsx.writeFile(outputPath);
  logger.info(`兑换订单导出成功: ${outputPath}, 共${data.length}条记录`);

  return { path: outputPath, count: data.length };
}

function queryPointsTransactions(params = {}) {
  const {
    emp_id,
    dept_id,
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
    whereConditions.push('pt.emp_id = ?');
    queryParams.push(emp_id);
  }
  if (dept_id) {
    whereConditions.push('e.dept_id = ?');
    queryParams.push(dept_id);
  }
  if (type) {
    whereConditions.push('pt.type = ?');
    queryParams.push(type);
  }
  if (source_type) {
    whereConditions.push('pt.source_type = ?');
    queryParams.push(source_type);
  }
  if (start_time) {
    whereConditions.push('pt.created_at >= ?');
    queryParams.push(start_time);
  }
  if (end_time) {
    whereConditions.push('pt.created_at <= ?');
    queryParams.push(end_time);
  }

  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

  const countStmt = prepare(`
    SELECT COUNT(*) as total 
    FROM points_transactions pt
    INNER JOIN employees e ON pt.emp_id = e.id
    ${whereClause}
  `);
  const { total } = countStmt.get(...queryParams);

  const offset = (page - 1) * page_size;
  const dataStmt = prepare(`
    SELECT 
      pt.*,
      e.emp_no,
      e.name as emp_name,
      d.dept_name
    FROM points_transactions pt
    INNER JOIN employees e ON pt.emp_id = e.id
    LEFT JOIN departments d ON e.dept_id = d.id
    ${whereClause}
    ORDER BY pt.created_at DESC
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

function queryOrders(params = {}) {
  const {
    emp_id,
    dept_id,
    status,
    approval_status,
    start_time,
    end_time,
    page = 1,
    page_size = 20
  } = params;

  let whereConditions = [];
  let queryParams = [];

  if (emp_id) {
    whereConditions.push('o.emp_id = ?');
    queryParams.push(emp_id);
  }
  if (dept_id) {
    whereConditions.push('e.dept_id = ?');
    queryParams.push(dept_id);
  }
  if (status) {
    whereConditions.push('o.status = ?');
    queryParams.push(status);
  }
  if (approval_status) {
    whereConditions.push('o.approval_status = ?');
    queryParams.push(approval_status);
  }
  if (start_time) {
    whereConditions.push('o.created_at >= ?');
    queryParams.push(start_time);
  }
  if (end_time) {
    whereConditions.push('o.created_at <= ?');
    queryParams.push(end_time);
  }

  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

  const countStmt = prepare(`
    SELECT COUNT(*) as total 
    FROM orders o
    INNER JOIN employees e ON o.emp_id = e.id
    ${whereClause}
  `);
  const { total } = countStmt.get(...queryParams);

  const offset = (page - 1) * page_size;
  const dataStmt = prepare(`
    SELECT 
      o.*,
      e.emp_no,
      e.name as emp_name,
      d.dept_name
    FROM orders o
    INNER JOIN employees e ON o.emp_id = e.id
    LEFT JOIN departments d ON e.dept_id = d.id
    ${whereClause}
    ORDER BY o.created_at DESC
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
  exportPointsTransactions,
  exportOrders,
  queryPointsTransactions,
  queryOrders
};
