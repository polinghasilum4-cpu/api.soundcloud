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

    // GET = info
    if (req.method === 'GET') {
        return res.json({
            success: true,
            info: 'Upload API — Catbox / Litterbox',
            modes: {
                permanent: 'POST /api/v2/upload (default) — file permanen',
                temporary: 'POST /api/v2/upload?type=temp&time=24h — auto-expired',
            },
            validTimes: VALID_TIMES,
            maxSize: '50 MB',
        });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'POST only' });
    }

    const startedAt = Date.now();

    try {
        const query = req.query || {};
        const type = (query.type || 'permanent').toLowerCase();
        let time = (query.time || '24h').toLowerCase();

        if (type === 'temp' || type === 'temporary') {
            if (!VALID_TIMES.includes(time)) {
                return res.status(400).json({
                    success: false,
                    error: `time invalid. Pilih: ${VALID_TIMES.join(', ')}`,
                });
            }
        }

        // Parse file
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
            const f = files[name];
            if (f) {
                file = Array.isArray(f) ? f[0] : f;
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

        console.log(`[upload] ${filename} (${(buffer.length / 1024).toFixed(1)} KB) type=${type}`);

        const isTemp = (type === 'temp' || type === 'temporary');
        const uploadUrl = isTemp ? LITTERBOX_URL : CATBOX_URL;

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

        const catboxRes = await axios.post(uploadUrl, catboxForm, {
            headers: {
                ...catboxForm.getHeaders(),
                'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 ' +
                              '(KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36',
                'origin': isTemp ? 'https://litterbox.catbox.moe' : 'https://catbox.moe',
                'referer': isTemp ? 'https://litterbox.catbox.moe/' : 'https://catbox.moe/',
                'accept': '*/*',
            },
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
            timeout: 60000,
        });

        const url = String(catboxRes.data).trim();
        if (!url.startsWith('http')) {
            throw new Error('Response invalid: ' + url.slice(0, 200));
        }

        let expiresAt = null;
        if (isTemp) {
            const map = { '1h': 3600e3, '12h': 12 * 3600e3, '24h': 24 * 3600e3, '72h': 72 * 3600e3 };
            expiresAt = Date.now() + (map[time] || 24 * 3600e3);
        }

        console.log(`[upload] ✅ ${url}`);

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
