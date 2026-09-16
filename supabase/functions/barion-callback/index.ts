// Barion webhook: a Barion GET kéréssel hívja meg ezt a végpontot
// (?paymentId=...) minden fizetési kísérlet után (sikeres és sikertelen
// esetén is) — a webhook maga NEM tartalmazza a végső állapotot, azt a
// Payment/GetPaymentState v2 lekérdezéssel kell megerősíteni, a Barion
// dokumentációjának javasolt mintája szerint.
//
// UGYANAZ A FIGYELMEZTETÉS, mint a barion-start-payment függvénynél: a
// pontos mezőneveket élő Barion teszt-tranzakcióval kell megerősíteni
// élesítés előtt, mert a docs.barion.com nem volt elérhető ellenőrzésre.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BARION_POS_KEY = Deno.env.get("BARION_POS_KEY")!;
const BARION_ENV = Deno.env.get("BARION_ENV") ?? "test";

const BARION_API_BASE = BARION_ENV === "prod" ? "https://api.barion.com" : "https://api.test.barion.com";

function priceForUsage(usage: number): { tier: string } {
  if (usage <= 100) return { tier: "sav1" };
  if (usage <= 250) return { tier: "sav2" };
  return { tier: "sav3" };
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const paymentId = url.searchParams.get("paymentId");
  if (!paymentId) {
    return new Response("Hiányzó paymentId.", { status: 400 });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !BARION_POS_KEY) {
    return new Response("A szerver nincs megfelelően beállítva.", { status: 500 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const stateRes = await fetch(
    `${BARION_API_BASE}/v2/Payment/GetPaymentState?POSKey=${encodeURIComponent(BARION_POS_KEY)}&PaymentId=${encodeURIComponent(paymentId)}`
  );
  const state = await stateRes.json().catch(() => null);

  if (!stateRes.ok || !state) {
    console.error("Barion GetPaymentState hiba a callback-ben:", paymentId);
    return new Response("Hiba a fizetési állapot lekérdezésekor.", { status: 502 });
  }

  const { data: subscription, error: findError } = await supabase
    .from("subscriptions")
    .select("company_id, last_usage_count")
    .eq("barion_payment_id", paymentId)
    .maybeSingle();

  if (findError || !subscription) {
    console.error("Nem található előfizetés ehhez a Barion fizetéshez:", paymentId);
    return new Response("OK", { status: 200 });
  }

  if (state.Status === "Succeeded") {
    const now = new Date();
    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
    const { tier } = priceForUsage(subscription.last_usage_count ?? 0);

    await supabase
      .from("subscriptions")
      .update({
        status: "active",
        tier,
        current_period_start: periodStart.toISOString().slice(0, 10),
        current_period_end: periodEnd.toISOString().slice(0, 10),
        updated_at: new Date().toISOString(),
      })
      .eq("company_id", subscription.company_id);
  } else if (state.Status === "Failed" || state.Status === "Canceled" || state.Status === "Expired") {
    await supabase
      .from("subscriptions")
      .update({ status: "past_due", updated_at: new Date().toISOString() })
      .eq("company_id", subscription.company_id);
  }

  return new Response("OK", { status: 200 });
});
