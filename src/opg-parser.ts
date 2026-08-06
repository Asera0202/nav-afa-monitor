export function extractXmlFromP7b(data: Buffer): string | null {
  const text = data.toString("utf-8");
  let start = text.indexOf("<?xml");
  if (start === -1) {
    const m = text.match(/<[A-Za-z_][\w:.-]*[ >]/);
    start = m ? m.index! : -1;
  }
  if (start === -1) return null;

  const afterDecl = text.slice(start);
  let rootMatch = afterDecl.match(/<\?xml[^?]*\?>\s*<([A-Za-z_][\w:.-]*)/);
  if (!rootMatch) rootMatch = afterDecl.match(/<([A-Za-z_][\w:.-]*)/);
  if (!rootMatch) return null;

  const rootTag = rootMatch[1];
  const closeTag = `</${rootTag}>`;
  const end = text.indexOf(closeTag, start);
  if (end === -1) return null;

  return text.slice(start, end + closeTag.length);
}

export const VAT_RATES: Record<string, number> = { A: 0.05, B: 0.18, C: 0.27, D: 0.0, E: 0.0 };
export const VAT_LABELS: Record<string, string> = {
  A: "5% (A)",
  B: "18% (B)",
  C: "27% (C)",
  D: "AJT (D, alanyi mentes)",
  E: "TAM (E, tárgyi mentes)",
};

export interface NynItem {
  gross: number;
  vatLetter: string;
  timestamp: string | null;
  receiptNumber: string | null;
  itemIndex: number;
}

export function parseNynEntries(xml: string): NynItem[] {
  const items: NynItem[] = [];
  const nynBlocks = xml.match(/<NYN>[\s\S]*?<\/NYN>/g) ?? [];

  for (const nyn of nynBlocks) {
    const cncMatch = nyn.match(/<CNC>(\d+)<\/CNC>/);
    if (cncMatch && cncMatch[1] !== "0") continue;

    const dtsMatch = nyn.match(/<DTS>([^<]+)<\/DTS>/);
    const nszMatch = nyn.match(/<NSZ>([^<]+)<\/NSZ>/);

    let itemIndex = 0;
    const itlBlocks = nyn.match(/<ITL>[\s\S]*?<\/ITL>/g) ?? [];
    for (const itl of itlBlocks) {
      const sus = [...itl.matchAll(/<SU>([-\d.,]+)<\/SU>/g)].map((m) => m[1]);
      const vcs = [...itl.matchAll(/<VC>([A-E])\d*<\/VC>/g)].map((m) => m[1]);
      const n = Math.min(sus.length, vcs.length);
      for (let i = 0; i < n; i++) {
        items.push({
          gross: parseFloat(sus[i].replace(",", ".")),
          vatLetter: vcs[i],
          timestamp: dtsMatch ? dtsMatch[1] : null,
          receiptNumber: nszMatch ? nszMatch[1] : null,
          itemIndex: itemIndex++,
        });
      }
    }
  }

  return items;
}

export interface VatAggregate {
  count: number;
  gross: number;
  net: number;
  vat: number;
}

export function aggregateByVatRate(items: NynItem[]): Record<string, VatAggregate> {
  const aggregate: Record<string, VatAggregate> = {};
  for (const item of items) {
    const rate = VAT_RATES[item.vatLetter] ?? 0;
    const net = item.gross / (1 + rate);
    const vat = item.gross - net;
    if (!aggregate[item.vatLetter]) {
      aggregate[item.vatLetter] = { count: 0, gross: 0, net: 0, vat: 0 };
    }
    const a = aggregate[item.vatLetter];
    a.count += 1;
    a.gross += item.gross;
    a.net += net;
    a.vat += vat;
  }
  return aggregate;
}
