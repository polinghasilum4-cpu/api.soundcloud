/**
 * Upload ke Catbox / Litterbox
 * 
 * POST /api/v2/upload
 * Content-Type: multipart/form-data
 * Field: file
 * Query: ?type=permanent (default) | ?type=temp&time=24h
 */

const axios = require('axios');
const FormData = require('form-data');
const { formidable } = require('formidable');
const fs = require('fs');

module.exports.config = {
    api: { bodyParser: false, sizeLimit: '50mb' },
    maxDuration: 30,
};

const CATBOX_URL = 'https://catbox.moe/user/api.php';
const LITTERBOX_URL = 'https://litterbox.catbox.moe/resources/internals/api.php';
const VALID_TIMES = ['1h', '12h', '24h', '72h'];

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') return res.status(204).end();

    if (req.method === 'GET') {
        return res.json({
            success: true,
            info: 'Upload API — Catbox / Litterbox',
            modes: {
                permanent: 'POST /api/v2/upload',
                temporary: 'POST /api/v2/upload?type=temp&time=24h',
            },
            validTimes: VALID_TIMES,
        });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'POST only' });
    }

    const startedAt = Date.now();

    try {
        const query = req.query || {};
        const type = (query.type || 'permanent').toLowerCase();
        const time = (query.time || '24h').toLowerCase();

        if ((type === 'temp' || type === 'temporary') && !VALID_TIMES.includes(time)) {
            return res.status(400).json({
                success: false,
                error: `time invalid. Pilih: ${VALID_TIMES.join(', ')}`,
            });
        }

        const form = formidable({
            maxFileSize: 50 * 1024 * 1024,
            multiples: false,
        });

        const { files } = await new Promise((resolve, reject) => {
            form.parse(req, (err, fields, files) => {
                if (err) return reject(err);
                resolve({ fields, files });
            });
        });

        const candidates = ['file', 'image', 'upload', 'photo', 'media'];
        let file = null;
        for (const name of candidates) {
            if (files[name]) {
                file = Array.isArray(files[name]) ? files[name][0] : files[name];
                break;
            }
        }

        if (!file) {
            return res.status(400).json({
                success: false,
                error: 'Butuh file. Field: file / image / upload / photo / media',
            });
        }

        const buffer = fs.readFileSync(file.filepath);
        const filename = file.originalFilename || 'upload.jpg';
        const mimetype = file.mimetype || 'image/jpeg';

        const isTemp = (type === 'temp' || type === 'temporary');
        const uploadUrl = isTemp ? LITTERBOX_URL : CATBOX_URL;

        console.log(`[upload] ${filename} (${(buffer.length / 1024).toFixed(1)} KB) ${isTemp ? 'temp:' + time : 'permanent'}`);

        // ============================================================
        //  FORWARD KE CATBOX — pakai header persis kayak browser
        // ============================================================
        const catboxForm = new FormData();
        catboxForm.append('reqtype', 'fileupload');
        if (isTemp) {
            catboxForm.append('time', time);
        } else {
            catboxForm.append('userhash', '');
        }
        catboxForm.append('fileToUpload', buffer, {
            filename,
            contentType: mimetype,
        });

        const catboxHeaders = {
            ...catboxForm.getHeaders(),
            // Browser fingerprint — WAJIB biar gak 412
            'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 ' +
                          '(KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36',
            'accept': 'application/json, text/plain, */*',
            'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
            'accept-encoding': 'gzip, deflate, br',
            'cache-control': 'no-cache',
            'x-requested-with': 'XMLHttpRequest',
            'origin': isTemp ? 'https://litterbox.catbox.moe' : 'https://catbox.moe',
            'referer': isTemp ? 'https://litterbox.catbox.moe/' : 'https://catbox.moe/',
            'sec-ch-ua': '"Google Chrome";v="153", "Not_A Brand";v="8", "Chromium";v="153"',
            'sec-ch-ua-mobile': '?1',
            'sec-ch-ua-platform': '"Android"',
            'sec-fetch-site': 'same-origin',
            'sec-fetch-mode': 'cors',
            'sec-fetch-dest': 'empty',
            'priority': 'u=1, i',
            'connection': 'keep-alive',
        };

        const catboxRes = await axios.post(uploadUrl, catboxForm, {
            headers: catboxHeaders,
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
            timeout: 60000,
            decompress: true,
            validateStatus: () => true, // handle manual
        });

        console.log(`[upload] Catbox status: ${catboxRes.status}`);
        console.log(`[upload] Catbox body: ${String(catboxRes.data).substring(0, 200)}`);

        if (catboxRes.status !== 200) {
            throw new Error(`Catbox HTTP ${catboxRes.status}: ${String(catboxRes.data).substring(0, 200)}`);
        }

        const url = String(catboxRes.data).trim();
        if (!url.startsWith('http')) {
            throw new Error('Catbox response invalid: ' + url.substring(0, 200));
        }

        let expiresAt = null;
        if (isTemp) {
            const map = { '1h': 3600e3, '12h': 12 * 3600e3, '24h': 24 * 3600e3, '72h': 72 * 3600e3 };
            expiresAt = Date.now() + map[time];
        }

        return res.json({
            success: true,
            data: {
                url,
                filename,
                size: buffer.length,
                mimetype,
                mode: isTemp ? 'temporary' : 'permanent',
                time: isTemp ? time : null,
                expiresAt,
                elapsedMs: Date.now() - startedAt,
            },
        });
    } catch (err) {
        console.error('[upload] error:', err.message);
        return res.status(500).json({
            success: false,
            error: err.message,
            elapsedMs: Date.now() - startedAt,
        });
    }
};
