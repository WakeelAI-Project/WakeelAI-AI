import { ZodError } from "zod";

/**
 * Creates a middleware that validates the request against provided Zod schemas.
 * 
 * @param {Object} schemas 
 * @param {import("zod").ZodSchema} [schemas.body] - Schema for req.body
 * @param {import("zod").ZodSchema} [schemas.query] - Schema for req.query
 * @param {import("zod").ZodSchema} [schemas.params] - Schema for req.params
 * @returns {import("express").RequestHandler}
 */
export const validateRequest = (schemas) => {
  return (req, res, next) => {
    try {
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      if (schemas.query) {
        req.query = schemas.query.parse(req.query);
      }
      if (schemas.params) {
        req.params = schemas.params.parse(req.params);
      }
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid request data",
            details: error.issues || error.errors
          }
        });
      }
      next(error);
    }
  };
};
