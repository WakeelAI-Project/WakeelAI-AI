import { z } from "zod";
import { executeWakeelRequest } from "./wakeel-client.js";

export const TemplateResponseSchema = z.object({
  template_id: z.string(),
  document_type: z.string(),
  name: z.string(),
  content_template: z.string(),
});

/**
 * Retrieves the active document template for a specific document type.
 * @param {import("../../contracts/index.js").AIContext} aiContext Trusted AI context
 * @param {string} documentType The type of the document (e.g., 'Contract')
 * @returns {Promise<z.infer<typeof TemplateResponseSchema>>}
 */
export async function getActiveTemplate(aiContext, documentType) {
  try {
    const data = await executeWakeelRequest("GET", `/api/ai/templates/active?documentType=${encodeURIComponent(documentType)}`, aiContext);
    
    // Validate the response shape
    const parsed = TemplateResponseSchema.safeParse(data);
    if (!parsed.success) {
      throw new Error(`Invalid template response received from backend: ${parsed.error.message}`);
    }

    return parsed.data;
  } catch (error) {
    if (error.status === 404) {
      throw new Error(`Active template not found for documentType: ${documentType}`);
    }
    throw error;
  }
}
