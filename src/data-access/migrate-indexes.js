/**
 * MongoDB Index Migration: conversations collection
 *
 * Background
 * ----------
 * The Conversation schema previously had `unique: true` on `conversationId` alone,
 * which created an index named "conversationId_1" in MongoDB.
 *
 * The current schema uses an owner-scoped compound unique index:
 *   { conversationId: 1, userId: 1, companyId: 1 }  unique: true
 *
 * Mongoose's schema change does NOT automatically drop the old index from an
 * existing database. This script performs the migration explicitly and idempotently.
 *
 * What this script does
 * ---------------------
 * 1. Drops the old unique single-field index "conversationId_1" if it exists.
 * 2. Ensures the new compound unique index exists.
 * 3. Is safe to run against an already-migrated database (idempotent).
 * 4. Does NOT touch conversation data or any other indexes.
 *
 * Usage
 * -----
 * Run once during deployment (before starting the application server):
 *
 *   node src/data-access/migrate-indexes.js
 *
 * Or add it as a pre-start step in your deployment pipeline:
 *
 *   "premigrate": "node src/data-access/migrate-indexes.js"
 *
 * It is safe to run on every deployment — it is idempotent.
 */

import mongoose from "mongoose";
import { config } from "../config/env.js";
import { logger } from "../shared/logger.js";

const COLLECTION_NAME = "conversations";

// The old index that must be removed if it exists
const OLD_INDEX_NAME = "conversationId_1";

// The new compound unique index specification
const NEW_COMPOUND_INDEX_SPEC = { conversationId: 1, userId: 1, companyId: 1 };
const NEW_COMPOUND_INDEX_OPTIONS = { unique: true, name: "conversationId_1_userId_1_companyId_1" };

async function migrateConversationIndexes() {
  let connection;

  try {
    logger.info("[Migration] Connecting to MongoDB...");
    connection = await mongoose.connect(config.MONGODB_URI, {
      dbName: config.MONGODB_DB_NAME,
    });
    logger.info(`[Migration] Connected to database: ${config.MONGODB_DB_NAME}`);

    const db = mongoose.connection.db;
    const collection = db.collection(COLLECTION_NAME);

    // -----------------------------------------------------------------------
    // Step 1: List existing indexes on the conversations collection
    // -----------------------------------------------------------------------
    let existingIndexes;
    try {
      existingIndexes = await collection.listIndexes().toArray();
      logger.info(
        `[Migration] Found ${existingIndexes.length} existing index(es) on '${COLLECTION_NAME}': ` +
          existingIndexes.map((i) => i.name).join(", ")
      );
    } catch (err) {
      if (err.code === 26 /* NamespaceNotFound */) {
        // Collection does not exist yet — nothing to migrate
        logger.info(
          `[Migration] Collection '${COLLECTION_NAME}' does not exist yet — skipping index drop.`
        );
        existingIndexes = [];
      } else {
        throw err;
      }
    }

    // -----------------------------------------------------------------------
    // Step 2: Drop the old single-field unique index if it still exists
    // -----------------------------------------------------------------------
    const oldIndexExists = existingIndexes.some((idx) => idx.name === OLD_INDEX_NAME);

    if (oldIndexExists) {
      logger.info(
        `[Migration] Dropping old unique index '${OLD_INDEX_NAME}' from '${COLLECTION_NAME}'...`
      );
      await collection.dropIndex(OLD_INDEX_NAME);
      logger.info(`[Migration] ✅ Old index '${OLD_INDEX_NAME}' dropped successfully.`);
    } else {
      logger.info(
        `[Migration] Old index '${OLD_INDEX_NAME}' not found — already removed or never existed.`
      );
    }

    // -----------------------------------------------------------------------
    // Step 3: Ensure the new compound unique index exists
    // -----------------------------------------------------------------------
    // Find if the compound index already exists (by name or exact key match)
    const existingCompoundIndex = existingIndexes.find(
      (idx) =>
        idx.name === NEW_COMPOUND_INDEX_OPTIONS.name ||
        (idx.key &&
          idx.key.conversationId === 1 &&
          idx.key.userId === 1 &&
          idx.key.companyId === 1)
    );

    if (existingCompoundIndex) {
      if (existingCompoundIndex.unique === true) {
        logger.info(
          `[Migration] Compound unique index already exists on '${COLLECTION_NAME}' — no action needed.`
        );
      } else {
        logger.info(
          `[Migration] Found compound index '${existingCompoundIndex.name}' but it is not unique. Dropping it...`
        );
        await collection.dropIndex(existingCompoundIndex.name);
        logger.info(
          `[Migration] Creating proper compound unique index on '${COLLECTION_NAME}'...`
        );
        await collection.createIndex(NEW_COMPOUND_INDEX_SPEC, NEW_COMPOUND_INDEX_OPTIONS);
        logger.info(
          `[Migration] ✅ Compound unique index '${NEW_COMPOUND_INDEX_OPTIONS.name}' created successfully.`
        );
      }
    } else {

      logger.info(
        `[Migration] Creating compound unique index on '${COLLECTION_NAME}'...`
      );
      await collection.createIndex(NEW_COMPOUND_INDEX_SPEC, NEW_COMPOUND_INDEX_OPTIONS);
      logger.info(
        `[Migration] ✅ Compound unique index '${NEW_COMPOUND_INDEX_OPTIONS.name}' created successfully.`
      );
    }

    logger.info("[Migration] ✅ Index migration completed successfully.");
  } catch (error) {
    if (error.code === 11000) {
      logger.error(
        "[Migration] ❌ Index migration failed: Duplicate conversation data exists that violates the new unique compound index. You must manually resolve the duplicate data before this migration can succeed.",
        error
      );
    } else {
      logger.error("[Migration] ❌ Index migration failed:", error);
    }
    process.exit(1);
  } finally {
    if (connection) {
      await mongoose.disconnect();
      logger.info("[Migration] MongoDB connection closed.");
    }
  }
}

migrateConversationIndexes();
