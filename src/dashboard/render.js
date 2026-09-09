import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PLACEHOLDER = "/*__DATA__*/";

// Inlines data.json into template.html and writes dashboard.html.
// The bundle is stdio-only: a file:// page cannot fetch a sibling JSON, so the
// data has to live inside the HTML. Called by every dashboard_affecting operation.
export async function renderDashboard(data, outPath) {
  const template = await readFile(join(HERE, "template.html"), "utf8");
  const start = template.indexOf(PLACEHOLDER);
  if (start === -1) throw new Error("template.html is missing the /*__DATA__*/ marker");

  // Replace the marker and the literal that follows it, up to end of that statement.
  const lineEnd = template.indexOf("\n", start);
  const head = template.slice(0, start);
  const tail = template.slice(lineEnd);
  const json = JSON.stringify(data).replace(/</g, "\\u003c");

  await writeFile(outPath, `${head}${PLACEHOLDER}${json};${tail}`, "utf8");
  return outPath;
}

// node src/dashboard/render.js <data.json> <out.html>
if (process.argv[1] && process.argv[1].endsWith("render.js")) {
  const [, , dataPath, outPath] = process.argv;
  const data = JSON.parse(await readFile(dataPath, "utf8"));
  console.log(await renderDashboard(data, outPath));
}
