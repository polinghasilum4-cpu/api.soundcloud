/**
 * mail.tm — Temp Mail Client
 * Node.js 18+ / Browser (modern)
 * 
 * Run: node test-mailtm.js
 */

const API = 'https://api.mail.tm';

// ============================================================
//  HELPERS
// ============================================================
const G = '\x1b[92m';   // green
const R = '\x1b[91m';   // red
const Y = '\x1b[93m';   // yellow
const C = '\x1b[96m';   // cyan
const B = '\x1b[94m';   // blue
const X = '\x1b[0m';    // reset

function log(icon, msg, color = '') {
    console.log(`${color}${icon} ${msg}${X}`);
}

function sep(title) {
    console.log(`\n${C}${'='.repeat(62)}${X}`);
    console.log(`${C}  ${title}${X}`);
    console.log(`${C}${'='.repeat(62)}${X}\n`);
}

function genUsername() {
    const hex = Array.from({ length: 8 }, () =>
        Math.floor(Math.random() * 16).toString(16)
    ).join('');
    const num = Math.floor(Math.random() * 90) + 10;
    return `${hex}${num}`;
}

function genPassword() {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%';
    let pwd = '';
    for (let i = 0; i < 14; i++) {
        pwd += chars[Math.floor(Math.random() * chars.length)];
    }
    return pwd;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));


// ============================================================
//  CLASS TempMail
// ============================================================
class TempMail {
    constructor(opts = {}) {
        this.api = opts.api || API;
        this.email = null;
        this.password = null;
        this.token = null;
        this.accountId = null;
        this.onProgress = opts.onProgress || (() => {});
    }

    _emit(step, info = {}) {
        try { this.onProgress(step, info); } catch (_) {}
    }

    _headers(extra = {}) {
        const h = {
            'accept': 'application/json',
            ...extra
        };
        if (this.token) {
            h['authorization'] = `Bearer ${this.token}`;
        }
        return h;
    }

    async _fetch(path, opts = {}) {
        const url = `${this.api}${path}`;
        const headers = this._headers(opts.headers || {});
        const res = await fetch(url, { ...opts, headers });
        const text = await res.text();
        let data;
        try {
            data = text ? JSON.parse(text) : {};
        } catch (_) {
            data = { raw: text };
        }
        return { ok: res.ok, status: res.status, data };
    }

    // -------- getDomains --------
    async getDomains() {
        this._emit('domains:start', {});
        const res = await this._fetch('/domains?page=1');
        if (!res.ok) {
            throw new Error(`Get domains gagal: HTTP ${res.status}`);
        }
        const members = Array.isArray(res.data)
            ? res.data
            : (res.data['hydra:member'] || []);
        const active = members.filter(d =>
            d && d.isActive !== false && d.is_active !== false
        );
        if (!active.length) throw new Error('Gak ada domain aktif');
        this._emit('domains:done', {
            total: members.length,
            active: active.length,
            domain: active[0].domain
        });
        return active;
    }

    // -------- create (register + login) --------
    async create(opts = {}) {
        const maxRetry = opts.maxRetry || 5;
        const domains = await this.getDomains();
        const domain = domains[0].domain;

        this._emit('account:start', { domain });

        for (let attempt = 1; attempt <= maxRetry; attempt++) {
            const username = genUsername();
            const password = genPassword();
            const address = `${username}@${domain}`;

            this._emit('account:attempt', { attempt, address });

            try {
                // Register
                const reg = await this._fetch('/accounts', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ address, password })
                });

                if (!reg.ok) {
                    this._emit('account:register_fail', {
                        status: reg.status,
                        msg: reg.data?.detail || reg.data?.message || 'unknown'
                    });
                    await sleep(1000);
                    continue;
                }

                // Login
                const login = await this._fetch('/token', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ address, password })
                });

                if (!login.ok || !login.data?.token) {
                    this._emit('account:login_fail', { status: login.status });
                    await sleep(1000);
                    continue;
                }

                this.email = address;
                this.password = password;
                this.token = login.data.token;
                this.accountId = login.data.id;

                this._emit('account:done', {
                    email: this.email,
                    id: this.accountId
                });

                return {
                    email: this.email,
                    password: this.password,
                    token: this.token,
                    id: this.accountId
                };
            } catch (e) {
                this._emit('account:error', { attempt, msg: e.message });
                await sleep(1000);
            }
        }

        throw new Error(`Gagal bikin akun setelah ${maxRetry} percobaan`);
    }

    // -------- me --------
    async me() {
        const res = await this._fetch('/me');
        if (!res.ok) throw new Error(`Get me gagal: HTTP ${res.status}`);
        return res.data;
    }

    // -------- getInbox --------
    async getInbox(page = 1) {
        if (!this.token) throw new Error('Belum login');
        const res = await this._fetch(`/messages?page=${page}`);
        if (!res.ok) throw new Error(`Get inbox gagal: HTTP ${res.status}`);
        const members = Array.isArray(res.data)
            ? res.data
            : (res.data['hydra:member'] || []);
        this._emit('inbox:done', { count: members.length });
        return members;
    }

    // -------- readMessage --------
    async readMessage(id) {
        if (!this.token) throw new Error('Belum login');
        const res = await this._fetch(`/messages/${id}`);
        if (!res.ok) throw new Error(`Read message gagal: HTTP ${res.status}`);
        const m = res.data;

        let body = '';
        if (m.text) {
            body = m.text;
        } else if (m.html) {
            const raw = Array.isArray(m.html) ? m.html.join('') : m.html;
            body = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        }

        return {
            id: m.id,
            from: m.from || {},
            to: m.to || [],
            subject: m.subject || '(tanpa subjek)',
            intro: m.intro || '',
            body: body || '(pesan kosong)',
            createdAt: m.createdAt,
            hasAttachments: m.hasAttachments || false,
            attachments: m.attachments || []
        };
    }

    // -------- deleteMessage --------
    async deleteMessage(id) {
        const res = await this._fetch(`/messages/${id}`, { method: 'DELETE' });
        return res.ok;
    }

    // -------- deleteAccount --------
    async deleteAccount() {
        if (!this.accountId) return false;
        const res = await this._fetch(`/accounts/${this.accountId}`, {
            method: 'DELETE'
        });
        return res.ok;
    }

    isActive() {
        return !!this.token;
    }

    reset() {
        this.email = null;
        this.password = null;
        this.token = null;
        this.accountId = null;
    }
}


