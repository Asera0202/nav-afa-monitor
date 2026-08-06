import { XMLParser } from "fast-xml-parser";
import { gunzipSync } from "node:zlib";
import { config } from "./config.js";
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

async function postXml(endpoint: string, bodyXml: string, baseUrl: string = config.baseUrl): Promise<string> {
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
  dateFrom: string;
  dateTo: string;
  direction?: "INBOUND" | "OUTBOUND";
  page?: number;
}

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

export async function queryInvoiceData(
  invoiceNumber: string,
  direction: "INBOUND" | "OUTBOUND" = "INBOUND",
  batchIndex?: number
): Promise<{ raw: unknown; invoiceXml: string | null }> {
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

export interface CashRegisterQuery {
  apNumber: string;
  fileNumberStart: string;
  fileNumberEnd: string;
}

export async function queryCashRegister(query: CashRegisterQuery): Promise<{ raw: unknown; rawXml: string }> {
  const { xml } = buildCommonHeaderXml();

  const requestXml = `<QueryCashRegisterRequest ${XML_NS}>${xml}
  <APNumber>${query.apNumber}</APNumber>
  <FileNumberStart>${query.fileNumberStart}</FileNumberStart>
  <FileNumberEnd>${query.fileNumberEnd}</FileNumberEnd>
</QueryCashRegisterRequest>`;

  const responseXml = await postXml("queryCashRegister", requestXml, config.cashRegisterBaseUrl);
  const parsed = xmlParser.parse(responseXml);
  const root = parsed.QueryCashRegisterResponse ?? parsed;

  return { raw: root, rawXml: responseXml };
}
