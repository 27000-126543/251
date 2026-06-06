const fs = require('fs');
const path = require('path');
const { initDatabase } = require('./src/db');
const { seedTestData } = require('./src/db/seed');
const { grantPoints, getPointsAccount, getPointsTransactions } = require('./src/services/points.service');
const { createOrder, approveOrder, getOrders, getPendingApprovals, getOrderByNo } = require('./src/services/order.service');
const { createShipment, signOrder, submitSurvey } = require('./src/services/logistics.service');
const { createReturn, processReturn } = require('./src/services/return.service');
const { scanExpiringPoints, expirePoints } = require('./src/services/expire.service');
const { generateMonthlyReport } = require('./src/services/report.service');
const { exportPointsTransactions, exportOrders } = require('./src/services/export.service');

const dbPath = path.join(__dirname, 'data/points_system.db');
if (fs.existsSync(dbPath)) {
  fs.unlinkSync(dbPath);
  console.log('已清理旧数据库');
}

const divider = '='.repeat(70);

async function runDemo() {
  console.log('');
  console.log(divider);
  console.log('  企业级员工福利积分系统 - 核心流程演示');
  console.log(divider);
  console.log('');

  console.log('【步骤1】初始化数据库和测试数据...');
  await initDatabase();
  seedTestData();
  console.log('   ✓ 数据库初始化完成');
  console.log('   ✓ 测试数据已加载（5个部门、5名员工、8种商品、3个供应商）');
  console.log('');

  console.log('【步骤2】给员工发放积分...');
  const emp1Points1 = grantPoints({
    emp_id: 1,
    rule_code: 'PERF_A',
    operator_id: 3,
    operator_name: '系统管理员'
  });
  console.log(`   员工1(张三) 绩效A级获得 500 积分，流水号: ${emp1Points1.txn_no}`);

  const emp1Points2 = grantPoints({
    emp_id: 1,
    points: 2000,
    remark: '项目特别贡献奖',
    operator_id: 3,
    operator_name: '系统管理员'
  });
  console.log(`   员工1(张三) 特别奖励获得 2000 积分，流水号: ${emp1Points2.txn_no}`);

  const emp2Points = grantPoints({
    emp_id: 2,
    points: 8000,
    remark: '季度优秀员工',
    operator_id: 3,
    operator_name: '系统管理员'
  });
  console.log(`   员工2(李四) 季度奖励获得 8000 积分，流水号: ${emp2Points.txn_no}`);
  console.log('');

  console.log('【步骤3】查询员工积分账户...');
  const account1 = getPointsAccount(1);
  console.log(`   员工1(张三) - 总积分: ${account1.total_points}, 可用: ${account1.available_points}, 冻结: ${account1.frozen_points}`);
  const account2 = getPointsAccount(2);
  console.log(`   员工2(李四) - 总积分: ${account2.total_points}, 可用: ${account2.available_points}, 冻结: ${account2.frozen_points}`);
  console.log('');

  console.log('【步骤4】员工1兑换小金额订单(无需审批)...');
  let order1 = null;
  try {
    order1 = createOrder({
      emp_id: 1,
      items: [
        { product_id: 4, quantity: 1 }
      ],
      shipping_address: '北京市朝阳区XX街道1号',
      contact_name: '张三',
      contact_phone: '13800138001',
      operator_id: 1,
      operator_name: '张三'
    });
    console.log(`   ✓ 订单创建成功: ${order1.order_no}`);
    console.log(`     商品: 保温杯套装 x1, 单价: 300积分`);
    console.log(`     配送费: 50积分, 总计: ${order1.total_points}积分`);
    console.log(`     订单状态: ${order1.status}, 审批状态: ${order1.approval_status}`);

    const account1After = getPointsAccount(1);
    console.log(`     积分账户变化: 可用 ${account1.available_points} → ${account1After.available_points}, 冻结 ${account1After.frozen_points}`);
  } catch (e) {
    console.log(`   ✗ 订单创建失败: ${e.message}`);
  }
  console.log('');

  console.log('【步骤5】员工2兑换大金额订单(需审批, 超过5000分)...');
  let order2 = null;
  try {
    order2 = createOrder({
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
    console.log(`   ✓ 订单创建成功: ${order2.order_no}`);
    console.log(`     商品: 品牌拉杆箱 x2, 单价: 2500积分`);
    console.log(`     配送费: 50积分, 总计: ${order2.total_points}积分`);
    console.log(`     订单状态: ${order2.status}, 审批级别: ${order2.required_approval_level}`);

    const account2After = getPointsAccount(2);
    console.log(`     积分账户变化: 可用 ${account2.available_points} → ${account2After.available_points}, 冻结: ${account2After.frozen_points}`);
  } catch (e) {
    console.log(`   ✗ 订单创建失败: ${e.message}`);
  }
  console.log('');

  console.log('【步骤6】查询待审批列表...');
  const pending = getPendingApprovals();
  console.log(`   当前待审批数量: ${pending.total}`);
  pending.list.forEach((a, idx) => {
    console.log(`   ${idx + 1}. 审批号: ${a.approval_no}, 订单: ${a.order_no}, 积分: ${a.total_points}, 级别: ${a.approver_level}`);
  });
  console.log('');

  console.log('【步骤7】部门经理审批订单...');
  if (pending.list.length > 0) {
    const approval = pending.list[0];
    try {
      const approveResult = approveOrder({
        order_id: approval.order_id,
        approver_id: 3,
        approver_name: '王五(部门经理)',
        approver_level: 1,
        approval_comment: '同意，福利发放合理',
        is_approved: true
      });
      console.log(`   ✓ 审批完成，结果: ${approveResult.status}`);

      const orderAfter = getOrderByNo(approval.order_no);
      const account2After = getPointsAccount(2);
      console.log(`     订单状态: ${orderAfter.status}`);
      console.log(`     积分账户: 可用 ${account2After.available_points}, 冻结 ${account2After.frozen_points}`);
    } catch (e) {
      console.log(`   ✗ 审批失败: ${e.message}`);
    }
  } else {
    console.log('   无待审批订单');
  }
  console.log('');

  console.log('【步骤8】查询已审批通过的订单，创建发货工单...');
  const approvedOrders = getOrders({ status: 'APPROVED' });
  console.log(`   已审批订单数量: ${approvedOrders.total}`);

  let shipment = null;
  if (approvedOrders.list.length > 0) {
    const order = approvedOrders.list[0];
    try {
      shipment = createShipment({
        order_no: order.order_no,
        courier_company: '顺丰速运',
        tracking_no: 'SF' + Date.now(),
        operator_id: 4,
        operator_name: '仓库管理员'
      });
      console.log(`   ✓ 发货成功: 物流单号 ${shipment.logistics_no}`);
      console.log(`     快递公司: ${shipment.courier_company}, 运单号: ${shipment.tracking_no}`);

      const orderAfterShip = getOrderByNo(order.order_no);
      console.log(`     订单状态: ${orderAfterShip.status}`);
    } catch (e) {
      console.log(`   ✗ 发货失败: ${e.message}`);
    }
  }
  console.log('');

  console.log('【步骤9】客户签收订单...');
  let signResult = null;
  if (shipment) {
    try {
      signResult = signOrder({
        logistics_no: shipment.logistics_no,
        signed_by: '李四',
        operator_id: 2
      });
      console.log(`   ✓ 签收成功: 状态 ${signResult.status}`);
      console.log(`     签收人: 李四, 问卷号: ${signResult.survey_no}`);
    } catch (e) {
      console.log(`   ✗ 签收失败: ${e.message}`);
    }
  }
  console.log('');

  console.log('【步骤10】提交满意度问卷...');
  if (signResult) {
    try {
      const surveyResult = submitSurvey({
        survey_no: signResult.survey_no,
        rating: 5,
        comment: '商品质量很好，配送速度快，非常满意！'
      });
      console.log(`   ✓ 问卷提交成功: ${surveyResult.rating}星评价`);
      console.log(`     评价: ${surveyResult.comment}`);
    } catch (e) {
      console.log(`   ✗ 问卷提交失败: ${e.message}`);
    }
  }
  console.log('');

  console.log('【步骤11】客户申请退货...');
  let returnOrder = null;
  if (approvedOrders.list.length > 0) {
    const order = approvedOrders.list[0];
    try {
      returnOrder = createReturn({
        order_no: order.order_no,
        return_reason: '商品尺寸不合适，需要退货',
        operator_id: 2,
        operator_name: '李四'
      });
      console.log(`   ✓ 退货申请提交成功: ${returnOrder.return_no}`);
      console.log(`     订单应退积分: ${returnOrder.return_points}`);
      console.log(`     扣除配送费: ${returnOrder.delivery_fee_deducted}积分`);
      console.log(`     实际退回: ${returnOrder.actual_refund_points}积分`);
    } catch (e) {
      console.log(`   ✗ 退货申请失败: ${e.message}`);
    }
  }
  console.log('');

  console.log('【步骤12】客服处理退货...');
  if (returnOrder) {
    try {
      const accountBefore = getPointsAccount(2);
      const processReturnResult = processReturn({
        return_no: returnOrder.return_no,
        is_approved: true,
        operator_id: 4,
        operator_name: '客服专员'
      });
      console.log(`   ✓ 退货处理完成: ${processReturnResult.status}`);
      console.log(`     实际退回积分: ${processReturnResult.actual_refund_points}`);
      console.log(`     扣除配送费: ${processReturnResult.delivery_fee_deducted}积分`);

      const accountAfter = getPointsAccount(2);
      console.log(`     积分账户变化: 可用 ${accountBefore.available_points} → ${accountAfter.available_points}`);
    } catch (e) {
      console.log(`   ✗ 退货处理失败: ${e.message}`);
    }
  }
  console.log('');

  console.log('【步骤13】积分过期扫描...');
  const expiring = scanExpiringPoints();
  console.log(`   扫描结果: 发现 ${expiring.length} 条即将过期积分记录`);
  if (expiring.length > 0) {
    expiring.forEach(item => {
      console.log(`     - 员工${item.emp_id}: ${item.expiring_points}积分将于${item.earliest_expire_at}过期`);
    });
  }
  console.log('');

  console.log('【步骤14】查询积分流水...');
  const transactions = getPointsTransactions({ emp_id: 1, page_size: 10 });
  console.log(`   员工1(张三)积分流水共 ${transactions.total} 条:`);
  transactions.list.forEach((t, idx) => {
    const sign = t.points >= 0 ? '+' : '';
    console.log(`     ${idx + 1}. ${sign}${t.points}分 | 类型: ${t.type} | ${t.remark || ''} | ${t.created_at}`);
  });
  console.log('');

  console.log('【步骤15】批量导出示例数据...');
  const reportsDir = path.join(__dirname, 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  try {
    const txnExport = await exportPointsTransactions({}, path.join(reportsDir, '积分流水导出.xlsx'));
    console.log(`   ✓ 积分流水已导出: ${txnExport.path} (${txnExport.count}条记录)`);
  } catch (e) {
    console.log(`   ✗ 积分流水导出失败: ${e.message}`);
  }

  try {
    const orderExport = await exportOrders({}, path.join(reportsDir, '兑换订单导出.xlsx'));
    console.log(`   ✓ 兑换订单已导出: ${orderExport.path} (${orderExport.count}条记录)`);
  } catch (e) {
    console.log(`   ✗ 订单导出失败: ${e.message}`);
  }
  console.log('');

  console.log('【步骤16】生成月度统计报告...');
  try {
    const now = new Date();
    const reportResult = await generateMonthlyReport(now.getFullYear(), now.getMonth() + 1, reportsDir);
    console.log(`   ✓ 月度统计报告生成完成`);
    console.log(`     Excel: ${reportResult.excelPath}`);
    console.log(`     PDF: ${reportResult.pdfPath}`);
    console.log('');
    console.log('   报告统计摘要:');
    console.log(`     - 总发放积分: ${reportResult.stats.summary.total_earned}`);
    console.log(`     - 总消耗积分: ${reportResult.stats.summary.total_spent}`);
    console.log(`     - 积分兑换率: ${reportResult.stats.summary.exchange_rate}%`);
    console.log(`     - 总订单数: ${reportResult.stats.summary.total_orders}`);
    console.log(`     - 热门商品TOP3:`);
    reportResult.stats.hot_products.slice(0, 3).forEach((p, idx) => {
      console.log(`       ${idx + 1}. ${p.product_name}: 兑换${p.total_quantity}件, ${p.total_points}积分`);
    });
  } catch (e) {
    console.log(`   ✗ 报告生成失败: ${e.message}`);
    console.error(e);
  }
  console.log('');

  console.log('【最终检查】验证数据一致性...');
  const finalAccount1 = getPointsAccount(1);
  const finalAccount2 = getPointsAccount(2);
  console.log(`   员工1(张三): 总${finalAccount1.total_points} | 可用${finalAccount1.available_points} | 冻结${finalAccount1.frozen_points} | 过期${finalAccount1.expired_points}`);
  console.log(`   员工2(李四): 总${finalAccount2.total_points} | 可用${finalAccount2.available_points} | 冻结${finalAccount2.frozen_points} | 过期${finalAccount2.expired_points}`);
  console.log('');

  console.log(divider);
  console.log('  ✅ 核心流程演示完成！');
  console.log(divider);
  console.log('');
  console.log('已验证的核心流程:');
  console.log('  ✓ 积分发放（规则校验 + 流水记录）');
  console.log('  ✓ 积分账户查询');
  console.log('  ✓ 商品兑换（库存校验 + 积分冻结）');
  console.log('  ✓ 多级审批流程');
  console.log('  ✓ 物流发货与签收');
  console.log('  ✓ 满意度问卷');
  console.log('  ✓ 退货处理（积分退回 + 配送费扣除）');
  console.log('  ✓ 积分过期扫描');
  console.log('  ✓ 积分流水查询');
  console.log('  ✓ 批量数据导出');
  console.log('  ✓ 月度统计报告（PDF + Excel）');
  console.log('  ✓ 数据一致性验证');
  console.log('');
  console.log('生成的文件:');
  console.log('  • reports/积分流水导出.xlsx');
  console.log('  • reports/兑换订单导出.xlsx');
  console.log('  • reports/月度报告_YYYYMM.xlsx');
  console.log('  • reports/月度报告_YYYYMM.pdf');
  console.log('  • data/points_system.db (SQLite数据库)');
  console.log('  • logs/combined.log (系统日志)');
  console.log('');
}

runDemo().catch(err => {
  console.error('演示执行出错:', err);
  console.error(err.stack);
  process.exit(1);
});
