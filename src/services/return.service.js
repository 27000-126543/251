const { prepare, withTransaction } = require('../db');
const { generateReturnNo } = require('../utils/helpers');
const { createOperationLog } = require('./operation-log.service');
const { getOrderByNo } = require('./order.service');
const { updateStock } = require('./product.service');
const { grantPoints } = require('./points.service');
const config = require('../config');
const logger = require('../utils/logger');

function createReturn(params) {
  const {
    order_no,
    return_reason,
    operator_id = null,
    operator_name = null
  } = params;

  return withTransaction(() => {
    const order = getOrderByNo(order_no);
    if (!order) {
      throw new Error('订单不存在');
    }

    if (order.status !== 'COMPLETED' && order.status !== 'SHIPPED') {
      throw new Error(`当前订单状态不允许退货，当前状态: ${order.status}`);
    }

    const return_no = generateReturnNo();
    const delivery_fee_deducted = order.delivery_fee || config.delivery.feePoints;
    const return_points = order.total_points;
    const actual_refund_points = return_points - delivery_fee_deducted;

    if (actual_refund_points < 0) {
      throw new Error('退货积分不足以抵扣配送费');
    }

    const stmt = prepare(`
      INSERT INTO return_orders
      (return_no, order_id, order_no, emp_id, return_reason, return_points, 
       delivery_fee_deducted, actual_refund_points, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')
    `);

    stmt.run(
      return_no,
      order.id,
      order_no,
      order.emp_id,
      return_reason,
      return_points,
      delivery_fee_deducted,
      actual_refund_points
    );

    createOperationLog({
      operation_type: 'CREATE_RETURN',
      module: 'RETURN',
      operator_id,
      operator_name,
      target_id: return_no,
      after_data: {
        order_no,
        return_points,
        delivery_fee_deducted,
        actual_refund_points
      }
    });

    logger.info(`退货申请创建成功: ${return_no}, 订单: ${order_no}`);

    return {
      return_no,
      order_no,
      return_points,
      delivery_fee_deducted,
      actual_refund_points,
      status: 'PENDING'
    };
  });
}

function processReturn(params) {
  const {
    return_no,
    is_approved = true,
    process_comment = '',
    operator_id = null,
    operator_name = null
  } = params;

  return withTransaction(() => {
    const stmt = prepare('SELECT * FROM return_orders WHERE return_no = ?');
    const returnOrder = stmt.get(return_no);

    if (!returnOrder) {
      throw new Error('退货单不存在');
    }

    if (returnOrder.status !== 'PENDING') {
      throw new Error(`退货单已处理，当前状态: ${returnOrder.status}`);
    }

    if (!is_approved) {
      const updateStmt = prepare(`
        UPDATE return_orders
        SET status = 'REJECTED', processed_at = CURRENT_TIMESTAMP, operator_id = ?
        WHERE id = ?
      `);
      updateStmt.run(operator_id, returnOrder.id);

      createOperationLog({
        operation_type: 'REJECT_RETURN',
        module: 'RETURN',
        operator_id,
        operator_name,
        target_id: return_no,
        after_data: { reason: process_comment }
      });

      logger.info(`退货被拒绝: ${return_no}`);

      return { return_no, status: 'REJECTED' };
    }

    grantPoints({
      emp_id: returnOrder.emp_id,
      points: returnOrder.actual_refund_points,
      source_type: 'RETURN',
      source_id: return_no,
      remark: `退货退款: ${returnOrder.order_no}，扣除配送费${returnOrder.delivery_fee_deducted}积分`,
      operator_id,
      operator_name
    });

    const order = getOrderByNo(returnOrder.order_no);
    const orderItemsStmt = prepare('SELECT * FROM order_items WHERE order_id = ?');
    const orderItems = orderItemsStmt.all(order.id);

    for (const item of orderItems) {
      updateStock(item.product_id, item.quantity, operator_id, operator_name);
    }

    const updateReturnStmt = prepare(`
      UPDATE return_orders
      SET status = 'COMPLETED', processed_at = CURRENT_TIMESTAMP, operator_id = ?
      WHERE id = ?
    `);
    updateReturnStmt.run(operator_id, returnOrder.id);

    const updateOrderStmt = prepare(`
      UPDATE orders
      SET status = 'RETURNED', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    updateOrderStmt.run(order.id);

    createOperationLog({
      operation_type: 'APPROVE_RETURN',
      module: 'RETURN',
      operator_id,
      operator_name,
      target_id: return_no,
      after_data: {
        actual_refund_points: returnOrder.actual_refund_points,
        delivery_fee_deducted: returnOrder.delivery_fee_deducted
      }
    });

    logger.info(`退货处理完成: ${return_no}, 退回积分: ${returnOrder.actual_refund_points}`);

    return {
      return_no,
      status: 'COMPLETED',
      actual_refund_points: returnOrder.actual_refund_points,
      delivery_fee_deducted: returnOrder.delivery_fee_deducted
    };
  });
}

function getReturn(returnNo) {
  const stmt = prepare('SELECT * FROM return_orders WHERE return_no = ?');
  return stmt.get(returnNo);
}

function getReturns(params = {}) {
  const { emp_id, status, page = 1, page_size = 20 } = params;

  let whereConditions = [];
  let queryParams = [];

  if (emp_id) {
    whereConditions.push('emp_id = ?');
    queryParams.push(emp_id);
  }
  if (status) {
    whereConditions.push('status = ?');
    queryParams.push(status);
  }

  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

  const countStmt = prepare(`SELECT COUNT(*) as total FROM return_orders ${whereClause}`);
  const { total } = countStmt.get(...queryParams);

  const offset = (page - 1) * page_size;
  const dataStmt = prepare(`
    SELECT * FROM return_orders ${whereClause}
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
  createReturn,
  processReturn,
  getReturn,
  getReturns
};
