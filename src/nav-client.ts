import { XMLParser } from "fast-xml-parser";
import { config } from "./config.js";
import {
  computePasswordHash,
  computeRequestSignature,
  currentTimestamp,
  decryptExchangeToken,
  generateRequestId,
} from "./nav-auth.js";

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

/** Közös fejléc (header + user + software) XML-blokk minden nem-manageInvoice kéréshez. */
function buildCommonHeaderXml(): { xml: string; requestId: string; timestamp: string } {
  const requestId = generateRequestId();
  const timestamp = currentTimestamp();
  const passwordHash = computePasswordHash(config.password);
  const requestSignature = computeRequestSignature(requestId, timestamp, config.signingKey);

  const xml = `
  <common:header>
    <common:requestId>${requestId}</common:requestId>
    <common:timestamp>${timestamp}</common:timestamp>
    <common:requestVersion>3.0</common:requestVersion>
    <common:headerVersion>1.0</common:headerVersion>
  </common:header>
  <common:user>
    <common:login>${config.login}</common:login>
    <common:passwordHash cryptoType="SHA-512">${passwordHash}</common:passwordHash>
    <common:taxNumber>${config.taxNumber}</common:taxNumber>
    <common:requestSignature cryptoType="SHA3-512">${requestSignature}</common:requestSignature>
  </common:user>
  <software>
    <softwareId>${config.softwareId}</softwareId>
    <softwareName>${config.softwareName}</softwareName>
    <softwareOperation>LOCAL_SOFTWARE</softwareOperation>
    <softwareMainVersion>0.1</softwareMainVersion>
    <softwareDevName>${config.softwareDevName}</softwareDevName>
    <softwareDevContact>${config.softwareDevContact}</softwareDevContact>
  </software>`;

  return { xml, requestId, timestamp };
}

const XML_NS = `xmlns="http://schemas.nav.gov.hu/OSA/3.0/api" xmlns:common="http://schemas.nav.gov.hu/NTCA/1.0/common"`;

async function postXml(endpoint: string, bodyXml: string): Promise<string> {
  const res = await fetch(`${config.baseUrl}/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/xml" },
    body: `<?xml version="1.0" encoding="UTF-8"?>\n${bodyXml}`,
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`NAV API hiba (${endpoint}, HTTP ${res.status}):\n${text}`);
  }

  const parsed = xmlParser.parse(text);
  const root = parsed[Object.keys(parsed).find((k) => k !== "?xml") ?? ""];
  const funcCode = root?.result?.funcCode ?? root?.funcCode;
  if (funcCode && funcCode !== "OK") {
    const errorCode = root?.result?.errorCode ?? "ISMERETLEN";
    const message = root?.result?.message ?? text;
    throw new Error(`NAV API hibaválasz (${endpoint}): [${errorCode}] ${message}`);
  }

  return text;
}

/**
 * Token lekérése és visszafejtése.
 * MEGJEGYZÉS: ez csak a manageInvoice (számla-BEKÜLDÉS) operációhoz kellene —
 * a lekérdező hívások (queryInvoiceDigest, queryInvoiceData) a header/user
 * blokkal önmagukban hitelesítenek, tokenExchange nélkül. Itt elsősorban egy
 * egyszerű "működik-e a hitelesítés" ellenőrzésnek hagytuk meg — ez az egyik
 * legegyszerűbb hívás, jó első teszt az újonnan generált kulcsokra.
 */
export async function tokenExchange(): Promise<string> {
  const { xml } = buildCommonHeaderXml();
  const requestXml = `<TokenExchangeRequest ${XML_NS}>${xml}\n</TokenExchangeRequest>`;

  const responseXml = await postXml("tokenExchange", requestXml);
  const parsed = xmlParser.parse(responseXml);
  const root = parsed.TokenExchangeResponse;
  const encryptedToken: string = root?.encodedExchangeToken;

  if (!encryptedToken) {
    throw new Error(`Nem sikerült tokent kinyerni a NAV válaszból:\n${responseXml}`);
  }

  return decryptExchangeToken(encryptedToken, config.exchangeKey);
}

export interface InvoiceDigestQuery {
  /** Számla kiállításának dátumtartománya (YYYY-MM-DD, a napok inkluzívak). */
  dateFrom: string;
  dateTo: string;
  /** INBOUND = a cégünk mint vevő kapta a számlát (ez kell a beszerzési/ÁFA-monitorhoz). */
  direction?: "INBOUND" | "OUTBOUND";
  page?: number;
}

/** Számlák listázása (nem a teljes XML, csak a fejadatok) egy dátumtartományra. */
export async function queryInvoiceDigest(query: InvoiceDigestQuery) {
  const { xml } = buildCommonHeaderXml();
  const direction = query.direction ?? "INBOUND";
  const page = query.page ?? 1;

  const requestXml = `<QueryInvoiceDigestRequest ${XML_NS}>${xml}
  <page>${page}</page>
  <invoiceDirection>${direction}</invoiceDirection>
  <invoiceQueryParams>
    <mandatoryQueryParams>
      <insDate>
        <dateTimeFrom>${query.dateFrom}T00:00:00.000Z</dateTimeFrom>
        <dateTimeTo>${query.dateTo}T23:59:59.999Z</dateTimeTo>
      </insDate>
    </mandatoryQueryParams>
  </invoiceQueryParams>
</QueryInvoiceDigestRequest>`;

  const responseXml = await postXml("queryInvoiceDigest", requestXml);
  const parsed = xmlParser.parse(responseXml);
  const result = parsed.QueryInvoiceDigestResponse?.invoiceDigestResult;
  const digests = result?.invoiceDigest ?? [];
  return {
    invoices: Array.isArray(digests) ? digests : digests ? [digests] : [],
    currentPage: result?.currentPage,
    availablePage: result?.availablePage,
  };
}

/**
 * Egy adott számla teljes adatának lekérése (a queryInvoiceDigest csak a
 * fejadatokat adja vissza — ez kell a tételes ÁFA-bontáshoz).
 * A Base64-ben, tömörítve (gzip) érkező invoiceData mezőt itt még nem
 * dekódoljuk — ez a következő lépés, ha a lista-lekérdezés már megy.
 */
export async function queryInvoiceData(
  invoiceNumber: string,
  direction: "INBOUND" | "OUTBOUND" = "INBOUND",
  batchIndex?: number
) {
  const { xml } = buildCommonHeaderXml();

  const requestXml = `<QueryInvoiceDataRequest ${XML_NS}>${xml}
  <invoiceNumberQuery>
    <invoiceNumber>${invoiceNumber}</invoiceNumber>
    <invoiceDirection>${direction}</invoiceDirection>
    ${batchIndex ? `<batchIndex>${batchIndex}</batchIndex>` : ""}
  </invoiceNumberQuery>
</QueryInvoiceDataRequest>`;

  const responseXml = await postXml("queryInvoiceData", requestXml);
  const parsed = xmlParser.parse(responseXml);
  return parsed.QueryInvoiceDataResponse;
}
