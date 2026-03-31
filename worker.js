// ============================================
// SchoolTube Cloudflare Worker — Video Proxy
// ============================================
// 이 Worker가 Piped API 호출 + 영상 스트림 전달을 모두 대행합니다.
// 브라우저는 이 Worker의 URL로만 요청하므로 학교 차단을 우회합니다.
//
// 배포 방법:
// 1. https://dash.cloudflare.com 접속 → 회원가입(무료)
// 2. 좌측 메뉴 "Workers & Pages" 클릭
// 3. "Create" 버튼 → "Create Worker" 클릭
// 4. 이름을 "schooltube-proxy" 등으로 지정
// 5. 기본 코드를 지우고 이 파일의 내용을 전부 붙여넣기
// 6. "Deploy" 클릭
// 7. 배포된 URL (예: https://schooltube-proxy.xxx.workers.dev)을
//    SchoolTube 앱의 설정에 입력
// ============================================

// Piped API — 여러 서버를 순서대로 시도합니다
const PIPED_APIS = [
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.adminforge.de",
  "https://pipedapi.leptons.xyz",
  "https://api.piped.private.coffee",
  "https://pipedapi.nosebs.ru",
  "https://pipedapi-libre.kavin.rocks",
  "https://pipedapi.drgns.space",
  "https://piped-api.privacy.com.de",
  "https://api.piped.yt",
  "https://piped-api.codespace.cz",
];

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Max-Age": "86400",
  };
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "*";
    const headers = corsHeaders(origin);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    try {
      // ─── /streams/{videoId} — Piped API 프록시 ───
      const streamsMatch = url.pathname.match(/^\/streams\/([a-zA-Z0-9_-]+)$/);
      if (streamsMatch) {
        const videoId = streamsMatch[1];
        const workerBase = `${url.protocol}//${url.host}`;
        return await handleStreams(videoId, workerBase, headers);
      }

      // ─── /proxy?url={url} — 범용 URL 프록시 ───
      if (url.pathname === "/proxy") {
        const targetUrl = url.searchParams.get("url");
        if (!targetUrl) {
          return jsonResponse({ error: "Missing url parameter" }, 400, headers);
        }
        return await handleProxy(targetUrl, request, headers);
      }

      // ─── /health — 헬스체크 ───
      if (url.pathname === "/health") {
        return jsonResponse(
          { status: "ok", timestamp: Date.now() },
          200,
          headers
        );
      }

      // ─── / — 안내 ───
      return jsonResponse(
        {
          name: "SchoolTube Proxy",
          endpoints: [
            "GET /streams/{videoId}",
            "GET /proxy?url={encodedUrl}",
            "GET /health",
          ],
        },
        200,
        headers
      );
    } catch (err) {
      return jsonResponse(
        { error: err.message || "Internal error" },
        500,
        headers
      );
    }
  },
};

// ── Piped API 프록시 — 여러 인스턴스에 순차 시도 ──
async function handleStreams(videoId, workerBase, headers) {
  let lastError = "All APIs failed";

  for (const apiBase of PIPED_APIS) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const res = await fetch(`${apiBase}/streams/${videoId}`, {
        signal: controller.signal,
        headers: { "User-Agent": "SchoolTube/1.0" },
      });
      clearTimeout(timeout);

      if (!res.ok) continue;

      const data = await res.json();
      if (data.error) continue;

      // 모든 스트림 URL을 Worker 프록시 경유로 변환
      rewriteUrls(data, workerBase);

      return new Response(JSON.stringify(data), {
        headers: { ...headers, "Content-Type": "application/json" },
      });
    } catch (e) {
      lastError = e.message;
      continue;
    }
  }

  return jsonResponse({ error: lastError }, 502, headers);
}

