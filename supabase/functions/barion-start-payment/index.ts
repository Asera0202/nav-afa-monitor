// Az "Előfizetés" oldalon a "Fizetés" gomb szerver-oldali végpontja.
// A bejelentkezett felhasználó cégéhez kiszámolja az ELŐZŐ naptári hónap
// tényleges bizonylatszámát (kimenő+bejövő számla + pénztárgépes napok —
// lásd a compute_billing_usage SQL függvényt), ebből megállapítja a sávot
// és az árat, majd elindít egy Barion fizetést (Payment/Start v2), és
// visszaadja a GatewayUrl-t, ahova a böngészőt irányítani kell.
//
// FONTOS, MÉG NEM ÉLESÍTETT RÉSZ (2026.09.16): a Barion hivatalos
// dokumentációja (docs.barion.com) a fejlesztői környezetből nem volt
// elérhető, ezért a pontos JSON-mezőnevek kutatásból (nem az élő
// referenciából) származnak — élesítés előtt egy valódi Barion
// sandbox/teszt POSKey-jel egy teszttranzakcióval ellenőrizni és
// szükség esetén finomhangolni kell ezt a hívást.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BARION_POS_KEY = Deno.env.get("BARION_POS_KEY")!;
const BARION_PAYEE_EMAIL = Deno.env.get("BARION_PAYEE_EMAIL")!;
const BARION_ENV = Deno.env.get("BARION_ENV") ?? "test"; // "test" vagy "prod"
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") ?? "https://cegfokusz.hu";

const BARION_API_BASE = BARION_ENV === "prod" ? "https://api.barion.com" : "https://api.test.barion.com";

// Sávos, forgalom-alapú árazás — ugyanaz a szabály, mint az
// "Előfizetés" oldalon (public/elofizetes.html) megjelenítve.
function priceForUsage(usage: number): { tier: string; price: number; label: string } {
  if (usage <= 100) return { tier: "sav1", price: 7999, label: "Alap sáv (havi 100 bizonylatig)" };
  if (usage <= 250) return { tier: "sav2", price: 9999, label: "Közepes sáv (havi 101-250 bizonylat)" };
  return { tier: "sav3", price: 11999, label: "Nagy sáv (havi 250 bizonylat felett)" };
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Csak POST kérés engedélyezett." }, 405);
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !BARION_POS_KEY || !BARION_PAYEE_EMAIL) {
    return json({ error: "A szerver nincs megfelelően beállítva (hiányzó Barion-adat)." }, 500);
  }

  const authHeader = req.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "") ?? null;
  if (!token) return json({ error: "Hiányzó hitelesítés." }, 401);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user) {
    return json({ error: "Érvénytelen munkamenet — jelentkezz be újra." }, 401);
  }

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("id, name")
    .eq("owner_user_id", userData.user.id)
    .maybeSingle();
  if (companyError || !company) {
    return json({ error: "Nem található cég ehhez a fiókhoz." }, 404);
  }

  // Az előző naptári hónap forgalma alapján számlázunk.
  const now = new Date();
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  const periodStart = new Date(Date.UTC(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth(), 1));
  const periodFromIso = periodStart.toISOString().slice(0, 10);
  const periodToIso = periodEnd.toISOString().slice(0, 10);

  const { data: usage, error: usageError } = await supabase.rpc("compute_billing_usage", {
    p_company_id: company.id,
    p_from: periodFromIso,
    p_to: periodToIso,
  });
  if (usageError) {
    return json({ error: `Hiba a forgalom kiszámításakor: ${usageError.message}` }, 500);
  }

  const { tier, price, label } = priceForUsage(usage ?? 0);
  const paymentRequestId = `CEGFOKUSZ-${company.id}-${periodFromIso}`;

  const barionRes = await fetch(`${BARION_API_BASE}/v2/Payment/Start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      POSKey: BARION_POS_KEY,
      PaymentType: "Immediate",
      PaymentRequestId: paymentRequestId,
      GuestCheckOut: true,
      FundingSources: ["All"],
      Currency: "HUF",
      Locale: "hu-HU",
      RedirectUrl: `${APP_BASE_URL}/elofizetes.html?payment=finished`,
      CallbackUrl: `${SUPABASE_URL}/functions/v1/barion-callback`,
      Transactions: [
        {
          POSTransactionId: paymentRequestId,
          Payee: BARION_PAYEE_EMAIL,
          Total: price,
          Comment: `Cégfókusz előfizetés — ${company.name} — ${periodFromIso.slice(0, 7)}`,
          Items: [
            {
              Name: "Cégfókusz havidíj",
              Description: label,
              Quantity: 1,
              Unit: "db",
              UnitPrice: price,
              ItemTotal: price,
            },
          ],
        },
      ],
    }),
  });

  const barionBody = await barionRes.json().catch(() => null);

  if (!barionRes.ok || !barionBody?.GatewayUrl) {
    console.error("Barion Payment/Start hiba:", JSON.stringify(barionBody));
    return json({ error: "Nem sikerült elindítani a fizetést a Barionnál.", details: barionBody }, 502);
  }

  await supabase
    .from("subscriptions")
    .update({ barion_payment_id: barionBody.PaymentId, last_usage_count: usage ?? 0, updated_at: new Date().toISOString() })
    .eq("company_id", company.id);

  return json({ ok: true, gateway_url: barionBody.GatewayUrl, tier, price, usage: usage ?? 0 });
});
