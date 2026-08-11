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


export interface NynPayment {
  receiptNumber: string | null;
  timestamp: string | null;
  paymentType: string;
  amount: number;
}

/**
 * A nyugtán belüli fizetési mód(ok) kinyerése a <DRC> blokkból.
 * FE1 = készpénz (közvetlen összeg), FE2 = bankkártya (közvetlen összeg),
 * FE3+ = egyéb fizetőeszköz, <FEN> névvel és <FES> összeggel jelölve.
 * Egy nyugta akár TÖBB fizetési módot is tartalmazhat (megosztott fizetés).
 */
export function parseNynPayments(xml: string): NynPayment[] {
  const payments: NynPayment[] = [];
  const nynBlocks = xml.match(/<NYN>[\s\S]*?<\/NYN>/g) ?? [];

  for (const nyn of nynBlocks) {
    const cncMatch = nyn.match(/<CNC>(\d+)<\/CNC>/);
    if (cncMatch && cncMatch[1] !== "0") continue;

    const dtsMatch = nyn.match(/<DTS>([^<]+)<\/DTS>/);
    const nszMatch = nyn.match(/<NSZ>([^<]+)<\/NSZ>/);
    const drcMatch = nyn.match(/<DRC>([\s\S]*?)<\/DRC>/);
    if (!drcMatch) continue;

    const drc = drcMatch[1];
    const receiptNumber = nszMatch ? nszMatch[1] : null;
    const timestamp = dtsMatch ? dtsMatch[1] : null;

    const fe1Match = drc.match(/<FE1>([-\d.,]+)<\/FE1>/);
    if (fe1Match) {
      payments.push({ receiptNumber, timestamp, paymentType: "Készpénz", amount: parseFloat(fe1Match[1].replace(",", ".")) });
    }

    const fe2Match = drc.match(/<FE2>([-\d.,]+)<\/FE2>/);
    if (fe2Match) {
      payments.push({ receiptNumber, timestamp, paymentType: "Bankkártya", amount: parseFloat(fe2Match[1].replace(",", ".")) });
    }

    const otherMatches = [...drc.matchAll(/<FE\d+>\s*<FEN>([^<]*)<\/FEN>\s*<FES>([-\d.,]+)<\/FES>\s*<\/FE\d+>/g)];
    for (const m of otherMatches) {
      payments.push({ receiptNumber, timestamp, paymentType: m[1] || "Egyéb", amount: parseFloat(m[2].replace(",", ".")) });
    }
  }

  return payments;
}
