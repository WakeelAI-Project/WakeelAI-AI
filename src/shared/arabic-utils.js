/**
 * Arabic Text and Name Utilities
 * Provides Unicode-safe Arabic normalization, pronoun detection, and variation generation.
 */

// Diacritics (tashkeel) regex: Fatha, Damma, Kasra, Sukun, Shadda, Tanween, etc.
const TASHKEEL_REGEX = /[\u064B-\u065F\u0670]/g;

// Tatweel / Kashida (ـ)
const TATWEEL_REGEX = /\u0640/g;

/**
 * Normalizes Arabic text for semantic matching and comparison:
 * - Strips tashkeel (diacritics)
 * - Strips tatweel (kashida)
 * - Normalizes Alef forms (أ, إ, آ, ٱ) -> ا
 * - Normalizes Teh Marbuta (ة) -> ه
 * - Normalizes Alef Maksura (ى) -> ي
 * - Trims and normalizes multiple whitespace
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizeArabic(text = "") {
  if (typeof text !== "string") return "";

  return text
    .replace(TASHKEEL_REGEX, "")
    .replace(TATWEEL_REGEX, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[\u200B-\u200D\uFEFF]/g, "") // Zero-width characters
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Checks if a string contains any Arabic Unicode characters.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function containsArabic(text = "") {
  if (typeof text !== "string") return false;
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
}

/**
 * Compares two names (Arabic or English) for loose equivalence.
 *
 * @param {string} name1
 * @param {string} name2
 * @returns {boolean}
 */
export function areArabicNamesEquivalent(name1 = "", name2 = "") {
  if (!name1 || !name2) return false;

  const n1 = normalizeArabic(name1.toLowerCase());
  const n2 = normalizeArabic(name2.toLowerCase());

  if (n1 === n2) return true;
  if (n1.includes(n2) || n2.includes(n1)) return true;

  // Compare individual name tokens (e.g. "Ahmed" in "Ahmed Hassan")
  const tokens1 = n1.split(/\s+/).filter((t) => t.length >= 2);
  const tokens2 = n2.split(/\s+/).filter((t) => t.length >= 2);

  return tokens1.some((t1) => tokens2.includes(t1));
}

/**
 * Generates common Arabic spelling variations for database search.
 * For example: "فريدة" -> ["فريدة", "فريده"]
 * "احمد" -> ["احمد", "أحمد", "إحمد"]
 *
 * @param {string} name
 * @returns {string[]}
 */
export function generateArabicSearchVariations(name = "") {
  if (!name || typeof name !== "string") return [];

  const raw = name.trim();
  const variations = new Set([raw]);

  // Teh Marbuta <-> Heh variations
  if (raw.includes("ة")) {
    variations.add(raw.replace(/ة/g, "ه"));
  }
  if (raw.includes("ه")) {
    variations.add(raw.replace(/ه/g, "ة"));
  }

  // Alef variations (ا, أ, إ, آ)
  if (/[اأإآ]/.test(raw)) {
    variations.add(raw.replace(/[أإآ]/g, "ا"));
    variations.add(raw.replace(/ا/g, "أ"));
    variations.add(raw.replace(/ا/g, "إ"));
  }

  // Yeh <-> Alef Maksura (ي <-> ى)
  if (raw.includes("ي")) {
    variations.add(raw.replace(/ي/g, "ى"));
  }
  if (raw.includes("ى")) {
    variations.add(raw.replace(/ى/g, "ي"));
  }

  return [...variations];
}
