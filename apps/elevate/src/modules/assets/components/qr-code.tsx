"use client";

import { QRCodeSVG } from "qrcode.react";
import { useSyncExternalStore } from "react";

const noop = () => () => {};

/**
 * A QR code for an item. It encodes only the item's address (this site's origin plus /assets/<tag>): no name, serial number or person.
 * The origin is read in the browser, so the same code works on localhost, staging and production. Drawn as inline SVG: it prints sharply.
 */
export function AssetQr({ path, size = 96, label }: { path: string; size?: number; label: string }) {
  const origin = useSyncExternalStore(noop, () => window.location.origin, () => "");
  if (!origin || !path.startsWith("/") || path.startsWith("//")) return <div style={{ width: size, height: size }} aria-hidden />;
  return <QRCodeSVG value={`${origin}${path}`} size={size} level="M" marginSize={1} role="img" aria-label={label} title={label} />;
}
