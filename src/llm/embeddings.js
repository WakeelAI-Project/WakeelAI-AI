import { OpenAIEmbeddings } from "@langchain/openai";
import { config } from "../config/env.js";

let embeddingsClient;

const getEmbeddingsClient = () => {
  if (!embeddingsClient) {
    embeddingsClient = new OpenAIEmbeddings({
      apiKey: config.EMBEDDING_API_KEY,
      openAIApiKey: config.EMBEDDING_API_KEY,
      model: config.EMBEDDING_MODEL,
      modelName: config.EMBEDDING_MODEL,
    });
  }

  return embeddingsClient;
};

/**
 * Generates one embedding vector for a single text chunk.
 *
 * @param {string} text
 * @returns {Promise<Array<number>>}
 */
export const generateEmbedding = async (text) => {
  const embeddings = await getEmbeddingsClient().embedDocuments([text]);
  return embeddings[0];
};

