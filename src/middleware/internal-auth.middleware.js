import { config } from "../config/env.js";

/**
 * Middleware to enforce internal service-to-service authentication.
 * 
 * 1. Validates the internal service key header.
 * 2. Extracts trusted identity context (userId, companyId, role) from headers.
 * 3. Populates req.aiContext.
 * 
 * @param {import("express").Request} req 
 * @param {import("express").Response} res 
 * @param {import("express").NextFunction} next 
 */
export const requireInternalAuth = (req, res, next) => {
  const internalKey = req.header("X-Wakeel-Internal-Key");

  // 1. Authenticate the internal request
  if (!internalKey || internalKey !== config.INTERNAL_SERVICE_KEY) {
    return res.status(401).json({
      success: false,
      error: {
        code: "UNAUTHORIZED_SERVICE",
        message: "Invalid or missing internal service key."
      }
    });
  }

  // 2. Extract trusted identity headers
  const userId = req.header("X-Wakeel-User-Id");
  const companyId = req.header("X-Wakeel-Company-Id");
  const role = req.header("X-Wakeel-Role");

  if (!userId || !companyId || !role) {
    return res.status(400).json({
      success: false,
      error: {
        code: "MISSING_IDENTITY_HEADERS",
        message: "Missing required internal identity headers (userId, companyId, role)."
      }
    });
  }

  // 3. Construct the trusted AI Context
  req.aiContext = {
    userId,
    companyId,
    role
  };

  next();
};
