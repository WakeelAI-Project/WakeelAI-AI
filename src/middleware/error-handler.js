import { logger } from "../shared/logger.js";

/**
 * Global Express error handling middleware.
 * Returns a consistent JSON structure without exposing stack traces in production.
 */
export const errorHandler = (err, req, res, next) => {
  logger.error(err);

  const statusCode = err.status || 500;
  const errorCode = err.code || "INTERNAL_SERVER_ERROR";
  
  // Do not expose internal error messages for 500s in production
  const message = (statusCode === 500 && process.env.NODE_ENV === "production") 
    ? "An unexpected error occurred." 
    : err.message || "An unexpected error occurred.";

  res.status(statusCode).json({
    success: false,
    error: {
      code: errorCode,
      message: message,
    }
  });
};
