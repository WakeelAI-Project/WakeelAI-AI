import crypto from "crypto";
import { z } from "zod";
import { createLLM } from "../llm/llm-provider.js";
import { llmConfig } from "../config/env.js";
import { retrieveKnowledge } from "../rag/retrieval/knowledge-retrieval.service.js";
import { getCompanyContext } from "./company-context.service.js";
import { logger } from "../shared/logger.js";

const RETRIEVAL_TOP_K = 6;
const MAX_CLAUSE_CHARACTERS = 3000;

// Officially supported placeholders - MUST match frontend TEMPLATE_PLACEHOLDERS
const SUPPORTED_PLACEHOLDERS = new Set([
  "employee_name",
  "job_title",
  "department",
  "salary",
  "hire_date",
  "contract_type",
  "company_name",
  "date",
]);

const GeneratedClauseSchema = z.object({
  title: z.string(),
  content: z.string(),
  category: z.enum(["labor_law", "company_policy", "mixed"]),
  source_ids: z.array(z.string()),
  support: z.enum(["supported", "insufficient_source_support"]),
});

const ClauseSuggestionsOutputSchema = z.object({
  clauses: z.array(GeneratedClauseSchema),
});

let clauseLlm;
const getClauseLlm = () => {
  if (!clauseLlm) {
    clauseLlm = createLLM({ ...llmConfig, temperature: 0 }).withStructuredOutput(
      ClauseSuggestionsOutputSchema,
      { name: "suggest_template_clauses" },
    );
  }
  return clauseLlm;
};

const createDomainError = (code, message, status = 400) => {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
};

// Document-type-aware retrieval query. Never generate contract clauses
// for a warning/termination letter.
const TOPIC_HINTS = {
  contract:
    "probation period working hours annual leave sick leave salary payment termination notice period confidentiality employee obligations employer obligations",
  warning_letter:
    "employee misconduct disciplinary action warning penalties employee obligations violations",
  termination_letter:
    "termination of employment notice period end of service severance final settlement",
};

const topicHintFor = (documentType) => {
  const key = String(documentType || "").trim().toLowerCase();
  return TOPIC_HINTS[key] || `${documentType} standard clauses obligations terms`;
};

const buildRetrievalQuery = ({ documentType, instruction, language }) => {
  const base = `${documentType} ${topicHintFor(documentType)} ${instruction || ""}`;
  return language === "ar"
    ? `${base} بنود ${documentType} فترة الاختبار ساعات العمل الأجازات إنهاء الخدمة الالتزامات`
    : base;
};

const retrieveForType = async ({ knowledgeType, companyId, documentType, instruction, language }) => {
  const retrieval = await retrieveKnowledge({
    query: buildRetrievalQuery({ documentType, instruction, language }),
    context: {
      knowledgeType, // MUST be "labor-law" or "company-policy" (kebab-case)
      ...(knowledgeType === "company-policy" ? { companyId } : {}),
      topK: RETRIEVAL_TOP_K,
    },
  });
  return {
    sources: Array.isArray(retrieval?.sources) ? retrieval.sources : [],
  };
};

const compactJson = (value) => JSON.stringify(value, null, 2);

const buildPrompt = ({ documentType, templateName, instruction, language, sources, companyContext }) => `
You are generating ready-to-insert legal clauses for an employment document TEMPLATE.
Template name: ${templateName || "(unnamed)"}
Document type: ${documentType}
HR instruction: ${instruction || "Generate the standard clauses for this template."}
Output language: ${language === "ar" ? "Arabic (Modern Standard, formal legal tone)" : "English (formal legal tone)"}

CRITICAL OUTPUT RULES:
1. OUTPUT CONTRACTUAL TEXT, NOT META-GUIDANCE
   - Write clauses as they would appear in the final legal document
   - Do NOT write instructions to HR (e.g. "يجب أن يتضمن العقد..." or "the contract must include...")
   - Do NOT write explanatory guidance (e.g. "the employer should..." or "this clause establishes...")
   - Write in first person contractual language using legal voice
   
   ❌ WRONG: "يجب أن يتضمن عقد العمل تاريخ إبرامه واسم صاحب العمل..."
   ✅ CORRECT: "أُبرم هذا العقد بتاريخ {{date}} بين {{company_name}} والموظف {{employee_name}}..."
   
   ❌ WRONG: "The employer must provide notice before termination."
   ✅ CORRECT: "Either party may terminate this agreement by providing 30 days written notice."

2. SUPPORTED PLACEHOLDERS ONLY
   You MUST use ONLY these exact placeholders (case-sensitive, with double curly braces):
   - {{employee_name}}  : Employee's full legal name
   - {{job_title}}      : Employee's job title/position
   - {{department}}     : Department name
   - {{salary}}         : Monthly salary amount
   - {{hire_date}}      : Employment start date
   - {{contract_type}}  : Type of employment contract
   - {{company_name}}   : Legal name of the company
   - {{date}}           : Current document date
   
   FORBIDDEN placeholders (will cause validation errors):
   ❌ {{start_date}}, {{end_date}}, {{working_hours}}, {{employer_name}}, {{work_address}},
   {{probation_period}}, {{notice_period}}, or ANY placeholder not in the supported list above.
   
   If you need a value that doesn't have a supported placeholder, write it as plain text or omit it.

3. NO MARKDOWN FORMATTING
   - Do NOT use ##, ###, or any Markdown syntax
   - Do NOT use bullet points with * or -
   - Use plain text with clear paragraph breaks
   - Use numbered clauses if appropriate (1., 2., 3.)

4. GROUNDING REQUIREMENTS
   - Generate clauses ONLY from the RETRIEVED SOURCES below
   - Never invent labor law articles, legal obligations, mandatory benefits, penalties, or policies
   - Every clause MUST cite at least one retrieved source id in source_ids
   - category must reflect grounding: "labor_law", "company_policy", or "mixed"
   - COMPANY CONTEXT may inform phrasing but is NOT a legal source on its own

5. DOCUMENT TYPE AWARENESS
   - Generate ONLY clauses relevant to "${documentType}"
   - Do not generate employment-contract clauses for a warning or termination letter

6. QUALITY STANDARDS
   - Do not include source citations, source names, or meta-language inside clause text
   - Generate between 3 and 8 clauses when support allows
   - Each clause should be self-contained and insertion-ready
   - If a topic cannot be supported by sources, omit it or return support="insufficient_source_support"

COMPANY CONTEXT (auxiliary only, NOT a legal source)
${compactJson(companyContext || {})}

RETRIEVED SOURCES
${compactJson(sources.map((s) => ({ id: s.id, type: s.type, title: s.title, content: s.content })))}
`;

