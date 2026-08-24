import { logger } from "../shared/logger.js";
import { searchEmployeesByNameApi } from "../integrations/wakeel/employee-api.js";
import {
  normalizeArabic,
  areArabicNamesEquivalent,
  generateArabicSearchVariations,
} from "../shared/arabic-utils.js";
import * as chatHistoryRepository from "../data-access/chat-history.repository.js";

const TARGETING_ROLES = new Set([
  "HR_Manager",
  "Owner",
  "Company_Owner",
  "CompanyOwner",
  "Admin",
]);

// Words that should not be treated as employee names
const NON_NAME_TOKENS = new Set([
  "this employee",
  "the employee",
  "that employee",
  "same employee",
  "him",
  "her",
  "them",
  "me",
  "myself",
  "company",
  "the company",
  "our company",
  "policy",
  "the policy",
  "leave",
  "annual leave",
  "contract",
  "labor law",
  "egyptian labor law",
  "الموظف",
  "الموظفة",
  "الموظفه",
  "الموظف ده",
  "الموظفة دي",
  "الموظفه دي",
  "هذا الموظف",
  "هذه الموظفة",
  "هذه الموظفه",
  "نفس الموظف",
  "نفس الموظفة",
  "نفس الموظفه",
  "هو",
  "هي",
  "ده",
  "دي",
  "له",
  "لها",
  "ليه",
  "ليها",
  "عنه",
  "عنها",
  "الشركة",
  "شركتنا",
  "قانون العمل",
  "قانون العمل المصري",
  "الاجازات",
  "الإجازات",
  "الاجازة السنوية",
  "الإجازة السنوية",
  "عقد",
  "العقد",
]);

/**
 * Checks if the user's role permits targeting another employee.
 *
 * @param {string} role
 * @returns {boolean}
 */
export function canTargetEmployee(role = "") {
  return TARGETING_ROLES.has(role);
}

/**
 * Checks if a message contains pronouns or demonstrative references pointing to an existing employee context.
 *
 * @param {string} message
 * @returns {boolean}
 */
export function hasEmployeePronounOrReference(message = "") {
  if (!message || typeof message !== "string") return false;

  const normalized = message.toLowerCase().trim();

  // English pronouns and demonstrative references
  const englishMatches =
    /\b(her|him|she|he|his|hers|this employee|that employee|the employee|same employee|for her|for him|about her|about him)\b/i.test(
      normalized,
    );
  if (englishMatches) return true;

  // Normalized Arabic text for Unicode matching
  const normAr = normalizeArabic(message);

  // Filter out question phrases like "ما هو", "ما هي", "ايه هو", "ايه هي", "من هو", "من هي"
  const strippedQuestionAr = normAr
    .replace(/(?:^|\s)(?:ما|ايه|ماذا|من|ماهو|ماهي)\s+(?:هو|هي)(?=\s|$|[.,?!])/gi, " ")
    .trim();

  // Demonstratives and attached pronouns in Arabic
  const arabicReferences =
    /(?:^|\s)(?:هذا الموظف|هذه الموظفه|الموظف ده|الموظفه دي|نفس الموظف|نفس الموظفه|له|لها|ليه|ليها|عنه|عنها|معه|معها|منه|منها|مرتبه|مرتبها|راتبه|راتبها|بياناته|بياناتها|اجازاته|اجازاتها|عقده|عقدها|ورقه|ورقها|ملفه|ملفها)(?:$|\s|[.,?!])/i.test(
      normAr,
    );

  if (arabicReferences) return true;

  // Standalone pronoun (after stripping interrogatives)
  const standalonePronoun = /(?:^|\s)(?:هو|هي|ده|دي)(?:$|\s|[.,?!])/i.test(
    strippedQuestionAr,
  );

  return standalonePronoun;
}

/**
 * Extracts a candidate employee name from free-form user message (Arabic or English).
 *
 * @param {string} message
 * @returns {string|null}
 */
