import { config, llmConfig } from "./src/config/env.js";
import { ITILanguageModel } from "./src/llm/iti-adapter.js";

async function runTest() {
  console.log("==========================================");
  console.log("LLM Connectivity Test");
  console.log("==========================================");
  console.log(`Model: ${config.LLM_MODEL}`);
  console.log(`Base URL: ${config.LLM_BASE_URL}`);
  
  if (!config.LLM_BASE_URL) {
    console.error("❌ ERROR: LLM_BASE_URL is not set or invalid.");
    process.exit(1);
  }
  
  const llm = new ITILanguageModel();
  
  console.log("Sending 'hello' to LLM...");
  
  try {
    const start = Date.now();
    const result = await llm.invoke("hello");
    console.log(`✅ Success in ${Date.now() - start}ms`);
    console.log("Response:", result);
  } catch (err) {
    console.error("❌ Fetch failed:", err.message);
    process.exit(1);
  }
}

runTest();
