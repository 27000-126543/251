const { prepare, withTransaction } = require('../db');
const { generateLogisticsNo, generateSurveyNo } = require('../utils/helpers');
const { createOperationLog } = require('./operation-log.service');
const { getOrderByNo } = require('./order.service');
const logger = require('../utils/logger');

function createShipment(params) {
  const {
    order_id,
    order_no,
    courier_company,
    tracking_no,
    remark = '',
    operator_id = null,
    operator_name = null
  } = params;

  return withTransaction(() => {
    const order = getOrderByNo(order_no);
    if (!order) {
      throw new Error('订单不存在');
    }

    if (order.status !== 'APPROVED') {
      throw new Error(`订单状态不允许发货，当前状态: ${order.status}`);
    }

    const logistics_no = generateLogisticsNo();

    const stmt = prepare(`
      INSERT INTO logistics
      (logistics_no, order_id, order_no, courier_company, tracking_no, status, remark)
      VALUES (?, ?, ?, ?, ?, 'SHIPPED', ?)
    `);

    stmt.run(
      logistics_no,
      order_id || order.id,
      order_no,
      courier_company,
      tracking_no,
      remark
    );

    const updateOrderStmt = prepare(`
      UPDATE orders
      SET status = 'SHIPPED', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    updateOrderStmt.run(order.id);

    createOperationLog({
      operation_type: 'CREATE_SHIPMENT',
      module: 'LOGISTICS',
      operator_id,
      operator_name,
      target_id: logistics_no,
      after_data: {
        order_no,
        courier_company,
        tracking_no
      }
    });

    logger.info(`发货工单创建成功: ${logistics_no}, 订单: ${order_no}`);

    return {
      logistics_no,
      order_no,
      courier_company,
      tracking_no,
      status: 'SHIPPED'
    };
  });
}

function signOrder(params) {
  const {
    logistics_no,
    signed_by,
    remark = '',
    operator_id = null
  } = params;

  return withTransaction(() => {
    const stmt = prepare('SELECT * FROM logistics WHERE logistics_no = ?');
    const logistics = stmt.get(logistics_no);

    if (!logistics) {
      throw new Error('物流记录不存在');
    }

    if (logistics.status === 'SIGNED') {
      throw new Error('订单已签收，无法重复签收');
    }

    const updateStmt = prepare(`
      UPDATE logistics
      SET status = 'SIGNED', signed_at = CURRENT_TIMESTAMP, signed_by = ?, remark = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    updateStmt.run(signed_by, remark, logistics.id);

    const updateOrderStmt = prepare(`
      UPDATE orders
      SET status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    updateOrderStmt.run(logistics.order_id);

    const survey_no = generateSurveyNo();
    const surveyStmt = prepare(`
      INSERT INTO satisfaction_surveys
      (survey_no, order_id, emp_id)
      VALUES (?, ?, ?)
    `);

    const order = getOrderByNo(logistics.order_no);
    surveyStmt.run(survey_no, logistics.order_id, order.emp_id);

    createOperationLog({
      operation_type: 'SIGN_ORDER',
      module: 'LOGISTICS',
      operator_id,
      target_id: logistics_no,
      after_data: { signed_by, survey_no }
    });

    logger.info(`订单签收成功: ${logistics_no}, 签收人: ${signed_by}`);

    return {
      logistics_no,
      status: 'SIGNED',
      signed_by,
      signed_at: new Date().toISOString(),
      survey_no
    };
  });
}

function submitSurvey(params) {
  const { survey_no, rating, comment = '' } = params;

  if (rating < 1 || rating > 5) {
    throw new Error('评分必须在1-5之间');
  }

  const stmt = prepare(`
    UPDATE satisfaction_surveys
    SET rating = ?, comment = ?, submitted_at = CURRENT_TIMESTAMP
    WHERE survey_no = ?
  `);

  const result = stmt.run(rating, comment, survey_no);

  if (result.changes === 0) {
    throw new Error('问卷不存在');
  }

  logger.info(`满意度问卷提交: ${survey_no}, 评分: ${rating}`);

  return { survey_no, rating, comment, submitted: true };
}

function getLogistics(orderNo) {
  const stmt = prepare('SELECT * FROM logistics WHERE order_no = ? ORDER BY created_at DESC');
  return stmt.all(orderNo);
}

function getSurvey(surveyNo) {
  const stmt = prepare('SELECT * FROM satisfaction_surveys WHERE survey_no = ?');
  return stmt.get(surveyNo);
}

function getSurveysByOrder(orderId) {
  const stmt = prepare('SELECT * FROM satisfaction_surveys WHERE order_id = ?');
  return stmt.all(orderId);
}

module.exports = {
  createShipment,
  signOrder,
  submitSurvey,
  getLogistics,
  getSurvey,
  getSurveysByOrder
};
