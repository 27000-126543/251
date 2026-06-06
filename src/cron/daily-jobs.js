const cron = require('node-cron');
const { scanExpiringPoints, expirePoints } = require('../services/expire.service');
const { processPendingAlerts } = require('../services/alert.service');
const logger = require('../utils/logger');

function runDailyJobs() {
  logger.info('开始执行每日定时任务');

  try {
    const expiring = scanExpiringPoints();
    logger.info(`扫描到即将过期积分记录: ${expiring.length}条`);
  } catch (error) {
    logger.error('积分过期扫描失败:', error);
  }

  try {
    const expired = expirePoints();
    logger.info(`处理过期积分: ${expired.length}条`);
  } catch (error) {
    logger.error('积分过期处理失败:', error);
  }

  try {
    const alertCount = processPendingAlerts();
    logger.info(`处理待发送告警: ${alertCount}条`);
  } catch (error) {
    logger.error('告警处理失败:', error);
  }

  logger.info('每日定时任务执行完成');
}

function startDailyScheduler() {
  cron.schedule('0 0 * * *', () => {
    logger.info('触发每日凌晨定时任务');
    runDailyJobs();
  });

  cron.schedule('0 */6 * * *', () => {
    logger.info('触发每6小时告警发送任务');
    processPendingAlerts().then(count => {
      logger.info(`处理待发送告警: ${count}条`);
    }).catch(error => {
      logger.error('告警处理失败:', error);
    });
  });

  logger.info('每日定时任务调度器已启动');
}

module.exports = {
  runDailyJobs,
  startDailyScheduler
};
