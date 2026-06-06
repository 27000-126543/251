const axios = require('axios');
const { prepare } = require('../db');
const { generateAlertNo, safeJsonStringify } = require('../utils/helpers');
const config = require('../config');
const logger = require('../utils/logger');

function createAlert(params) {
  const {
    alert_type,
    level = 'INFO',
    title,
    content,
    target_channels = ['wechat']
  } = params;

  const alert_no = generateAlertNo();

  const stmt = prepare(`
    INSERT INTO alerts 
    (alert_no, alert_type, level, title, content, target_channels)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    alert_no,
    alert_type,
    level,
    title,
    content,
    safeJsonStringify(target_channels)
  );

  return { alert_no, ...params };
}

async function sendWechatAlert(title, content) {
  if (!config.wechat.webhookUrl) {
    logger.warn('未配置企业微信Webhook，跳过消息推送');
    return false;
  }

  try {
    const message = {
      msgtype: 'markdown',
      markdown: {
        content: `## ${title}\n\n${content}`
      }
    };

    await axios.post(config.wechat.webhookUrl, message, {
      timeout: 5000
    });

    return true;
  } catch (error) {
    logger.error('企业微信消息推送失败:', error.message);
    return false;
  }
}

async function processPendingAlerts() {
  const stmt = prepare(`
    SELECT * FROM alerts 
    WHERE is_sent = 0 
    ORDER BY created_at ASC 
    LIMIT 100
  `);

  const alerts = stmt.all();

  for (const alert of alerts) {
    const channels = JSON.parse(alert.target_channels || '[]');
    
    if (channels.includes('wechat')) {
      await sendWechatAlert(alert.title, alert.content);
    }

    const updateStmt = prepare(`
      UPDATE alerts 
      SET is_sent = 1, sent_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `);
    updateStmt.run(alert.id);
  }

  return alerts.length;
}

async function sendAbnormalPointsAlert(empId, empName, changeAmount, reason) {
  const title = '⚠️ 积分异常变动告警';
  const content = `
员工ID: ${empId}
员工姓名: ${empName}
变动积分: ${changeAmount > 0 ? '+' : ''}${changeAmount}
异常原因: ${reason}
时间: ${new Date().toLocaleString()}
  `.trim();

  createAlert({
    alert_type: 'POINTS_ABNORMAL',
    level: 'WARNING',
    title,
    content
  });

  return sendWechatAlert(title, content);
}

async function sendStockAlert(productId, productName, currentStock, safetyStock) {
  const title = '⚠️ 库存不足告警';
  const content = `
商品ID: ${productId}
商品名称: ${productName}
当前库存: ${currentStock}
安全库存: ${safetyStock}
状态: 已低于安全库存，请及时补货
时间: ${new Date().toLocaleString()}
  `.trim();

  createAlert({
    alert_type: 'STOCK_LOW',
    level: 'WARNING',
    title,
    content
  });

  return sendWechatAlert(title, content);
}

async function sendStockOverstockAlert(productId, productName, currentStock, maxStock) {
  const title = '⚠️ 库存超储告警';
  const content = `
商品ID: ${productId}
商品名称: ${productName}
当前库存: ${currentStock}
最大库存: ${maxStock}
状态: 库存超储，请控制采购
时间: ${new Date().toLocaleString()}
  `.trim();

  createAlert({
    alert_type: 'STOCK_OVER',
    level: 'INFO',
    title,
    content
  });

  return sendWechatAlert(title, content);
}

async function sendApprovalReminder(approverName, orderNo, totalPoints) {
  const title = '📋 审批待办提醒';
  const content = `
审批人: ${approverName}
订单号: ${orderNo}
订单积分: ${totalPoints}
状态: 待您审批
时间: ${new Date().toLocaleString()}
  `.trim();

  createAlert({
    alert_type: 'APPROVAL_REMINDER',
    level: 'INFO',
    title,
    content
  });

  return sendWechatAlert(title, content);
}

module.exports = {
  createAlert,
  sendWechatAlert,
  processPendingAlerts,
  sendAbnormalPointsAlert,
  sendStockAlert,
  sendStockOverstockAlert,
  sendApprovalReminder
};
