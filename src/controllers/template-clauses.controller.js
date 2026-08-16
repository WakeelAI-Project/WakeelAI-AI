import { suggestTemplateClauses } from "../services/template-clause-suggestion.service.js";
import { logger } from "../shared/logger.js";

export const postTemplateClauses = async (req, res, next) => {
  try {
    const trusted = req.aiContext; // set by requireInternalAuth

    // Defense in depth: .NET already restricts to HR_Manager, but never trust the caller alone.
    if (trusted.role !== "HR_Manager") {
      return res.status(403).json({
        success: false,
        error: { code: "FORBIDDEN_ROLE", message: "Only HR managers can generate template clauses." },
      });
    }

    // Tenant guard: body companyId must match the trusted header identity.
    if (req.body.companyId !== trusted.companyId) {
      return res.status(403).json({
        success: false,
        error: { code: "IDENTITY_CONTEXT_MISMATCH", message: "companyId does not match the authenticated service identity." },
      });
    }

    logger.info(
      `[TemplateClausesController] templateId=${req.body.templateId} language=${req.body.language} ` +
      `laborLaw=${req.body.includeLaborLaw} policy=${req.body.includeCompanyPolicy}`,
    );

    const result = await suggestTemplateClauses({
      templateId: req.body.templateId,
      documentType: req.body.documentType,
      templateName: req.body.templateName,
      language: req.body.language,
      includeLaborLaw: req.body.includeLaborLaw,
      includeCompanyPolicy: req.body.includeCompanyPolicy,
      instruction: req.body.instruction,
      aiContext: trusted,
    });

    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};
