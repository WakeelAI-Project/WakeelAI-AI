import { HuggingFaceInferenceEmbeddings } from "@langchain/community/embeddings/hf";
import { config } from "../config/env.js";

let embeddingsClient;

const getEmbeddingsClient = () => {
  if (!embeddingsClient) {
    embeddingsClient = new HuggingFaceInferenceEmbeddings({
      apiKey: config.HUGGINGFACE_API_KEY,
      model: config.EMBEDDING_MODEL,
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
  const vector = embeddings[0];
  
  if (!Array.isArray(vector) || vector.length !== 1024) {
    throw new Error(`Invalid embedding dimension. Expected 1024, got ${vector?.length}`);
  }
  
  return vector;
};

/**
 * Generates multiple embedding vectors for multiple text chunks.
 *
 * @param {Array<string>} texts
 * @returns {Promise<Array<Array<number>>>}
 */
export const generateEmbeddings = async (texts) => {
  if (!Array.isArray(texts) || texts.length === 0) return [];
  
  const embeddings = await getEmbeddingsClient().embedDocuments(texts);
  
  const invalidEmbeddingIndex = embeddings.findIndex(
    (vector) => !Array.isArray(vector) || vector.length !== 1024
  );
  
  if (invalidEmbeddingIndex !== -1) {
    throw new Error(`Invalid embedding dimension at index ${invalidEmbeddingIndex}. Expected 1024, got ${embeddings[invalidEmbeddingIndex]?.length}`);
  }
  
  return embeddings;
};
