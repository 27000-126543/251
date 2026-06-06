const path = require('path');
const fs = require('fs');

const config = {
  db: {
    path: process.env.DB_PATH || path.join(__dirname, '../../data/points_system.db')
  },
  redis: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: process.env.REDIS_PORT || 6379
  },
  approval: {
    threshold1: parseInt(process.env.APPROVAL_THRESHOLD_1) || 5000,
    threshold2: parseInt(process.env.APPROVAL_THRESHOLD_2) || 10000
  },
  points: {
    expireDays: parseInt(process.env.POINTS_EXPIRE_DAYS) || 365,
    expireWarningDays: parseInt(process.env.POINTS_EXPIRE_WARNING_DAYS) || 30
  },
  delivery: {
    feePoints: parseInt(process.env.DELIVERY_FEE_POINTS) || 50
  },
  system: {
    maxConcurrentRequests: parseInt(process.env.MAX_CONCURRENT_REQUESTS) || 1000
  },
  wechat: {
    webhookUrl: process.env.WECHAT_WEBHOOK_URL || ''
  }
};

const dataDir = path.dirname(config.db.path);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

module.exports = config;
