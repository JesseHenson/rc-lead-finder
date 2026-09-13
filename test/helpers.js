import { run } from "../src/db/client.js";

// Every test file shares one database per run (see package.json). Watch tests
// start from empty watch tables rather than assuming file order.
export function resetWatch() {
  for (const t of ["finding", "report", "sweep", "competitor", "search_term", "source_group", "service", "profile"])
    run(`DELETE FROM ${t}`);
}
