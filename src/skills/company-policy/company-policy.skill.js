import { z } from "zod";
import { createLLM } from "../../llm/llm-provider.js";
import { config, llmConfig } from "../../config/env.js";
import { logger } from "../../shared/logger.js";
import { retrieveKnowledge } from "../../rag/retrieval/knowledge-retrieval.service.js";

export const companyPolicyInputSchema = z.object({
  message: z.string().describe("The user's policy question"),
});

const llm = createLLM({
  ...llmConfig,
  temperature: 0,
});

/**
 * Company Policy AI Skill
 */
const companyPolicySkill = {
  name: "company_policy",
  description:
    "Answers questions about the company's internal policies and handbook using strictly retrieved sources.",
  inputSchema: companyPolicyInputSchema,

  /**
   * Executes the company policy skill.
   * @param {string} message - The raw user message.
   * @param {import("../../contracts/index.js").AIContext} context - The user context.
   * @returns {Promise<import("../../contracts/index.js").SkillResult>}
   */
  async execute(message, context) {
    logger.info(
      `[CompanyPolicySkill] Executing company policy skill for message: "${message}"`,
    );
    try {
      if (!context || !context.companyId) {
        throw new Error(
          "Missing companyId in context. Cannot retrieve company policy.",
        );
      }

      logger.info(
        `[CompanyPolicySkill] Retrieving company-policy knowledge chunks for company ${context.companyId}`,
      );
      const retrievalResult = await retrieveKnowledge({
        query: message,
        context: {
          knowledgeType: "company-policy",
          companyId: context.companyId,
          topK: 5,
        },
      });

      const { chunks, sources } = retrievalResult;

      if (!chunks || chunks.length === 0) {
        logger.warn(
          `[CompanyPolicySkill] No relevant company-policy chunks retrieved.`,
        );
        return {
          success: true,
          data: {
            answer: "No company policy has been uploaded yet.",
          },
          message: null,
          sources: [],
          action: null,
        };
      }

      // Deduplicate and compact chunks for token efficiency
      const seen = new Set();
      const uniqueChunks = chunks.filter((c) => {
        const key = `${c.title}::${c.content?.slice(0, 80)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      logger.info(
        `[CompanyPolicySkill] Retrieved ${chunks.length} chunks (${uniqueChunks.length} unique). Prompting LLM.`,
      );

      const formattedContext = uniqueChunks
        .map((c) => `[Source: ${c.title}]\n${c.content?.trim().replace(/\n{3,}/g, "\n\n")}`)
        .join("\n\n");

      const prompt = `You are an HR assistant for the company.
Answer the user's question using ONLY the provided company policy context below.
Do not invent company policies.
Do not infer a company policy that is not supported by the context.
Do not mix general or Egyptian labor law into the answer unless the retrieved context explicitly contains it. Clearly distinguish company policy from general labor law.
If no relevant company policy exists in the context, explicitly state that no relevant company-specific policy was found.
Do not expose internal retrieval mechanics or use meta-language.

Context:
${formattedContext}

User Question: "${message}"`;

      const response = await llm.invoke(prompt);

      return {
        success: true,
        data: {
          answer: response.content,
        },
        message: null,
        sources,
        action: null,
      };
    } catch (error) {
      logger.error(
        `[CompanyPolicySkill] Failed to execute company policy skill: ${error.message}`,
      );
      return {
        success: false,
        data: null,
        message:
          "An error occurred while attempting to retrieve or process company policy information.",
        sources: [],
        action: null,
      };
    }
  },
};

export default companyPolicySkill;
