/* ============================================================
 *  origin guard — cuma web https://xs0cietylabsz.biz.id yang boleh
 *  Dipanggil di awal handler: if (!guard(req, res)) return;
 * ============================================================ */

const ALLOWED_ORIGINS = [
  "https://xs0cietylabsz.biz.id",
  "https://www.xs0cietylabsz.biz.id",
];

function originOf(value) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGINS[0]);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Filename, X-Requested-With");
  res.setHeader("Vary", "Origin");
}

module.exports = function originGuard(req, res) {
  // Always attach CORS for allowed domain (browser needs it on error responses too)
  setCors(req, res);

  // Preflight
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return false; // caller should return; preflight handled
  }

  const origin = req.headers.origin;
  const referer = req.headers.referer || req.headers.referrer;

  let ok = false;
  if (origin) {
    ok = ALLOWED_ORIGINS.includes(origin);
  } else if (referer) {
    ok = ALLOWED_ORIGINS.includes(originOf(referer));
  }

  if (ok) return true;

  res.statusCode = 403;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify({
    error: "Forbidden",
    message: "API ini hanya bisa diakses dari https://xs0cietylabsz.biz.id",
  }));
  return false;
};
