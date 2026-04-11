const mongoose = require('mongoose');

const isTransientError = (err) =>
  Array.isArray(err.errorLabels) && err.errorLabels.includes('TransientTransactionError');

// MongoDB error code 20 = "Transaction numbers are only allowed on a replica set member or mongos"
// This happens on standalone MongoDB (typical in local dev). Fall back to non-transactional execution.
const isNoReplicaSetError = (err) =>
  err.code === 20 || err.message?.includes('Transaction numbers');

/**
 * Runs `fn(session)` inside a MongoDB transaction with automatic retry on
 * transient errors. On standalone MongoDB (no replica set), transparently
 * falls back to running `fn(null)` without a transaction so local dev works
 * without any config changes.
 *
 * @param {(session: ClientSession|null) => Promise<T>} fn
 * @param {number} maxRetries
 * @returns {Promise<T>}
 */
const runWithRetry = async (fn, maxRetries = 2) => {
  let attempt = 0;
  while (true) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const result = await fn(session);
      await session.commitTransaction();
      await session.endSession();
      return result;
    } catch (err) {
      await session.abortTransaction();
      await session.endSession();

      // Standalone MongoDB — silently fall back to no-transaction
      if (isNoReplicaSetError(err)) {
        return fn(null);
      }

      if (isTransientError(err) && attempt < maxRetries) {
        attempt++;
        await new Promise((r) => setTimeout(r, 50 * attempt));
        continue;
      }

      throw err;
    }
  }
};

module.exports = { runWithRetry, isTransientError };
