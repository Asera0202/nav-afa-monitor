import { XMLParser } from "fast-xml-parser";
import { gunzipSync } from "node:zlib";
import { invoiceBaseUrl, type NavCredentials } from "./config.js";
import {
  computePasswordHash,
  computeRequestSignature,
  currentTimestamp,
  decryptExchangeToken,
  generateRequestId,
} from "./nav-auth.js";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
});

function buildCommonHeaderXml(creds: NavCredentials): { xml: string; requestId: string; timestamp: string } {
  const requestId = generateRequestId();
  const timestamp = currentTimestamp();
  const passwordHash = computePasswordHash(creds.password);
  const requestSignature = computeRequestSignature(requestId, timestamp, creds.signingKey);

  const xml = `
  <common:header>
    <common:requestId>${requestId}</common:requestId>
    <common:timestamp>${timestamp}</common:timestamp>
    <common:requestVersion>3.0</common:requestVersion>
    <common:headerVersion>1.0</common:headerVersion>
  </common:header>
  <common:user>
    <common:login>${creds.login}</common:login>
    <common:passwordHash cryptoType="SHA-512">${passwordHash}</common:passwordHash>
    <common:taxNumber>${creds.taxNumber}</common:taxNumber>
    <common:requestSignature cryptoType="SHA3-512">${requestSignature}</common:requestSignature>
  </common:user>
  <software>
    <softwareId>${creds.softwareId}</softwareId>
    <softwareName>${creds.softwareName}</softwareName>
    <softwareOperation>LOCAL_SOFTWARE</softwareOperation>
    <softwareMainVersion>0.1</softwareMainVersion>
    <softwareDevName>${creds.softwareDevName}</softwareDevName>
    <softwareDevContact>${creds.softwareDevContact}</softwareDevContact>
  </software>`;

  return { xml, requestId, timestamp };
}

const XML_NS = `xmlns="http://schemas.nav.gov.hu/OSA/3.0/api" xmlns:common="http://schemas.nav.gov.hu/NTCA/1.0/common"`;

async function postXml(endpoint: string, bodyXml: string, baseUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl}/${endpoint}`, {
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

export async function tokenExchange(creds: NavCredentials): Promise<string> {
  const { xml } = buildCommonHeaderXml(creds);
  const requestXml = `<TokenExchangeRequest ${XML_NS}>${xml}\n</TokenExchangeRequest>`;

  const responseXml = await postXml("tokenExchange", requestXml, invoiceBaseUrl(creds.navEnv));
  const parsed = xmlParser.parse(responseXml);
  const root = parsed.TokenExchangeResponse;
  const encryptedToken: string = root?.encodedExchangeToken;

  if (!encryptedToken) {
    throw new Error(`Nem sikerült tokent kinyerni a NAV válaszból:\n${responseXml}`);
  }

  return decryptExchangeToken(encryptedToken, creds.exchangeKey);
}

export interface InvoiceDigestQuery {
  dateFrom: string;
  dateTo: string;
  direction?: "INBOUND" | "OUTBOUND";
  page?: number;
}

export async function queryInvoiceDigest(query: InvoiceDigestQuery, creds: NavCredentials) {
  const { xml } = buildCommonHeaderXml(creds);
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

  const responseXml = await postXml("queryInvoiceDigest", requestXml, invoiceBaseUrl(creds.navEnv));
  const parsed = xmlParser.parse(responseXml);
  const result = parsed.QueryInvoiceDigestResponse?.invoiceDigestResult;
  const digests = result?.invoiceDigest ?? [];
  return {
    invoices: Array.isArray(digests) ? digests : digests ? [digests] : [],
    currentPage: result?.currentPage,
    availablePage: result?.availablePage,
  };
}

export async function queryInvoiceData(
  invoiceNumber: string,
  direction: "INBOUND" | "OUTBOUND" = "INBOUND",
  batchIndex: number | undefined,
  creds: NavCredentials
): Promise<{ raw: unknown; invoiceXml: string | null }> {
  const { xml } = buildCommonHeaderXml(creds);

  const requestXml = `<QueryInvoiceDataRequest ${XML_NS}>${xml}
  <invoiceNumberQuery>
    <invoiceNumber>${invoiceNumber}</invoiceNumber>
    <invoiceDirection>${direction}</invoiceDirection>
    ${batchIndex ? `<batchIndex>${batchIndex}</batchIndex>` : ""}
  </invoiceNumberQuery>
</QueryInvoiceDataRequest>`;

  const responseXml = await postXml("queryInvoiceData", requestXml, invoiceBaseUrl(creds.navEnv));
  const parsed = xmlParser.parse(responseXml);
  const root = parsed.QueryInvoiceDataResponse;
  const result = root?.invoiceDataResult;

  let invoiceXml: string | null = null;
  const base64Data: string | undefined = result?.invoiceData;
  if (base64Data) {
    const isCompressed =
      result?.compressedContentIndicator === true || result?.compressedContentIndicator === "true";
    const buffer = Buffer.from(base64Data, "base64");
    invoiceXml = (isCompressed ? gunzipSync(buffer) : buffer).toString("utf-8");
  }

  return { raw: root, invoiceXml };
}
