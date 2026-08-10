const splitLongTextByWords = (text, chunkSize) => {
  const chunks = [];
  const words = text.split(/\s+/).filter(Boolean);
  let current = "";

  for (const word of words) {
    if (word.length > chunkSize) {
      if (current) {
        chunks.push(current);
        current = "";
      }

      for (let index = 0; index < word.length; index += chunkSize) {
        chunks.push(word.slice(index, index + chunkSize));
      }
      continue;
    }

    const next = current ? `${current} ${word}` : word;
    if (next.length <= chunkSize) {
      current = next;
      continue;
    }

    if (current) {
      chunks.push(current);
    }
    current = word;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
};

const splitParagraphIntoSegments = (paragraph, chunkSize) => {
  const sentences = paragraph.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [paragraph];
  const segments = [];
  let current = "";

  for (const sentence of sentences) {
    const cleanSentence = sentence.trim();
    if (!cleanSentence) {
      continue;
    }

    if (cleanSentence.length > chunkSize) {
      if (current) {
        segments.push(current);
        current = "";
      }
      segments.push(...splitLongTextByWords(cleanSentence, chunkSize));
      continue;
    }

    const next = current ? `${current} ${cleanSentence}` : cleanSentence;
    if (next.length <= chunkSize) {
      current = next;
      continue;
    }

    if (current) {
      segments.push(current);
    }
    current = cleanSentence;
  }

  if (current) {
    segments.push(current);
  }

  return segments;
};

/**
 * Splits text into deterministic retrieval-friendly chunks while preserving
 * paragraph and sentence boundaries where practical.
 *
 * @param {string} content
 * @param {Object} options
 * @param {number} options.chunkSize
 * @returns {Array<string>}
 */
export const chunkDocumentContent = (content, { chunkSize }) => {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error("chunkSize must be a positive integer");
  }

  const normalizedContent = content.replace(/\r\n/g, "\n").trim();
  if (!normalizedContent) {
    return [];
  }

  const paragraphs = normalizedContent
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const segments = paragraphs.flatMap((paragraph) => (
    paragraph.length <= chunkSize
      ? [paragraph]
      : splitParagraphIntoSegments(paragraph, chunkSize)
  ));

  const chunks = [];
  let current = "";

  for (const segment of segments) {
    const next = current ? `${current}\n\n${segment}` : segment;
    if (next.length <= chunkSize) {
      current = next;
      continue;
    }

    if (current) {
      chunks.push(current);
    }
    current = segment;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks.filter((chunk) => chunk.trim().length > 0);
};

