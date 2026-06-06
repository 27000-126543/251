const dayjs = require('dayjs');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { prepare } = require('../db');
const logger = require('../utils/logger');

function generateMonthlyStatistics(year, month) {
  const startDate = dayjs(`${year}-${month}-01`).startOf('month').format('YYYY-MM-DD HH:mm:ss');
  const endDate = dayjs(`${year}-${month}-01`).endOf('month').format('YYYY-MM-DD HH:mm:ss');

  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevStartDate = dayjs(`${prevYear}-${prevMonth}-01`).startOf('month').format('YYYY-MM-DD HH:mm:ss');
  const prevEndDate = dayjs(`${prevYear}-${prevMonth}-01`).endOf('month').format('YYYY-MM-DD HH:mm:ss');

  const lastYearStart = dayjs(`${year - 1}-${month}-01`).startOf('month').format('YYYY-MM-DD HH:mm:ss');
  const lastYearEnd = dayjs(`${year - 1}-${month}-01`).endOf('month').format('YYYY-MM-DD HH:mm:ss');

  const deptPointsStmt = prepare(`
    SELECT 
      d.id as dept_id,
      d.dept_code,
      d.dept_name,
      COUNT(DISTINCT pt.emp_id) as emp_count,
      COUNT(pt.id) as txn_count,
      COALESCE(SUM(CASE WHEN pt.type = 'EARN' THEN pt.points ELSE 0 END), 0) as total_earned,
      COALESCE(SUM(CASE WHEN pt.type = 'DEDUCT' THEN ABS(pt.points) ELSE 0 END), 0) as total_spent
    FROM departments d
    LEFT JOIN employees e ON d.id = e.dept_id
    LEFT JOIN points_transactions pt ON e.id = pt.emp_id 
      AND pt.created_at >= ? AND pt.created_at <= ?
    GROUP BY d.id
    ORDER BY total_earned DESC
  `);

  const deptStats = deptPointsStmt.all(startDate, endDate);

  const deptStatsPrev = deptPointsStmt.all(lastYearStart, lastYearEnd);

  const hotProductsStmt = prepare(`
    SELECT 
      p.id as product_id,
      p.product_code,
      p.product_name,
      p.category,
      p.points_price,
      COALESCE(SUM(oi.quantity), 0) as total_quantity,
      COALESCE(SUM(oi.subtotal_points), 0) as total_points
    FROM products p
    LEFT JOIN order_items oi ON p.id = oi.product_id
    LEFT JOIN orders o ON oi.order_id = o.id 
      AND o.created_at >= ? AND o.created_at <= ?
      AND o.status NOT IN ('REJECTED', 'RETURNED')
    GROUP BY p.id
    ORDER BY total_quantity DESC
    LIMIT 20
  `);

  const hotProducts = hotProductsStmt.all(startDate, endDate);

  const orderStatsStmt = prepare(`
    SELECT 
      COUNT(*) as total_orders,
      COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END), 0) as completed_orders,
      COALESCE(SUM(CASE WHEN status = 'RETURNED' THEN 1 ELSE 0 END), 0) as returned_orders,
      COALESCE(SUM(total_points), 0) as total_points
    FROM orders
    WHERE created_at >= ? AND created_at <= ?
  `);

  const orderStats = orderStatsStmt.get(startDate, endDate);

  const dailyTrendStmt = prepare(`
    SELECT 
      DATE(created_at) as date,
      COALESCE(SUM(CASE WHEN type = 'EARN' THEN points ELSE 0 END), 0) as earned,
      COALESCE(SUM(CASE WHEN type = 'DEDUCT' THEN ABS(points) ELSE 0 END), 0) as spent
    FROM points_transactions
    WHERE created_at >= ? AND created_at <= ?
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `);

  const dailyTrend = dailyTrendStmt.all(startDate, endDate);

  const monthlyTrendStmt = prepare(`
    SELECT 
      STRFTIME('%Y-%m', created_at) as month,
      COALESCE(SUM(CASE WHEN type = 'EARN' THEN points ELSE 0 END), 0) as earned,
      COALESCE(SUM(CASE WHEN type = 'DEDUCT' THEN ABS(points) ELSE 0 END), 0) as spent
    FROM points_transactions
    WHERE created_at >= ? AND created_at <= ?
    GROUP BY STRFTIME('%Y-%m', created_at)
    ORDER BY month ASC
  `);

  const sixMonthsAgo = dayjs(`${year}-${month}-01`).subtract(6, 'month').startOf('month').format('YYYY-MM-DD HH:mm:ss');
  const monthlyTrend = monthlyTrendStmt.all(sixMonthsAgo, endDate);

  const totalEarned = deptStats.reduce((sum, d) => sum + d.total_earned, 0);
  const totalSpent = deptStats.reduce((sum, d) => sum + d.total_spent, 0);
  const exchangeRate = totalEarned > 0 ? ((totalSpent / totalEarned) * 100).toFixed(2) : 0;

  return {
    period: { year, month, startDate, endDate },
    summary: {
      total_earned: totalEarned,
      total_spent: totalSpent,
      exchange_rate: exchangeRate,
      total_orders: orderStats.total_orders,
      completed_orders: orderStats.completed_orders,
      returned_orders: orderStats.returned_orders
    },
    department_stats: deptStats.map(d => ({
      ...d,
      exchange_rate: d.total_earned > 0 ? ((d.total_spent / d.total_earned) * 100).toFixed(2) : 0
    })),
    department_stats_yoy: deptStatsPrev,
    hot_products: hotProducts,
    daily_trend: dailyTrend,
    monthly_trend: monthlyTrend
  };
}

