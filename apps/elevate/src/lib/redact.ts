// Removes secrets and sensitive values before anything is written to the audit log.
const SENSITIVE_WORDS =
  /password|passphrase|passwd|secret|token|ciphertext|api[_-]?key|philhealth|pag[_-]?ibig|bank|account[_-]?number|pay[_-]?rate|salary/i;
// Short ids (TIN, SSS) only match as whole words: tin, tin_number, tinNumber, but not "setting".
const SENSITIVE_IDS = /(^|[_-])(tin|sss)([_-]|$)|^(tin|sss)[A-Z]/;

export const REDACTED = "[redacted]";

const isSensitiveKey = (key: string) => SENSITIVE_WORDS.test(key) || SENSITIVE_IDS.test(key);

export function redact<T>(value: T, depth = 0): T {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1)) as T;
  if (value instanceof Date) return value;

  const entries = Object.entries(value as Record<string, unknown>).map(
    ([key, v]) => [key, isSensitiveKey(key) ? REDACTED : redact(v, depth + 1)] as const,
  );
  return Object.fromEntries(entries) as T;
}