export function extractCandidateEmployeeName(message = "") {
  if (!message || typeof message !== "string") return null;

  const cleanMessage = message.trim();

  // Arabic name extraction patterns
  const arabicPrefixPatterns = [
    /(?:تعرف\s+(?:ايه\s+)?عن|ماذا\s+تعرف\s+عن|قولي\s+(?:معلومات\s+)?عن|عايز\s+معلومات\s+عن|هات\s+بيانات|بيانات\s+الموظف[ةه]?|معلومات\s+الموظف[ةه]?|معلومات\s+عن|مين\s+هو|مين\s+هي|عقد\s+عمل|عقد|انشئ\s+عقد(?:\s+عمل)?|أنشئ\s+عقد(?:\s+عمل)?|اعمل\s+عقد(?:\s+عمل)?|اعملي\s+عقد(?:\s+عمل)?|اكتب\s+عقد(?:\s+عمل)?|جهز\s+عقد(?:\s+عمل)?|خطاب\s+انذار|خطاب\s+إنذار|انذار|إنذار|خطاب\s+انهاء\s+خدمة|خطاب\s+إنهاء\s+خدمة|انهاء\s+خدمة|إنهاء\s+خدمة)(?:\s+(?:لـ?|عن|بخصوص))?\s*([^\n,?.!]+)/iu,
  ];

  for (const pattern of arabicPrefixPatterns) {
    const match = cleanMessage.match(pattern);
    if (match?.[1]) {
      let candidate = match[1]
        .replace(/\s+(?:شغال[ةه]?|مرتبها|مرتبه|كام|عنده|عندها|في|مع|من|لو|علشان|عشان).*$/iu, "")
        .trim();
      // Strip leading attached preposition 'لـ' or 'ل' (e.g. 'لفريدة' -> 'فريدة', 'لنورهان' -> 'نورهان')
      if (/^ل[\u0621-\u064A]/.test(candidate) && candidate.length > 2) {
        const withoutLam = candidate.replace(/^لـ?/, "").trim();
        const normWithoutLam = normalizeArabic(withoutLam.toLowerCase());
        if (withoutLam.length >= 2 && !NON_NAME_TOKENS.has(normWithoutLam)) {
          candidate = withoutLam;
        }
      }
      const normCandidate = normalizeArabic(candidate.toLowerCase());
      if (candidate.length >= 2 && !NON_NAME_TOKENS.has(normCandidate) && !NON_NAME_TOKENS.has(candidate.toLowerCase())) {
        return candidate;
      }
    }
  }

  // Arabic reverse patterns (e.g. "فريدة مرتبها كام", "نورهان شغالة ايه")
  const arabicReversePatterns = [
    /^([^\n,?.!]+?)\s+(?:شغال[ةه]?\s+ايه|مرتبها\s+كام|مرتبه\s+كام|كام\s+مرتبها|كام\s+مرتبه|عندها\s+كام\s+يوم|عنده\s+كام\s+يوم|رصيد\s+اجازاتها|رصيد\s+اجازاته|رصيد\s+إجازاتها|رصيد\s+إجازاته)$/iu,
  ];

  for (const pattern of arabicReversePatterns) {
    const match = cleanMessage.match(pattern);
    if (match?.[1]) {
      let candidate = match[1].trim();
      if (/^ل[\u0621-\u064A]/.test(candidate) && candidate.length > 2) {
        const withoutLam = candidate.replace(/^لـ?/, "").trim();
        const normWithoutLam = normalizeArabic(withoutLam.toLowerCase());
        if (withoutLam.length >= 2 && !NON_NAME_TOKENS.has(normWithoutLam)) {
          candidate = withoutLam;
        }
      }
      const normCandidate = normalizeArabic(candidate.toLowerCase());
      if (candidate.length >= 2 && !NON_NAME_TOKENS.has(normCandidate) && !NON_NAME_TOKENS.has(candidate.toLowerCase())) {
        return candidate;
      }
    }
  }

  // English name extraction patterns
  const englishPrefixPatterns = [
    /\b(?:what\s+do\s+you\s+know\s+about|tell\s+me\s+about|who\s+is|info\s+about|information\s+about|details\s+about|profile\s+of|contract\s+for|employment\s+contract\s+for|warning\s+letter\s+for|termination\s+letter\s+for|draft\s+a\s+contract\s+for|create\s+a\s+contract\s+for|generate\s+a\s+contract\s+for)\s+([^,.;\n?]+)/i,
  ];

  for (const pattern of englishPrefixPatterns) {
    const match = cleanMessage.match(pattern);
    if (match?.[1]) {
      const candidate = match[1]
        .replace(/\s+(?:as|with|starting|start|salary|who|whose|which|in|at|and).*$/i, "")
        .trim();
      if (candidate.length >= 2 && !NON_NAME_TOKENS.has(candidate.toLowerCase())) {
        return candidate;
      }
    }
  }

  return null;
}

/**
 * Resolves the target employee from user message, conversation context, or name search.
 * Enforces company-scoped security via searchEmployeesByNameApi and updates the conversation state.
 *
 * @param {Object} params
 * @param {string} params.message
 * @param {import("../contracts/index.js").AIContext} params.userContext
 * @param {string} [params.conversationId]
 * @returns {Promise<{ resolved: boolean, targetEmployeeId?: string, targetEmployeeName?: string, userContext: Object, candidateMatches?: Array }>}
 */
