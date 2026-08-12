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

1. Házipénztár-egyeztetés (készpénz-eltérés jelzése)
2. ✅ E-nyugta felkészültség-jelző (2026.09.01-i kötelezettség) — kész (dashboard,
   a `cash_registers` tábla alapján személyre szabott zöld/sárga jelzés)
3. KOBAK-import (kell hozzá minta-fájl)
4. Könyvelői egyeztetés-feltöltés (főkönyvi kivonat, "lekönyveletlen tétel" felismerés)
5. ✅ Anomália-jelzés — kész (dashboard). ÁFA-kulcsonként hasonlítja a beszerzést
   (bejövő számla) és az értékesítést (kimenő számla + pénztárgép) a kiválasztott
   időszakra; 2,5x-nél nagyobb arányú, min. 50 000 Ft-os eltérésnél jelez,
   mindkét irányban (hiányzó bejövő számla / hiányzó értékesítési tétel gyanúja)
6. Iparűzési adó-becslő — nettó árbevétel megvan automatikusan, de a levonható tételeket
   (anyagköltség, ELÁBÉ, alvállalkozói díj) kézzel kell majd megadni/kategorizálni
   (szállító-memória + kulcsszó-javaslat + AI-javaslat kombinációja tervezve)
7. Beépített AI-chat asszisztens (cég-specifikus adatra korlátozva + friss adózási hírek)
8. NAV-határidő-naptár
9. ✅ Export PDF/Excel — kész (PDF: dashboard "PDF-jelentés" gomb; Excel: Adataim
   oldal "Excel exportálása" gomb, a szűrt tételes adatokat exportálja .xlsx-be)
10. ✅ Profi, menüsoros/kártyás vizuális redesign — kész, élesítve mind a 6 oldalon
    (dashboard, adataim, beallitasok: teljes sidebar-váltás; login, register,
    reset-password: szín- és tipográfiai frissítés). Bankos irányba tolva:
    mélyebb intézményi kék, bankkártya-szerű cégazonosító, talpas számtipó.
11. Fizetési/előfizetési rendszer
12. Skálázási előkészítés (ha a cégszám tucat/száz fölé nő)
13. WellData cégadat-automatizálás (most még nem éri meg a költsége: 15.990-37.990 Ft+ÁFA/hó)
14. Könyvelőirodai partnerprogram
15. Homepage
16. Jogi papírok (adatkezelési tájékoztató, ÁSZF) — szándékosan a legvégére, amikor minden
    kész és piacra lépnétek
17. Piac-tágító ötletek: banki egyenleg/cash-flow összekötés, webshop-integráció
    (Shoprenter/UNAS), ingyenes kezdő szint, angol nyelvű verzió
18. NAV adószámla-lekérdezés egy gombbal
19. ✅ Manuális "Adatok frissítése" gomb a dashboardon — kész
    (`supabase/functions/trigger-sync/` Supabase Edge Function indítja a
    GitHub Actions szinkront, csak az adott cégre). Áttéve Vercel-ről
    Supabase-re, mert a Vercel Custom Environments Pro-only, de ez nem
    kell hozzá — a sima Environment Variables (amit itt használtunk volna)
    ingyenes is lett volna, csak Supabase-re egyszerűbb volt átállni.
    **TEENDŐ nálad:** Supabase CLI-vel be kell állítani a `GITHUB_DISPATCH_TOKEN`
    titkos kulcsot és deployolni a függvényt (lásd README "Manuális 'Adatok
    frissítése' gomb" szakasz) — enélkül a gomb hibát fog dobni.
