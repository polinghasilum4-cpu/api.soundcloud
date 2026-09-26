/**
 * Upload File — via Litterbox (Catbox temporary)
 * 
 * POST /api/v2/upload
 * multipart/form-data:
 *   - file : file (wajib)
 *   - time : 1h / 12h / 24h / 72h (default 24h)
 */

const axios = require('axios');
const FormData = require('form-data');
const { formidable } = require('formidable');
const fs = require('fs');

module.exports.config = {
    api: { bodyParser: false, sizeLimit: '50mb' },
    maxDuration: 30,
};

const LITTERBOX = 'https://litterbox.catbox.moe/resources/internals/api.php';
const VALID_TIMES = ['1h', '12h', '24h', '72h'];

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Max-Age', '86400');

    if (req.method === 'OPTIONS') return res.status(204).end();

    // GET = info
    if (req.method === 'GET') {
        return res.json({
            success: true,
            info: 'Upload File API — via Litterbox',
            usage: 'POST multipart: file (wajib) + time (opsional)',
            valid_times: VALID_TIMES,
            max_size: '50 MB',
        });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'POST only' });
    }

    const startedAt = Date.now();

    try {
        const form = formidable({
            maxFileSize: 50 * 1024 * 1024,
            multiples: false,
        });

        const { fields, files } = await new Promise((resolve, reject) => {
            form.parse(req, (err, fields, files) => {
                if (err) return reject(err);
                resolve({ fields, files });
            });
        });

        const fileField = files.file || files.upload || files.image;
        const file = Array.isArray(fileField) ? fileField[0] : fileField;

        if (!file) {
            return res.status(400).json({
                success: false,
                error: 'Butuh file. Field: "file"',
            });
        }

        const timeField = fields.time;
        let time = Array.isArray(timeField) ? timeField[0] : (timeField || '24h');
        time = String(time).toLowerCase();

        if (!VALID_TIMES.includes(time)) {
            return res.status(400).json({
                success: false,
                error: `time invalid. Pilih: ${VALID_TIMES.join(', ')}`,
            });
        }

        const buffer = fs.readFileSync(file.filepath);
        const filename = file.originalFilename || 'file';
        const mimetype = file.mimetype || 'application/octet-stream';

        console.log(`[upload] ${filename} (${(buffer.length / 1024).toFixed(1)} KB) time=${time}`);

        // Forward ke Litterbox
        const lb = new FormData();
        lb.append('reqtype', 'fileupload');
        lb.append('time', time);
        lb.append('fileToUpload', buffer, {
            filename,
            contentType: mimetype,
        });

        const lbRes = await axios.post(LITTERBOX, lb, {
            headers: {
                ...lb.getHeaders(),
                'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36',
                'accept': '*/*',
                'origin': 'https://litterbox.catbox.moe',
                'referer': 'https://litterbox.catbox.moe/',
            },
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
            timeout: 30000,
            validateStatus: () => true,
        });

        const url = String(lbRes.data).trim();

        if (!url.startsWith('http')) {
            throw new Error('Litterbox response invalid: ' + url.slice(0, 200));
        }

        return res.json({
            success: true,
            data: {
                url,
                filename,
                size: buffer.length,
                mimetype,
                time,
                elapsedMs: Date.now() - startedAt,
            },
        });
    } catch (err) {
        console.error('[upload]', err.message);
        return res.status(500).json({
            success: false,
            error: err.message || 'Upload gagal',
            elapsedMs: Date.now() - startedAt,
        });
    }
};
