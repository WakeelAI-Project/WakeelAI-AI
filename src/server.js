import app from "./app.js";
import { config } from "./config/env.js";
import { connectDatabase } from "./data-access/database.js";
import { bootstrapInitialLaborLawKnowledge } from "./rag/ingestion/knowledge-bootstrap.service.js";
import { logger } from "./shared/logger.js";

const startServer = async () => {
  try {
    await connectDatabase();
    await bootstrapInitialLaborLawKnowledge();

    app.listen(config.PORT, () => {
      logger.info(`✅ Wakeel AI Service running on port ${config.PORT}`);
    });
  } catch (error) {
    logger.error("❌ Failed to start server:", error);
    process.exit(1);
  }
};

startServer();
