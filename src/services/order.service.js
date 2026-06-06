const { prepare, withTransaction } = require('../db');
const { generateOrderNo, generateApprovalNo, generateTxnNo } = require('../utils/helpers');
const { getPointsAccount, deductFrozenPoints } = require('./points.service');
const { getProduct, createPurchaseRequest } = require('./product.service');
const { createOperationLog } = require('./operation-log.service');
const { sendApprovalReminder, sendStockAlert } = require('./alert.service');
const config = require('../config');
const logger = require('../utils/logger');

function getApprovalLevel(totalPoints) {
  if (totalPoints >= config.approval.threshold2) {
    return 2;
  }
  if (totalPoints >= config.approval.threshold1) {
    return 1;
  }
  return 0;
}

function createOrder(params) {
  const {
    emp_id,
    items,
    shipping_address,
    contact_name,
    contact_phone,
    remark = '',
    operator_id = null,
    operator_name = null
  } = params;

  if (!items || items.length === 0) {
    throw new Error('订单商品不能为空');
  }

  const validatedItems = [];
  let total_points = 0;

  for (const item of items) {
    const product = getProduct(item.product_id);
    if (!product) {
      throw new Error(`商品不存在: ${item.product_id}`);
    }
    if (product.stock < item.quantity) {
      const qtyToPurchase = Math.max(item.quantity, product.safety_stock * 2);
      createPurchaseRequest(product.id, qtyToPurchase, operator_id);
      throw new Error(`商品库存不足: ${product.product_name}, 当前库存: ${product.stock}, 已自动发起补货申请`);
    }

    const subtotal = product.points_price * item.quantity;
    total_points += subtotal;

    validatedItems.push({
      product_id: product.id,
      product_name: product.product_name,
      points_price: product.points_price,
      quantity: item.quantity,
      subtotal_points: subtotal,
      current_stock: product.stock
    });
  }

  return withTransaction(() => {
    const orderItems = [];
    const stockUpdates = [];

    for (const item of validatedItems) {
      const product = getProduct(item.product_id);
      if (!product || product.stock < item.quantity) {
        throw new Error(`商品 ${item.product_name} 库存已变化，请重新下单`);
      }

      orderItems.push({
        product_id: item.product_id,
        product_name: item.product_name,
        points_price: item.points_price,
        quantity: item.quantity,
        subtotal_points: item.subtotal_points
      });

      stockUpdates.push({
        product_id: item.product_id,
        quantity: -item.quantity
      });
    }

    const delivery_fee = config.delivery.feePoints;
    total_points += delivery_fee;

    const account = getPointsAccount(emp_id);
    if (account.available_points < total_points) {
      throw new Error(`积分不足，当前可用: ${account.available_points}, 需要: ${total_points}`);
    }

    const requiredApprovalLevel = getApprovalLevel(total_points);

    const order_no = generateOrderNo();
    const order_status = requiredApprovalLevel > 0 ? 'PENDING_APPROVAL' : 'APPROVED';
    const approval_status = requiredApprovalLevel > 0 ? 'PENDING' : 'NOT_REQUIRED';

    const orderStmt = prepare(`
      INSERT INTO orders
      (order_no, emp_id, total_points, status, shipping_address, contact_name, contact_phone, 
       approval_status, current_approver_level, delivery_fee, remark)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const orderResult = orderStmt.run(
      order_no,
      emp_id,
      total_points,
      order_status,
      shipping_address,
      contact_name,
      contact_phone,
      approval_status,
      requiredApprovalLevel,
      delivery_fee,
      remark
    );

    const order_id = orderResult.lastInsertRowid;

    const orderItemStmt = prepare(`
      INSERT INTO order_items
      (order_id, product_id, product_name, points_price, quantity, subtotal_points)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const item of orderItems) {
      orderItemStmt.run(
        order_id,
        item.product_id,
        item.product_name,
        item.points_price,
        item.quantity,
        item.subtotal_points
      );
    }

    for (const update of stockUpdates) {
      const productStmt = prepare('SELECT * FROM products WHERE id = ?');
      const product = productStmt.get(update.product_id);
      if (product) {
        const updateStockStmt = prepare(`
          UPDATE products
          SET stock = stock + ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `);
        updateStockStmt.run(update.quantity, update.product_id);

        const newStock = product.stock + update.quantity;
        if (newStock <= product.safety_stock && update.quantity < 0) {
          sendStockAlert(update.product_id, product.product_name, newStock, product.safety_stock);
        }
      }
    }

    const freezeStmt = prepare(`
      UPDATE points_accounts
      SET available_points = available_points - ?,
          frozen_points = frozen_points + ?,
          version = version + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND version = ?
    `);
    const freezeResult = freezeStmt.run(total_points, total_points, account.id, account.version);
    if (freezeResult.changes === 0) {
      throw new Error('积分冻结失败，并发冲突，请重试');
    }

    if (requiredApprovalLevel === 0) {
      const deductFrozenStmt = prepare(`
        UPDATE points_accounts
        SET frozen_points = frozen_points - ?,
            version = version + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);
      deductFrozenStmt.run(total_points, account.id);

      const txn_no = generateTxnNo();
      const txnStmt = prepare(`
        INSERT INTO points_transactions
        (txn_no, emp_id, points, balance_after, type, source_type, source_id, expire_at, remark, created_at)
        VALUES (?, ?, ?, ?, 'DEDUCT', 'EXCHANGE', ?, ?, ?, CURRENT_TIMESTAMP)
      `);
      txnStmt.run(txn_no, emp_id, -total_points,
        account.total_points - total_points,
        order_no, null, '订单兑换：' + order_no);
    }

    if (requiredApprovalLevel > 0) {
      const approval_no = generateApprovalNo();
      const approvalStmt = prepare(`
        INSERT INTO approvals
        (approval_no, order_id, order_no, emp_id, total_points, approver_level, status)
        VALUES (?, ?, ?, ?, ?, ?, 'PENDING')
      `);
      approvalStmt.run(approval_no, order_id, order_no, emp_id, total_points, 1);

      if (requiredApprovalLevel > 1) {
        const approval_no2 = generateApprovalNo();
        approvalStmt.run(approval_no2, order_id, order_no, emp_id, total_points, 2);
      }

      sendApprovalReminder('部门经理', order_no, total_points);
    }

    createOperationLog({
      operation_type: 'CREATE_ORDER',
      module: 'ORDER',
      operator_id,
      operator_name,
      target_id: order_no,
      after_data: {
        order_no,
        emp_id,
        total_points,
        items: orderItems,
        approval_level: requiredApprovalLevel
      }
    });

    logger.info(`订单创建成功: ${order_no}, 员工: ${emp_id}, 总积分: ${total_points}, 审批级别: ${requiredApprovalLevel}`);

    return {
      order_id,
      order_no,
      total_points,
      status: order_status,
      approval_status,
      required_approval_level: requiredApprovalLevel,
      items: orderItems
    };
  });
}

function approveOrder(params) {
  const {
    order_id,
    approver_id,
    approver_name,
    approver_level,
    approval_comment = '',
    is_approved = true,
    operator_id = null
  } = params;

  return withTransaction(() => {
    const orderStmt = prepare('SELECT * FROM orders WHERE id = ?');
    const order = orderStmt.get(order_id);

    if (!order) {
      throw new Error('订单不存在');
    }

    if (order.approval_status === 'APPROVED' || order.approval_status === 'REJECTED') {
      throw new Error('订单已完成审批，无法重复审批');
    }

    if (approver_level > order.current_approver_level) {
      throw new Error(`需要先通过级别 ${order.current_approver_level} 的审批`);
    }

    const approvalStmt = prepare(`
      SELECT * FROM approvals 
      WHERE order_id = ? AND approver_level = ? AND status = 'PENDING'
      ORDER BY id ASC
      LIMIT 1
    `);
    const approval = approvalStmt.get(order_id, approver_level);

    if (!approval) {
      throw new Error('当前级别无待审批记录');
    }

    const updateApprovalStmt = prepare(`
      UPDATE approvals
      SET status = ?, approver_id = ?, approver_name = ?, approval_comment = ?, approved_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    if (!is_approved) {
      updateApprovalStmt.run('REJECTED', approver_id, approver_name, approval_comment, approval.id);

      const updateOrderStmt = prepare(`
        UPDATE orders
        SET status = 'REJECTED', approval_status = 'REJECTED', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);
      updateOrderStmt.run(order_id);

      const accountStmt = prepare('SELECT * FROM points_accounts WHERE emp_id = ?');
      const account = accountStmt.get(order.emp_id);
      if (account) {
        const unfreezeStmt = prepare(`
          UPDATE points_accounts
          SET available_points = available_points + ?,
              frozen_points = frozen_points - ?,
              version = version + 1,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND version = ?
        `);
        unfreezeStmt.run(order.total_points, order.total_points, account.id, account.version);
      }

      const orderItemsStmt = prepare('SELECT * FROM order_items WHERE order_id = ?');
      const orderItems = orderItemsStmt.all(order_id);
      for (const item of orderItems) {
        const productStmt = prepare('SELECT * FROM products WHERE id = ?');
        const product = productStmt.get(item.product_id);
        if (product) {
          const restoreStockStmt = prepare(`
            UPDATE products
            SET stock = stock + ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `);
          restoreStockStmt.run(item.quantity, item.product_id);
        }
      }

      createOperationLog({
        operation_type: 'REJECT_ORDER',
        module: 'ORDER',
        operator_id: approver_id,
        operator_name: approver_name,
        target_id: order.order_no,
        after_data: { reason: approval_comment }
      });

      logger.info(`订单被拒绝: ${order.order_no}, 审批人: ${approver_name}, 级别: ${approver_level}`);

      return { order_no: order.order_no, status: 'REJECTED' };
    }

    updateApprovalStmt.run('APPROVED', approver_id, approver_name, approval_comment, approval.id);

    const nextLevel = approver_level + 1;
    if (nextLevel <= order.current_approver_level) {
      sendApprovalReminder('总监', order.order_no, order.total_points);

      createOperationLog({
        operation_type: 'APPROVE_ORDER_LEVEL',
        module: 'ORDER',
        operator_id: approver_id,
        operator_name: approver_name,
        target_id: order.order_no,
        after_data: { level: approver_level, next_level: nextLevel }
      });

      return {
        order_no: order.order_no,
        status: 'PENDING_APPROVAL',
        next_approval_level: nextLevel
      };
    }

    deductFrozenPoints({
      emp_id: order.emp_id,
      points: order.total_points,
      source_type: 'EXCHANGE',
      source_id: order.order_no,
      remark: `订单兑换: ${order.order_no}`,
      operator_id: approver_id,
      operator_name: approver_name
    });

    const updateOrderStmt = prepare(`
      UPDATE orders
      SET status = 'APPROVED', approval_status = 'APPROVED', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    updateOrderStmt.run(order_id);

    createOperationLog({
      operation_type: 'APPROVE_ORDER',
      module: 'ORDER',
      operator_id: approver_id,
      operator_name: approver_name,
      target_id: order.order_no,
      after_data: { total_points: order.total_points }
    });

    logger.info(`订单审批通过: ${order.order_no}, 审批人: ${approver_name}`);

    return {
      order_no: order.order_no,
      status: 'APPROVED',
      total_points: order.total_points
    };
  });
}

function getOrder(orderId) {
  const orderStmt = prepare('SELECT * FROM orders WHERE id = ?');
  const order = orderStmt.get(orderId);

  if (order) {
    const itemsStmt = prepare('SELECT * FROM order_items WHERE order_id = ?');
    order.items = itemsStmt.get(orderId);
  }

  return order;
}

function getOrderByNo(orderNo) {
  const orderStmt = prepare('SELECT * FROM orders WHERE order_no = ?');
  const order = orderStmt.get(orderNo);

  if (order) {
    const itemsStmt = prepare('SELECT * FROM order_items WHERE order_id = ?');
    order.items = itemsStmt.all(order.id);
  }

  return order;
}

function getOrders(params = {}) {
  const {
    emp_id,
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
    whereConditions.push('emp_id = ?');
    queryParams.push(emp_id);
  }
  if (status) {
    whereConditions.push('status = ?');
    queryParams.push(status);
  }
  if (approval_status) {
    whereConditions.push('approval_status = ?');
    queryParams.push(approval_status);
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

  const countStmt = prepare(`SELECT COUNT(*) as total FROM orders ${whereClause}`);
  const { total } = countStmt.get(...queryParams);

  const offset = (page - 1) * page_size;
  const dataStmt = prepare(`
    SELECT * FROM orders ${whereClause}
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

function getPendingApprovals(params = {}) {
  const { approver_level, page = 1, page_size = 20 } = params;

  let whereConditions = ['a.status = ?'];
  let queryParams = ['PENDING'];

  if (approver_level !== undefined && approver_level !== null) {
    whereConditions.push('a.approver_level = ?');
    queryParams.push(approver_level);
  }

  const whereClause = whereConditions.join(' AND ');

  const countStmt = prepare(`
    SELECT COUNT(*) as total 
    FROM approvals a
    WHERE ${whereClause}
  `);
  const { total } = countStmt.get(...queryParams);

  const offset = (page - 1) * page_size;
  const dataStmt = prepare(`
    SELECT a.*, o.contact_name, o.shipping_address
    FROM approvals a
    LEFT JOIN orders o ON a.order_id = o.id
    WHERE ${whereClause}
    ORDER BY a.created_at ASC
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
  getApprovalLevel,
  createOrder,
  approveOrder,
  getOrder,
  getOrderByNo,
  getOrders,
  getPendingApprovals
};
