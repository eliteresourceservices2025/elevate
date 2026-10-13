import "server-only";
import { supportAddress } from "./constants";

/** Where support requests go: the deployment's SUPPORT_EMAIL, else the agreed default. */
export function supportEmail(): string {
  return supportAddress();
}
