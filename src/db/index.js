const Database = require('better-sqlite3');
const config = require('../config');
const initDatabase = require('./init');

let dbInstance = null;

function getDb() {
  if (!dbInstance) {
    dbInstance = initDatabase();
  }
  return dbInstance;
}

function withTransaction(fn) {
  const db = getDb();
  const txn = db.transaction(fn);
  return txn();
}

function prepare(sql) {
  const db = getDb();
  return db.prepare(sql);
}

module.exports = {
  getDb,
  withTransaction,
  prepare
};
