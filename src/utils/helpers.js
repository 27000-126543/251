const { v4: uuidv4 } = require('uuid');
const dayjs = require('dayjs');

function generateNo(prefix) {
  const timestamp = dayjs().format('YYYYMMDDHHmmss');
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `${prefix}${timestamp}${random}`;
}

function generateTxnNo() {
  return generateNo('TXN');
}

function generateOrderNo() {
  return generateNo('ORD');
}

function generateApprovalNo() {
  return generateNo('APR');
}

function generateLogisticsNo() {
  return generateNo('LOG');
}

function generateReturnNo() {
  return generateNo('RET');
}

function generatePRNo() {
  return generateNo('PR');
}

function generateSurveyNo() {
  return generateNo('SRV');
}

function generateLogNo() {
  return generateNo('LOG');
}

function generateAlertNo() {
  return generateNo('ALT');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function safeJsonParse(str, defaultValue = null) {
  try {
    return JSON.parse(str);
  } catch (e) {
    return defaultValue;
  }
}

function safeJsonStringify(obj, defaultValue = '{}') {
  try {
    return JSON.stringify(obj);
  } catch (e) {
    return defaultValue;
  }
}

module.exports = {
  generateNo,
  generateTxnNo,
  generateOrderNo,
  generateApprovalNo,
  generateLogisticsNo,
  generateReturnNo,
  generatePRNo,
  generateSurveyNo,
  generateLogNo,
  generateAlertNo,
  sleep,
  safeJsonParse,
  safeJsonStringify
};