async function generateExcelReport(stats, outputPath) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '员工福利积分系统';
  workbook.created = new Date();

  const summarySheet = workbook.addWorksheet('概览');
  summarySheet.columns = [
    { header: '指标', key: 'metric', width: 30 },
    { header: '数值', key: 'value', width: 20 }
  ];

  summarySheet.addRows([
    { metric: '统计月份', value: `${stats.period.year}年${stats.period.month}月` },
    { metric: '总发放积分', value: stats.summary.total_earned },
    { metric: '总消耗积分', value: stats.summary.total_spent },
    { metric: '积分兑换率(%)', value: stats.summary.exchange_rate },
    { metric: '总订单数', value: stats.summary.total_orders },
    { metric: '已完成订单', value: stats.summary.completed_orders },
    { metric: '退货订单', value: stats.summary.returned_orders }
  ]);

  const deptSheet = workbook.addWorksheet('部门统计');
  deptSheet.columns = [
    { header: '部门名称', key: 'dept_name', width: 20 },
    { header: '员工数', key: 'emp_count', width: 10 },
    { header: '发放积分', key: 'total_earned', width: 15 },
    { header: '消耗积分', key: 'total_spent', width: 15 },
    { header: '兑换率(%)', key: 'exchange_rate', width: 15 }
  ];
  deptSheet.addRows(stats.department_stats);

  const productSheet = workbook.addWorksheet('热门商品');
  productSheet.columns = [
    { header: '商品名称', key: 'product_name', width: 30 },
    { header: '分类', key: 'category', width: 15 },
    { header: '单价(积分)', key: 'points_price', width: 15 },
    { header: '兑换数量', key: 'total_quantity', width: 15 },
    { header: '总积分', key: 'total_points', width: 15 }
  ];
  productSheet.addRows(stats.hot_products);

  const trendSheet = workbook.addWorksheet('每日趋势');
  trendSheet.columns = [
    { header: '日期', key: 'date', width: 15 },
    { header: '发放积分', key: 'earned', width: 15 },
    { header: '消耗积分', key: 'spent', width: 15 }
  ];
  trendSheet.addRows(stats.daily_trend);

  const monthlyTrendSheet = workbook.addWorksheet('月度趋势');
  monthlyTrendSheet.columns = [
    { header: '月份', key: 'month', width: 15 },
    { header: '发放积分', key: 'earned', width: 15 },
    { header: '消耗积分', key: 'spent', width: 15 }
  ];
  monthlyTrendSheet.addRows(stats.monthly_trend);

  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  await workbook.xlsx.writeFile(outputPath);
  logger.info(`Excel报告已生成: ${outputPath}`);

  return outputPath;
}