// ============================================================
//  MAIN — Test Full Flow
// ============================================================
async function main() {
    console.log(`\n${B}${'='.repeat(62)}${X}`);
    console.log(`${B}  🧪 mail.tm Temp Mail — JS Test${X}`);
    console.log(`${B}${'='.repeat(62)}${X}\n`);

    const tm = new TempMail({
        onProgress: (step, info) => {
            // Log tiap step
            if (step === 'domains:done') {
                log('✓', `Domain aktif: ${info.active}/${info.total} → ${info.domain}`, G);
            } else if (step === 'account:attempt') {
                log('🔄', `Attempt ${info.attempt}: ${info.address}`, Y);
            } else if (step === 'account:register_fail') {
                log('⚠️', `Register fail: ${info.msg}`, Y);
            } else if (step === 'account:done') {
                log('✓', `Akun jadi: ${info.email}`, G);
            } else if (step === 'inbox:done') {
                log('✓', `Inbox: ${info.count} pesan`, G);
            }
        }
    });

    try {
        // 1. Bikin akun
        sep('1️⃣  CREATE ACCOUNT');
        const acc = await tm.create();

        log('📧', `Email    : ${acc.email}`, C);
        log('🔑', `Password : ${acc.password}`, C);
        log('🎫', `Token    : ${acc.token.substring(0, 40)}...`, C);

        // 2. Cek /me
        sep('2️⃣  GET /ME');
        const me = await tm.me();
        log('✓', `ID       : ${me.id}`, G);
        log('✓', `Verified : ${me.isVerified}`, G);

        // 3. Ambil inbox
        sep('3️⃣  GET INBOX');
        let inbox = await tm.getInbox();
        log('📬', `Total pesan: ${inbox.length}`, C);

        if (inbox.length > 0) {
            for (const m of inbox.slice(0, 3)) {
                log('', `   • ${m.subject || '(tanpa subjek)'}`, Y);
                log('', `     Dari: ${m.from?.address || '?'}`, Y);
            }
        } else {
            log('ℹ️', 'Inbox kosong', Y);
        }

        // 4. Kalau ada pesan, baca yang pertama
        if (inbox.length > 0) {
            sep('4️⃣  READ MESSAGE');
            const msg = await tm.readMessage(inbox[0].id);
            log('📩', `Subjek: ${msg.subject}`, C);
            log('👤', `Dari  : ${msg.from?.address || '?'}`, C);
            log('📅', `Waktu : ${new Date(msg.createdAt).toLocaleString('id-ID')}`, C);
            log('', '');
            log('', '─── BODY ───', Y);
            console.log(msg.body.substring(0, 500));
        }

        // 5. Polling manual (opsional)
        sep('5️⃣  POLLING INBOX (30 detik)');
        log('ℹ️', `Kirim email dari akun lain ke: ${acc.email}`, Y);
        log('', '');

        let found = false;
        for (let i = 1; i <= 6; i++) {
            await sleep(5000);
            const msgs = await tm.getInbox();
            log(`${i}`, `Polling #${i}: ${msgs.length} pesan`, Y);
            if (msgs.length > inbox.length) {
                log('✓', 'Ada pesan baru!', G);
                for (const m of msgs) {
                    log('', `   📩 ${m.subject || '(tanpa subjek)'}`, C);
                }
                found = true;
                break;
            }
        }

        if (!found) {
            log('ℹ️', 'Belum ada pesan baru (normal kalau belum dikirim)', Y);
        }

        // Summary
        sep('📊 SUMMARY');
        log('✓', `Email: ${acc.email}`, G);
        log('✓', `Password: ${acc.password}`, G);
        log('', '');
        log('💡', 'Buka https://mail.tm di browser buat login', C);
        log('', `   Email: ${acc.email}`, Y);
        log('', `   Pass : ${acc.password}`, Y);

    } catch (e) {
        log('❌', `Fatal: ${e.message}`, R);
        console.error(e);
    }
}

main();