export async function resolveTargetEmployee({ message, userContext, conversationId }) {
  const effectiveContext = { ...userContext };

  if (!canTargetEmployee(userContext?.role)) {
    return {
      resolved: Boolean(userContext?.targetEmployeeId),
      targetEmployeeId: userContext?.targetEmployeeId || null,
      targetEmployeeName: userContext?.targetEmployeeName || null,
      userContext: effectiveContext,
    };
  }

  const candidateName = extractCandidateEmployeeName(message);

  if (candidateName) {
    logger.info(
      `[EmployeeResolver] Extracted candidate employee name="${candidateName}" for companyId=${userContext?.companyId}`,
    );

    try {
      // 1. Search backend for exact candidate name
      let searchResult = await searchEmployeesByNameApi(userContext, candidateName);
      let matches = searchResult?.employees || [];
      logger.info(`[EmployeeResolver] Initial search for "${candidateName}" returned ${matches.length} matches. searchResult=${JSON.stringify(searchResult)}`);

      // 2. If no matches and name is Arabic, search with spelling variations (e.g. ة <-> ه, أ <-> ا)
      if (matches.length === 0) {
        const variations = generateArabicSearchVariations(candidateName);
        for (const variation of variations) {
          if (variation === candidateName) continue;
          try {
            const varResult = await searchEmployeesByNameApi(userContext, variation);
            if (varResult?.employees?.length > 0) {
              matches = varResult.employees;
              break;
            }
          } catch (e) {
            // continue trying variations
          }
        }
      }

      logger.info(
        `[EmployeeResolver] Found ${matches.length} matching employee(s) for "${candidateName}"`,
      );

      if (matches.length === 1) {
        const matched = matches[0];
        effectiveContext.targetEmployeeId = matched.employee_id;
        effectiveContext.targetEmployeeName = matched.full_name;

        // Persist target employee to conversation if conversationId is provided
        if (conversationId && userContext?.userId && userContext?.companyId) {
          try {
            await chatHistoryRepository.upsertConversation({
              conversationId,
              userId: userContext.userId,
              companyId: userContext.companyId,
              role: userContext.role,
              targetEmployeeId: matched.employee_id,
              targetEmployeeName: matched.full_name,
            });
          } catch (err) {
            logger.warn(`[EmployeeResolver] Failed to persist target employee to conversation: ${err.message}`);
          }
        }

        return {
          resolved: true,
          targetEmployeeId: matched.employee_id,
          targetEmployeeName: matched.full_name,
          userContext: effectiveContext,
          candidateMatches: matches,
        };
      }

      if (matches.length > 1) {
        // Try exact normalized match
        const exactMatch = matches.find((m) =>
          areArabicNamesEquivalent(m.full_name, candidateName),
        );

        if (exactMatch) {
          effectiveContext.targetEmployeeId = exactMatch.employee_id;
          effectiveContext.targetEmployeeName = exactMatch.full_name;

          if (conversationId && userContext?.userId && userContext?.companyId) {
            try {
              await chatHistoryRepository.upsertConversation({
                conversationId,
                userId: userContext.userId,
                companyId: userContext.companyId,
                role: userContext.role,
                targetEmployeeId: exactMatch.employee_id,
                targetEmployeeName: exactMatch.full_name,
              });
            } catch (err) {
              logger.warn(`[EmployeeResolver] Failed to persist target employee: ${err.message}`);
            }
          }

          return {
            resolved: true,
            targetEmployeeId: exactMatch.employee_id,
            targetEmployeeName: exactMatch.full_name,
            userContext: effectiveContext,
            candidateMatches: matches,
          };
        }

        return {
          resolved: false,
          userContext: effectiveContext,
          candidateMatches: matches,
        };
      }
    } catch (error) {
      logger.error(`[EmployeeResolver] Employee lookup failed for "${candidateName}": ${error.message}`);
    }
  }

  // If no new name was extracted, check if message uses pronouns or demonstratives
  if (hasEmployeePronounOrReference(message)) {
    if (userContext?.targetEmployeeId) {
      logger.info(
        `[EmployeeResolver] Pronoun/reference detected. Retaining targetEmployeeId=${userContext.targetEmployeeId} (${userContext.targetEmployeeName || "unnamed"})`,
      );
      return {
        resolved: true,
        targetEmployeeId: userContext.targetEmployeeId,
        targetEmployeeName: userContext.targetEmployeeName || null,
        userContext: effectiveContext,
      };
    }
  }

  return {
    resolved: Boolean(userContext?.targetEmployeeId),
    targetEmployeeId: userContext?.targetEmployeeId || null,
    targetEmployeeName: userContext?.targetEmployeeName || null,
    userContext: effectiveContext,
  };
}
