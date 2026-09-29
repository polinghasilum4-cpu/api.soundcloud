/**
 * SaveFrom Scraper — Vercel Serverless Function
 * ============================================
 * Endpoint: POST /api/v2/savefrom
 * Body    : { "url": "https://..." }
 * Response: { "success": true, "options": [...] }
 */

const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36';

// Chromium binary CDN (buat chromium-min)
const CHROMIUM_PACK_URL = 'https://github.com/Sparticuz/chromium/releases/download/v131.0.0/chromium-v131.0.0-pack.tar';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

module.exports = async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    // Parse body (Vercel udah auto-parse JSON kalau content-type JSON)
    const { url } = req.body || {};

    if (!url || !/^https?:\/\//.test(url)) {
        return res.status(400).json({ success: false, error: 'URL tidak valid' });
    }

    console.log('[savefrom] request:', url);
    const startTime = Date.now();
    let browser = null;

    try {
        // Launch Chromium (Vercel-optimized)
        browser = await puppeteer.launch({
            args: [
                ...chromium.args,
                '--disable-blink-features=AutomationControlled',
                '--disable-dev-shm-usage',
                '--no-sandbox',
                '--no-zygote',
                '--single-process',
                `--user-agent=${MOBILE_UA}`,
            ],
            defaultViewport: {
                width: 412,
                height: 915,
                isMobile: true,
                hasTouch: true,
            },
            executablePath: await chromium.executablePath(CHROMIUM_PACK_URL),
            headless: chromium.headless,
        });

        const page = await browser.newPage();
        await page.setUserAgent(MOBILE_UA);
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        });

        // Stealth
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            window.chrome = { runtime: {} };
            Object.defineProperty(navigator, 'languages', {
                get: () => ['id-ID', 'id', 'en-US', 'en']
            });
        });

        // Buka savefrom
        await page.goto('https://savefrom.co.id/', {
            waitUntil: 'domcontentloaded',
            timeout: 25000,
        });
        await sleep(2500);

        // Cari input field
        const inputSelectors = [
            'input#sf_url',
            'input[name="sf_url"]',
            'input[type="url"]',
            'input[type="text"]',
        ];

        let inputEl = null;
        for (const sel of inputSelectors) {
            inputEl = await page.$(sel);
            if (inputEl) {
                console.log('[savefrom] input found:', sel);
                break;
            }
        }

        if (!inputEl) {
            throw new Error('Input field SaveFrom tidak ditemukan (DOM berubah?)');
        }

        // Isi & submit
        await inputEl.click();
        await page.evaluate(el => el.value = '', inputEl);
        await inputEl.type(url, { delay: 20 });
        await sleep(300);

        let clicked = false;
        for (const sel of ['button[type="submit"]', 'button.sf-btn', 'input[type="submit"]']) {
            const btn = await page.$(sel);
            if (btn) {
                await btn.click();
                clicked = true;
                break;
            }
        }
        if (!clicked) await inputEl.press('Enter');

        // Polling max 30s
        const pollStart = Date.now();
        let found = false;
        while (Date.now() - pollStart < 30000) {
            await sleep(1200);
            const has = await page.evaluate(() => {
                const links = document.querySelectorAll('a');
                for (const a of links) {
                    const h = a.href || '';
                    if (h.includes('fbcdn') || h.includes('googlevideo') ||
                        h.includes('.mp4') || h.includes('cdn')) return true;
                }
                return false;
            });
            if (has) { found = true; break; }
        }

        if (!found) {
            throw new Error('Timeout: link download gak muncul dalam 30s');
        }

        await sleep(1500);

        // Scrape links
        const rawLinks = await page.evaluate(() => {
            const out = [];
            document.querySelectorAll('a').forEach(a => {
                const href = a.href || '';
                const text = (a.innerText || a.textContent || '').trim();
                if (href.startsWith('https://savefrom.co.id/') ||
                    href.startsWith('https://downloadhelper.app/')) return;

                const isVideo = href.includes('fbcdn') || href.includes('googlevideo') ||
                                href.includes('.mp4') || href.includes('video') || href.includes('cdn');
                const isAudio = href.includes('.mp3') || href.includes('audio') || href.includes('.m4a');

                if (isVideo || isAudio) {
                    out.push({
                        text: text,
                        href: href,
                        type: isAudio ? 'audio' : 'video',
                    });
                }
            });
            return out;
        });

        // Build options
        const options = [];
        const seenBitrates = new Set();

        for (const link of rawLinks) {
            const href = link.href.trim();
            const text = link.text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();

            const brMatch = href.match(/bitrate=(\d+)/);
            const bitrate = brMatch ? brMatch[1] : null;
            const brInt = bitrate ? parseInt(bitrate) : 0;

            const tagMatch = href.match(/tag=([^&]+)/);
            const tag = tagMatch ? decodeURIComponent(tagMatch[1]) : '';
            const tagLower = tag.toLowerCase();
            const textUpper = text.toUpperCase();

            // Deteksi kualitas
            let quality = null;
            if (tagLower.includes('1080') || textUpper.includes('1080') || textUpper.includes('FULL HD')) {
                quality = 'Full HD (1080p)';
            } else if (tagLower.includes('720') || textUpper.includes('720')) {
                quality = 'HD (720p)';
            } else if (tagLower.includes('480') || textUpper.includes('480')) {
                quality = '480p';
            } else if (tagLower.includes('360') || textUpper.includes('360')) {
                quality = '360p';
            } else if (tagLower.includes('240') || textUpper.includes('240')) {
                quality = '240p';
            } else if (textUpper.includes('HD') && link.type === 'video') {
                quality = 'HD (720p)';
            }

            if (!quality && brInt > 0) {
                if (brInt >= 1500000) quality = 'Full HD (1080p)';
                else if (brInt >= 500000) quality = 'HD (720p)';
                else if (brInt >= 300000) quality = '480p';
                else if (brInt >= 150000) quality = '360p';
                else if (brInt >= 50000) quality = '240p';
            }

            if (!quality) quality = link.type === 'audio' ? 'Audio (M4A)' : 'MP4';

            const key = bitrate || href.split('?')[0].slice(0, 200);
            if (seenBitrates.has(key)) continue;
            seenBitrates.add(key);

            options.push({
                label: quality,
                text,
                url: href,
                type: link.type,
                bitrate,
                sizeHint: brInt ? Math.round(brInt * 60 / 8) : null,
            });
        }

        // Sort: HD di atas, audio di bawah
        const order = {
            'Full HD (1080p)': 0, 'HD (720p)': 1, '480p': 2, '360p': 3,
            '240p': 4, 'MP4': 5, 'Audio (M4A)': 6
        };
        options.sort((a, b) => (order[a.label] ?? 99) - (order[b.label] ?? 99));

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[savefrom] success in ${elapsed}s, ${options.length} options`);

        return res.status(200).json({
            success: true,
            url,
            options,
            elapsed: parseFloat(elapsed),
        });

    } catch (err) {
        console.error('[savefrom] error:', err.message);
        return res.status(500).json({
            success: false,
            error: err.message || 'Scrape gagal',
            elapsed: parseFloat(((Date.now() - startTime) / 1000).toFixed(1)),
        });
    } finally {
        if (browser) {
            try { await browser.close(); } catch (e) {}
        }
    }
};
