import { XMLParser } from "fast-xml-parser";
import { config } from "./config.js";
import {
  computePasswordHash,
  computeRequestSignature,
  currentTimestamp,
  generateRequestId,
} from "./nav-auth.js";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", removeNSPrefix: true });

const OPF_BASE =
  (process.env.NAV_ENV ?? "test") === "production"
    ? "https://api-onlinepenztargep.nav.gov.hu"
    : "https://api-test-onlinepenztargep.nav.gov.hu";

function buildOpfHeaderXml(): string {
  const requestId = generateRequestId();
  const timestamp = currentTimestamp();
  const passwordHash = computePasswordHash(config.password);
  const requestSignature = computeRequestSignature(requestId, timestamp, config.signingKey);

  return `
  <common:header>
    <common:requestId>${requestId}</common:requestId>
    <common:timestamp>${timestamp}</common:timestamp>
    <common:requestVersion>1.0</common:requestVersion>
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
}

async function postSoap(path: string, bodyXml: string): Promise<string> {
  const { text } = await postSoapRaw(path, bodyXml);
  return text;
}

async function postSoapRaw(path: string, bodyXml: string): Promise<{ buffer: Buffer; contentType: string; text: string }> {
  const soapEnvelope = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns="http://schemas.nav.gov.hu/OPF/1.0/api" xmlns:common="http://schemas.nav.gov.hu/NTCA/1.0/common">
  <soap:Body>
    ${bodyXml}
  </soap:Body>
</soap:Envelope>`;

  const res = await fetch(`${OPF_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/soap+xml; charset=UTF-8" },
    body: soapEnvelope,
  });

  const contentType = res.headers.get("content-type") ?? "";
  const buffer = Buffer.from(await res.arrayBuffer());

  if (!res.ok) {
    throw new Error(`OPF hiba (${path}, HTTP ${res.status}):\n${buffer.toString("utf-8")}`);
  }

  return { buffer, contentType, text: buffer.toString("utf-8") };
}

interface MultipartPart {
  headers: Record<string, string>;
  body: Buffer;
}

function parseMultipartRelated(buffer: Buffer, boundary: string): MultipartPart[] {
  const boundaryMarker = Buffer.from(`--${boundary}`);
  const parts: MultipartPart[] = [];
  let searchStart = buffer.indexOf(boundaryMarker);

  while (searchStart !== -1) {
    const partStart = searchStart + boundaryMarker.length;
    const nextBoundary = buffer.indexOf(boundaryMarker, partStart);
    if (nextBoundary === -1) break;

    let segment = buffer.subarray(partStart, nextBoundary);
    if (segment.subarray(0, 2).toString() === "--") break;

    const headerEnd = segment.indexOf("\r\n\r\n");
    if (headerEnd !== -1) {
      const headerText = segment.subarray(0, headerEnd).toString("utf-8");
      let body = segment.subarray(headerEnd + 4);
      if (body.subarray(body.length - 2).toString() === "\r\n") {
        body = body.subarray(0, body.length - 2);
      }
      const headers: Record<string, string> = {};
      headerText
        .split("\r\n")
        .filter(Boolean)
        .forEach((line) => {
          const idx = line.indexOf(":");
          if (idx > -1) headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
        });
      parts.push({ headers, body });
    }

    searchStart = nextBoundary;
  }

  return parts;
}

export async function queryCashRegisterStatus(apNumbers?: string[]): Promise<unknown> {
  const header = buildOpfHeaderXml();
  const apList = apNumbers && apNumbers.length
    ? apNumbers.map((ap) => `<APNumber>${ap}</APNumber>`).join("")
    : "";

  const requestXml = `<QueryCashRegisterStatusRequest>${header}
  <cashRegisterStatusQuery>
    <APNumberList>${apList}</APNumberList>
  </cashRegisterStatusQuery>
</QueryCashRegisterStatusRequest>`;

  const responseXml = await postSoap("/queryCashRegisterFile/v1/queryCashRegisterStatus", requestXml);
  const parsed = parser.parse(responseXml);
  return parsed.Envelope?.Body ?? parsed;
}

export interface CashRegisterFileResult {
  fileName: string;
  zipBuffer: Buffer | null;
  validationResultCode: string;
  validationErrorCode?: string;
}

export async function queryCashRegisterFile(
  apNumber: string,
  fileNumberStart: number,
  fileNumberEnd?: number
): Promise<{
  files: CashRegisterFileResult[];
  rawXml: string;
  partsInfo: { headers: Record<string, string>; length: number }[];
}> {
  const header = buildOpfHeaderXml();
  const requestXml = `<QueryCashRegisterFileDataRequest>${header}
  <cashRegisterFileDataQuery>
    <APNumber>${apNumber}</APNumber>
    <fileNumberStart>${fileNumberStart}</fileNumberStart>
    ${fileNumberEnd ? `<fileNumberEnd>${fileNumberEnd}</fileNumberEnd>` : ""}
  </cashRegisterFileDataQuery>
</QueryCashRegisterFileDataRequest>`;

  const { buffer, contentType, text } = await postSoapRaw(
    "/queryCashRegisterFile/v1/queryCashRegisterFile",
    requestXml
  );

  const boundaryMatch = contentType.match(/boundary="?([^";]+)"?/i);

  if (!boundaryMatch) {
    return { files: [], rawXml: text, partsInfo: [] };
  }

  const parts = parseMultipartRelated(buffer, boundaryMatch[1]);
  const xmlPart = parts.find((p) => p.headers["content-type"]?.includes("xml"));
  const rawXml = xmlPart ? xmlPart.body.toString("utf-8") : "";

  const partsInfo = parts.map((p) => ({ headers: p.headers, length: p.body.length }));

  const attachmentsByCid = new Map<string, Buffer>();
  for (const p of parts) {
    const cid = p.headers["content-id"]?.replace(/^<|>$/g, "");
    if (cid) attachmentsByCid.set(cid, p.body);
  }

  const parsedXml = parser.parse(rawXml);
  const body = parsedXml.Envelope?.Body ?? parsedXml;
  const response = body.QueryCashRegisterFileDataResponse;
  const result = response?.cashRegisterFileDataResult;
  const rawList = result?.cashRegisterFileDataList?.cashRegisterFileData;
  const list = Array.isArray(rawList) ? rawList : rawList ? [rawList] : [];

  const cidMatches = [...rawXml.matchAll(/href=["']cid:([^"']+)["']/g)].map((m) => m[1]);

  const files: CashRegisterFileResult[] = list.map((item: any, index: number) => {
    const cid = cidMatches[index];
    const zipBuffer = cid ? attachmentsByCid.get(decodeURIComponent(cid)) ?? null : null;
    return {
      fileName: item?.cashRegisterFileName ?? `ismeretlen-${index}`,
      zipBuffer,
      validationResultCode: item?.fileValidationResultCode ?? "ISMERETLEN",
      validationErrorCode: item?.fileValidationErrorCode,
    };
  });

  return { files, rawXml, partsInfo };
}
