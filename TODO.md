# Hátralévő fejlesztési lista

## Javasolt sorrend

1. **Sürgős, határidős** — #2 (E-nyugta, 2026.09.01-i kötelezettség)
2. **Dizájn-alap** — #10 (redesign, mielőtt több felület épül rá — így nem kell duplán megcsinálni)
3. **Meglévő pilot-ügyfél mélyítése** — #1, #18, #5, #9, #8
4. **Új adatforrás-integrációk** — #3 (blokkolva mintafájlig), #4, #6
5. **Monetizáció / publikus indulás előkészítése** — #11, #12, #15
6. **Növekedési / halasztható** — #7, #14, #13, #17
7. **Legvégén** — #16 (jogi papírok, piacra lépéskor)

*(Megjegyzés: ha egy ötlet kapcsán menet közben új lehetőség merül fel, azt megjegyzésként a kapcsolódó pont alá fűzöm.)*

## Tételek

1. ✅ Házipénztár-egyeztetés — kész ("A" szint: teljes pénztárkönyv). Új
   `public/hazipenztar.html` oldal + `cash_movements`/`cash_counts` táblák.
   Automatikusan behúzza a pénztárgépes készpénzes eladást, a kiadásokat/
   bevételeket és az időszaki fizikai leltárt a felhasználó rögzíti kézzel
   (ezt a NAV nem látja). Minden leltár új kiindulópont, eltérés-számítással.
   **TEENDŐ nálad:** a migrációt (`supabase/migrations/20260812000000_hazipenztar.sql`)
   alkalmazni kell Supabase-ben (`supabase db push`, lásd README) — enélkül
   az oldal hibát dob.
2. ✅ E-nyugta felkészültség-jelző (2026.09.01-i kötelezettség) — kész (dashboard,
   a `cash_registers` tábla alapján személyre szabott zöld/sárga jelzés)
3. ⛔ KOBAK-import — TISZTÁZVA (2026.09.04): a "KOBAK" valójában a NAV saját
   portálja (kobakonline.nav.gov.hu), pénztárgép/e-nyugta adminisztrációra —
   ebből nincs pótolható új adat, amit ne húznánk már automatikusan a NAV
   API-n. A pénztárgépes (OPG) adatoknál a NAV csak kb. 14 napig tartja
   elérhetőn a fájlokat lekérdezésre — ami ennél korábbi, az a NAV oldaláról
   is véglegesen elveszett, semmivel nem pótolható vissza utólag. Ez a pont
   emiatt törölhető/lezárva, a valódi igényt a #3b és #4 pontok fedik le.
