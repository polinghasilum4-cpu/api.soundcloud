/**
 * Face Swap API — Remaker.ai
 * 
 * Endpoint: POST /api/v2/faceswap
 * 
 * Support 2 mode (auto-detect):
 * 
 *   A) Multipart — upload file
 *      Content-Type: multipart/form-data
 *      Fields: source (file), target (file), serial (opsional)
 * 
 *   B) JSON — pakai URL gambar
 *      Content-Type: application/json
 *      Body: { source_url, target_url, serial? }
 * 
 * Response:
 *   { success: true, data: { jobId, outputUrls: [...] } }
 */

import formidable from 'formidable';
import fs from 'fs';
import crypto from 'crypto';

// ============================================================
//  VERCEL CONFIG
// ============================================================
export const config = {
    api: {
        bodyParser: false,       // kita handle sendiri
        sizeLimit: '25mb',
    },
    maxDuration: 300,            // 5 menit
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

// Upload gambar via OSS presigned URL
async function uploadImage(buffer, filename, serial) {
    const size = buffer.length;

    // 1. init-upload
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

    // 2. PUT ke presigned URL
    const putRes = await fetch(parts[0].url, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        body: buffer,
    });
    if (!putRes.ok) {
        throw new Error(`PUT upload gagal: HTTP ${putRes.status}`);
    }

    // 3. complete-upload (non-critical)
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

// Create job
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

// Polling job
async function waitForJob(jobId, serial, maxWaitMs = 240000) {
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

            // Error fatal
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
            if (errCount >= 5) throw new Error(`Network error ${errCount}x: ${e.message}`);
        }
    }
    throw new Error(`Timeout ${maxWaitMs}ms nunggu job ${jobId}`);
}

// FULL FLOW
async function faceSwap(sourceBuffer, targetBuffer, serial) {
    // Upload 2 gambar parallel
    const [sourceUrl, targetUrl] = await Promise.all([
        uploadImage(sourceBuffer, 'source.jpg', serial),
        uploadImage(targetBuffer, 'target.jpg', serial),
    ]);

    // Create job
    const jobId = await createJob(targetUrl, sourceUrl, serial);

    // Polling
    const outputUrls = await waitForJob(jobId, serial);

    return { jobId, outputUrls, sourceUrl, targetUrl };
}

// Parse multipart
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

// Read JSON body manually (karena bodyParser: false)
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

// Download dari URL
async function fetchAsBuffer(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Gagal download: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
}

// ============================================================
//  HANDLER
// ============================================================
export default async function handler(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

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

        // Mode A: multipart (upload file)
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
        }
        // Mode B: JSON (URL gambar)
        else if (contentType.includes('application/json')) {
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
        }
        // Mode tidak dikenal
        else {
            return res.status(400).json({
                success: false,
                error: 'Content-Type harus multipart/form-data atau application/json',
            });
        }

        // Validasi ukuran
        if (sourceBuf.length > 15_000_000 || targetBuf.length > 15_000_000) {
            return res.status(400).json({
                success: false,
                error: 'Gambar max 15 MB',
            });
        }

        // Jalanin face swap
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
}
