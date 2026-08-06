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

export const config = {
  navEnv: (process.env.NAV_ENV ?? "test") as "test" | "production",
  baseUrl:
    (process.env.NAV_ENV ?? "test") === "production"
      ? "https://api.onlineszamla.nav.gov.hu/invoiceService/v3"
      : "https://api-test.onlineszamla.nav.gov.hu/invoiceService/v3",

  cashRegisterBaseUrl:
    (process.env.NAV_ENV ?? "test") === "production"
      ? "https://api.onlineszamla.nav.gov.hu/invoiceService/v3"
      : "https://api-test.onlineszamla.nav.gov.hu/invoiceService/v3",

  login: required("NAV_LOGIN"),
  password: required("NAV_PASSWORD"),
  signingKey: required("NAV_SIGNING_KEY"),
  exchangeKey: required("NAV_EXCHANGE_KEY"),
  taxNumber: required("NAV_TAX_NUMBER"),

  softwareId: required("SOFTWARE_ID"),
  softwareName: process.env.SOFTWARE_NAME ?? "AFA-Monitor",
  softwareDevName: process.env.SOFTWARE_DEV_NAME ?? "",
  softwareDevContact: process.env.SOFTWARE_DEV_CONTACT ?? "",
};
