import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { config } from "../config/env.js";

export const LegalClauseGenerationOutputSchema = z.object({
  support: z.enum(["supported", "insufficient_source_support"]),
  clause: z.string(),
  source_ids: z.array(z.string()),
}).strict();

let legalClauseLlm;

const getLegalClauseLlm = () => {
  if (!legalClauseLlm) {
    const llm = new ChatOpenAI({
      apiKey: config.LLM_API_KEY,
      modelName: config.LLM_MODEL,
      temperature: 0,
    });

    legalClauseLlm = llm.withStructuredOutput(LegalClauseGenerationOutputSchema, {
      name: "generate_rag_grounded_legal_clause",
    });
  }

  return legalClauseLlm;
};

const compactJson = (value) => JSON.stringify(value, null, 2);

export const buildLegalClausePrompt = ({
  clause,
  documentType,
  documentValues,
  companyContext,
  employeeContext,
  chunks,
  sources,
}) => `
You are generating exactly one clause for an HR document.

You must generate this clause only from the provided retrieved sources. Do not rely on unsupported legal assumptions. If the retrieved sources do not contain sufficient information to safely generate the requested clause, do not invent the missing rule.

Rules:
- Generate only the requested clause, not the full document.
- Preserve user-provided document values; do not replace salary, employee name, job title, dates, or IDs.
- Treat the template as the document structure; do not rewrite template sections.
- Do not include citations inside the clause text. Return source IDs only in source_ids.
- Do not use meta-language such as "the retrieved documents say" or "according to the AI".
- If support is insufficient, return support="insufficient_source_support", clause="", and source_ids=[].

DOCUMENT CONTEXT
${compactJson({
  document_type: documentType,
  user_provided_values: documentValues,
})}

COMPANY CONTEXT
${compactJson(companyContext || {})}

EMPLOYEE CONTEXT
${compactJson(employeeContext || {})}

REQUESTED CLAUSE
${compactJson(clause)}

RETRIEVED SOURCES
${compactJson({
  chunks,
  sources,
})}
`;

/**
 * Generates one RAG-grounded legal/company-policy clause.
 *
 * @param {Object} input
 * @returns {Promise<z.infer<typeof LegalClauseGenerationOutputSchema>>}
 */
export async function generateLegalClause(input) {
  const result = await getLegalClauseLlm().invoke(buildLegalClausePrompt(input));
  return LegalClauseGenerationOutputSchema.parse(result);
}