3b. ✅ Számla-pótló (backfill) szkript — kész, első futás lefutott (2026.09.04):
    a napi szinkron csak 34 napra visszamenőleg kérdezi le a NAV Online
    Számla adatait, ezért egy cég csatlakozásakor a korábbi hónapok
    kimaradtak. `src/backfill-invoices.ts` + `.github/workflows/
    backfill-invoices.yml` (kézzel, GitHub Actions workflow_dispatch-csel
    indítható) tetszőleges dátumtól visszatölti a bejövő/kimenő számlákat,
    30 napos darabokban, lapozást kezelve. Első futás 2026.01.01-től:
    381 számla feldolgozva (1 hibás), 522 ÁFA-sor feltöltve.
    **TEENDŐ, ha skálázunk (lásd #12):** ma ezt még GitHub Actions
    workflow_dispatch-en keresztül hívja meg egy Edge Function — ez a
    felhasználó felől már gombnyomásra megy (lásd alább), de a mögötte lévő
    GITHUB_DISPATCH_TOKEN/Edge Function beállítás sok céggel skálázva
    átgondolandó.
    ✅ **UI kész (2026.09.04):** önálló "Adatpótlás" oldal a sidebar
    menüben (`public/adatpotlas.html`, Házipénztár és Beállítások között)
    — a felhasználó maga választ kezdő dátumot, egy gombbal indítja
    (`supabase/functions/trigger-backfill/`). Korábban a Beállítások oldal
    aljára volt eldugva, ahol senki nem kereste — a felhasználó jelezte,
    hogy ez nem felhasználóbarát, ezért került ki külön menüpontba.
4. ✅ Könyvelői egyeztetés-feltöltés — **teljesen kész, élesben tesztelve
   és működik (2026.09.16)**. Saját sidebar-menüpontja és oldala van
   (`public/konyveloi-egyeztetes.html`) — egy oldalon a magyarázat,
   feltöltés és eredmény, a dashboardon pedig egy jól látható
   "Könyvelői egyeztetés megnyitása" gomb mutat ide (korábban az
   Adatpótlás oldal aljára volt eldugva, és külön oldalon jelentek meg
   a részletek — a felhasználó kérésére önálló, végigvezetett oldal lett).
   Feltöltés után automatikusan elindul: `supabase/functions/
   trigger-process-upload/` → `.github/workflows/
   process-upload.yml` → `src/process-upload.ts`. A PDF-et pozíció (x/y
   koordináta) alapján olvassa ki (a nyers szövegkinyerés összekeverte az
   oszlopokat a QualitySoft Diamond "Részletes ÁFA kimutatás"
   riport-típusnál), kiolvassa a riport fejlécéből az időszakot is, és
   **csak az arra az időszakra eső** NAV-bejövő-számlákkal veti össze
   (korábban a teljes évet nézte egy negyedéves kimutatáshoz, ami
   irreálisan magas "hiányzó" számot adott — javítva).
   Az eredmény egy külön táblában (`reconciliation_findings`) és egy
   részletes, táblázatos oldalon jelenik meg
   (`public/egyeztetes-reszletek.html`: bizonylatszám, szállító, dátum,
   nettó/ÁFA/bruttó) — nem csak egy rövid szövegben. A **dashboardon** is
   megjelenik egy "Könyvelői egyeztetés" kártya, link a részletekre.
   A hibás (nem szám tartalmú) bizonylatszám-felismeréseket kiszűrjük.
   **Ismert korlát, tisztázva a felhasználóval:** PDF-ből 100%-osan
   hibátlan kiolvasás technikailag nem garantálható (néhány több sorba
   tördelt tétel kimaradhat a felismerésből — inkább kimarad, mint hogy
   hibásan párosuljon). Az Adatpótlás oldal magyarázata most már
   kifejezetten javasolja Excel/CSV kérését a könyvelőtől PDF helyett
   (ha van ilyen exportja), mert az kétértelműség nélkül, tökéletesen
   feldolgozható lenne — ha a felhasználó tud ilyet szerezni, érdemes
   megírni hozzá is a feldolgozást.
   Csak a "konyveloi_afa" típusú PDF-eket dolgozza fel — a "kobak_penztargep"
   típusúakat egyelőre csak tárolja (nincs minta-fájl hozzá).
   **Élesítés közben felmerült és javított hibák (mind megoldva):**
   - a `manual_data_uploads`/`reconciliation_findings` táblákhoz a
     `service_role`-nak nem volt jogosultsága (csak `authenticated`-nek
     adtuk meg korábban) — "permission denied" hibát adott, míg ki nem
     derült a debug-üzenettel
   - a `trigger-process-upload` Edge Function 12 napig érintetlenül állt,
     és valamiért nem volt elérhető (404) — törlés + újra-deploy oldotta meg
   - a `pdf-parse` npm csomag hibásan "debug módnak" hiszi magát ESM/tsx
     környezetben, és egy nálunk nem létező, saját teszt-PDF-et próbál
     megnyitni induláskor — ez minden feldolgozást elhasalt, amíg ki nem
     derült a GitHub Actions logból; a belső `pdf-parse/lib/pdf-parse.js`
     modult importálva elkerülhető
   - fájlnévben lévő zárójel/szóköz "Invalid key" Storage-hibát adott —
     a tárolási útvonalhoz most a fájlnevet biztonságos formára alakítjuk
4b. Dokumentum-megosztó portál a könyvelővel — ÚJ ÖTLET (2026.09.04),
    TERV PONTOSÍTVA (2026.09.16): a vállalkozás fel tudna tölteni mindent,
    amit a könyvelő kér (bankszámla-kivonat, számlák, egyéb bizonylat), a
    könyvelő pedig egy helyről le tudná tölteni — mindketten látnák, mi van
    feltöltve és mi hiányzik. Felmértük a piaci megoldásokat (Kulcs-Soft
    Kulcs Connect, Cashbook, Accace online portál) — mindegyik ugyanazt a
    mintát követi: kategorizált feltöltés (kimenő/bejövő számla, bank-
    kivonat, szerződés, egyéb) + könyvelői oldali nézet, ahol látszik mi van
    meg és mi hiányzik + kétirányú megjegyzés-lehetőség.
    **Döntés a felhasználóval (2026.09.16):** a könyvelő saját, teljes
    értékű fiókkal férjen hozzá (nem egyszerű tokenes linkkel) — regisztrál,
    bejelentkezik, és csak a hozzá rendelt cégek adatait látja.
    **Vázlatos terv, amikor sorra kerül:**
    - `accountants` tábla + `company_accountant_links` (meghívásos/
      elfogadásos hozzárendelés, melyik könyvelő melyik céghez fér hozzá)
    - könyvelői bejelentkezés után külön nézet: csak a hozzárendelt cégek
      dokumentumtára, kategorizálva
    - vállalkozói oldalon feltöltés kategóriával + checklist, hogy mi
      hiányzik még a könyvelő kérése szerint
    - kétirányú megjegyzés-lehetőség
    - Storage + RLS a meglévő `manual_data_uploads`/Storage mintára építve,
      könyvelői szerepkörrel bővített jogosultsággal
    Egyelőre nem kezdtük el — a listán utána következő pontokkal (#6, #7,
    #8) haladunk tovább, ez akkor kerül elő, amikor a sorban ideérünk.
5. ✅ Anomália-jelzés — kész (dashboard). ÁFA-kulcsonként hasonlítja a beszerzést
   (bejövő számla) és az értékesítést (kimenő számla + pénztárgép) a kiválasztott
   időszakra; 2,5x-nél nagyobb arányú, min. 50 000 Ft-os eltérésnél jelez,
   mindkét irányban (hiányzó bejövő számla / hiányzó értékesítési tétel gyanúja)
6. Iparűzési adó-becslő — nettó árbevétel megvan automatikusan, de a levonható tételeket
   (anyagköltség, ELÁBÉ, alvállalkozói díj) kézzel kell majd megadni/kategorizálni
   (szállító-memória + kulcsszó-javaslat + AI-javaslat kombinációja tervezve)
7. Beépített AI-chat asszisztens (cég-specifikus adatra korlátozva + friss adózási hírek)
8. ✅ NAV-határidő-naptár — kész (2026.09.16). Önálló `public/hatarido-naptar.html`
   oldal + dashboard-kártya a legközelebbi 1-2 határidővel
   (`renderUpcomingDeadlinesHtml`). A szabálykészlet (`public/tax-deadlines.js`)
   mindhárom adózási formára (KATA, átalányadó, normál) és az alanyi
   ÁFA-mentességre is lefedi a jellemző határidőket, tudatosan úgy, hogy a
   jövőbeli előfizetők bármelyik formát választva helyes dátumokat kapjanak,
   nem csak a pilot-ügyfélre hangolva. Ehhez a Beállítások oldalon új mező:
   ÁFA-bevallás gyakorisága (havi/negyedéves/éves) — csak akkor jelenik meg,
   ha a cég nem alanyi mentes.
   **TEENDŐ nálad:** a migrációt (`supabase/migrations/
   20260916010000_vat_frequency.sql`) alkalmazni kell Supabase-ben.
   **Tudatos egyszerűsítés:** tájékoztató jellegű, a leggyakoribb
   határidőket mutatja (nincs pl. alkalmazotti bér utáni járulék, mert
   nincs alkalmazott-adat a rendszerben) — ez a naptáron is jelezve van.
   **BŐVÍTVE (2026.09.16), felhasználói visszajelzés alapján ("nincs benne
   a járulékfizetési határidő"):** kutatás a NAV hivatalos adónaptára és
   több forrás (accace.hu, adózóna.hu) alapján — pótoltuk az egyéni
   vállalkozói szocho és TB-járulék határidőket (2026.01.01-től negyedéves,
   nem havi), és bevezettük a hétvégére/munkaszüneti napra eső határidők
   automatikus áttolását a következő munkanapra, Meeus-algoritmussal
   számolt húsvét-függő ünnepekkel — ez minden jövőbeli évre magától
   helyes marad, kézi karbantartás nélkül. Ellenőrizve a 2026-os NAV
   tényleges áttolt dátumaival, pontos egyezés. Új mező a Beállítások
   oldalon: vállalkozási forma (egyéni vállalkozó / társas vállalkozás),
   csak "normál" adózásnál — migráció: `companies.entity_type`.
   **TEENDŐ nálad:** ezt a migrációt is (`supabase/migrations/
   20260916020000_entity_type.sql`) alkalmazni kell Supabase-ben.
   **Amit ez nem tud automatikusan követni:** ha maga a jogszabály
   változik (ahogy idén a szocho/TB-járulék gyakoriságával történt) — ezt
   időnként kézzel érdemes újra átnézni.
   **VÉGLEGESÍTVE (2026.09.16), valós NAV-adattal ellenőrizve:** a
   felhasználó letöltötte a saját NAV Ügyfélportál Adónaptárának .ics
   exportját ("Naptárbejegyzések letöltése" funkció) — ebből kiderült,
   hogy EV-knél/átalányadósoknál NEM vagy-vagy, hanem EGYSZERRE fut egy
   HAVI "08-as" bevallás (kifizetésekkel/juttatásokkal összefüggő adó,
   SZJA-levonás — ezt a 2026-os változás nem érintette) ÉS egy
   NEGYEDÉVES "Járulék bevallás" (szocho+TB-járulék — ez váltott
   negyedévesre). A generált dátumok pontosan egyeznek a valós .ics
   fájllal. Emiatt a korábban bevezetett havi/negyedéves választógomb
   (`jarulek_frequency`) feleslegessé vált (megtévesztő volt, mert nem
   választás kérdése) — eltávolítva, mindkét tétel mindig automatikusan
   megjelenik.
   **Felmerült és ELVETETT ötlet:** automatikus .ics-behúzás minden
   felhasználónál — kiderült, hogy az Adónaptárhoz nincs technikai
   felhasználós API (ellentétben az Online Számla/Pénztárgép API-val),
   csak személyes Ügyfélkapu mögött érhető el, tehát ez ugyanaz a
   biztonsági/jogi kockázat volna, mint a #18-nál már elutasított
   Ügyfélkapu-automatizálás. A felhasználó saját kezű .ics feltöltését is
   elvetettük explicit kérésére — a jövőbeli előfizetők nem fognak
   fájlokat le-/feltöltögetni. Marad az általános, szabály-alapú naptár,
   link a NAV saját Adónaptárára a teljesen pontos, személyre szabott
   adatért.
9. ✅ Export PDF/Excel — kész (PDF: dashboard "PDF-jelentés" gomb; Excel: Adataim
   oldal "Excel exportálása" gomb, a szűrt tételes adatokat exportálja .xlsx-be)
10. ✅ Profi, menüsoros/kártyás vizuális redesign — kész, élesítve mind a 6 oldalon
    (dashboard, adataim, beallitasok: teljes sidebar-váltás; login, register,
    reset-password: szín- és tipográfiai frissítés). Bankos irányba tolva:
    mélyebb intézményi kék, bankkártya-szerű cégazonosító, talpas számtipó.
11. Fizetési/előfizetési rendszer
12. ⏳ Skálázási előkészítés (ha a cégszám tucat/száz fölé nő) — RÉSZBEN KÉSZ
    (2026.09.16).
    **Elv (2026.09.04):** minden olyan funkció, amit most GitHub Actions
    manuális workflow_dispatch-csel indítunk (pl. a #3b számla-pótló
    backfill), csak addig maradhat így, amíg egyetlen (pilot) ügyfél van.
    Több ügyfélnél ezeknek egy gombnyomásra kell működniük a felhasználói
    felületen (Beállítások/dashboard), technikai/GitHub-beavatkozás nélkül —
    hasonlóan, ahogy a #19 "Adatok frissítése" gombot is Edge Function mögé
    tettük.
    **Átvilágítás eredménye (2026.09.16):** a napi szinkron, havi email,
    kétheti emlékeztető, felhasználó-indított gombok (Adatok frissítése,
    Adatpótlás, feltöltés-feldolgozás) mind már jól skálázódnak, cégenkénti
    kódmódosítás nélkül. Két valódi szűk keresztmetszetet találtunk:
    - ✅ **Regisztráció kézi jóváhagyása** — MEGOLDVA: a felhasználóval
      egyeztetve (tudatosan vállalt kockázat: nincs emberi ellenőrzés a
      NAV-adatokon) a `src/auto-approve-registrations.ts` +
      `.github/workflows/auto-approve-registrations.yml` (15 percenként fut)
      most már automatikusan aktiválja az új cégeket, nem kell nekem
      kézzel lefuttatnom a régi `review-registrations.ts`-t (ami megmaradt
      tartalék/hibakereső eszköznek).
    - ✅ **Backup git-repóba írása vég nélkül nőtt** — MEGOLDVA: 30 napos
      retenció bevezetve a `backup-database.yml`-ben (fájlnév-dátum
      alapján, mert git checkout után mtime nem használható). Felmerült
      alternatívaként a Supabase saját napi backup-ja (Pro csomag, kb.
      $25/hó ≈ 9.000-9.500 Ft) — ez még nyitott döntés, egyelőre a git-
      retenció fut, ingyenes.
    **Még hátra (ha tényleg sok cégre nő):** a `daily-opg-sync`/
    `daily-invoice-sync` egyetlen GitHub Actions jobban fut le minden
    cégre — sok tucat/száz cégnél érdemes lehet particionálni vagy
    valódi worker-queue rendszerre váltani.
13. WellData cégadat-automatizálás (most még nem éri meg a költsége: 15.990-37.990 Ft+ÁFA/hó)
14. Könyvelőirodai partnerprogram
15. Homepage
16. Jogi papírok (adatkezelési tájékoztató, ÁSZF) — szándékosan a legvégére, amikor minden
    kész és piacra lépnétek
17. Piac-tágító ötletek: banki egyenleg/cash-flow összekötés, webshop-integráció
    (Shoprenter/UNAS), ingyenes kezdő szint, angol nyelvű verzió
    **Konkrét igény merült fel (2026.09.03):**
    - Meglévő adatok teljesebb kihasználása: szállító neve, fizetési mód
      (kp/kártya), beérkezés dátuma, érték, ÁFA% tételenként — ez részben
      már megvan (`invoice_vat_lines.partner_name`,
      `opg_receipt_payments.payment_type`), de átfogóbb megjelenítés kell.
    - Banki hozzáférés/integráció, hogy a kasszába beütött kártyás összeg
      egyeztethető legyen a tényleges banki kártya-jóváírással (van, hogy
      eltérés van a kettő között).
    - SZÉP-kártyás fizetések külön nyilvántartása — ez csak a bankszámla-
      kivonaton látszik, nincs benne sem a pénztárgép-, sem a
      számla-adatokban, tehát ugyanaz a banki integráció kellene hozzá.
    Egyik sincs még kidolgozva/megbeszélve részletesen a felhasználóval.
18. ⛔ NAV adószámla-lekérdezés egy gombbal — BLOKKOLVA, nincs rá céges technikai
    felhasználós NAV API (ellentétben az Online Számla/Pénztárgép API-kkal),
    csak személyes Ügyfélkapus bejelentkezéssel érhető el a NAV Ügyfélportálon.
    Az Ügyfélkapu-automatizálás (scraping) aránytalanul nagy biztonsági/jogi
    kockázat lenne. Helyette a sidebar menübe (Beállítások alá) került egy
    "NAV adószámla" link (kész, élesítve) — új fülön nyitja meg a NAV
    Ügyfélportál adószámla-oldalát, nem automatizál semmit. Ha a NAV valaha
    kiad hivatalos API-t erre,
    érdemes újranézni.
19. ✅ Manuális "Adatok frissítése" gomb a dashboardon — kész és élesben
    végigtesztelve, működik (`supabase/functions/trigger-sync/` Supabase Edge
    Function indítja a GitHub Actions szinkront, csak az adott cégre). Áttéve
    Vercel-ről Supabase-re, mert a Vercel Custom Environments Pro-only, de ez
    nem kell hozzá — a sima Environment Variables ingyenes is lett volna,
    csak Supabase-re egyszerűbb volt átállni.
    Élesítés közben felmerült és javított hibák (mind megoldva):
    - hiányzott az `apikey` fejléc a hívásból (az új Supabase kulcsrendszeren
      ez is kell, nemcsak a felhasználó saját tokenje)
    - a Supabase platform-rétege ("@supabase/server" wrapper) JSON-ként
      próbálja beolvasni a kérés törzsét — üres body esetén 500-at dobott;
      most `{}`-t küldünk body-ként
    - a "Verify JWT with legacy secret" kapcsolót ki kellett kapcsolni a
      függvénynél (a kód saját maga ellenőrzi a bejelentkezést)
    - a GitHub tokent többször "fine-grained" típusúra hozta létre a
      felhasználó "classic" helyett, ez sosem engedte a workflow-indítást
    - végül a helyes classic PAT (repo + workflow scope) sem másolódott át
      helyesen kézi kijelöléssel — a beépített másoló ikonnal sikerült
20. ✅ Bejelentkezés-hiba javítva — a domain gyökere (`index.html`) korábban egy
    statikus, elavult "Email cím megerősítve" placeholder volt, ami zsákutca
    volt, ha valaki közvetlenül ide navigált. Mostantól teljes értékű, működő
    bejelentkező oldal, és csak akkor mutat megerősítő üzenetet, ha az URL
    ténylegesen `type=signup`/`type=email_change` paramétert tartalmaz. A
    "Cégfókusz" fejléc a login/register/reset-password oldalakon mostantól
    kattintható link a főoldalra (eddig nem volt az, ezért tűnt úgy, mintha
    "visszadobna" egy dead-endre).
