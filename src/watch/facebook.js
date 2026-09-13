// Runs inside a Facebook group search page, via Claude in Chrome's
// javascript_tool. It is never called in Node: facebookScript() serialises it.
//
// Verified on live pages, 2026-09:
// - A single javascript_tool call is cancelled at 45s, so this starts a
//   background job on window.__watch and returns at once; poll FACEBOOK_POLL.
// - Post links only fill in after ONE trusted mouse move per page load
//   (computer hover), then focus + pointerdown on the timestamp link.
// - The timestamp link is the first link on the card whose path is the search
//   page itself (a placeholder) or already a /posts/ path.
// - The tooltip shows the exact date. The previous tooltip must be dismissed
//   first; two real posts can share the same minute, so equal times are fine.
// - Cards re-render on scroll and hover: re-find the card by text every step.
// - Return paths only. The browser tool refuses output containing query strings.

export function facebookJob({ sinceMs, max, budgetMs }) {
  const W = (window.__watch = { status: "running", out: [], started: Date.now(), stop_reason: null });
  const P = a => { try { return new URL(a.href, location.origin).pathname; } catch { return ""; } };
  const here = location.pathname;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const fire = (a, types) => types.forEach(t =>
    a.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window, button: 0 })));
  const OUT = ["pointerout", "pointerleave", "mouseout", "mouseleave"];
  const OVER = ["pointerover", "pointerenter", "mouseover", "mouseenter", "mousemove"];
  const SEL = '[data-ad-comet-preview="message"],[data-ad-preview="message"]';
  const norm = s => (s || "").replace(/\s+/g, " ").trim();
  const bodyFor = key => [...document.querySelectorAll(SEL)].find(x => norm(x.innerText).startsWith(key));
  const cardFor = key => {
    const b = bodyFor(key);
    if (!b) return null;
    let el = b, card = b;
    for (let i = 0; i < 18 && el.parentElement; i++) {
      el = el.parentElement;
      if ((el.innerText || "").length > 3000) break;
      card = el;
    }
    return card;
  };
  const tsA = card => card
    ? [...card.querySelectorAll("a[href]")].find(a => { const p = P(a); return p === here || /\/posts\//.test(p); })
    : null;
  const tip = () => [...document.querySelectorAll('[role="tooltip"]')].map(x => norm(x.innerText)).filter(Boolean).pop() || "";
  const when = t => {
    const ms = Date.parse(t.replace(/^[A-Za-z]+,\s*/, "").replace(/\s+at\s+/i, " "));
    return Number.isFinite(ms) ? ms : null;
  };

  (async () => {
    const seen = new Set();
    const t0 = Date.now();
    const timeLeft = () => Date.now() - t0 < budgetMs;
    let idle = 0;

    for (let pass = 0; pass < 25 && W.out.length < max && timeLeft() && !W.stop_reason; pass++) {
      const keys = [...document.querySelectorAll(SEL)].map(b => norm(b.innerText)).filter(Boolean).map(t => t.slice(0, 40));
      let fresh = 0;

      for (const key of keys) {
        if (W.out.length >= max || !timeLeft() || W.stop_reason) break;
        if (seen.has(key)) continue;
        seen.add(key);
        fresh++;

        const card = cardFor(key);
        if (!card) continue;
        const text = norm(bodyFor(key)?.innerText).slice(0, 400);
        const author = [...card.querySelectorAll('a[href*="/user/"]')]
          .map(a => norm(a.getAttribute("aria-label") || a.innerText)).find(Boolean) || null;

        let a = tsA(card);
        if (!a) { W.out.push({ author, text, time: null, link: null, note: "no timestamp link" }); continue; }
        a.scrollIntoView({ block: "center" });
        await sleep(250);

        a = tsA(cardFor(key));
        if (a) fire(a, OUT);
        for (let k = 0; k < 5 && tip(); k++) await sleep(200);
        await sleep(300);

        a = tsA(cardFor(key));
        if (a) fire(a, OVER);
        let time = null;
        for (let k = 0; k < 10 && !time; k++) {
          await sleep(200);
          const t = tip();
          if (/\d{4}/.test(t)) time = t.slice(0, 60);
        }

        let link = null;
        const cur = tsA(cardFor(key));
        const already = cur ? P(cur) : "";
        if (/\/posts\/\d+/.test(already)) link = already;
        else if (cur) {
          cur.focus?.();
          fire(cur, ["pointerdown", "mousedown"]);
          for (let k = 0; k < 10 && !link; k++) {
            await sleep(200);
            const cc = cardFor(key);
            link = (cc && [...cc.querySelectorAll("a[href]")].map(P).find(p => /\/posts\/\d+/.test(p))) || null;
          }
        }
        const end = tsA(cardFor(key));
        if (end) { fire(end, OUT); end.blur?.(); }

        const ms = time ? when(time) : null;
        if (ms && ms < sinceMs) { W.stop_reason = "reached posts older than the last sweep"; break; }
        W.out.push({ author, text, time, link });
      }

      idle = fresh ? 0 : idle + 1;
      if (idle >= 3) { W.stop_reason = W.stop_reason || "no more results"; break; }
      window.scrollBy(0, 600);
      await sleep(1000);
    }

    W.stop_reason = W.stop_reason || (W.out.length >= max ? "hit the per-search cap" : "time budget used");
    W.seconds = Math.round((Date.now() - t0) / 1000);
    W.status = "done";
  })().catch(e => { W.status = "error: " + String(e).slice(0, 120); });

  return "started";
}

export function facebookScript({ sinceMs, max = 15, budgetMs = 80000 }) {
  return `(${facebookJob.toString()})(${JSON.stringify({ sinceMs: Number(sinceMs), max: Number(max), budgetMs: Number(budgetMs) })})`;
}

export const FACEBOOK_POLL =
  "JSON.stringify(window.__watch ? { status: window.__watch.status, stop_reason: window.__watch.stop_reason, " +
  "collected: window.__watch.out.length, seconds: window.__watch.seconds ?? Math.round((Date.now() - window.__watch.started) / 1000), " +
  "out: window.__watch.status === 'done' ? window.__watch.out : undefined } : { status: 'not started' })";
