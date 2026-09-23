const axios = require("axios");

const API_BASE = "https://api.toolenium.com";

const HEADERS = {
  accept: "*/*",
  "content-type": "application/json",
  origin: "https://scload.com",
  referer: "https://scload.com/",
  "user-agent":
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36",
  "accept-language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
};

module.exports = async (req, res) => {
  // CORS Headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const scUrl = req.query.url || req.body?.url;

  if (!scUrl) {
    return res.status(400).json({
      status: false,
      message: "Parameter 'url' wajib diisi!",
      example: "/api/v2/soundcloud?url=https://soundcloud.com/user/track"
    });
  }

  try {
    const { data } = await axios.post(
      `${API_BASE}/v1/info`,
      { url: scUrl },
      { headers: HEADERS, timeout: 30000 }
    );

    if (!data || !data.formats || data.formats.length === 0) {
      return res.status(404).json({
        status: false,
        message: "Gagal mengambil info trek SoundCloud atau trek tidak ditemukan."
      });
    }

    const chosen = data.formats[0];
    let ext = chosen.audio_ext || "mp3";
    if (ext === "none") ext = "mp3";

    return res.status(200).json({
      status: true,
      data: {
        title: data.title || "SoundCloud Track",
        duration: data.duration || "N/A",
        thumbnail: data.thumbnail || "https://i.scdn.co/image/ab67616d0000b273",
        format: chosen.format_id || ext,
        downloadUrl: chosen.url,
        ext: ext
      }
    });
  } catch (error) {
    return res.status(500).json({
      status: false,
      message: "Terjadi kesalahan server.",
      error: error.message
    });
  }
};
