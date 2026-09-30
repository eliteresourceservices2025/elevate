import "server-only";
import { createFieldCrypto, type FieldCrypto } from "./crypto-core";

export * from "./crypto-core";

let shared: FieldCrypto | undefined;

/** The app-wide instance, built from the environment on first use. */
export function fieldCrypto(): FieldCrypto {
  shared ??= createFieldCrypto(process.env.FIELD_ENCRYPTION_KEYS);
  return shared;
}
