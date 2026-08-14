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
        const parsedBody = schemas.body.parse(req.body);
        Object.defineProperty(req, 'body', { value: parsedBody, writable: true, enumerable: true, configurable: true });
      }
      if (schemas.query) {
        const parsedQuery = schemas.query.parse(req.query);
        Object.defineProperty(req, 'query', { value: parsedQuery, writable: true, enumerable: true, configurable: true });
      }
      if (schemas.params) {
        const parsedParams = schemas.params.parse(req.params);
        Object.defineProperty(req, 'params', { value: parsedParams, writable: true, enumerable: true, configurable: true });
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
