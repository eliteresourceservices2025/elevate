import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Field encryption for government IDs, payout details and pay rates (CLAUDE.md).
// AES-256-GCM. Stored format:  v<version>:<base64( iv[12] | authTag[16] | ciphertext )>
// Keys come from FIELD_ENCRYPTION_KEYS as "v2:<base64>,v1:<base64>", newest first.
// New writes use the first key; older versions stay readable until re-encrypted.

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Never includes plaintext, ciphertext or key material in its message. */
export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CryptoError";
  }
}

export type FieldCrypto = {
  /** Version new writes use, e.g. "v2". */
  currentVersion: string;
  /**
   * `context` binds the value to where it lives (for example `employee_sensitive:tin:<employeeId>`),
   * so a ciphertext copied to another row or column fails to decrypt.
   */
  encrypt(plaintext: string, context: string): string;
  decrypt(stored: string, context: string): string;
  /** True if the value was written with an older key and should be re-encrypted. */
  needsReencrypt(stored: string): boolean;
  reencrypt(stored: string, context: string): string;
};

function parseKeys(raw: string | undefined): { order: string[]; keys: Map<string, Buffer> } {
  if (!raw || !raw.trim()) throw new CryptoError("FIELD_ENCRYPTION_KEYS is not set");

  const keys = new Map<string, Buffer>();
  const order: string[] = [];

  for (const part of raw.split(",")) {
    const entry = part.trim();
    const sep = entry.indexOf(":");
    const version = sep > 0 ? entry.slice(0, sep) : "";
    const b64 = sep > 0 ? entry.slice(sep + 1) : "";

    if (!/^v\d+$/.test(version)) throw new CryptoError("FIELD_ENCRYPTION_KEYS entries must look like v1:<base64>");
    if (keys.has(version)) throw new CryptoError(`FIELD_ENCRYPTION_KEYS repeats ${version}`);

    const key = Buffer.from(b64, "base64");
    if (key.length !== KEY_BYTES) throw new CryptoError(`Key ${version} must decode to exactly ${KEY_BYTES} bytes`);

    keys.set(version, key);
    order.push(version);
  }
  return { order, keys };
}

/** Build a crypto instance from a key string. Exposed for tests and key-rotation scripts. */
export function createFieldCrypto(rawKeys: string | undefined): FieldCrypto {
  const { order, keys } = parseKeys(rawKeys);
  const currentVersion = order[0];

  const keyFor = (version: string): Buffer => {
    const key = keys.get(version);
    if (!key) throw new CryptoError(`No key is configured for ${version}`);
    return key;
  };

  function encrypt(plaintext: string, context: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, keyFor(currentVersion), iv);
    cipher.setAAD(Buffer.from(context, "utf8"));
    const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${currentVersion}:${Buffer.concat([iv, tag, body]).toString("base64")}`;
  }

  function split(stored: string): { version: string; iv: Buffer; tag: Buffer; body: Buffer } {
    const sep = stored.indexOf(":");
    const version = sep > 0 ? stored.slice(0, sep) : "";
    const raw = Buffer.from(sep > 0 ? stored.slice(sep + 1) : "", "base64");
    if (!/^v\d+$/.test(version) || raw.length < IV_BYTES + TAG_BYTES) throw new CryptoError("Malformed encrypted value");
    return {
      version,
      iv: raw.subarray(0, IV_BYTES),
      tag: raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES),
      body: raw.subarray(IV_BYTES + TAG_BYTES),
    };
  }

  function decrypt(stored: string, context: string): string {
    const { version, iv, tag, body } = split(stored);
    try {
      const decipher = createDecipheriv(ALGORITHM, keyFor(version), iv);
      decipher.setAAD(Buffer.from(context, "utf8"));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
    } catch (error) {
      if (error instanceof CryptoError) throw error;
      // Wrong key, wrong context or tampered data all look the same on purpose.
      throw new CryptoError("Could not decrypt value");
    }
  }

  return {
    currentVersion,
    encrypt,
    decrypt,
    needsReencrypt: (stored) => split(stored).version !== currentVersion,
    reencrypt: (stored, context) => encrypt(decrypt(stored, context), context),
  };
}

let shared: FieldCrypto | undefined;

/** The app-wide instance, built from the environment on first use. */
export function fieldCrypto(): FieldCrypto {
  shared ??= createFieldCrypto(process.env.FIELD_ENCRYPTION_KEYS);
  return shared;
}

/** Show only the last `visible` characters, e.g. "•••••6789". Masked by default in the UI. */
export function maskValue(value: string, visible = 4): string {
  const clean = value.replace(/[^A-Za-z0-9]/g, ""); // ignore dashes and spaces
  if (clean.length <= visible) return "•".repeat(clean.length);
  return "•".repeat(Math.min(clean.length - visible, 8)) + clean.slice(-visible);
}
