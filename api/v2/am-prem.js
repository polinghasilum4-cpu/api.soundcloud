/* ============================================================
   RestAPIdhan — /api/am
   ============================================================
   Base   : https://restapidhan.vercel.app
   Method : GET
   Auth   : apikey (wajib)

   FLOW (3-step):
     1. send(email)                → magic link dikirim ke email
     2. verif(email, url)          → verifikasi link → dapat idToken
     3. apply(idToken)             → eksekusi / ambil hasil
   ============================================================ */

const AM_BASE = 'https://restapidhan.vercel.app';
const AM_KEY  = 'freeapikeydhan26';

/**
 * Core fetcher untuk /api/am
 * @param {'send'|'verif'|'apply'} action
 * @param {Object} params
 * @returns {Promise<Object>}
 */
async function fetchAM(action, params = {}) {
  if (!['send', 'verif', 'apply'].includes(action)) {
    throw new Error(`Action tidak valid: "${action}". Gunakan: send | verif | apply`);
  }

  const query = new URLSearchParams({
    action,
    apikey: AM_KEY,
    ...params
  });

  const url = `${AM_BASE}/api/am?${query.toString()}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Accept': 'application/json' }
  });

  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    const text = await res.text();
    throw new Error(`Response bukan JSON (HTTP ${res.status}): ${text.slice(0, 150)}`);
  }

  const json = await res.json();

  if (!res.ok || json.status === false) {
    throw new Error(json.error || json.message || `HTTP ${res.status}`);
  }

  return json;
}

/* ============================================================
   STEP 1 — SEND
   Kirim magic link ke email
   ============================================================ */
async function amSend(email) {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Email tidak valid');
  }
  return fetchAM('send', { email });
}

/* ============================================================
   STEP 2 — VERIF
   Verifikasi link dari email → dapat idToken
   @param {string} email
   @param {string} url - URL lengkap dari email (magic link)
   ============================================================ */
async function amVerif(email, url) {
  if (!email) throw new Error('Email wajib diisi');
  if (!url)   throw new Error('URL magic link wajib diisi');
  return fetchAM('verif', { email, url });
}

/* ============================================================
   STEP 3 — APPLY
   Eksekusi pakai idToken
   ============================================================ */
async function amApply(idToken) {
  if (!idToken) throw new Error('idToken wajib diisi');
  return fetchAM('apply', { idToken });
}

/* ============================================================
   ORCHESTRATOR — full flow helper
   ============================================================ */
async function amFullFlow({ email, url, idToken }) {
  if (email && url && idToken) {
    const applied = await amApply(idToken);
    return { step: 'apply', applied };
  }
  if (email && url) {
    const verified = await amVerif(email, url);
    return { step: 'verif', verified };
  }
  if (email) {
    const sent = await amSend(email);
    return { step: 'send', sent };
  }
  throw new Error('Minimal butuh email untuk mulai');
}

/* ============================================================
   UI — Panel untuk testing
   ============================================================ */
function amRenderPanel(container) {
  container.innerHTML = `
    <div class="am-panel">
      <div class="am-step">
        <div class="am-step-num">1</div>
        <div class="am-step-body">
          <label>Email</label>
          <input id="amEmail" type="email" placeholder="you@example.com" />
          <button id="amSendBtn">Send Magic Link</button>
          <div id="amSendOut" class="am-out"></div>
        </div>
      </div>
      <div class="am-step">
        <div class="am-step-num">2</div>
        <div class="am-step-body">
          <label>Magic Link URL (dari email)</label>
          <input id="amUrl" type="text" placeholder="https://..." />
          <button id="amVerifBtn">Verify</button>
          <div id="amVerifOut" class="am-out"></div>
        </div>
      </div>
      <div class="am-step">
        <div class="am-step-num">3</div>
        <div class="am-step-body">
          <label>idToken</label>
          <input id="amToken" type="text" placeholder="token..." />
          <button id="amApplyBtn">Apply</button>
          <div id="amApplyOut" class="am-out"></div>
        </div>
      </div>
    </div>
  `;

  const $ = (id) => document.getElementById(id);
  const show = (el, data, isError = false) => {
    el.textContent = typeof data === 'string'
      ? data
      : JSON.stringify(data, null, 2);
    el.classList.toggle('is-error', isError);
  };

  $('amSendBtn').addEventListener('click', async () => {
    const out = $('amSendOut');
    show(out, '⏳ mengirim...');
    try {
      const r = await amSend($('amEmail').value.trim());
      show(out, r);
    } catch (e) {
      show(out, '❌ ' + e.message, true);
    }
  });

  $('amVerifBtn').addEventListener('click', async () => {
    const out = $('amVerifOut');
    show(out, '⏳ memverifikasi...');
    try {
      const r = await amVerif($('amEmail').value.trim(), $('amUrl').value.trim());
      show(out, r);
      // auto-fill idToken jika ada di response
      const tok = r.idToken || r.data?.idToken || r.token;
      if (tok) $('amToken').value = tok;
    } catch (e) {
      show(out, '❌ ' + e.message, true);
    }
  });

  $('amApplyBtn').addEventListener('click', async () => {
    const out = $('amApplyOut');
    show(out, '⏳ apply...');
    try {
      const r = await amApply($('amToken').value.trim());
      show(out, r);
    } catch (e) {
      show(out, '❌ ' + e.message, true);
    }
  });
}

/* ============================================================
   Contoh pemakaian (console)
   ============================================================ */
(async () => {
  try {
    // STEP 1
    const step1 = await amSend('test@example.com');
    console.log('✅ SEND :', step1);
    // → { status: true, message: "Magic link berhasil dikirim ke email. Sesi berlaku 5 menit." }

    // STEP 2 (setelah user klik link di email)
    // const step2 = await amVerif('test@example.com', 'URL_DARI_EMAIL');
    // console.log('✅ VERIF:', step2);
    // → biasanya berisi { status: true, idToken: "..." }

    // STEP 3
    // const step3 = await amApply('ID_TOKEN_DARI_STEP_2');
    // console.log('✅ APPLY:', step3);

  } catch (err) {
    console.error('❌ AM error:', err.message);
  }
})();
