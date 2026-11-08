// Requests from a browser must come from the Q-DAY site itself. Server to
// server callers (no Origin header, such as the crank) are allowed.
const ALLOWED = [/^https:\/\/qday\.jdollar\.site$/, /^https:\/\/qday-one\.vercel\.app$/, /^https:\/\/qday-[a-z0-9-]+-jenzyloves-projects\.vercel\.app$/, /^http:\/\/localhost(:\d+)?$/];

export function originOk(req: any): boolean {
  const origin = String(req.headers?.origin || "");
  if (!origin) return true;
  return ALLOWED.some((r) => r.test(origin));
}
