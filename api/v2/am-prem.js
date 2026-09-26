// api/v2/am-prem.js
// Endpoint: /api/v2/am-prem
// Method  : POST / GET
// Wrapper untuk RestAPIdhan /api/am dengan validasi + error handling

const AM_BASE = process.env.AM_BASE || 'https://restapidhan.vercel.app';
const AM_KEY  = process.env.AM_KEY  || 'freeapikeydhan26';

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  try {
    // Ambil input dari GET query atau POST body
    const input = {
      action: req.method === 'GET' ? req.query.action : (req.body && req.body.action),
      email:  req.method === 'GET' ? req.query.email  : (req.body && req.body.email),
      url:    req.method === 'GET' ? req.query.url    : (req.body && req.body.url),
      idToken:req.method === 'GET' ? req.query.idToken: (req.body && req.body.idToken),
    };

    if (!input.action) {
      return res.status(400).json({
        status: false,
        error: 'Parameter "action" wajib diisi (send | verif | apply)'
      });
    }

    if (!['send', 'verif', 'apply'].includes(input.action)) {
      return res.status(400).json({
        status: false,
        error: `Action tidak valid: "${input.action}". Gunakan: send | verif | apply`
      });
    }

    // Bangun query ke upstream
    const qs = new URLSearchParams({ action: input.action, apikey: AM_KEY });
    if (input.email)   qs.set('email', input.email);
    if (input.url)     qs.set('url', input.url);
    if (input.idToken) qs.set('idToken', input.idToken);

    const upstreamUrl = `${AM_BASE}/api/am?${qs.toString()}`;

    // Fetch upstream dengan timeout manual (Node 18+ punya global fetch)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    let upstreamRes;
    try {
      upstreamRes = await fetch(upstreamUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const text = await upstreamRes.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res.status(502).json({
        status: false,
        error: 'Upstream bukan JSON',
        raw: text.slice(0, 300),
      });
    }

    return res.status(upstreamRes.status).json(data);

  } catch (err) {
    // Apapun yang terjadi, selalu balikin JSON supaya Vercel tidak render halaman error
    const message = err && err.message ? err.message : 'Unknown error';
    const isAbort = err && err.name === 'AbortError';
    return res.status(isAbort ? 504 : 500).json({
      status: false,
      error: isAbort ? 'Upstream timeout' : message,
      hint: 'Cek logs Vercel untuk detail stack trace'
    });
  }
};
