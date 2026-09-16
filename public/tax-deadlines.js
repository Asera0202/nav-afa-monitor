// A NAV-határidő-naptár szabályai. Szándékosan a leggyakoribb, jellemző
// határidőket tartalmazza minden fő vállalkozási formára (KATA, átalányadó,
// normál/társasági adózás) — nem helyettesíti a könyvelő tájékoztatását,
// tájékoztató jellegű. A `company` objektumból a `tax_regime`,
// `alanyi_mentes` és `vat_frequency` mezőket használja, amikről a
// felhasználó a Beállítások oldalon nyilatkozik.

function pad2(n) {
  return String(n).padStart(2, "0");
}

function iso(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

// A KATA, átalányadó és normál (SZJA/TAO) szabályok is támogatják az
// "alanyi ÁFA-mentes" állapotot — ilyenkor nincs rendszeres ÁFA-bevallás,
// függetlenül az adózási formától.
function generateTaxDeadlines(company, { fromYear, yearsAhead = 1 } = {}) {
  const startYear = fromYear ?? new Date().getFullYear();
  const deadlines = [];

  for (let year = startYear; year <= startYear + yearsAhead; year++) {
    // --- KATA: havi tételes adó befizetése minden hónap 12-ig ---
    if (company.tax_regime === "kata") {
      for (let m = 1; m <= 12; m++) {
        deadlines.push({
          date: iso(year, m, 12),
          title: "KATA tételes adó befizetése",
          description: "A tárgyhavi kisadózói tételes adó befizetésének határideje.",
        });
      }
    }

    // --- Átalányadó: negyedéves SZJA-előleg + éves SZJA-bevallás ---
    if (company.tax_regime === "atalanyado") {
      const quarterlyDates = [
        { m: 4, y: year, label: "I. negyedévre" },
        { m: 7, y: year, label: "II. negyedévre" },
        { m: 10, y: year, label: "III. negyedévre" },
        { m: 1, y: year + 1, label: "IV. negyedévre" },
      ];
      for (const q of quarterlyDates) {
        deadlines.push({
          date: iso(q.y, q.m, 12),
          title: "Átalányadó SZJA-előleg befizetése",
          description: `Az előző negyedévi (${q.label}) személyi jövedelemadó-előleg befizetésének határideje.`,
        });
      }
      deadlines.push({
        date: iso(year, 5, 20),
        title: "Éves SZJA-bevallás (átalányadó)",
        description: "Az előző évi személyi jövedelemadó-bevallás beadásának határideje.",
      });
    }

    // --- Normál/társasági adózás: éves TAO + iparűzési adó ---
    if (company.tax_regime === "normal") {
      deadlines.push({
        date: iso(year, 5, 31),
        title: "Éves társasági adó / SZJA-bevallás",
        description: "Az előző évi társasági adó (vagy SZJA, egyéni vállalkozóknál) bevallásának határideje.",
      });
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
        const quarters = [
          { m: 4, y: year, label: "I. negyedévi" },
          { m: 7, y: year, label: "II. negyedévi" },
          { m: 10, y: year, label: "III. negyedévi" },
          { m: 1, y: year + 1, label: "IV. negyedévi" },
        ];
        for (const q of quarters) {
          deadlines.push({
            date: iso(q.y, q.m, 20),
            title: "Negyedéves ÁFA-bevallás",
            description: `A ${q.label} ÁFA-bevallás beadásának és befizetésének határideje.`,
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
