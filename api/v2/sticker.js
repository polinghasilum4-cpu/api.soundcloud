/* ============================================================
   api/v2/sticker.js — Sticker Maker server-side
   Endpoint: POST /api/v2/sticker
   Fields: file (image/video), mode (crop|circle|rounded)
   ============================================================ */

const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const { formidable } = require('formidable');
const fs = require('fs');
const path = require('path');
const os = require('os');

module.exports.config = {
  api: { bodyParser: false, sizeLimit: '10mb' },
  maxDuration: 30,
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'POST only' });
  }

  const startedAt = Date.now();
  let inPath = null;
  let outPath = null;

  try {
    /* ---------- Parse multipart ---------- */
    const form = formidable({
      maxFileSize: 8 * 1024 * 1024,
      multiples: false,
    });

    const { fields, files } = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) return reject(err);
        resolve({ fields, files });
      });
    });

    const fileField = files.file || files.image || files.video;
    const file = Array.isArray(fileField) ? fileField[0] : fileField;
    if (!file) {
      return res.status(400).json({ success: false, error: 'Field "file" wajib' });
    }

    const modeField = fields.mode;
    const mode = (Array.isArray(modeField) ? modeField[0] : modeField) || 'crop';
    if (!['crop', 'circle', 'rounded'].includes(mode)) {
      return res.status(400).json({ success: false, error: 'Mode harus: crop | circle | rounded' });
    }

    const isVideo = (file.mimetype || '').startsWith('video/');
    const isImage = (file.mimetype || '').startsWith('image/');
    if (!isVideo && !isImage) {
      return res.status(400).json({ success: false, error: 'File harus gambar/video' });
    }

    /* ---------- Prepare temp files ---------- */
    const tmpDir = os.tmpdir();
    const ts = Date.now();
    const inExt = isVideo ? 'mp4' : 'png';
    inPath  = path.join(tmpDir, `st_in_${ts}.${inExt}`);
    outPath = path.join(tmpDir, `st_out_${ts}.webp`);

    const inBuf = fs.readFileSync(file.filepath);
    fs.writeFileSync(inPath, inBuf);

    /* ---------- Build filter ---------- */
    const SIZE = 512;
    const filters = [
      `scale=${SIZE}:${SIZE}:force_original_aspect_ratio=decrease`,
      `pad=${SIZE}:${SIZE}:(ow-iw)/2:(oh-ih)/2:color=${isVideo ? 'black' : '0x00000000'}`,
    ];

    if (mode === 'circle') {
      const R = SIZE / 2;
      filters.push('format=rgba');
      filters.push(
        `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(gt(pow(X-${R},2)+pow(Y-${R},2),${R * R}),0,255)'`
      );
    } else if (mode === 'rounded') {
      const r = 60;
      const R2 = r * r;
      const W = SIZE;
      filters.push('format=rgba');
      filters.push(
        `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='` +
        `if(lt(X,${r})*lt(Y,${r})*gt(pow(${r}-X,2)+pow(${r}-Y,2),${R2}),0,` +
        `if(gt(X,${W - r})*lt(Y,${r})*gt(pow(X-${W - r},2)+pow(${r}-Y,2),${R2}),0,` +
        `if(lt(X,${r})*gt(Y,${W - r})*gt(pow(${r}-X,2)+pow(Y-${W - r},2),${R2}),0,` +
        `if(gt(X,${W - r})*gt(Y,${W - r})*gt(pow(X-${W - r},2)+pow(Y-${W - r},2),${R2}),0,255))))'`
      );
    }

    /* ---------- Run ffmpeg ---------- */
    await new Promise((resolve, reject) => {
      let cmd = ffmpeg(inPath).videoFilters(filters.join(','));

      if (isVideo) {
        cmd = cmd
          .inputOptions(['-t', '5'])
          .outputOptions([
            '-c:v', 'libwebp',
            '-lossless', '0',
            '-compression_level', '4',
            '-q:v', '65',
            '-loop', '0',
            '-an',
            '-vsync', '0',
          ]);
      } else {
        cmd = cmd.outputOptions([
          '-c:v', 'libwebp',
          '-lossless', '0',
          '-compression_level', '6',
          '-q:v', '80',
        ]);
      }

      cmd.save(outPath)
        .on('end', resolve)
        .on('error', reject);
    });

    const outBuf = fs.readFileSync(outPath);
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(2);

    /* ---------- Response ---------- */
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Content-Length', outBuf.length);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Elapsed', elapsed);
    return res.status(200).send(outBuf);

  } catch (err) {
    console.error('[sticker]', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Gagal convert sticker',
      elapsedMs: Date.now() - startedAt,
    });
  } finally {
    if (inPath)  { try { fs.unlinkSync(inPath); }  catch {} }
    if (outPath) { try { fs.unlinkSync(outPath); } catch {} }
  }
};
