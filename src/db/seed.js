const { prepare, getDb, saveDatabase } = require('./index');

function seedTestData() {
  const deptStmt = prepare(`
    INSERT OR IGNORE INTO departments (dept_code, dept_name)
    VALUES (?, ?)
  `);
  deptStmt.run('TECH', '技术部');
  deptStmt.run('HR', '人力资源部');
  deptStmt.run('FIN', '财务部');
  deptStmt.run('MKT', '市场部');
  deptStmt.run('OPS', '运营部');

  const empStmt = prepare(`
    INSERT OR IGNORE INTO employees (emp_no, name, email, phone, dept_id, position, level)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  empStmt.run('E001', '张三', 'zhangsan@company.com', '13800138001', 1, '高级工程师', 'P6');
  empStmt.run('E002', '李四', 'lisi@company.com', '13800138002', 1, '工程师', 'P5');
  empStmt.run('E003', '王五', 'wangwu@company.com', '13800138003', 2, 'HR经理', 'M2');
  empStmt.run('E004', '赵六', 'zhaoliu@company.com', '13800138004', 3, '财务主管', 'M1');
  empStmt.run('E005', '钱七', 'qianqi@company.com', '13800138005', 4, '市场专员', 'P4');

  const ruleStmt = prepare(`
    INSERT OR IGNORE INTO points_rules (rule_code, rule_name, rule_type, points, max_points_per_month)
    VALUES (?, ?, ?, ?, ?)
  `);
  ruleStmt.run('PERF_A', '绩效A级', 'PERFORMANCE', 500, 2000);
  ruleStmt.run('PERF_B', '绩效B级', 'PERFORMANCE', 300, 2000);
  ruleStmt.run('OVERTIME', '加班奖励', 'OVERTIME', 50, 500);
  ruleStmt.run('ATTENDANCE', '全勤奖', 'ATTENDANCE', 200, 200);
  ruleStmt.run('SUGGESTION', '合理化建议', 'SUGGESTION', 100, 500);

  const supplierStmt = prepare(`
    INSERT OR IGNORE INTO suppliers (supplier_code, supplier_name, contact_name, contact_phone, rating)
    VALUES (?, ?, ?, ?, ?)
  `);
  supplierStmt.run('SUP001', '优选供应商A', '张经理', '13900139001', 4.8);
  supplierStmt.run('SUP002', '品质供应商B', '李经理', '13900139002', 4.5);
  supplierStmt.run('SUP003', '优质供应商C', '王经理', '13900139003', 4.2);

  const productStmt = prepare(`
    INSERT OR IGNORE INTO products (product_code, product_name, category, points_price, market_price, stock, safety_stock, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  productStmt.run('PROD001', '高端蓝牙耳机', '数码电子', 800, 199.00, 50, 10, '高品质无线蓝牙耳机');
  productStmt.run('PROD002', '智能手环', '数码电子', 1200, 299.00, 30, 10, '多功能智能运动手环');
  productStmt.run('PROD003', '品牌拉杆箱', '旅行用品', 2500, 599.00, 20, 5, '20寸商务拉杆箱');
  productStmt.run('PROD004', '保温杯套装', '家居用品', 300, 89.00, 100, 20, '304不锈钢保温杯');
  productStmt.run('PROD005', '品牌双肩包', '箱包配饰', 1500, 399.00, 25, 10, '商务休闲双肩包');
  productStmt.run('PROD006', '护眼台灯', '家居用品', 600, 159.00, 40, 10, 'LED护眼学习台灯');
  productStmt.run('PROD007', '机械键盘', '数码电子', 2000, 499.00, 15, 5, '机械游戏键盘');
  productStmt.run('PROD008', '品牌电动牙刷', '个护健康', 900, 229.00, 35, 10, '声波电动牙刷');

  const psStmt = prepare(`
    INSERT OR IGNORE INTO product_suppliers (product_id, supplier_id, supplier_price, supply_days, priority)
    VALUES (?, ?, ?, ?, ?)
  `);
  psStmt.run(1, 1, 150.00, 3, 1);
  psStmt.run(1, 2, 160.00, 5, 2);
  psStmt.run(2, 1, 200.00, 3, 1);
  psStmt.run(2, 3, 210.00, 4, 2);
  psStmt.run(3, 2, 400.00, 7, 1);
  psStmt.run(4, 3, 60.00, 2, 1);
  psStmt.run(5, 1, 250.00, 3, 1);
  psStmt.run(6, 2, 100.00, 3, 1);
  psStmt.run(7, 1, 350.00, 5, 1);
  psStmt.run(8, 3, 150.00, 3, 1);

  console.log('测试数据初始化完成');
}

module.exports = { seedTestData };
