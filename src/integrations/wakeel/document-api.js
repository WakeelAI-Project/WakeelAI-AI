import { z } from "zod";
import { wakeelFetch } from "./wakeel-client.js";

/**
 * Canonical request contract for POST /api/documents/save (Node.js -> .NET).
 *
 * Identity (userId, companyId, role) is NEVER duplicated in this body — it is
 * already trusted from the internal headers (X-User-Id, X-Company-Id, X-Role)
 * attached by wakeelFetch. Only document-specific business data belongs here.
 */
export const DocumentSaveRequestSchema = z.object({
  // The type of document being generated (e.g. "Contract", "Warning", "Termination").
  document_type: z.string().trim().min(1, "document_type is required"),
  // Human-readable title for the generated document.
  title: z.string().trim().min(1, "title is required"),
  // The fully rendered document content, as HTML.
  content_html: z.string().trim().min(1, "content_html is required"),
  // Optional target employee record when one already exists. New-employee
  // contract drafts often do not have a Wakeel employee record yet.
  employee_id: z.string().trim().min(1).optional(),
  // The template used to generate this document, when applicable.
  template_id: z.string().trim().min(1).optional(),
  // Free-form structured metadata captured during generation (e.g. filled
  // placeholder values). Optional, additive — never used to carry identity.
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

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
 * @param {z.infer<typeof DocumentSaveRequestSchema>} payload The document payload to save
 * @returns {Promise<z.infer<typeof DocumentSaveResponseSchema>>}
 */
export async function saveDocument(aiContext, payload) {
  // Validate the outbound payload shape before it ever leaves the AI Server.
  const parsedPayload = DocumentSaveRequestSchema.safeParse(payload);
  if (!parsedPayload.success) {
    throw new Error(`Invalid document save payload: ${parsedPayload.error.message}`);
  }

  const data = await wakeelFetch("POST", "/api/documents/save", aiContext, parsedPayload.data);

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
