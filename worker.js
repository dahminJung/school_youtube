// ============================================
// SchoolTube Cloudflare Worker — Web Scrape (v7)
// YouTube 웹페이지에서 직접 영상 데이터를 추출합니다.
// API 키 불필요. 서드파티 의존성 없음.
// ============================================

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "*",
  };
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "*";
    const headers = corsHeaders(origin);

    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers });

    try {
      const streamsMatch = url.pathname.match(/^\/streams\/([a-zA-Z0-9_-]+)$/);
      if (streamsMatch) {
        return await handleStreams(streamsMatch[1], `${url.protocol}//${url.host}`, headers);
      }

      const debugMatch = url.pathname.match(/^\/debug\/([a-zA-Z0-9_-]+)$/);
      if (debugMatch) {
        return await handleDebug(debugMatch[1], headers);
      }

      if (url.pathname === "/proxy") {
        const targetUrl = url.searchParams.get("url");
        if (!targetUrl) return jsonResponse({ error: "No URL" }, 400, headers);
        return await handleProxy(targetUrl, request, headers);
      }

      if (url.pathname === "/health")
        return jsonResponse({ status: "ok", version: "v7" }, 200, headers);

      return jsonResponse({ name: "SchoolTube v7" }, 200, headers);
    } catch (err) {
      return jsonResponse({ error: err.message }, 500, headers);
    }
  },
};

// ─────────────────────────────────────
// 방법 1: WEB InnerTube (API 키 없이)
// ─────────────────────────────────────
async function tryWebInnerTube(videoId) {
  const res = await fetch("https://www.youtube.com/youtubei/v1/player", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Origin": "https://www.youtube.com",
      "Referer": `https://www.youtube.com/watch?v=${videoId}`,
      "X-Youtube-Client-Name": "1",
      "X-Youtube-Client-Version": "2.20260301.00.00",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
    body: JSON.stringify({
      videoId,
      context: {
        client: {
          clientName: "WEB",
          clientVersion: "2.20260301.00.00",
          hl: "ko",
          gl: "KR",
        },
      },
      contentCheckOk: true,
      racyCheckOk: true,
    }),
  });
  if (!res.ok) return null;
  return res.json();
}

// ─────────────────────────────────────
// 방법 2: MWEB InnerTube (모바일 웹)
// ─────────────────────────────────────
async function tryMWebInnerTube(videoId) {
  const res = await fetch("https://www.youtube.com/youtubei/v1/player", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Origin": "https://m.youtube.com",
      "Referer": `https://m.youtube.com/watch?v=${videoId}`,
      "User-Agent": "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
    },
    body: JSON.stringify({
      videoId,
      context: {
        client: {
          clientName: "MWEB",
          clientVersion: "2.20260301.01.00",
          hl: "ko",
          gl: "KR",
        },
      },
      contentCheckOk: true,
      racyCheckOk: true,
    }),
  });
  if (!res.ok) return null;
  return res.json();
}

// ─────────────────────────────────────
// 방법 3: 웹페이지 스크래핑
// YouTube /watch 페이지 HTML에서 플레이어 데이터 추출
// ─────────────────────────────────────
async function tryWebScrape(videoId) {
  const res = await fetch(
    `https://www.youtube.com/watch?v=${videoId}&bpctr=9999999999&has_verified=1`,
    {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept-Language": "ko-KR,ko;q=0.9",
        "Cookie": "CONSENT=PENDING+999; SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjMwODI5LjA3X3AxGgJlbiACGgYIgJnZpwY",
      },
    }
  );
  if (!res.ok) return null;

  const html = await res.text();

  // ytInitialPlayerResponse 추출
  const marker = "var ytInitialPlayerResponse = ";
  const startIdx = html.indexOf(marker);
  if (startIdx === -1) return null;

  const jsonStart = startIdx + marker.length;
  // JSON 객체의 끝을 찾기 (중괄호 매칭)
  let depth = 0;
  let jsonEnd = jsonStart;
  for (let i = jsonStart; i < html.length && i < jsonStart + 500000; i++) {
    if (html[i] === "{") depth++;
    else if (html[i] === "}") {
      depth--;
      if (depth === 0) {
        jsonEnd = i + 1;
        break;
      }
    }
  }

  if (depth !== 0) return null;

  try {
    return JSON.parse(html.substring(jsonStart, jsonEnd));
  } catch {
    return null;
  }
}

// ─── 스트림 핸들러: 3가지 방법을 순서대로 시도 ───
async function handleStreams(videoId, workerBase, headers) {
  const methods = [
    { name: "WEB", fn: () => tryWebInnerTube(videoId) },
    { name: "MWEB", fn: () => tryMWebInnerTube(videoId) },
    { name: "SCRAPE", fn: () => tryWebScrape(videoId) },
  ];

  for (const method of methods) {
    try {
      const data = await method.fn();
      if (!data) continue;

      const status = data?.playabilityStatus?.status;
      if (status === "ERROR" || status === "LOGIN_REQUIRED" || status === "UNPLAYABLE") continue;

      const result = extractStreams(data, workerBase);
      if (result.hls || (result.videoStreams && result.videoStreams.length > 0)) {
        result._method = method.name;
        return new Response(JSON.stringify(result), {
          headers: { ...headers, "Content-Type": "application/json" },
        });
      }
    } catch {
      continue;
    }
  }

  return jsonResponse(
    { error: "영상 스트림을 가져올 수 없습니다. 잠시 후 다시 시도해 주세요." },
    502,
    headers
  );
}

