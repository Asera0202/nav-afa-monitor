import { queryCashRegisterStatus } from "./opf-client.js";

async function main() {
  const apNumber = process.argv[2] ?? "APA00813560";
  console.log(`OPF státusz-lekérdezés próba: AP=${apNumber}`);
  console.log(`(cél: ${process.env.NAV_ENV === "production" ? "éles" : "teszt"} környezet)\n`);

  try {
    const result = await queryCashRegisterStatus([apNumber]);
    console.log("SIKER — nyers válasz:");
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.log("HIBA:");
    console.log((err as Error).message);
  }
}

main();
