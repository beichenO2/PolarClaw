/**
 * PII (Personally Identifiable Information) detection and variable substitution.
 *
 * Strategy: regex-based detection for common Chinese/English PII patterns.
 * Each detected entity is replaced with a numbered placeholder ($PHONE_1, $NAME_1, etc.)
 * and a reverse mapping is kept for de-substitution.
 */

const PII_PATTERNS = [
  { type: "PHONE", regex: /(?<!\d)1[3-9]\d{9}(?!\d)/g },
  { type: "ID_CARD", regex: /(?<!\d)\d{6}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)/g },
  { type: "EMAIL", regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  { type: "BANK_CARD", regex: /(?<!\d)\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}(?:\d{0,3})?(?!\d)/g },
  { type: "IP_ADDR", regex: /(?<!\d)(?:(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})(?!\d)/g },
];

/**
 * @typedef {{ type: string; original: string; placeholder: string }} PiiEntity
 */

/**
 * @typedef {{ sanitized: string; entities: PiiEntity[]; vault: Map<string, string> }} SanitizeResult
 */

/**
 * Detect and replace PII in text. Returns sanitized text + a vault for reversal.
 * @param {string} text
 * @param {Map<string, string>} [existingVault] - reuse an existing vault for consistent naming
 * @returns {SanitizeResult}
 */
export function sanitizePii(text, existingVault) {
  /** @type {Map<string, string>} */
  const vault = existingVault ?? new Map();
  /** @type {Map<string, number>} */
  const counters = new Map();
  /** @type {PiiEntity[]} */
  const entities = [];

  const reverseVault = new Map();
  for (const [placeholder, original] of vault) {
    reverseVault.set(original, placeholder);
  }

  let sanitized = text;

  for (const { type, regex } of PII_PATTERNS) {
    sanitized = sanitized.replace(regex, (match) => {
      if (reverseVault.has(match)) {
        return reverseVault.get(match);
      }
      const count = (counters.get(type) ?? 0) + vault.size + 1;
      counters.set(type, (counters.get(type) ?? 0) + 1);
      const placeholder = `$${type}_${count}`;
      vault.set(placeholder, match);
      reverseVault.set(match, placeholder);
      entities.push({ type, original: match, placeholder });
      return placeholder;
    });
  }

  return { sanitized, entities, vault };
}

/**
 * Register custom named entities for substitution (e.g., user-provided names).
 * @param {string} text
 * @param {Array<{ value: string; type?: string }>} customEntities
 * @param {Map<string, string>} [existingVault]
 * @returns {SanitizeResult}
 */
export function sanitizeWithCustomEntities(text, customEntities, existingVault) {
  const vault = existingVault ?? new Map();
  const entities = /** @type {PiiEntity[]} */ ([]);
  let sanitized = text;

  for (const ce of customEntities) {
    const type = ce.type ?? "NAME";
    if (!ce.value || !ce.value.trim()) continue;

    let existingPlaceholder = null;
    for (const [p, o] of vault) {
      if (o === ce.value) {
        existingPlaceholder = p;
        break;
      }
    }

    if (!existingPlaceholder) {
      let n = 1;
      while (vault.has(`$${type}_${n}`)) n++;
      existingPlaceholder = `$${type}_${n}`;
      vault.set(existingPlaceholder, ce.value);
      entities.push({ type, original: ce.value, placeholder: existingPlaceholder });
    }

    sanitized = sanitized.split(ce.value).join(existingPlaceholder);
  }

  const regex = sanitizePii(sanitized, vault);
  return {
    sanitized: regex.sanitized,
    entities: [...entities, ...regex.entities],
    vault: regex.vault,
  };
}

/**
 * Reverse substitution: replace placeholders back with original values.
 * @param {string} text
 * @param {Map<string, string>} vault
 * @returns {string}
 */
export function desanitize(text, vault) {
  let result = text;
  for (const [placeholder, original] of vault) {
    result = result.split(placeholder).join(original);
  }
  return result;
}

/**
 * Quick check: does the text contain any detectable PII?
 * @param {string} text
 * @returns {boolean}
 */
export function containsPii(text) {
  for (const { regex } of PII_PATTERNS) {
    regex.lastIndex = 0;
    if (regex.test(text)) return true;
  }
  return false;
}
