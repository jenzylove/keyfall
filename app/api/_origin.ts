// Requests from a browser must come from the Q-DAY site itself (or a local dev
// server). Server to server callers (no Origin header, such as the crank) are
// allowed.
const ALLOWED = [/^https:\/\/qday\.jdollar\.site$/, /^https:\/\/qday-one\.vercel\.app$/, /^https:\/\/qday-[a-z0-9-]+-jenzyloves-projects\.vercel\.app$/, /^http:\/\/localhost(:\d+)?$/];

export function originOk(req: any): boolean {
  const origin = String(req.headers?.origin || "");
  if (!origin) return true;
  return ALLOWED.some((r) => r.test(origin));
}

/** Set CORS headers for allowed origins. Returns true when the request was a
 * preflight that has been answered. */
export function cors(req: any, res: any): boolean {
  const origin = String(req.headers?.origin || "");
  if (origin && ALLOWED.some((r) => r.test(origin))) {
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
