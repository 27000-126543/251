const { EventEmitter } = require('events');
const logger = require('../utils/logger');

class TaskQueue extends EventEmitter {
  constructor(concurrency = 100) {
    super();
    this.concurrency = concurrency;
    this.queue = [];
    this.active = 0;
    this.running = false;
  }

  add(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.emit('added', task);
      this.process();
    });
  }

  async process() {
    if (this.active >= this.concurrency || this.queue.length === 0) {
      return;
    }

    const { task, resolve, reject } = this.queue.shift();
    this.active++;
    this.running = true;

    try {
      const result = await task();
      resolve(result);
      this.emit('completed', task, result);
    } catch (error) {
      reject(error);
      this.emit('error', task, error);
      logger.error('队列任务执行失败:', error.message);
    } finally {
      this.active--;
      if (this.active === 0 && this.queue.length === 0) {
        this.running = false;
        this.emit('drained');
      }
      setImmediate(() => this.process());
    }
  }

  get length() {
    return this.queue.length;
  }

  get isRunning() {
    return this.running;
  }
}

const grantPointsQueue = new TaskQueue(500);
const orderQueue = new TaskQueue(200);
const notificationQueue = new TaskQueue(100);

function asyncGrantPoints(params) {
  return grantPointsQueue.add(() => {
    const { grantPoints } = require('../services/points.service');
    return grantPoints(params);
  });
}

function asyncCreateOrder(params) {
  return orderQueue.add(() => {
    const { createOrder } = require('../services/order.service');
    return createOrder(params);
  });
}

function asyncSendNotification(params) {
  return notificationQueue.add(async () => {
    const { sendWechatAlert } = require('../services/alert.service');
    return sendWechatAlert(params.title, params.content);
  });
}

module.exports = {
  TaskQueue,
  grantPointsQueue,
  orderQueue,
  notificationQueue,
  asyncGrantPoints,
  asyncCreateOrder,
  asyncSendNotification
};
