import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { requireInternalAuth } from "../src/middleware/internal-auth.middleware.js";
import { config } from "../src/config/env.js";

describe("Internal Auth Middleware", () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      header: jest.fn(),
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    next = jest.fn();
    config.WAKEEL_INTERNAL_API_KEY = "your_internal_api_key_here";
  });

  it("should return 401 if X-Internal-API-Key is missing", () => {
    req.header.mockReturnValue(undefined);

    requireInternalAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: expect.objectContaining({ code: "UNAUTHORIZED_SERVICE" })
    }));
    expect(next).not.toHaveBeenCalled();
  });

  it("should return 401 if X-Internal-API-Key is invalid", () => {
    req.header.mockImplementation((name) => {
      if (name === "X-Internal-API-Key") return "wrong-key";
      return undefined;
    });

    requireInternalAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("should return 400 if identity headers are missing", () => {
    req.header.mockImplementation((name) => {
      if (name === "X-Internal-API-Key") return "your_internal_api_key_here";
      return undefined;
    });

    requireInternalAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: expect.objectContaining({ code: "MISSING_IDENTITY_HEADERS" })
    }));
  });

  it("should populate req.aiContext and call next if all headers are valid", () => {
    req.header.mockImplementation((name) => {
      if (name === "X-Internal-API-Key") return "your_internal_api_key_here";
      if (name === "X-User-Id") return "user-123";
      if (name === "X-Company-Id") return "company-456";
      if (name === "X-Role") return "employee";
      return undefined;
    });

    requireInternalAuth(req, res, next);

    expect(req.aiContext).toEqual({
      userId: "user-123",
      companyId: "company-456",
      role: "employee"
    });
    expect(next).toHaveBeenCalled();
  });
});