function generatePDFReport(stats, outputPath) {
  return new Promise((resolve, reject) => {
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    doc.fontSize(20).text('员工福利积分月度统计报告', { align: 'center' });
    doc.moveDown();
    doc.fontSize(14).text(`统计周期: ${stats.period.year}年${stats.period.month}月`, { align: 'center' });
    doc.moveDown(2);

    doc.fontSize(16).text('一、总体概览', { underline: true });
    doc.moveDown();
    doc.fontSize(12);
    doc.text(`• 总发放积分: ${stats.summary.total_earned}`);
    doc.text(`• 总消耗积分: ${stats.summary.total_spent}`);
    doc.text(`• 积分兑换率: ${stats.summary.exchange_rate}%`);
    doc.text(`• 总订单数: ${stats.summary.total_orders}`);
    doc.text(`• 已完成订单: ${stats.summary.completed_orders}`);
    doc.text(`• 退货订单: ${stats.summary.returned_orders}`);
    doc.moveDown(2);

    doc.fontSize(16).text('二、部门统计', { underline: true });
    doc.moveDown();
    doc.fontSize(10);
    
    const tableTop = doc.y;
    const col1X = 50;
    const col2X = 180;
    const col3X = 280;
    const col4X = 380;
    const col5X = 480;

    doc.font('Helvetica-Bold');
    doc.text('部门名称', col1X, tableTop);
    doc.text('员工数', col2X, tableTop);
    doc.text('发放积分', col3X, tableTop);
    doc.text('消耗积分', col4X, tableTop);
    doc.text('兑换率', col5X, tableTop);
    doc.font('Helvetica');

    let y = tableTop + 20;
    stats.department_stats.slice(0, 10).forEach(dept => {
      doc.text(dept.dept_name || '-', col1X, y);
      doc.text(dept.emp_count.toString(), col2X, y);
      doc.text(dept.total_earned.toString(), col3X, y);
      doc.text(dept.total_spent.toString(), col4X, y);
      doc.text(dept.exchange_rate + '%', col5X, y);
      y += 18;
    });

    doc.moveDown(2);
    y = doc.y;

    doc.fontSize(16).text('三、热门商品TOP10', { underline: true });
    doc.moveDown();
    doc.fontSize(10);

    const pCol1X = 50;
    const pCol2X = 250;
    const pCol3X = 350;
    const pCol4X = 450;

    doc.font('Helvetica-Bold');
    doc.text('商品名称', pCol1X, doc.y);
    doc.text('单价', pCol2X, doc.y);
    doc.text('数量', pCol3X, doc.y);
    doc.text('总积分', pCol4X, doc.y);
    doc.font('Helvetica');

    y = doc.y + 20;
    stats.hot_products.slice(0, 10).forEach(product => {
      doc.text(product.product_name.substring(0, 20), pCol1X, y);
      doc.text(product.points_price.toString(), pCol2X, y);
      doc.text(product.total_quantity.toString(), pCol3X, y);
      doc.text(product.total_points.toString(), pCol4X, y);
      y += 18;
    });

    doc.end();

    stream.on('finish', () => {
      logger.info(`PDF报告已生成: ${outputPath}`);
      resolve(outputPath);
    });
    stream.on('error', reject);
  });
}

async function generateMonthlyReport(year, month, outputDir) {
  const stats = generateMonthlyStatistics(year, month);
  
  const dateStr = `${year}${String(month).padStart(2, '0')}`;
  const excelPath = path.join(outputDir, `月度报告_${dateStr}.xlsx`);
  const pdfPath = path.join(outputDir, `月度报告_${dateStr}.pdf`);

  await generateExcelReport(stats, excelPath);
  await generatePDFReport(stats, pdfPath);

  return { stats, excelPath, pdfPath };
}

module.exports = {
  generateMonthlyStatistics,
  generateExcelReport,
  generatePDFReport,
  generateMonthlyReport
};
