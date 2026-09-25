/**
 * Face Swap API — Remaker.ai
 * 
 * POST /api/v2/faceswap
 */

const axios = require('axios');
const https = require('https');
const { URL } = require('url');
const { formidable } = require('formidable');
const fs = require('fs');
const crypto = require('crypto');

// ============================================================
//  VERCEL CONFIG
// ============================================================
module.exports.config = {
    api: {
        bodyParser: false,
        sizeLimit: '25mb',
    },
    maxDuration: 60,
};

// ============================================================
//  KONSTANTA
// ============================================================
const BASE_URL = 'https://api.remaker.ai';
const PRODUCT_CODE = '067003';
const USER_AGENT = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 ' +
                   '(KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36';

// ============================================================
//  HELPER
// ============================================================
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeHeaders(serial, extra = {}) {
    return {
        'sec-ch-ua-platform': '"Android"',
        'user-agent': USER_AGENT,
        'sec-ch-ua': '"Google Chrome";v="153", "Not_A Brand";v="8", "Chromium";v="153"',
        'sec-ch-ua-mobile': '?1',
        'accept': '*/*',
        'origin': 'https://remaker.ai',
        'referer': 'https://remaker.ai/',
        'source': 'ai_face_vary',
        'product-code': PRODUCT_CODE,
        'product-serial': serial,
        'authorization': '',
        ...extra,
    };
}

// ============================================================
//  PUT VIA HTTPS MODULE — MINIMAL HEADERS (fix signature)
// ============================================================
function putToOss(rawUrl, buffer, contentType = 'image/jpeg') {
    return new Promise((resolve, reject) => {
        let u;
        try {
            u = new URL(rawUrl);
        } catch (e) {
            return reject(new Error(`URL presigned invalid: ${e.message}`));
        }

        // PENTING: pakai raw path+query persis dari URL asli
        const reqPath = u.pathname + u.search;

        const req = https.request(
            {
                method: 'PUT',
                hostname: u.hostname,
                port: u.port || 443,
                path: reqPath,
                headers: {
                    'Content-Type': contentType,
                    'Content-Length': buffer.length,
                    // JANGAN tambah User-Agent / Accept / Accept-Encoding
                    // biar canonical request match sama yang di-sign
                },
            },
            (res) => {
                let body = '';
                res.on('data', (c) => (body += c));
                res.on('end', () =>
                    resolve({ status: res.statusCode, body, headers: res.headers })
                );
            }
        );

        req.on('error', reject);
        req.setTimeout(60000, () => {
            req.destroy(new Error('PUT timeout 60s'));
        });

        req.write(buffer);
        req.end();
    });
}

// ============================================================
//  UPLOAD GAMBAR
// ============================================================
async function uploadImage(buffer, filename, serial) {
    const size = buffer.length;

    // ---- 1. init-upload ----
    const initRes = await fetch(`${BASE_URL}/api/pai/v5/init-upload`, {
        method: 'POST',
        headers: makeHeaders(serial, {
            'content-type': 'application/x-www-form-urlencoded',
        }),
        body: new URLSearchParams({
            file_name: filename,
            file_size: String(size),
            part_size: '5242880',
        }).toString(),
    });
    const initData = await initRes.json();
    if (initData.code !== 100000 || !initData.result) {
        throw new Error(`init-upload gagal: ${JSON.stringify(initData).slice(0, 150)}`);
    }

    const { upload_id, parts, base_url } = initData.result;
    const putUrl = parts[0].url;

    // ---- 2. PUT ke presigned URL — coba 3 content-type ----
    const tried = [];
    const contentTypes = ['image/jpeg', 'application/octet-stream', ''];

    let lastErr = null;
    let succeeded = false;

    for (const ct of contentTypes) {
        try {
            const r = await putToOss(putUrl, buffer, ct);
            tried.push(`CT='${ct || '(none)'}' → ${r.status}`);

            if (r.status >= 200 && r.status < 300) {
                succeeded = true;
                break;
            }

            // Kalau 403, simpan error & coba CT berikutnya
            if (r.status === 403) {
                lastErr = `PUT gagal HTTP 403: ${String(r.body).slice(0, 200)}`;
                continue;
            }

            // Error lain, langsung lempar
            throw new Error(`PUT gagal HTTP ${r.status}: ${String(r.body).slice(0, 200)}`);
        } catch (e) {
            tried.push(`CT='${ct || '(none)'}' → ERR ${e.message}`);
            lastErr = e.message;
        }
    }

    if (!succeeded) {
        throw new Error(`${lastErr || 'PUT gagal'} | Tried: ${tried.join(', ')}`);
    }

    // ---- 3. complete-upload (non-critical) ----
    try {
        await fetch(`${BASE_URL}/api/pai/v5/complete-upload`, {
            method: 'POST',
            headers: makeHeaders(serial, {
                'content-type': 'application/x-www-form-urlencoded',
            }),
            body: new URLSearchParams({
                upload_id,
                product_code: PRODUCT_CODE,
            }).toString(),
        });
    } catch (_) {}

    return base_url;
}

// ============================================================
//  CREATE JOB
// ============================================================
async function createJob(targetUrl, swapUrl, serial) {
    const res = await fetch(`${BASE_URL}/api/pai/v3/ai-facevary/appapi/create-job`, {
        method: 'POST',
        headers: makeHeaders(serial, { 'content-type': 'application/json' }),
        body: JSON.stringify({
            target_image: targetUrl,
            swap_image: swapUrl,
            product_code: PRODUCT_CODE,
        }),
    });
    const data = await res.json();
    if (data.code !== 100000 || !data.result?.job_id) {
        throw new Error(`create-job gagal: ${JSON.stringify(data).slice(0, 200)}`);
    }
    return data.result.job_id;
}

