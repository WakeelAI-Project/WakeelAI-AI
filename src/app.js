import express from "express";
import cors from "cors";
import helmet from "helmet";
import { errorHandler } from "./middleware/error-handler.js";
import healthRoutes from "./routes/health.routes.js";

const app = express();

// Global Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Routes
app.use(healthRoutes);

// Global Error Handler
app.use(errorHandler);

export default app;
