const { getDb } = require('./src/db');
const { seedTestData } = require('./src/db/seed');
const { grantPoints, getPointsAccount, getPointsTransactions } = require('./src/services/points.service');
const { createOrder, approveOrder, getOrders, getPendingApprovals } = require('./src/services/order.service');
const { createShipment, signOrder, submitSurvey } = require('./src/services/logistics.service');
const { createReturn, processReturn } = require('./src/services/return.service');
const { scanExpiringPoints, expirePoints } = require('./src/services/expire.service');
const { generateMonthlyReport } = require('./src/services/report.service');
const { exportPointsTransactions, exportOrders } = require('./src/services/export.service');
const path = require('path');

const divider = '='.repeat(60);

async function runDemo() {
  console.log(divider);
  console.log('  员工福利积分系统 - 功能演示');
  console.log(divider);
  console.log('');

  console.log('1. 初始化数据库和测试数据...');
  getDb();
  seedTestData();
  console.log('   ✓ 完成');
  console.log('');

  console.log('2. 给员工发放积分...');
  const emp1Points = grantPoints({
    emp_id: 1,
    rule_code: 'PERF_A',
    operator_id: 3,
    operator_name: '系统管理员'
  });
  console.log(`   员工1(张三) 绩效A级获得500积分，流水号: ${emp1Points.txn_no}`);

  const emp2Points = grantPoints({
    emp_id: 2,
    points: 3000,
    remark: '月度优秀员工奖励',
    operator_id: 3,
    operator_name: '系统管理员'
  });
  console.log(`   员工2(李四) 手动发放3000积分，流水号: ${emp2Points.txn_no}`);

  const emp3Points = grantPoints({
    emp_id: 1,
    rule_code: 'OVERTIME',
    operator_id: 3,
    operator_name: '系统管理员'
  });
  console.log(`   员工1(张三) 加班奖励50积分，流水号: ${emp3Points.txn_no}`);

  console.log('');
  console.log('3. 查询员工积分账户...');
  const account1 = getPointsAccount(1);
  console.log(`   员工1(张三) - 总积分: ${account1.total_points}, 可用: ${account1.available_points}`);
  const account2 = getPointsAccount(2);
  console.log(`   员工2(李四) - 总积分: ${account2.total_points}, 可用: ${account2.available_points}`);
  console.log('');

  console.log('4. 创建兑换订单 - 小金额(无需审批)...');
  try {
    const order1 = createOrder({
      emp_id: 1,
      items: [
        { product_id: 4, quantity: 2 }
      ],
      shipping_address: '北京市朝阳区XX街道1号',
      contact_name: '张三',
      contact_phone: '13800138001',
      operator_id: 1,
      operator_name: '张三'
    });
    console.log(`   订单创建成功: ${order1.order_no}, 总积分: ${order1.total_points}`);
    console.log(`   订单状态: ${order1.status}, 审批状态: ${order1.approval_status}`);
  } catch (e) {
    console.log(`   订单创建失败: ${e.message}`);
  }
  console.log('');

  console.log('5. 创建兑换订单 - 超过5000分(需部门经理审批)...');
  try {
    const order2 = createOrder({
      emp_id: 2,
      items: [
        { product_id: 3, quantity: 2 }
      ],
      shipping_address: '上海市浦东新区XX路2号',
      contact_name: '李四',
      contact_phone: '13800138002',
      operator_id: 2,
      operator_name: '李四'
    });
    console.log(`   订单创建成功: ${order2.order_no}, 总积分: ${order2.total_points}`);
    console.log(`   订单状态: ${order2.status}, 审批级别: ${order2.required_approval_level}`);
  } catch (e) {
    console.log(`   订单创建失败: ${e.message}`);
  }
  console.log('');

  console.log('6. 查询待审批列表...');
  const pending = getPendingApprovals();
  console.log(`   待审批数量: ${pending.total}`);
  pending.list.forEach(a => {
    console.log(`   - 审批号: ${a.approval_no}, 订单: ${a.order_no}, 积分: ${a.total_points}, 级别: ${a.approver_level}`);
  });
  console.log('');

  console.log('7. 部门经理审批订单...');
  if (pending.list.length > 0) {
    const approval = pending.list[0];
    const approveResult = approveOrder({
      order_id: approval.order_id,
      approver_id: 3,
      approver_name: '王五(部门经理',
      approver_level: 1,
      approval_comment: '同意',
      is_approved: true
    });
    console.log(`   审批结果: ${approveResult.status}`);
  }
  console.log('');

  console.log('8. 创建发货工单...');
  const orders = getOrders({ status: 'APPROVED' });
  if (orders.list.length > 0) {
    const order = orders.list[0];
    const shipment = createShipment({
      order_no: order.order_no,
      courier_company: '顺丰速运',
      tracking_no: 'SF' + Date.now(),
      operator_id: 4,
      operator_name: '仓库管理员'
    });
    console.log(`   发货成功: 物流单号 ${shipment.logistics_no}, 快递: ${shipment.courier_company}`);
    console.log('');

    console.log('9. 订单签收...');
    const signResult = signOrder({
      logistics_no: shipment.logistics_no,
      signed_by: order.contact_name,
      operator_id: order.emp_id
    });
    console.log(`   签收成功: 状态 ${signResult.status}, 问卷号: ${signResult.survey_no}`);
    console.log('');

    console.log('10. 提交满意度问卷...');
    const surveyResult = submitSurvey({
      survey_no: signResult.survey_no,
      rating: 5,
      comment: '商品质量很好，配送很快！'
    });
    console.log(`   问卷提交成功: 评分 ${surveyResult.rating}星`);
    console.log('');

    console.log('11. 申请退货...');
    const returnOrder = createReturn({
      order_no: order.order_no,
      return_reason: '商品不适合',
      operator_id: order.emp_id,
      operator_name: order.contact_name
    });
    console.log(`   退货申请: ${returnOrder.return_no}, 应退积分: ${returnOrder.return_points}`);
    console.log(`   扣除配送费: ${returnOrder.delivery_fee_deducted}, 实退积分: ${returnOrder.actual_refund_points}`);
    console.log('');

    console.log('12. 处理退货...');
    const processReturnResult = processReturn({
      return_no: returnOrder.return_no,
      is_approved: true,
      operator_id: 4,
      operator_name: '客服专员'
    });
    console.log(`   退货处理完成: 状态 ${processReturnResult.status}, 实退积分: ${processReturnResult.actual_refund_points}`);
  }
  console.log('');

  console.log('13. 积分过期扫描...');
  const expiring = scanExpiringPoints();
  console.log(`   即将过期积分记录: ${expiring.length}条`);
  console.log('');

  console.log('14. 积分流水查询...');
  const transactions = getPointsTransactions({ emp_id: 1, page_size: 5 });
  console.log(`   员工1积分流水共 ${transactions.total} 条:`);
  transactions.list.forEach(t => {
    console.log(`   - ${t.type === 'EARN' ? '+' : ''}${t.points}分 (${t.type}) - ${t.remark || ''}`);
  });
  console.log('');

  console.log('15. 导出示例数据...');
  const reportsDir = path.join(__dirname, 'reports');
  const txnExport = await exportPointsTransactions({}, path.join(reportsDir, '积分流水导出.xlsx'));
  console.log(`   积分流水已导出: ${txnExport.path} (${txnExport.count}条)`);
  console.log('');

  console.log('16. 生成月度统计报告...');
  const now = new Date();
  const reportResult = await generateMonthlyReport(now.getFullYear(), now.getMonth() + 1, reportsDir);
  console.log(`   Excel报告: ${reportResult.excelPath}`);
  console.log(`   PDF报告: ${reportResult.pdfPath}`);
  console.log('');

  console.log(divider);
  console.log('  演示完成！');
  console.log(divider);
  console.log('');
  console.log('核心功能总结:');
  console.log('  ✓ 积分发放与规则校验');
  console.log('  ✓ 积分账户管理(乐观锁并发控制');
  console.log('  ✓ 商品兑换与库存管理');
  console.log('  ✓ 智能采购与供应商分配');
  console.log('  ✓ 多级审批流程(5000分部门经理, 10000分总监');
  console.log('  ✓ 物流发货与签收');
  console.log('  ✓ 满意度问卷');
  console.log('  ✓ 退货处理(扣除配送费)');
  console.log('  ✓ 积分过期扫描与清零');
  console.log('  ✓ 月度统计报告(PDF/Excel)');
  console.log('  ✓ 批量数据导出');
  console.log('  ✓ 操作日志与异常告警');
  console.log('  ✓ 高并发队列处理');
  console.log('');
}

runDemo().catch(console.error);
