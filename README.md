# 企业级员工福利积分自动化管理系统

## 项目简介

一个功能完整的企业级员工福利积分自动化管理与智能兑换系统，支持高并发处理，适用于数万员工每月百万级积分操作。

## 功能特性

### 1. 积分管理
- ✅ 积分发放（绩效、加班奖励等）
- ✅ 规则自动校验（月度上限等）
- ✅ 积分账户管理（乐观锁并发控制）
- ✅ 积分冻结/解冻
- ✅ 积分流水记录

### 2. 福利商城兑换
- ✅ 商品库存校验
- ✅ 积分自动扣减
- ✅ 订单生成与管理
- ✅ 库存不足自动告警

### 3. 智能采购
- ✅ 供应商评分机制
- ✅ 报价对比
- ✅ 订单自动拆分
- ✅ 采购申请自动生成

### 4. 多级审批流程
- ✅ 5000分以下：无需审批
- ✅ 5000-10000分：部门经理审批
- ✅ 10000分以上：总监审批
- ✅ 审批状态流转
- ✅ 审批提醒推送

### 5. 物流与签收
- ✅ 发货工单生成
- ✅ 物流信息绑定
- ✅ 订单签收确认
- ✅ 满意度问卷推送

### 6. 退货处理
- ✅ 退货申请
- ✅ 积分自动退回（扣除配送费）
- ✅ 库存自动更新
- ✅ 退货审批流程

### 7. 积分过期管理
- ✅ 每日凌晨扫描即将过期积分
- ✅ 到期前30天自动提醒
- ✅ 预警记录生成
- ✅ 过期自动清零

### 8. 统计报告
- ✅ 各部门积分发放统计
- ✅ 兑换率分析
- ✅ 热门商品排行
- ✅ 成本趋势分析
- ✅ 同比数据对比
- ✅ PDF报告生成
- ✅ Excel报告生成

### 9. 查询与导出
- ✅ 多条件组合查询（员工、部门、时间段）
- ✅ 积分流水查询
- ✅ 兑换明细查询
- ✅ 批量导出Excel

### 10. 日志与监控
- ✅ 详细操作日志
- ✅ 积分异常变动告警
- ✅ 库存不足/超储告警
- ✅ 企业微信群推送

### 11. 高并发处理
- ✅ 数据库WAL模式
- ✅ 乐观锁机制
- ✅ 事务处理
- ✅ 任务队列
- ✅ 连接池优化

## 项目结构

```
├── src/
│   ├── config/          # 配置文件
│   ├── db/              # 数据库模块
│   │   ├── init.js      # 数据库初始化
│   │   ├── index.js     # 数据库连接
│   │   └── seed.js      # 测试数据
│   ├── services/        # 业务服务层
│   │   ├── points.service.js
│   │   ├── product.service.js
│   │   ├── order.service.js
│   │   ├── logistics.service.js
│   │   ├── return.service.js
│   │   ├── expire.service.js
│   │   ├── report.service.js
│   │   ├── export.service.js
│   │   ├── operation-log.service.js
│   │   └── alert.service.js
│   ├── cron/            # 定时任务
│   │   ├── daily-jobs.js
│   │   └── monthly-jobs.js
│   ├── queue/           # 任务队列
│   │   └── index.js
│   ├── utils/           # 工具函数
│   │   ├── helpers.js
│   │   └── logger.js
│   └── index.js         # 主入口
├── data/                # 数据文件
├── logs/                # 日志文件
├── reports/             # 报告文件
├── demo.js              # 功能演示脚本
├── package.json
└── .env.example
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env` 并根据需要修改配置：

```bash
cp .env.example .env
```

### 3. 运行演示

```bash
node demo.js
```

### 4. 启动系统

```bash
npm start
```

### 5. 单独运行定时任务

```bash
# 每日任务（积分过期扫描等）
npm run cron:daily

# 每月任务（生成月度报告）
npm run cron:monthly
```

## 核心API示例

### 发放积分

```javascript
const { grantPoints } = require('./src/services/points.service');

const result = grantPoints({
  emp_id: 1,
  rule_code: 'PERF_A',
  operator_id: 3,
  operator_name: '管理员'
});
```

### 创建订单

```javascript
const { createOrder } = require('./src/services/order.service');

const order = createOrder({
  emp_id: 1,
  items: [
    { product_id: 1, quantity: 1 }
  ],
  shipping_address: '北京市...',
  contact_name: '张三',
  contact_phone: '13800138000'
});
```

### 审批订单

```javascript
const { approveOrder } = require('./src/services/order.service');

const result = approveOrder({
  order_id: 1,
  approver_id: 3,
  approver_name: '经理',
  approver_level: 1,
  is_approved: true
});
```

### 生成月度报告

```javascript
const { generateMonthlyReport } = require('./src/services/report.service');

const result = await generateMonthlyReport(2024, 6, './reports');
```

## 数据库设计

系统包含18张核心业务表：

- `departments` - 部门表
- `employees` - 员工表
- `points_accounts` - 积分账户
- `points_transactions` - 积分流水
- `points_rules` - 积分规则
- `suppliers` - 供应商
- `products` - 商品
- `product_suppliers` - 商品供应商关联
- `orders` - 订单
- `order_items` - 订单明细
- `approvals` - 审批记录
- `logistics` - 物流记录
- `return_orders` - 退货单
- `satisfaction_surveys` - 满意度问卷
- `purchase_requests` - 采购申请
- `points_expire_warnings` - 积分过期预警
- `operation_logs` - 操作日志
- `alerts` - 异常告警

## 配置说明

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| DB_PATH | 数据库文件路径 | ./data/points_system.db |
| APPROVAL_THRESHOLD_1 | 一级审批阈值(分) | 5000 |
| APPROVAL_THRESHOLD_2 | 二级审批阈值(分) | 10000 |
| POINTS_EXPIRE_DAYS | 积分有效期(天) | 365 |
| POINTS_EXPIRE_WARNING_DAYS | 过期提醒提前天数 | 30 |
| DELIVERY_FEE_POINTS | 配送费积分 | 50 |

## 技术栈

- **数据库**: SQLite (better-sqlite3)
- **定时任务**: node-cron
- **日志**: winston
- **Excel导出**: exceljs
- **PDF生成**: pdfkit
- **日期处理**: dayjs
- **队列**: 内置TaskQueue

## 高并发优化

1. **WAL模式**: 启用SQLite的WAL模式，支持高并发读写
2. **乐观锁**: 使用版本号控制并发更新
3. **事务**: 所有写操作使用事务保证原子性
4. **队列**: 异步任务队列削峰填谷
5. **索引**: 合理的数据库索引设计
6. **连接池**: 单例数据库连接复用

## License

MIT
