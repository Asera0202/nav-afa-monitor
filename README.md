# Cégfókusz — NAV-alapú ÁFA- és pénzügyi monitor

Magyar kisvállalkozásoknak szóló SaaS. Automatikusan lekérdezi a NAV-tól
(Online Számla API + Online Pénztárgép API) a számla- és nyugtaadatokat,
megmutatja az ÁFA-pozíciót, és figyelmeztet a hiányzó könyvelésre és a
közelgő adózási bevételi küszöbökre.

Nem számlázó program — egy független, kívülről jövő ellenőrző réteg a
Billingo / Számlázz.hu típusú rendszerek fölé.

Élő oldal: **cegfokusz.hu**

## Architektúra

- **Supabase** — adatbázis, hitelesítés (Auth), jogosultságkezelés (RLS —
  cégenkénti adatelkülönítés adatbázis-szinten, nem csak kódszinten)
- **Vercel** — a `public/` mappát szolgálja ki éles környezetben (statikus site)
- **GitHub Actions** — 4 ütemezett automatizált feladat (lásd lent)
- **Brevo** — SMTP e-mail küldés (Supabase Auth-emailek + havi összefoglaló)
- **Telegram-bot** (`@Afa_monitor_bot`) — értesítések

Minden regisztrált cég NAV-kulcsai titkosítva kerülnek az adatbázisba. A napi
szinkron ezeket a Supabase service role kulccsal és egy dedikált visszafejtő
kulccsal (`REGISTRATION_PRIVATE_KEY`) olvassa vissza, cégenként külön.

## Mappák

- `src/` — Node/TypeScript háttérszkriptek. Ezeket vagy a GitHub Actions
  futtatja ütemezetten, vagy kézzel indíthatók Codespace terminálból:
  `npx tsx src/fájlnév.ts`
- `public/` — a tényleges éles weboldal (statikus HTML+JS): regisztráció,
  bejelentkezés, irányítópult, adataim, beállítások, admin állapot-oldalak
- `supabase/functions/trigger-sync/` — egyetlen Supabase Edge Function: ez
  szolgálja ki a dashboard "Adatok frissítése" gombját (lásd lent)
- `supabase/migrations/` — SQL migrációk az adatbázis-séma változásaihoz.
  Ezeket a Supabase CLI-vel kell alkalmazni (`supabase db push`), vagy
  kézzel, a Supabase dashboard SQL Editorjában lefuttatva
- `.github/workflows/` — a 4 ütemezett automatizálás
- `backups/` — napi adatbázis-mentések. Szándékosan git-tracked: a mentés-
  workflow magába a repóba commitolja a napi `pg_dump`-ot, ez maga a mentési
  mechanizmus — ezért NEM kerülhet `.gitignore`-ba
- `out/` — helyi szkriptfuttatások kimenete / minta-fájlok fejlesztéshez,
  nem éles, nem automatizált

## Automatizált feladatok (GitHub Actions)

| Workflow | Ütemezés (UTC) | Mit csinál |
|---|---|---|
| Napi NAV-szinkron | minden nap 05:00 | Lekéri az aktivált cégek számla- és pénztárgép-adatát, frissíti a `public/status.html`-t és a `public/thresholds.html`-t |
| Napi adatbázis-mentés | minden nap 06:00 | `pg_dump`-ol és bekommitol egy `backups/backup-ÉÉÉÉ-HH-NN.sql` fájlt |
| Kétheti könyvelői emlékeztető | havonta 1. és 15. 08:00 | Emlékeztetőt küld minden cégnek a könyvelői analitika összeállításáról |
| Havi összefoglaló e-mail | havonta 1. 07:00 | Elküldi minden cégnek az előző havi ÁFA-pozíciót és fizetésimód-bontást |

## Manuális "Adatok frissítése" gomb

A dashboardon lévő gomb egy Supabase Edge Function-t hív
(`supabase/functions/trigger-sync/`), ami ellenőrzi a bejelentkezett
felhasználó munkamenetét, majd egy GitHub Actions workflow_dispatch hívással
elindítja a MEGLÉVŐ szinkron-szkripteket, csak az ő cégére szűkítve — a NAV-
hitelesítő adatok visszafejtéséhez szükséges titkos kulcsok soha nem kerülnek
a böngészőbe. 3 perces cooldown védi a NAV API-t a túl gyakori újraindítástól.

**Beállítás (egyszeri, a Supabase ingyenes csomagján is elérhető):**

A `SUPABASE_URL` és `SUPABASE_SERVICE_ROLE_KEY` minden Supabase Edge
Function-ben automatikusan elérhető — ezekkel nincs teendő. Csak egyetlen
titkos kulcsot kell beállítani:

1. Hozz létre egy GitHub **fine-grained personal access token**-t a
   `github.com/settings/personal-access-tokens/new` oldalon: "Only select
   repositories" → `nav-afa-monitor`, majd a "Repository permissions" alatt
   **"Actions": Read and write** (minden más maradjon "No access"). Ez
   engedélyezi a workflow_dispatch hívást, de semmi mást.
