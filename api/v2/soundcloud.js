const axios = require("axios");

module.exports = async (req, res) => {
  // ---- CORS ----
  res.setHeader("Access-Control-Allow-Origin", "https://xs0cietylabsz.biz.id");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, X-Client-IPv4, X-Tool-Page-Url"
  );
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (!require("../../lib/origin-guard")(req, res)) return;

  const scUrl = req.query.url || req.body?.url;
  if (!scUrl) {
    return res.status(400).json({
      status: false,
      message: "Parameter 'url' wajib diisi!",
      example: "/api/v2/soundcloud?url=https://soundcloud.com/artist/track"
    });
  }

  // IP client (Vercel)
  const clientIp =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.headers["x-real-ip"] ||
    req.socket?.remoteAddress ||
    "";

  try {
    // (opsional) telemetry ke theeztools, non-blocking
    axios
      .post(
        "https://api.theeztools.com/api/client-ip/detect",
        { client_ip: clientIp, detected_at: new Date().toISOString() },
        {
          headers: {
            "Content-Type": "application/json",
            "X-Client-IPv4": clientIp,
            "X-Tool-Page-Url": "https://xs0cietylabsz.biz.id/",
            "Origin": "https://xs0cietylabsz.biz.id",
            "Referer": "https://xs0cietylabsz.biz.id/"
          },
          timeout: 8000
        }
      )
      .catch(() => {});

    const response = await axios({
      method: "post",
      url: "https://api.toolenium.com/v1/info",
      headers: {
        accept: "*/*",
        "content-type": "application/json",
        origin: "https://scload.com",
        referer: "https://scload.com/",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      },
      data: { url: scUrl },
      timeout: 30000
    });

    const data = response.data;
    if (!data?.formats?.length) {
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
        thumbnail: data.thumbnail || "",
        format: chosen.format_id || ext,
        downloadUrl: chosen.url,
        ext
      }
    });
  } catch (error) {
    return res.status(500).json({
      status: false,
      message: "Terjadi kesalahan server.",
      error: error.response?.data || error.message
    });
  }
};
