import mongoose from "mongoose";
import { config } from "../config/env.js";
import { logger } from "../shared/logger.js";

/**
 * Establishes a connection to MongoDB.
 */
export const connectDatabase = async () => {
  try {
    const connectionUri = config.MONGODB_URI;
    await mongoose.connect(connectionUri, {
      dbName: config.MONGODB_DB_NAME,
    });
    logger.info(`✅ Successfully connected to MongoDB Database: ${config.MONGODB_DB_NAME}`);
  } catch (error) {
    logger.error("❌ Failed to connect to MongoDB", error);
    process.exit(1);
  }
};

/**
 * Disconnects from MongoDB gracefully.
 */
export const disconnectDatabase = async () => {
  try {
    await mongoose.disconnect();
    logger.info("MongoDB connection closed.");
  } catch (error) {
    logger.error("Error closing MongoDB connection", error);
  }
};
