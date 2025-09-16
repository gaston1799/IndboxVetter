// models/User.js
const { upsertUser, getCredits, addCredits } = require("../config/db");

class User {
  /**
   * Ensure a user exists in the DB (create or update name/picture).
   * @param {{ id?: string, email: string, name?: string, picture?: string }} payload
   * @returns {Promise<{ id?: string, email: string, name?: string, picture?: string }>}
   */
  static async findOrCreate(payload) {
    if (!payload?.email) throw new Error("User.findOrCreate: email required");
    // upsertUser returns the user object
    return upsertUser(payload);
  }

  /**
   * Get the user's current credit balance.
   * @param {string} email
   * @returns {Promise<number>}
   */
  static async getCredits(email) {
    if (!email) throw new Error("User.getCredits: email required");
    return getCredits(email);
  }

  /**
   * Add (or subtract) credits. Negative delta will decrement.
   * @param {string} email
   * @param {number} delta
   * @returns {Promise<number>} new balance
   */
  static async addCredits(email, delta) {
    if (!email) throw new Error("User.addCredits: email required");
    if (typeof delta !== "number" || Number.isNaN(delta)) {
      throw new Error("User.addCredits: delta must be a number");
    }
    return addCredits(email, delta);
  }
}

module.exports = User;
