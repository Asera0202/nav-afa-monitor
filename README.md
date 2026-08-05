# NAV ÁFA-monitor — NAV Online Számla kliens

Ez a szkript a bejövő (beszerzési) számlák automatikus lekérdezésére szolgál a
NAV Online Számla API-n keresztül — ez az ÁFA-monitor projekt első lépése.
Cél: a saját kézi feldolgozás (ami a 49 hiányzó számlát és a ~507.000 Ft
levonható ÁFA-eltérést feltárta) helyett automatikusan lekérni ugyanezt az
adatot a NAV-tól.

## Mit tud most?

- Hitelesítés a NAV Online Számla API-val (SHA-512 jelszó-hash, aláírás)
- `tokenExchange` hívás — gyors teszt, hogy a hitelesítési adatok jók-e
- `queryInvoiceDigest` — bejövő számlák listázása egy dátumtartományra
- `queryInvoiceData` — egy konkrét számla teljes adatának lekérése (a
  tételes ÁFA-bontáshoz ez kell majd, de a válasz feldolgozása még nincs
  kész — lásd "Következő lépések")

## 1. NAV hitelesítési adatok beszerzése (ha még nincs meg)

1. Lépj be a **teszt** rendszerbe: `onlineszamla-test.nav.gov.hu`,
   ügyfélkapus/KAÜ bejelentkezéssel, elsődleges felhasználóként.
2. **Felhasználók → Technikai felhasználó hozzáadása.** Adj meg jelszót,
   pipáld be a "Számlák kezelése" és "Számlák lekérdezése" jogokat.
3. A technikai felhasználó **Részletek** lapján **Kulcsgenerálás** — ez adja
   az XML aláírókulcsot és cserekulcsot.
4. Az éles (`onlineszamla.nav.gov.hu`) rendszerben ugyanezt külön meg kell
   csinálni, amikor arra sor kerül — a teszt és éles technikai
   felhasználók/kulcsok nem átjárhatók.

## 2. Telepítés

```bash
npm install
cp .env.example .env
```

Töltsd ki a `.env` fájlt a NAV-tól kapott adatokkal (login, jelszó,
aláírókulcs, cserekulcs, adószám törzsszáma). Hagyd `NAV_ENV=test`-en,
amíg a teszt környezetben nem megy stabilan minden.

## 3. Futtatás

```bash
npm run dev
```

Ez lefuttatja a `src/index.ts`-t: ellenőrzi a hitelesítést, majd lekéri a
folyó hónap bejövő számláit, és elmenti a `out/invoices.json` fájlba.

## Fontos — mit érdemes ellenőrizni, mielőtt élesben használod

Ezt a klienst a hivatalos "Online Számla Interfész Specifikáció HU v3.0"
alapján írtuk, de néhány pontot **mindenképp validálj a teszt környezetben**,
mielőtt élesre váltasz:

- **`SOFTWARE_ID` formátuma** (`.env`-ben) — a NAV pontos hossz-/
  karakterkészlet-követelményét érdemes az aktuális XSD-vel összevetni,
  ha a NAV validációs hibát ad rá.
- **`requestSignature` számítás** — SHA3-512(requestId + maszkolt timestamp +
  aláírókulcs), nagybetűs hex. Ezt a NAV teszt API-val élesben leteszteltük
  (2026-08-05) — SHA-512-vel `INVALID_REQUEST_SIGNATURE_HASH_CRYPTO` hibát
  adott, SHA3-512-vel jó. A `passwordHash` marad SHA-512. Ha később
  számla-*beküldést* (manageInvoice) is építünk, ahhoz más, index-hash
  alapú aláírás-összeállítás kell — az ebben a szkriptben még nincs
  implementálva.
- Az XML kérés-struktúra (elemek sorrendje, névterek) a publikus
  dokumentáció alapján készült — ha a NAV séma-validációs hibát ad,
  az konkrétan megmondja, melyik mezőt kell igazítani.

A teszt környezet (`api-test.onlineszamla.nav.gov.hu`) pontosan erre való:
minden éles funkciót tud, de nem kerül be az éles rendszerbe, szóval
nyugodtan lehet vele próbálkozni és hibázni.

## Következő lépések (roadmap)

1. ✅ Projekt váz + hitelesítés + számlalista lekérdezés
2. `queryInvoiceData` válaszának feldolgozása — a Base64+gzip tömörített
   `invoiceData` XML kibontása és a tételes ÁFA-adatok kinyerése
   (ÁFA-kulcsonkénti bontás, ahogy a kézi feldolgozásnál is volt)
3. Az eredmény bekötése a tervezett Supabase adatmodellbe
4. Dashboard (Next.js) — fizetendő vs. levonható ÁFA, nettó pozíció,
   kulcsonkénti arány-riasztás
5. Ütemezett, automatikus futtatás (pl. napi cron)