const validateClause = (clause, availableSourceIds) => {
  if (clause.support !== "supported") return false;
  const content = clause.content?.trim();
  if (!content) return false;
  if (content.length > MAX_CLAUSE_CHARACTERS) return false;
  if (!Array.isArray(clause.source_ids) || clause.source_ids.length === 0) return false;
  if (clause.source_ids.some((id) => !availableSourceIds.has(id))) return false;
  if (/<\s*(html|body|h1)\b/i.test(content)) return false;
  if (/(according to the ai|retrieved documents|provided sources|as an ai|source id|citation)/i.test(content)) return false;
  
  // Detect unsupported placeholders
  const placeholderPattern = /\{\{([a-z_]+)\}\}/g;
  const matches = [...content.matchAll(placeholderPattern)];
  for (const match of matches) {
    const placeholderKey = match[1];
    if (!SUPPORTED_PLACEHOLDERS.has(placeholderKey)) {
      // Reject clause with unsupported placeholder
      return false;
    }
  }
  
  // Detect Markdown headings (##, ###)
  if (/^#{1,6}\s+/m.test(content)) {
    return false;
  }
  
  return true;
};

export async function suggestTemplateClauses({
  templateId,
  documentType,
  templateName,
  language = "en",
  includeLaborLaw = true,
  includeCompanyPolicy = true,
  instruction,
  aiContext, // trusted { userId, companyId, role } from requireInternalAuth
}) {
  const companyId = aiContext.companyId; // ALWAYS the trusted value
  const allSources = [];
  const sourcesById = new Map();
  const addSources = (sources) => {
    for (const source of sources) {
      if (!sourcesById.has(source.id)) {
        sourcesById.set(source.id, source);
        allSources.push(source);
      }
    }
  };

  if (includeLaborLaw) {
    try {
      const laborLaw = await retrieveForType({
        knowledgeType: "labor-law", companyId, documentType, instruction, language,
      });
      addSources(laborLaw.sources);
    } catch (error) {
      logger.error(`[TemplateClauses] labor-law retrieval failed: ${error.message}`);
      throw createDomainError("RAG_RETRIEVAL_FAILED", "Could not retrieve labor law knowledge.", 502);
    }
  }

  if (includeCompanyPolicy) {
    try {
      const companyPolicy = await retrieveForType({
        knowledgeType: "company-policy", companyId, documentType, instruction, language,
      });
      addSources(companyPolicy.sources);
    } catch (error) {
      // A company with no ingested policy is a normal case, not a failure.
      logger.warn(`[TemplateClauses] company-policy retrieval unavailable: ${error.message}`);
    }
  }

  if (allSources.length === 0) {
    return {
      success: false,
      clauses: [],
      message: "No sufficiently relevant legal or company-policy sources were found.",
    };
  }

  // Company context is auxiliary flavor only — failure here must never block generation.
  let companyContext = null;
  try {
    companyContext = await getCompanyContext(aiContext);
  } catch (error) {
    logger.warn(`[TemplateClauses] Company context unavailable, continuing: ${error.message}`);
  }

  let output;
  try {
    output = await getClauseLlm().invoke(buildPrompt({
      documentType, templateName, instruction, language, sources: allSources, companyContext,
    }));
    output = ClauseSuggestionsOutputSchema.parse(output);
  } catch (error) {
    logger.error(`[TemplateClauses] Clause generation failed: ${error.message}`);
    throw createDomainError("CLAUSE_GENERATION_FAILED", "Could not generate clause suggestions.", 502);
  }

  const availableSourceIds = new Set(allSources.map((source) => source.id));
  const clauses = output.clauses
    .filter((clause) => validateClause(clause, availableSourceIds))
    .map((clause, index) => ({
      id: `generated-${index + 1}-${crypto.randomUUID()}`,
      title: clause.title.trim(),
      content: clause.content.trim(),
      category: clause.category,
      language,
      sources: [...new Set(clause.source_ids)]
        .map((sourceId) => sourcesById.get(sourceId))
        .filter(Boolean)
        .map((source) => ({
          id: source.id,
          title: source.title ?? null,
          type: source.type ?? null, // "labor-law" | "company-policy"
          score: source.metadata?.similarityScore ?? null,
          metadata: source.metadata ?? {}, // preserved as-is, nothing invented
        })),
    }));

  logger.info(
    `[TemplateClauses] templateId=${templateId} generated=${output.clauses.length} accepted=${clauses.length}`,
  );

  if (clauses.length === 0) {
    return {
      success: false,
      clauses: [],
      message: "No sufficiently relevant legal or company-policy sources were found.",
    };
  }

  return { success: true, clauses };
}
