import express from "express";
import cors from "cors";
import helmet from "helmet";
import { errorHandler } from "./middleware/error-handler.js";
import healthRoutes from "./routes/health.routes.js";
import aiRoutes from "./routes/ai.routes.js";
import knowledgeRoutes from "./routes/knowledge.routes.js";

const app = express();

// Global Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Routes
app.use(healthRoutes); // keep health at root
app.use("/api/ai", aiRoutes);
app.use("/api/knowledge", knowledgeRoutes);

// Global Error Handler
app.use(errorHandler);

export default app;
