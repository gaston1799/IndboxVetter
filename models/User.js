// models/User.js
const {
  upsertUser,
  getUser,
  listUsers,
  getSettings: getSettingsFromStore,
  updateSettings: updateSettingsInStore,
  getSubscription: getSubscriptionFromStore,
  updateSubscription: updateSubscriptionInStore,
} = require("../config/db");

class User {
  /**
   * Ensure a user exists in the DB (create or update name/picture).
   * @param {{ id?: string, email: string, name?: string, picture?: string }} payload
   * @returns {Promise<{ id?: string, email: string, name?: string, picture?: string }>}
   */
  static async findOrCreate(payload) {
    if (!payload?.email) throw new Error("User.findOrCreate: email required");
    return upsertUser(payload);
  }

  /**
   * Fetch a user by email (without sensitive settings).
   * @param {string} email
   * @returns {Promise<object|null>}
   */
  static async findByEmail(email) {
    if (!email) throw new Error("User.findByEmail: email required");
    return getUser(email);
  }

  /**
   * List all users (admin helper).
   * @returns {Promise<object[]>}
   */
  static async list() {
    return listUsers();
  }

  /**
   * Get per-user settings.
   * @param {string} email
   */
  static async getSettings(email) {
    if (!email) throw new Error("User.getSettings: email required");
    return getSettingsFromStore(email);
  }

  /**
   * Update per-user settings.
   * @param {string} email
   * @param {object} updates
   */
  static async updateSettings(email, updates) {
    if (!email) throw new Error("User.updateSettings: email required");
    return updateSettingsInStore(email, updates);
  }

  /**
   * Fetch subscription info for a user.
   * @param {string} email
   */
  static async getSubscription(email) {
    if (!email) throw new Error("User.getSubscription: email required");
    return getSubscriptionFromStore(email);
  }

  /**
   * Update subscription info for a user.
   * @param {string} email
   * @param {object} updates
   */
  static async updateSubscription(email, updates) {
    if (!email) throw new Error("User.updateSubscription: email required");
    return updateSubscriptionInStore(email, updates);
  }
}

module.exports = User;
