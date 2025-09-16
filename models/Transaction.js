// models/Transaction.js
const { addTransaction, getTransactions } = require("../config/db");

class Transaction {
  /**
   * Log a transaction.
   * @param {Object} p
   * @param {string} p.email
   * @param {number} p.amount  positive=purchase/top-up, negative=usage
   * @param {"purchase"|"usage"|"adjustment"} p.type
   * @param {string=} p.stripeId
   * @param {Object=} p.meta   arbitrary info, e.g. { model, tokens, messageId }
   */
  static async create(p) {
    if (!p?.email) throw new Error("Transaction.create: email required");
    if (typeof p.amount !== "number") throw new Error("Transaction.create: amount must be number");
    if (!p.type) throw new Error("Transaction.create: type required");
    return addTransaction(p);
  }

  /**
   * List recent transactions for a user.
   * @param {string} email
   * @param {number=} limit
   */
  static async list(email, limit = 50) {
    if (!email) throw new Error("Transaction.list: email required");
    return getTransactions(email, limit);
  }
}

module.exports = Transaction;