// ============================================================
//  POLLING JOB
// ============================================================
async function waitForJob(jobId, serial, maxWaitMs = 50000) {
    const start = Date.now();
    let attempt = 0;
    let errCount = 0;

    while (Date.now() - start < maxWaitMs) {
        await sleep(3000);
        attempt++;

        try {
            const res = await fetch(
                `${BASE_URL}/api/pai/v3/ai-facevary/appapi/get-job/${jobId}`,
                { method: 'GET', headers: makeHeaders(serial) }
            );
            const data = await res.json();
            const urls = data.result?.output_image_url;
            const msg = data.message?.en || '';

            if (urls && urls.length > 0) return urls;
            errCount = 0;

            if (
                msg.includes('not found') ||
                msg.includes('failed') ||
                msg.includes('no face') ||
                msg.includes('no human')
            ) {
                throw new Error(`Job gagal: ${msg}`);
            }
        } catch (e) {
            if (e.message.startsWith('Job gagal')) throw e;
            errCount++;
            if (errCount >= 5) {
                throw new Error(`Network error ${errCount}x: ${e.message}`);
            }
        }
    }
    throw new Error(`Timeout ${maxWaitMs}ms nunggu job ${jobId}`);
}

// ============================================================
//  FULL FLOW
// ============================================================
async function faceSwap(sourceBuffer, targetBuffer, serial) {
    const [sourceUrl, targetUrl] = await Promise.all([
        uploadImage(sourceBuffer, 'source.jpg', serial),
        uploadImage(targetBuffer, 'target.jpg', serial),
    ]);

    const jobId = await createJob(targetUrl, sourceUrl, serial);
    const outputUrls = await waitForJob(jobId, serial);

    return { jobId, outputUrls, sourceUrl, targetUrl };
}

// ============================================================
//  PARSING HELPERS
// ============================================================
function parseForm(req) {
    return new Promise((resolve, reject) => {
        const form = formidable({
            maxFileSize: 15 * 1024 * 1024,
            maxTotalFileSize: 25 * 1024 * 1024,
            multiples: false,
            filter: (part) => part.mimetype?.startsWith('image/') ?? true,
        });
        form.parse(req, (err, fields, files) => {
            if (err) return reject(err);
            resolve({ fields, files });
        });
    });
}

function getFile(files, key) {
    const f = files[key];
    if (!f) return null;
    const file = Array.isArray(f) ? f[0] : f;
    if (!file) return null;
    return fs.readFileSync(file.filepath);
}

function getField(fields, key) {
    const v = fields[key];
    return Array.isArray(v) ? v[0] : v;
}

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', (chunk) => {
            data += chunk;
            if (data.length > 1_000_000) {
                reject(new Error('Body terlalu besar'));
                req.destroy();
            }
        });
        req.on('end', () => {
            try {
                resolve(data ? JSON.parse(data) : {});
            } catch (e) {
                reject(new Error('Invalid JSON'));
            }
        });
        req.on('error', reject);
    });
}

async function fetchAsBuffer(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Gagal download: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
}

// ============================================================
//  HANDLER UTAMA
// ============================================================
module.exports = async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Max-Age', '86400');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({
            success: false,
            error: 'Method not allowed. Gunakan POST.',
        });
    }

    const contentType = req.headers['content-type'] || '';
    const serial = crypto.randomBytes(16).toString('hex');
    const startedAt = Date.now();

    try {
        let sourceBuf, targetBuf, customSerial;

        if (contentType.includes('multipart/form-data')) {
            const { fields, files } = await parseForm(req);
            sourceBuf = getFile(files, 'source');
            targetBuf = getFile(files, 'target');
            customSerial = getField(fields, 'serial');

            if (!sourceBuf || !targetBuf) {
                return res.status(400).json({
                    success: false,
                    error: 'Butuh 2 file: "source" dan "target"',
                });
            }
        } else if (contentType.includes('application/json')) {
            const body = await readJsonBody(req);
            const { source_url, target_url, serial: ser } = body;

            if (!source_url || !target_url) {
                return res.status(400).json({
                    success: false,
                    error: 'Butuh "source_url" dan "target_url"',
                });
            }

            [sourceBuf, targetBuf] = await Promise.all([
                fetchAsBuffer(source_url),
                fetchAsBuffer(target_url),
            ]);
            customSerial = ser;
        } else {
            return res.status(400).json({
                success: false,
                error: 'Content-Type harus multipart/form-data atau application/json',
            });
        }

        if (sourceBuf.length > 15_000_000 || targetBuf.length > 15_000_000) {
            return res.status(400).json({
                success: false,
                error: 'Gambar max 15 MB',
            });
        }

        const finalSerial = customSerial || serial;
        const result = await faceSwap(sourceBuf, targetBuf, finalSerial);

        return res.json({
            success: true,
            data: {
                jobId: result.jobId,
                outputUrls: result.outputUrls,
                sourceUrl: result.sourceUrl,
                targetUrl: result.targetUrl,
                serial: finalSerial,
                elapsedMs: Date.now() - startedAt,
            },
        });
    } catch (err) {
        console.error('[faceswap]', err.message);
        return res.status(500).json({
            success: false,
            error: err.message || 'Face swap gagal',
            elapsedMs: Date.now() - startedAt,
        });
    }
};
