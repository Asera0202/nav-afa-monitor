import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !TELEGRAM_BOT_TOKEN) {
  console.error("Hiányzó környezeti változó (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / TELEGRAM_BOT_TOKEN)");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const REMINDER_TEXT = `📋 ÁFA-monitor emlékeztető

Kérj a könyvelődtől friss főkönyvi kivonatot vagy analitikát, és töltsd fel az ÁFA-monitorba — így az adat naprakész marad, és láthatod, ha valami lemaradt a könyvelésből.`;

async function sendTelegramMessage(chatId: string, text: string): Promise<boolean> {
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  const data = await res.json();
  if (!data.ok) {
    console.error(`Telegram hiba (chat_id=${chatId}):`, data.description);
    return false;
  }
  return true;
}

async function main() {
  console.log("Cégek lekérése, akiknek van beállított Telegram-chat ID-je...");

  const { data: companies, error } = await supabase
    .from("companies")
    .select("id, name, telegram_chat_id")
    .not("telegram_chat_id", "is", null);

  if (error) throw error;

  if (!companies || companies.length === 0) {
    console.log("Nincs egyetlen cég sem beállított Telegram-chat ID-vel — nincs kinek küldeni.");
    return;
  }

  console.log(`${companies.length} cégnek küldünk emlékeztetőt.`);

  let sent = 0,
    failed = 0;
  for (const company of companies) {
    const ok = await sendTelegramMessage(company.telegram_chat_id, REMINDER_TEXT);
    if (ok) {
      sent++;
      console.log(`  ✅ Elküldve: ${company.name}`);
    } else {
      failed++;
      console.log(`  ⚠️ Sikertelen: ${company.name}`);
    }
  }

  console.log(`\nÖsszesen: ${sent} elküldve, ${failed} sikertelen.`);
}

main().catch((err) => {
  console.error("Váratlan hiba az emlékeztetők küldésekor:", err);
  process.exit(1);
});
