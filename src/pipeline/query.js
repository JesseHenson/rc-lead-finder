// Read-only SQL over the market watch store.
//
// The tables are the interesting thing about this bundle, and every canned tool
// answers only the question it was built for. This answers the rest — but it is
// deliberately a reader: the store is the record of what was found and what
// the owner did about it, and a stray UPDATE from a chat message would be silent.

import { all, open } from "../db/client.js";

const TABLES = ["profile", "service", "source_group", "search_term", "competitor", "sweep", "finding", "report", "ask", "prospect", "run", "territory"];

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
  // A non-numeric limit (e.g. from a loosely-typed tool call) must not become
  // invalid SQL — fall back to the default instead of throwing.
  const cap = Number(limit) > 0 ? Math.floor(Number(limit)) : 200;

  if (!text) throw new Error("Empty query.");
  if (/;/.test(text)) throw new Error("One statement at a time — no semicolons inside the query.");
  if (!/^(select|with)\b/i.test(text)) throw new Error("Read-only: the query must start with SELECT or WITH.");
  if (FORBIDDEN.test(text)) throw new Error("Read-only: that query contains a statement that would change or reach outside the data.");

  // A missing LIMIT on a full table scan is how a tool result blows past the
  // response size and the answer is lost entirely.
  const capped = /\blimit\s+\d+/i.test(text) ? text : `${text} LIMIT ${cap}`;

  const rows = open().prepare(capped).all();
  return {
    row_count: rows.length,
    truncated: rows.length >= cap && !/\blimit\s+\d+/i.test(text),
    rows,
  };
}
