import { z } from "zod";
import { createLLM } from "../../llm/llm-provider.js";
import { config, llmConfig } from "../../config/env.js";
import { logger } from "../../shared/logger.js";
import { retrieveKnowledge } from "../../rag/retrieval/knowledge-retrieval.service.js";

export const laborLawInputSchema = z.object({
  message: z.string().describe("The user's legal question"),
});

const llm = createLLM({
  ...llmConfig,
  temperature: 0,
});

/**
 * Labor Law AI Skill
 */
const laborLawSkill = {
  name: "labor_law",
  description:
    "Answers questions about Egyptian labor law using strictly retrieved legal sources.",
  inputSchema: laborLawInputSchema,

  /**
   * Executes the labor law skill.
   * @param {string} message - The raw user message.
   * @param {import("../../contracts/index.js").AIContext} context - The user context.
   * @returns {Promise<import("../../contracts/index.js").SkillResult>}
   */
  async execute(message, context) {
    logger.info(
      `[LaborLawSkill] Executing labor law skill for message: "${message}"`,
    );
    try {
      logger.info(`[LaborLawSkill] Retrieving labor-law knowledge chunks`);
      const retrievalResult = await retrieveKnowledge({
        query: message,
        context: {
          knowledgeType: "labor-law",
        },
      });

      const { chunks, sources } = retrievalResult;

      if (!chunks || chunks.length === 0) {
        logger.warn(`[LaborLawSkill] No relevant labor-law chunks retrieved.`);
        return {
          success: true,
          data: {
            answer: "No relevant legal support was found for this question.",
          },
          message: null,
          sources: [],
          action: null,
        };
      }

      logger.info(
        `[LaborLawSkill] Retrieved ${chunks.length} chunks. Prompting LLM.`,
      );

      const formattedContext = chunks
        .map((c) => `[Source: ${c.title}]\n${c.content}`)
        .join("\n\n");

      const prompt = `You are a legal assistant for Egyptian Labor Law.
Answer the user's question using ONLY the provided legal context below.
Do not invent legal requirements, article numbers, or citations.
Do not rely on your general knowledge.
If the retrieved context is insufficient to answer the question, clearly state that sufficient legal support was not found.
Do not expose internal retrieval mechanics or use meta-language like "the AI thinks" or "the retrieved context says".

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
        `[LaborLawSkill] Failed to execute labor law skill: ${error.message}`,
      );
      return {
        success: false,
        data: null,
        message:
          "An error occurred while attempting to retrieve or process labor law information.",
        sources: [],
        action: null,
      };
    }
  },
};

export default laborLawSkill;