// ── 스트림 URL 재작성 — Worker를 경유하도록 ──
function rewriteUrls(data, workerBase) {
  const proxyUrl = (u) =>
    u ? `${workerBase}/proxy?url=${encodeURIComponent(u)}` : u;

  // HLS URL 재작성
  if (data.hls) {
    data.hls = proxyUrl(data.hls);
  }

  // 비디오 스트림 URL 재작성
  if (data.videoStreams) {
    data.videoStreams = data.videoStreams.map((s) => ({
      ...s,
      url: proxyUrl(s.url),
    }));
  }

  // 오디오 스트림 URL 재작성
  if (data.audioStreams) {
    data.audioStreams = data.audioStreams.map((s) => ({
      ...s,
      url: proxyUrl(s.url),
    }));
  }

  // 자막
  if (data.subtitles) {
    data.subtitles = data.subtitles.map((s) => ({
      ...s,
      url: proxyUrl(s.url),
    }));
  }

  // 썸네일
  if (data.thumbnailUrl) {
    data.thumbnailUrl = proxyUrl(data.thumbnailUrl);
  }

  // 프리뷰 프레임
  if (data.previewFrames) {
    data.previewFrames = data.previewFrames.map((f) => ({
      ...f,
      urls: (f.urls || []).map(proxyUrl),
    }));
  }
}

// ── 범용 URL 프록시 — 영상/HLS/이미지 등 스트리밍 전달 ──
async function handleProxy(targetUrl, originalRequest, headers) {
  // 보안: http(s)만 허용
  if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
    return jsonResponse({ error: "Invalid URL scheme" }, 400, headers);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  const res = await fetch(targetUrl, {
    signal: controller.signal,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: originalRequest.headers.get("Accept") || "*/*",
      Range: originalRequest.headers.get("Range") || "",
    },
    redirect: "follow",
  });
  clearTimeout(timeout);

  // HLS 매니페스트(.m3u8) 내의 URL도 재작성
  const contentType = res.headers.get("Content-Type") || "";
  if (
    contentType.includes("mpegurl") ||
    contentType.includes("m3u8") ||
    targetUrl.endsWith(".m3u8")
  ) {
    const text = await res.text();
    const workerBase = new URL(originalRequest.url);
    const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf("/") + 1);
    const rewritten = rewriteM3u8(
      text,
      baseUrl,
      `${workerBase.protocol}//${workerBase.host}`
    );
    return new Response(rewritten, {
      status: res.status,
      headers: {
        ...headers,
        "Content-Type": "application/vnd.apple.mpegurl",
        "Cache-Control": "no-cache",
      },
    });
  }

  // 그 외(영상 세그먼트, 이미지 등)는 스트리밍 전달
  const responseHeaders = { ...headers };
  for (const key of [
    "Content-Type",
    "Content-Length",
    "Content-Range",
    "Accept-Ranges",
    "Cache-Control",
  ]) {
    const val = res.headers.get(key);
    if (val) responseHeaders[key] = val;
  }

  return new Response(res.body, {
    status: res.status,
    headers: responseHeaders,
  });
}

// ── M3U8 매니페스트 URL 재작성 ──
function rewriteM3u8(text, baseUrl, workerBase) {
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      // 빈 줄이나 주석은 그대로
      if (!trimmed || trimmed.startsWith("#")) {
        // #EXT-X-MAP 등의 URI 속성도 재작성
        if (trimmed.includes('URI="')) {
          return trimmed.replace(/URI="([^"]+)"/, (match, uri) => {
            const fullUrl = uri.startsWith("http") ? uri : baseUrl + uri;
            return `URI="${workerBase}/proxy?url=${encodeURIComponent(fullUrl)}"`;
          });
        }
        return line;
      }
      // URL 줄 → 프록시 경유로 변환
      const fullUrl = trimmed.startsWith("http") ? trimmed : baseUrl + trimmed;
      return `${workerBase}/proxy?url=${encodeURIComponent(fullUrl)}`;
    })
    .join("\n");
}

function jsonResponse(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