2. Telepítsd a Supabase CLI-t (`npm install -g supabase` vagy
   `brew install supabase/tap/supabase`), majd lépj be: `supabase login`
3. Kösd össze a projekttel: `supabase link --project-ref <a-te-project-ref-ed>`
   (a project-ref a Supabase dashboard URL-jében, vagy Settings → General
   alatt található)
4. Állítsd be a titkos kulcsot:
   `supabase secrets set GITHUB_DISPATCH_TOKEN=<a-github-tokened>`
5. Telepítsd a függvényt:
   `supabase functions deploy trigger-sync`

Ugyanez a `GITHUB_DISPATCH_TOKEN` titkos kulcs szolgálja ki a Beállítások
oldalon lévő "Számlák pótlása" gombot is
(`supabase/functions/trigger-backfill/`, a `backfill-invoices.yml` workflow-t
indítja) — ezt a függvényt is deployolni kell:
`supabase functions deploy trigger-backfill`.

**FONTOS mindkét függvénynél:** a Supabase dashboardon az Edge Function
"Settings" fülén ki kell kapcsolni a **"Verify JWT with legacy secret"**
kapcsolót (a kód saját maga ellenőrzi a bejelentkezést) — enélkül a hívás
mindig hibázik. Lásd a TODO.md #19-es pontját a részletesen dokumentált
buktatókról (apikey fejléc, üres kérés-törzs stb.).

## Kézi feltöltésű dokumentumok (KOBAK, könyvelői kimutatás)

A Beállítások oldalon lévő feltöltő a `supabase/migrations/
20260904000000_manual_data_uploads.sql` migrációban létrehozott
`manual_data_uploads` táblát és `manual-uploads` Storage bucket-et használja
— ezt is alkalmazni kell Supabase-ben (SQL Editor), mielőtt a feltöltés
működne. A feltöltött fájlok feldolgozása egyelőre kézi (a fájl csak
biztonságosan tárolva van), az automatikus feldolgozás a következő lépés.

## Házipénztár

A `public/hazipenztar.html` oldal egy egyszerű pénztárkönyv: a pénztárgépes
készpénzes eladást automatikusan behúzza (`opg_receipt_payments`, `Készpénz`
tételek), a kézi kiadásokat/bevételeket és az időszaki fizikai leltárakat a
felhasználó rögzíti. A várható egyenleg mindig a legutóbbi leltártól számol
előre — minden új leltár egyben új kiindulópont is.

**Ehhez két új adatbázis-tábla kell** (`cash_movements`, `cash_counts`),
amiket a `supabase/migrations/20260812000000_hazipenztar.sql` fájl hoz létre.
Alkalmazáshoz:

    supabase db push

(vagy: nyisd meg a fájlt, másold be a tartalmát a Supabase dashboard SQL
Editorjába, és futtasd le kézzel). Amíg ez nincs lefuttatva, a Házipénztár
oldal hibát fog dobni betöltéskor.

## Fejlesztés

A fejlesztés GitHub Codespaces terminálból történik, telepítés:

    npm install

A **production** rendszer nem helyi `.env`-ből dolgozik: a cégek NAV-kulcsai
titkosítva az adatbázisban vannak, a workflow-k GitHub Secrets-ből kapják meg
a visszafejtéshez szükséges kulcsokat.

Néhány egyszemélyes fejlesztői/teszt-szkript (pl. `fetch-sample-invoice.ts`,
`inspect-nyn-sample.ts`, `test-opf-file.ts`) viszont egy helyi `.env` fájlból
olvassa a fejlesztő saját NAV technikai felhasználóját. Ehhez ezek a
változók kellenek:

    NAV_LOGIN=
    NAV_PASSWORD=
    NAV_SIGNING_KEY=
    NAV_EXCHANGE_KEY=
    NAV_TAX_NUMBER=
    NAV_ENV=test
    SOFTWARE_ID=
    SOFTWARE_NAME=
    SOFTWARE_DEV_NAME=
    SOFTWARE_DEV_CONTACT=

A technikai felhasználót a NAV Online Számla **teszt** rendszerében
(`onlineszamla-test.nav.gov.hu`) kell létrehozni, ügyfélkapus belépés után:
Felhasználók → Technikai felhasználó hozzáadása, majd a Részletek lapon
Kulcsgenerálás adja az aláíró- és cserekulcsot.

## Jelenlegi állapot

Minden alapfunkció éles és validálva: regisztráció, bejelentkezés,
multi-tenant napi NAV-szinkron, interaktív irányítópult (ÁFA-pozíció,
küszöb-figyelő, fizetésimód-bontás, letölthető PDF-jelentés), Adataim,
Beállítások, napi mentés, havi összefoglaló e-mail.
