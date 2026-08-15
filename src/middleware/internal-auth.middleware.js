import { config } from "../config/env.js";

const logInternalAuth = (message) => {
  console.log(`[InternalAuth] ${message}`);
};

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
  const internalKey = req.header("X-Internal-API-Key");
  logInternalAuth(`Request received for ${req.method} ${req.path}. internal key present=${Boolean(internalKey)}`);

  // 1. Authenticate the internal request
  if (!internalKey || internalKey !== config.WAKEEL_INTERNAL_API_KEY) {
    return res.status(401).json({
      success: false,
      error: {
        code: "UNAUTHORIZED_SERVICE",
        message: "Invalid or missing internal service key."
      }
    });
  }

  // 2. Extract trusted identity headers
  const userId = req.header("X-User-Id");
  const companyId = req.header("X-Company-Id");
  const role = req.header("X-Role");
  logInternalAuth(
    "Trusted identity headers received. " +
    `userId present=${Boolean(userId)} ` +
    `companyId present=${Boolean(companyId)} ` +
    `role present=${Boolean(role)}`
  );

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
