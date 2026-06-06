module.exports = {
  ...require('./points.service'),
  ...require('./product.service'),
  ...require('./order.service'),
  ...require('./logistics.service'),
  ...require('./return.service'),
  ...require('./expire.service'),
  ...require('./report.service'),
  ...require('./export.service'),
  ...require('./operation-log.service'),
  ...require('./alert.service')
};
