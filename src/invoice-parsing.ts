// A NAV Online Számla XML-ből kinyerhető adatok feldolgozása — közös modul,
// hogy a napi szinkron (daily-invoice-sync.ts) és a pótló szkript
// (backfill-invoices.ts) ugyanazt a logikát használja, ne duplikálva.

import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", removeNSPrefix: true });

export interface VatRateSummary {
  vatPercentage: number;
  netAmount: number;
  vatAmount: number;
  grossAmount: number;
}

export interface InvoiceLineItem {
  lineNumber: number;
  description: string | null;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  netAmount: number;
  vatPercentage: number;
  vatAmount: number;
  grossAmount: number;
}

function parseInvoice(invoiceXml: string) {
  return parser.parse(invoiceXml);
}

export function extractVatSummary(invoiceXml: string): VatRateSummary[] {
  const parsed = parseInvoice(invoiceXml);
  const summary = parsed.InvoiceData?.invoiceMain?.invoice?.invoiceSummary?.summaryNormal;
  const raw = summary?.summaryByVatRate;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((item: any) => ({
    vatPercentage: Number(item?.vatRate?.vatPercentage ?? 0),
    netAmount: Number(item?.vatRateNetData?.vatRateNetAmount ?? 0),
    vatAmount: Number(item?.vatRateVatData?.vatRateVatAmount ?? 0),
    grossAmount: Number(item?.vatRateGrossData?.vatRateGrossAmount ?? 0),
  }));
}

// A tételsorok (invoiceLines.line[]) kiolvasása — ez adja a termék/szolgáltatás
// szöveges megnevezését, mennyiséget, egységárat, amiből az iparűzési adó
// levonható tételeinek (anyagköltség, ELÁBÉ, stb.) kategorizálása épül majd.
// A "lineAmountsNormal" a leggyakoribb forma; ha hiányzik (pl. egyszerűsített
// számla), nullákkal térünk vissza az összegeknél, a szöveget akkor is megőrizzük.
export function extractLineItems(invoiceXml: string): InvoiceLineItem[] {
  const parsed = parseInvoice(invoiceXml);
  const raw = parsed.InvoiceData?.invoiceMain?.invoice?.invoiceLines?.line;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((line: any) => {
    const amounts = line?.lineAmountsNormal ?? line?.lineAmountsSimplified;
    return {
      lineNumber: Number(line?.lineNumber ?? 0),
      description: line?.lineDescription != null ? String(line.lineDescription) : null,
      quantity: line?.quantity != null ? Number(line.quantity) : null,
      unit: line?.unitOfMeasureOwn != null ? String(line.unitOfMeasureOwn) : line?.unitOfMeasure != null ? String(line.unitOfMeasure) : null,
      unitPrice: line?.unitPrice != null ? Number(line.unitPrice) : null,
      netAmount: Number(amounts?.lineNetAmountData?.lineNetAmount ?? 0),
      vatPercentage: Number(amounts?.lineVatRate?.vatPercentage ?? amounts?.lineVatData?.vatPercentage ?? 0),
      vatAmount: Number(amounts?.lineVatData?.lineVatAmount ?? 0),
      grossAmount: Number(amounts?.lineGrossAmountData?.lineGrossAmountNormal ?? 0),
    };
  });
}