function extractStreams(data, workerBase) {
  const px = (u) => (u ? `${workerBase}/proxy?url=${encodeURIComponent(u)}` : null);
  const sd = data.streamingData || {};
  const vd = data.videoDetails || {};

  const hls = sd.hlsManifestUrl ? px(sd.hlsManifestUrl) : null;

  const videoStreams = (sd.formats || [])
    .filter((f) => f.url)
    .map((f) => ({
      url: px(f.url),
      quality: f.qualityLabel || `${f.height}p`,
      mimeType: f.mimeType,
      height: f.height || 0,
      width: f.width || 0,
      videoOnly: false,
    }));

  const thumbs = vd.thumbnail?.thumbnails || [];
  const thumbnailUrl = thumbs.length > 0 ? thumbs[thumbs.length - 1].url : null;

  return {
    title: vd.title || "",
    hls,
    videoStreams,
    thumbnailUrl,
  };
}

// ─── 디버그 ───
async function handleDebug(videoId, headers) {
  const results = [];

  // 1. WEB InnerTube
  const r1 = { method: "WEB_INNERTUBE", status: null, playability: null, hasHls: false, formats: 0, error: null };
  try {
    const data = await tryWebInnerTube(videoId);
    if (data) {
      r1.status = 200;
      r1.playability = data?.playabilityStatus?.status;
      r1.hasHls = !!data?.streamingData?.hlsManifestUrl;
      r1.formats = (data?.streamingData?.formats?.length || 0) + (data?.streamingData?.adaptiveFormats?.length || 0);
      r1.error = data?.playabilityStatus?.reason || null;
    } else {
      r1.error = "No response";
    }
  } catch (e) { r1.error = e.message; }
  results.push(r1);

  // 2. MWEB InnerTube
  const r2 = { method: "MWEB_INNERTUBE", status: null, playability: null, hasHls: false, formats: 0, error: null };
  try {
    const data = await tryMWebInnerTube(videoId);
    if (data) {
      r2.status = 200;
      r2.playability = data?.playabilityStatus?.status;
      r2.hasHls = !!data?.streamingData?.hlsManifestUrl;
      r2.formats = (data?.streamingData?.formats?.length || 0) + (data?.streamingData?.adaptiveFormats?.length || 0);
      r2.error = data?.playabilityStatus?.reason || null;
    } else {
      r2.error = "No response";
    }
  } catch (e) { r2.error = e.message; }
  results.push(r2);

  // 3. Web Scrape
  const r3 = { method: "WEB_SCRAPE", status: null, playability: null, hasHls: false, formats: 0, error: null };
  try {
    const data = await tryWebScrape(videoId);
    if (data) {
      r3.status = 200;
      r3.playability = data?.playabilityStatus?.status;
      r3.hasHls = !!data?.streamingData?.hlsManifestUrl;
      r3.formats = (data?.streamingData?.formats?.length || 0) + (data?.streamingData?.adaptiveFormats?.length || 0);
      r3.error = data?.playabilityStatus?.reason || null;
    } else {
      r3.error = "Could not extract player data from page";
    }
  } catch (e) { r3.error = e.message; }
  results.push(r3);

  return new Response(JSON.stringify({ videoId, results }, null, 2), {
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

// ─── URL 프록시 ───
async function handleProxy(targetUrl, originalRequest, headers) {
  try {
    const res = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Range: originalRequest.headers.get("Range") || "",
      },
    });

    const contentType = res.headers.get("Content-Type") || "";
    if (contentType.includes("mpegurl") || contentType.includes("m3u8")) {
      const text = await res.text();
      const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf("/") + 1);
      const wb = `${new URL(originalRequest.url).protocol}//${new URL(originalRequest.url).host}`;
      return new Response(rewriteM3u8(text, baseUrl, wb), {
        headers: { ...headers, "Content-Type": "application/vnd.apple.mpegurl" },
      });
    }

    const rh = { ...headers };
    ["Content-Type", "Content-Length", "Content-Range", "Accept-Ranges"].forEach((k) => {
      const v = res.headers.get(k);
      if (v) rh[k] = v;
    });
    return new Response(res.body, { status: res.status, headers: rh });
  } catch (e) {
    return jsonResponse({ error: e.message }, 502, headers);
  }
}

function rewriteM3u8(text, baseUrl, workerBase) {
  return text.split("\n").map((line) => {
    const t = line.trim();
    if (!t || t.startsWith("#")) {
      if (t.includes('URI="')) {
        return t.replace(/URI="([^"]+)"/, (_, uri) => {
          const full = uri.startsWith("http") ? uri : baseUrl + uri;
          return `URI="${workerBase}/proxy?url=${encodeURIComponent(full)}"`;
        });
      }
      return line;
    }
    const full = t.startsWith("http") ? t : baseUrl + t;
    return `${workerBase}/proxy?url=${encodeURIComponent(full)}`;
  }).join("\n");
}

function jsonResponse(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
