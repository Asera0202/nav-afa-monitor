import { queryCashRegister } from "./nav-client.js";

async function main() {
  const apNumber = process.argv[2] ?? "APA00813560";
  const fileStart = process.argv[3] ?? "0001";
  const fileEnd = process.argv[4] ?? "0005";

  console.log(`Pénztárgép-lekérdezés próba: AP=${apNumber}, fájlszám ${fileStart}-${fileEnd}`);
  console.log(`(cél URL: ${process.env.NAV_ENV === "production" ? "éles" : "teszt"} környezet, queryCashRegister)\n`);

  try {
    const { raw } = await queryCashRegister({
      apNumber,
      fileNumberStart: fileStart,
      fileNumberEnd: fileEnd,
    });
    console.log("SIKER — nyers válasz:");
    console.log(JSON.stringify(raw, null, 2));
  } catch (err) {
    console.log("HIBA (ez is hasznos infó — ebből pontosítunk):");
    console.log((err as Error).message);
  }
}

main();
