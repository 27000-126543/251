const cron = require('node-cron');
const dayjs = require('dayjs');
const path = require('path');
const { generateMonthlyReport } = require('../services/report.service');
const logger = require('../utils/logger');

async function runMonthlyJobs() {
  logger.info('开始执行每月定时任务');

  const now = dayjs();
  const lastMonth = now.subtract(1, 'month');
  const year = lastMonth.year();
  const month = lastMonth.month() + 1;

  const outputDir = path.join(__dirname, '../../reports');

  try {
    const result = await generateMonthlyReport(year, month, outputDir);
    logger.info(`月度报告生成完成: ${year}年${month}月`);
    logger.info(`Excel报告: ${result.excelPath}`);
    logger.info(`PDF报告: ${result.pdfPath}`);
  } catch (error) {
    logger.error('月度报告生成失败:', error);
  }

  logger.info('每月定时任务执行完成');
}

function startMonthlyScheduler() {
  cron.schedule('0 2 1 * *', () => {
    logger.info('触发每月1日凌晨2点定时任务');
    runMonthlyJobs();
  });

  logger.info('每月定时任务调度器已启动');
}

module.exports = {
  runMonthlyJobs,
  startMonthlyScheduler
};
