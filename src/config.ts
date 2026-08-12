import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Hiányzó környezeti változó: ${name}. Töltsd ki a .env fájlban (lásd .env.example).`
    );
  }
  return value;
}

export interface NavCredentials {
  login: string;
  password: string;
  signingKey: string;
  exchangeKey: string;
  taxNumber: string;
  navEnv: "test" | "production";
  softwareId: string;
  softwareName: string;
  softwareDevName: string;
  softwareDevContact: string;
}

export function invoiceBaseUrl(navEnv: "test" | "production"): string {
  return navEnv === "production"
    ? "https://api.onlineszamla.nav.gov.hu/invoiceService/v3"
    : "https://api-test.onlineszamla.nav.gov.hu/invoiceService/v3";
}

export function opfBaseUrl(navEnv: "test" | "production"): string {
  return navEnv === "production"
    ? "https://api-onlinepenztargep.nav.gov.hu"
    : "https://api-test-onlinepenztargep.nav.gov.hu";
}

/** A SOFTWARE_ID kötött, 18 karakteres formátumú: HU + 00000 + 8 jegyű adószám-törzsszám + 001. */
export function buildSoftwareId(taxNumber: string): string {
  return `HU00000${taxNumber}001`;
}

/**
 * A natív fetch() hibái (pl. "fetch failed") önmagukban nem árulják el, mi
 * volt a tényleges ok — azt az err.cause hordozza (pl. timeout, DNS-hiba,
 * lezárt kapcsolat). Ez a segédfüggvény ezt is belefűzi az üzenetbe, hogy
 * a sync_runs naplóban és a logokban is látszódjon a valódi hibaforrás.
 */
export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const parts = [err.message];
  let cause = (err as { cause?: unknown }).cause;
  while (cause) {
    if (cause instanceof Error) {
      parts.push(`ok: ${cause.message}${(cause as any).code ? ` (${(cause as any).code})` : ""}`);
      cause = (cause as { cause?: unknown }).cause;
    } else {
      parts.push(`ok: ${String(cause)}`);
      break;
    }
  }
  return parts.join(" — ");
}

export function buildCredentialsFromEnv(): NavCredentials {
  return {
    login: required("NAV_LOGIN"),
    password: required("NAV_PASSWORD"),
    signingKey: required("NAV_SIGNING_KEY"),
    exchangeKey: required("NAV_EXCHANGE_KEY"),
    taxNumber: required("NAV_TAX_NUMBER"),
    navEnv: (process.env.NAV_ENV ?? "test") as "test" | "production",
    softwareId: required("SOFTWARE_ID"),
    softwareName: process.env.SOFTWARE_NAME ?? "AFA-Monitor",
    softwareDevName: process.env.SOFTWARE_DEV_NAME ?? "",
    softwareDevContact: process.env.SOFTWARE_DEV_CONTACT ?? "",
  };
}
