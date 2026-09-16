// A NAV-határidő-naptár szabályai. Szándékosan a leggyakoribb, jellemző
// határidőket tartalmazza minden fő vállalkozási formára (KATA, átalányadó,
// normál/társasági adózás) — nem helyettesíti a könyvelő tájékoztatását,
// tájékoztató jellegű. A `company` objektumból a `tax_regime`,
// `alanyi_mentes`, `vat_frequency` és `entity_type` mezőket használja,
// amikről a felhasználó a Beállítások oldalon nyilatkozik.
//
// FONTOS, ami miatt ez a naptár "magától" frissül minden évre, hozzáadott
// karbantartás nélkül: a szabályok NEM konkrét dátumokat tartalmaznak,
// hanem képleteket ("a negyedévet követő hónap 12-ig" stb.), amikből minden
// jövőbeli évre helyesen újraszámolódik a pontos naptári dátum — plusz a
// magyar munkaszüneti napokra és hétvégére eső határidőket automatikusan
// a következő munkanapra tolja, ugyanúgy, ahogy a NAV hivatalos adónaptára
// is teszi. Amit ez NEM tud automatikusan követni: ha maga a jogszabály
// változik (pl. 2026.01.01-től a szocho/TB-járulék havi helyett negyedéves
// bevallásra állt át egyéni vállalkozóknál — ezt a változást a kutatásunk
// alapján 2026.09-én kézzel vezettük be). Ilyen jogszabályváltozásokat
// időnként érdemes újra átnézni.

function pad2(n) {
  return String(n).padStart(2, "0");
}

