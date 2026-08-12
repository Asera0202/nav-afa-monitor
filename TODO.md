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
5. Anomália-jelzés (szokatlan ÁFA-kulcs arányok)
6. Iparűzési adó-becslő — nettó árbevétel megvan automatikusan, de a levonható tételeket
   (anyagköltség, ELÁBÉ, alvállalkozói díj) kézzel kell majd megadni/kategorizálni
   (szállító-memória + kulcsszó-javaslat + AI-javaslat kombinációja tervezve)
7. Beépített AI-chat asszisztens (cég-specifikus adatra korlátozva + friss adózási hírek)
8. NAV-határidő-naptár
9. Export PDF/Excel
10. Profi, menüsoros/kártyás vizuális redesign mind az 5 oldalon — koncepció már bemutatva
    (bal oldali sidebar-menü, ikonos kártyák), jóváhagyásra vár, még nincs megépítve
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
