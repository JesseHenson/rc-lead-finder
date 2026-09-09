// Read-only SQL over the lead store.
//
// The tables are the interesting thing about this bundle, and every canned tool
// answers only the question it was built for. This answers the rest — but it is
// deliberately a reader: the store is the record of what was found and what
// Rudy did about it, and a stray UPDATE from a chat message would be silent.

import { all, open } from "../db/client.js";

const TABLES = ["ask", "prospect", "run", "territory"];

// Anything that writes, attaches, or reaches outside the query.
const FORBIDDEN = /\b(insert|update|delete|drop|alter|create|replace|attach|detach|pragma|vacuum|reindex|begin|commit|rollback|savepoint)\b/i;

export function schema() {
  return TABLES.map(t => ({
    table: t,
    columns: all(`PRAGMA table_info(${t})`).map(c => `${c.name} ${c.type}${c.pk ? " PK" : ""}`),
    rows: all(`SELECT COUNT(*) AS n FROM ${t}`)[0]?.n ?? 0,
  }));
}

export function querySql(sql, { limit = 200 } = {}) {
  const text = String(sql || "").trim().replace(/;+\s*$/, "");

  if (!text) throw new Error("Empty query.");
  if (/;/.test(text)) throw new Error("One statement at a time — no semicolons inside the query.");
  if (!/^(select|with)\b/i.test(text)) throw new Error("Read-only: the query must start with SELECT or WITH.");
  if (FORBIDDEN.test(text)) throw new Error("Read-only: that query contains a statement that would change or reach outside the data.");

  // A missing LIMIT on a full table scan is how a tool result blows past the
  // response size and the answer is lost entirely.
  const capped = /\blimit\s+\d+/i.test(text) ? text : `${text} LIMIT ${limit}`;

  const rows = open().prepare(capped).all();
  return {
    row_count: rows.length,
    truncated: rows.length >= limit && !/\blimit\s+\d+/i.test(text),
    rows,
  };
}
