const { prepare, withTransaction } = require('../db');
const { safeJsonStringify, generatePRNo } = require('../utils/helpers');
const { sendStockAlert } = require('./alert.service');
const { createOperationLog } = require('./operation-log.service');
const logger = require('../utils/logger');

function getProduct(productId) {
  const stmt = prepare(`
    SELECT * FROM products WHERE id = ? AND status = 1
  `);
  return stmt.get(productId);
}

function getProductByCode(productCode) {
  const stmt = prepare(`
    SELECT * FROM products WHERE product_code = ? AND status = 1
  `);
  return stmt.get(productCode);
}

function getProductSuppliers(productId) {
  const stmt = prepare(`
    SELECT ps.*, s.supplier_name, s.rating, s.contact_name, s.contact_phone
    FROM product_suppliers ps
    INNER JOIN suppliers s ON ps.supplier_id = s.id
    WHERE ps.product_id = ? AND ps.status = 1 AND s.status = 1
    ORDER BY ps.priority ASC, s.rating DESC
  `);
  return stmt.all(productId);
}

function updateStock(productId, quantity, operatorId = null, operatorName = null) {
  return withTransaction(() => {
    const product = getProduct(productId);
    if (!product) {
      throw new Error('商品不存在');
    }

    const newStock = product.stock + quantity;

    if (newStock < 0) {
      throw new Error(`库存不足，当前库存: ${product.stock}`);
    }

    const updateStmt = prepare(`
      UPDATE products
      SET stock = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    updateStmt.run(newStock, productId);

    if (newStock <= product.safety_stock && quantity < 0) {
      sendStockAlert(productId, product.product_name, newStock, product.safety_stock);
    }

    createOperationLog({
      operation_type: 'UPDATE_STOCK',
      module: 'PRODUCT',
      operator_id: operatorId,
      operator_name: operatorName,
      target_id: productId,
      before_data: { stock: product.stock },
      after_data: { stock: newStock }
    });

    return {
      product_id: productId,
      before_stock: product.stock,
      after_stock: newStock
    };
  });
}

function allocateSuppliers(productId, quantity) {
  const suppliers = getProductSuppliers(productId);

  if (suppliers.length === 0) {
    throw new Error('该商品没有可用供应商');
  }

  const totalWeight = suppliers.reduce((sum, s) => sum + (s.rating || 1), 0);
  const allocations = [];
  let remaining = quantity;

  for (let i = 0; i < suppliers.length; i++) {
    const supplier = suppliers[i];
    const isLast = i === suppliers.length - 1;

    let allocatedQty;
    if (isLast) {
      allocatedQty = remaining;
    } else {
      allocatedQty = Math.ceil(quantity * (supplier.rating || 1) / totalWeight);
      allocatedQty = Math.min(allocatedQty, remaining);
    }

    if (allocatedQty > 0) {
      allocations.push({
        supplier_id: supplier.supplier_id,
        supplier_name: supplier.supplier_name,
        supplier_price: supplier.supplier_price,
        quantity: allocatedQty,
        estimated_cost: allocatedQty * supplier.supplier_price,
        supply_days: supplier.supply_days
      });
      remaining -= allocatedQty;
    }

    if (remaining <= 0) break;
  }

  return allocations;
}

function createPurchaseRequest(productId, quantity, operatorId = null) {
  return withTransaction(() => {
    const product = getProduct(productId);
    if (!product) {
      throw new Error('商品不存在');
    }

    const allocations = allocateSuppliers(productId, quantity);
    const totalEstimatedCost = allocations.reduce((sum, a) => sum + a.estimated_cost, 0);

    const pr_no = generatePRNo();

    const stmt = prepare(`
      INSERT INTO purchase_requests
      (pr_no, product_id, product_name, quantity, estimated_points, supplier_allocations, status)
      VALUES (?, ?, ?, ?, ?, ?, 'PENDING')
    `);

    stmt.run(
      pr_no,
      productId,
      product.product_name,
      quantity,
      totalEstimatedCost,
      safeJsonStringify(allocations)
    );

    createOperationLog({
      operation_type: 'CREATE_PR',
      module: 'PURCHASE',
      operator_id: operatorId,
      target_id: pr_no,
      after_data: {
        product_id: productId,
        product_name: product.product_name,
        quantity,
        allocations
      }
    });

    logger.info(`采购申请创建成功: ${pr_no}, 商品: ${product.product_name}, 数量: ${quantity}`);

    return {
      pr_no,
      product_id: productId,
      product_name: product.product_name,
      quantity,
      estimated_cost: totalEstimatedCost,
      supplier_allocations: allocations
    };
  });
}

function getPurchaseRequests(params = {}) {
  const { status, product_id, page = 1, page_size = 20 } = params;

  let whereConditions = [];
  let queryParams = [];

  if (status) {
    whereConditions.push('status = ?');
    queryParams.push(status);
  }
  if (product_id) {
    whereConditions.push('product_id = ?');
    queryParams.push(product_id);
  }

  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

  const countStmt = prepare(`SELECT COUNT(*) as total FROM purchase_requests ${whereClause}`);
  const { total } = countStmt.get(...queryParams);

  const offset = (page - 1) * page_size;
  const dataStmt = prepare(`
    SELECT * FROM purchase_requests ${whereClause}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `);
  queryParams.push(page_size, offset);
  const list = dataStmt.all(...queryParams).map(pr => ({
    ...pr,
    supplier_allocations: JSON.parse(pr.supplier_allocations || '[]')
  }));

  return {
    list,
    total,
    page,
    page_size,
    total_pages: Math.ceil(total / page_size)
  };
}

function getProducts(params = {}) {
  const { category, keyword, status = 1, page = 1, page_size = 20 } = params;

  let whereConditions = [];
  let queryParams = [];

  if (status !== null && status !== undefined) {
    whereConditions.push('status = ?');
    queryParams.push(status);
  }
  if (category) {
    whereConditions.push('category = ?');
    queryParams.push(category);
  }
  if (keyword) {
    whereConditions.push('(product_name LIKE ? OR product_code LIKE ?)');
    queryParams.push(`%${keyword}%`, `%${keyword}%`);
  }

  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

  const countStmt = prepare(`SELECT COUNT(*) as total FROM products ${whereClause}`);
  const { total } = countStmt.get(...queryParams);

  const offset = (page - 1) * page_size;
  const dataStmt = prepare(`
    SELECT * FROM products ${whereClause}
    ORDER BY updated_at DESC
    LIMIT ? OFFSET ?
  `);
  queryParams.push(page_size, offset);
  const list = dataStmt.all(...queryParams);

  return {
    list,
    total,
    page,
    page_size,
    total_pages: Math.ceil(total / page_size)
  };
}

module.exports = {
  getProduct,
  getProductByCode,
  getProductSuppliers,
  updateStock,
  allocateSuppliers,
  createPurchaseRequest,
  getPurchaseRequests,
  getProducts
};
