// Every POST route here changes state or spends someone's gas, so it only
// answers the KEYFALL site itself. A browser always sends Origin on a POST
// (same origin included), so a missing Origin means a script, and it is
// refused. localhost is accepted only outside production (`vercel dev`).
// Origin can be forged by a script that sets the header by hand: this is a
// speed bump, not the limit. The limits that hold are in each route (join.ts
// rate limits on chain; hunt and tick only send moves the contract allows).
// The crank does not use these routes: it runs app/npc/tick.mjs directly.
const SITE = [/^https:\/\/(qday|keyfall)\.jdollar\.site$/,/^https:\/\/qday-one\.vercel\.app$/, /^https:\/\/qday-[a-z0-9-]+-jenzyloves-projects\.vercel\.app$/];
const DEV = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function allowed(origin: string): boolean {
  if (!origin) return false;
  if (SITE.some((r) => r.test(origin))) return true;
  return process.env.VERCEL_ENV !== "production" && DEV.test(origin);
}

export function originOk(req: any): boolean {
  return allowed(String(req.headers?.origin || ""));
}

/** Set CORS headers for allowed origins. Returns true when the request was a
 * preflight that has been answered. */
export function cors(req: any, res: any): boolean {
  const origin = String(req.headers?.origin || "");
  if (allowed(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "content-type");
  }
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }
  return false;
}
