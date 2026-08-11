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
- **Vercel** — a `public/` mappát szolgálja ki éles környezetben
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
