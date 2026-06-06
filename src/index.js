const { getDb } = require('./db');
const { seedTestData } = require('./db/seed');
const { startDailyScheduler } = require('./cron/daily-jobs');
const { startMonthlyScheduler } = require('./cron/monthly-jobs');
const logger = require('./utils/logger');

console.log('========================================');
console.log('  企业级员工福利积分自动化管理系统');
console.log('========================================');
console.log('');

try {
  const db = getDb();
  console.log('✓ 数据库连接成功');

  seedTestData();
  console.log('✓ 测试数据初始化完成');

  startDailyScheduler();
  console.log('✓ 每日定时任务调度器已启动');

  startMonthlyScheduler();
  console.log('✓ 每月定时任务调度器已启动');

  console.log('');
  console.log('系统启动成功！');
  console.log('');
  console.log('主要功能模块:');
  console.log('  • 积分发放与规则校验');
  console.log('  • 福利商城兑换');
  console.log('  • 智能采购与供应商分配');
  console.log('  • 多级审批流程');
  console.log('  • 物流管理与签收');
  console.log('  • 退货处理');
  console.log('  • 积分过期管理');
  console.log('  • 月度统计报告');
  console.log('  • 查询与批量导出');
  console.log('  • 操作日志与异常告警');
  console.log('');

} catch (error) {
  logger.error('系统启动失败:', error);
  console.error('系统启动失败:', error.message);
  process.exit(1);
}

process.on('SIGINT', () => {
  console.log('\n正在关闭系统...');
  process.exit(0);
});
