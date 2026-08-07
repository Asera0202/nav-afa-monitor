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
