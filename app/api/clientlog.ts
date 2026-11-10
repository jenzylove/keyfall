// Client error reports: the raw reason a move failed, so the plain sentence the player saw can be traced.
// Never receives keys: the client sends the error text and the move name only.
import { cors, originOk } from "./_origin.js";
export default async function handler(req: any, res: any) {
  if (cors(req, res)) return;
  if (req.method !== "POST" || !originOk(req)) return res.status(204).end();
  const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  console.log("[clientlog]", JSON.stringify({ net: String(b.net || "").slice(0, 10), move: String(b.move || "").slice(0, 30), who: String(b.who || "").slice(0, 70), err: String(b.err || "").slice(0, 200), tail: String(b.err || "").slice(-500) }));
  return res.status(204).end();
}