function iso(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

// --- Magyar munkaszüneti napok (13 db/év: fix dátumok + húsvéthez kötött
// mozgó ünnepek). Meeus/Jones/Butcher-algoritmus a húsvétvasárnap
// kiszámításához, ebből származtatva minden évre automatikusan. ---
function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function addDaysUtc(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function toIsoUtc(date) {
  return date.toISOString().slice(0, 10);
}

function hungarianPublicHolidays(year) {
  const easter = easterSunday(year);
  return new Set([
    iso(year, 1, 1), // Újév
    iso(year, 3, 15), // Nemzeti ünnep
    toIsoUtc(addDaysUtc(easter, -2)), // Nagypéntek
    toIsoUtc(easter), // Húsvétvasárnap
    toIsoUtc(addDaysUtc(easter, 1)), // Húsvéthétfő
    iso(year, 5, 1), // A munka ünnepe
    toIsoUtc(addDaysUtc(easter, 49)), // Pünkösdvasárnap
    toIsoUtc(addDaysUtc(easter, 50)), // Pünkösdhétfő
    iso(year, 8, 20), // Államalapítás ünnepe
    iso(year, 10, 23), // Nemzeti ünnep
    iso(year, 11, 1), // Mindenszentek
    iso(year, 12, 25), // Karácsony
    iso(year, 12, 26), // Karácsony másnapja
  ]);
}

const holidayCache = new Map();
function isNonBusinessDay(dateIso) {
  const [y, , ] = dateIso.split("-").map(Number);
  const dow = new Date(dateIso + "T00:00:00Z").getUTCDay();
  if (dow === 0 || dow === 6) return true;
  if (!holidayCache.has(y)) holidayCache.set(y, hungarianPublicHolidays(y));
  return holidayCache.get(y).has(dateIso);
}

// A NAV gyakorlatával egyezően: ha egy határidő hétvégére vagy
// munkaszüneti napra esik, a következő munkanapra tolódik.
function shiftToNextBusinessDay(dateIso) {
  let d = new Date(dateIso + "T00:00:00Z");
  let shifted = false;
  while (isNonBusinessDay(toIsoUtc(d))) {
    d = addDaysUtc(d, 1);
    shifted = true;
  }
  return { date: toIsoUtc(d), shifted };
}

function quarterlyDates(year) {
  return [
    { m: 4, y: year, label: "I. negyedévre" },
    { m: 7, y: year, label: "II. negyedévre" },
    { m: 10, y: year, label: "III. negyedévre" },
    { m: 1, y: year + 1, label: "IV. negyedévre" },
  ];
}

// A KATA, átalányadó és normál (SZJA/TAO) szabályok is támogatják az
// "alanyi ÁFA-mentes" állapotot — ilyenkor nincs rendszeres ÁFA-bevallás,
// függetlenül az adózási formától.
function generateTaxDeadlines(company, { fromYear, yearsAhead = 1 } = {}) {
  const startYear = fromYear ?? new Date().getFullYear();
  const deadlines = [];
  // Kata/átalányadó mindig egyéni vállalkozó; "normál" adózásnál a
  // felhasználó nyilatkozik erről (entity_type: 'ev' vagy 'tarsas').
  const entityType = company.tax_regime === "normal" ? (company.entity_type || "ev") : "ev";

  for (let year = startYear; year <= startYear + yearsAhead; year++) {
    // --- KATA: havi tételes adó befizetése minden hónap 12-ig ---
    if (company.tax_regime === "kata") {
      for (let m = 1; m <= 12; m++) {
        deadlines.push({
          date: iso(year, m, 12),
          title: "KATA tételes adó befizetése",
          description: "A tárgyhavi kisadózói tételes adó befizetésének határideje. A KATA ezt a szociális hozzájárulási adót és a TB-járulékot is magában foglalja, külön járulékfizetés nem szükséges.",
        });
      }
    }

    // --- Átalányadó / normál egyéni vállalkozó: negyedéves SZJA-előleg +
    // szocho + TB-járulék (2026.01.01-től egységesen negyedéves, a
    // negyedévet követő hónap 12-ig), plusz éves SZJA-bevallás ---
    if (company.tax_regime === "atalanyado" || (company.tax_regime === "normal" && entityType === "ev")) {
      for (const q of quarterlyDates(year)) {
        deadlines.push({
          date: iso(q.y, q.m, 12),
          title: "Negyedéves SZJA-előleg, szocho és TB-járulék befizetése",
          description: `Az előző negyedévi (${q.label}) személyijövedelemadó-előleg, szociális hozzájárulási adó és társadalombiztosítási járulék bevallásának és befizetésének határideje (2026-tól ezek egységesen negyedévesek egyéni vállalkozóknál).`,
        });
      }
      deadlines.push({
        date: iso(year, 5, 20),
        title: "Éves SZJA-bevallás",
        description: "Az előző évi személyi jövedelemadó-bevallás beadásának határideje.",
      });
    }

    // --- Normál/társasági adózás (Kft/Bt/Zrt): éves TAO + iparűzési adó ---
    if (company.tax_regime === "normal" && entityType === "tarsas") {
      deadlines.push({
        date: iso(year, 5, 31),
        title: "Éves társasági adó bevallása",
        description: "Az előző évi társasági adó bevallásának határideje.",
      });
    }

    // --- Helyi iparűzési adó: normál adózásnál (EV és társas is) ---
    if (company.tax_regime === "normal") {
      deadlines.push({
        date: iso(year, 5, 31),
        title: "Éves helyi iparűzési adó bevallása",
        description: "Az előző évi helyi iparűzési adó bevallásának határideje.",
      });
      deadlines.push({
        date: iso(year, 3, 15),
        title: "Helyi iparűzési adó előleg (I. félév)",
        description: "Az első féléves iparűzésiadó-előleg befizetésének határideje.",
      });
      deadlines.push({
        date: iso(year, 9, 15),
        title: "Helyi iparűzési adó előleg (II. félév)",
        description: "A második féléves iparűzésiadó-előleg befizetésének határideje.",
      });
    }

    // --- ÁFA-bevallás: minden formánál lehetséges, ha nem alanyi mentes ---
    if (!company.alanyi_mentes) {
      const freq = company.vat_frequency || "negyedeves";
      if (freq === "havi") {
        for (let m = 1; m <= 12; m++) {
          const dueYear = m === 12 ? year + 1 : year;
          const dueMonth = m === 12 ? 1 : m + 1;
          deadlines.push({
            date: iso(dueYear, dueMonth, 20),
            title: "Havi ÁFA-bevallás",
            description: `A(z) ${year}. ${pad2(m)}. havi ÁFA-bevallás beadásának és befizetésének határideje.`,
          });
        }
      } else if (freq === "negyedeves") {
        for (const q of quarterlyDates(year)) {
          deadlines.push({
            date: iso(q.y, q.m, 20),
            title: "Negyedéves ÁFA-bevallás",
            description: `A ${q.label.replace("re", "i")} ÁFA-bevallás beadásának és befizetésének határideje.`,
          });
        }
      } else if (freq === "eves") {
        deadlines.push({
          date: iso(year + 1, 2, 25),
          title: "Éves ÁFA-bevallás",
          description: `A(z) ${year}. évi ÁFA-bevallás beadásának és befizetésének határideje.`,
        });
      }
    }
  }

  // Hétvégére/munkaszüneti napra eső határidők automatikus áttolása a
  // következő munkanapra — a NAV hivatalos adónaptárának gyakorlata szerint.
  for (const d of deadlines) {
    const { date, shifted } = shiftToNextBusinessDay(d.date);
    if (shifted) {
      d.originalDate = d.date;
      d.date = date;
      d.description += ` (Az eredeti határidő hétvégére/munkaszüneti napra esett, ezért a következő munkanapra, ${date}-ra tolódott.)`;
    }
  }

  deadlines.sort((a, b) => a.date.localeCompare(b.date));
  return deadlines;
}

function upcomingTaxDeadlines(company, { limit = 5, fromDate } = {}) {
  const todayIso = (fromDate ?? new Date()).toISOString().slice(0, 10);
  const all = generateTaxDeadlines(company, { yearsAhead: 1 });
  return all.filter((d) => d.date >= todayIso).slice(0, limit);
}

function daysUntil(dateIso, fromDate) {
  const today = fromDate ?? new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const target = new Date(dateIso + "T00:00:00");
  return Math.round((target - todayMidnight) / 86400000);
}
