import { z } from "zod";
import { executeWakeelRequest } from "./wakeel-client.js";

export const DocumentSaveResponseSchema = z.object({
  success: z.boolean(),
  document_id: z.string(),
  document_type: z.string(),
  status: z.string(),
  created_at: z.string(), // Keeping as string to match backend ISO string format
});

/**
 * Saves a generated document to the backend.
 * @param {import("../../contracts/index.js").AIContext} aiContext Trusted AI context
 * @param {Object} payload The document payload to save
 * @returns {Promise<z.infer<typeof DocumentSaveResponseSchema>>}
 */
export async function saveDocument(aiContext, payload) {
  const data = await executeWakeelRequest("POST", "/api/documents/save", aiContext, payload);
  
  // Validate the response shape
  const parsed = DocumentSaveResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(`Invalid document save response received from backend: ${parsed.error.message}`);
  }

  if (!parsed.data.success) {
    throw new Error("Backend reported failure when saving the document.");
  }

  return parsed.data;
}
