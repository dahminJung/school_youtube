// ============================================
// SchoolTube — Google Apps Script (Code.gs)
// ============================================
// 배포 방법:
// 1. https://script.google.com 접속
// 2. "새 프로젝트" 클릭
// 3. 기본 코드(function myFunction...) 전부 삭제
// 4. 이 파일 내용을 전부 복사해서 붙여넣기
// 5. 상단 메뉴: 배포 → 새 배포
// 6. 유형 선택: "웹 앱"
// 7. "액세스 권한이 있는 사용자": "모든 사용자" 선택
// 8. "배포" 클릭
// 9. 생성된 URL을 복사 (https://script.google.com/macros/s/xxxxx/exec)
// 10. 이 URL을 worker.js의 GAS_URL에 붙여넣기
// ============================================

function doGet(e) {
  var videoId = e.parameter.v;
  var mode = e.parameter.mode || "streams";

  if (!videoId) {
    return jsonOut({ error: "Missing ?v= parameter" });
  }

  if (mode === "debug") {
    return jsonOut(debugAll(videoId));
  }

  var result = getStreams(videoId);
  return jsonOut(result);
}

function getStreams(videoId) {
  // 방법 1: WEB 클라이언트
  var data = callPlayer(videoId, "WEB", "2.20260301.00.00", null);
  if (data && data.streamingData && hasPlayableStreams(data)) {
    return extractResult(data);
  }

  // 방법 2: IOS 클라이언트 (HLS 지원)
  data = callPlayer(videoId, "IOS", "19.45.4", "com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X;)");
  if (data && data.streamingData && hasPlayableStreams(data)) {
    return extractResult(data);
  }

  // 방법 3: ANDROID 클라이언트
  data = callPlayer(videoId, "ANDROID", "19.09.37", "com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip");
  if (data && data.streamingData && hasPlayableStreams(data)) {
    return extractResult(data);
  }

  // 방법 4: MWEB 클라이언트
  data = callPlayer(videoId, "MWEB", "2.20260301.01.00", null);
  if (data && data.streamingData && hasPlayableStreams(data)) {
    return extractResult(data);
  }

  // 방법 5: 웹페이지 스크래핑
  var scraped = scrapeWatch(videoId);
  if (scraped && scraped.streamingData && hasPlayableStreams(scraped)) {
    return extractResult(scraped);
  }

  return { error: "모든 방법이 실패했습니다. 잠시 후 다시 시도해 주세요." };
}

function callPlayer(videoId, clientName, clientVersion, userAgent) {
  var url = "https://www.youtube.com/youtubei/v1/player";
  var context = {
    client: {
      clientName: clientName,
      clientVersion: clientVersion,
      hl: "ko",
      gl: "KR"
    }
  };

  if (clientName === "IOS") {
    context.client.deviceModel = "iPhone16,2";
  }
  if (clientName === "ANDROID") {
    context.client.androidSdkVersion = 30;
  }

  var payload = {
    videoId: videoId,
    context: context,
    contentCheckOk: true,
    racyCheckOk: true
  };

  var headers = { "Content-Type": "application/json" };
  if (userAgent) headers["User-Agent"] = userAgent;
  if (clientName === "WEB" || clientName === "MWEB") {
    headers["Origin"] = "https://www.youtube.com";
    headers["Referer"] = "https://www.youtube.com/watch?v=" + videoId;
  }

  var options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    headers: headers,
    muteHttpExceptions: true,
    followRedirects: true
  };

  try {
    var response = UrlFetchApp.fetch(url, options);
    var code = response.getResponseCode();
    if (code !== 200) return null;
    return JSON.parse(response.getContentText());
  } catch (e) {
    return null;
  }
}

function scrapeWatch(videoId) {
  try {
    var url = "https://www.youtube.com/watch?v=" + videoId + "&bpctr=9999999999&has_verified=1";
    var options = {
      method: "get",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept-Language": "ko-KR,ko;q=0.9",
        "Cookie": "CONSENT=PENDING+999"
      },
      muteHttpExceptions: true,
      followRedirects: true
    };
    var response = UrlFetchApp.fetch(url, options);
    var html = response.getContentText();

    var marker = "var ytInitialPlayerResponse = ";
    var idx = html.indexOf(marker);
    if (idx === -1) return null;

    var start = idx + marker.length;
    var depth = 0;
    var end = start;
    for (var i = start; i < html.length && i < start + 500000; i++) {
      if (html.charAt(i) === "{") depth++;
      else if (html.charAt(i) === "}") {
        depth--;
        if (depth === 0) { end = i + 1; break; }
      }
    }
    if (depth !== 0) return null;
    return JSON.parse(html.substring(start, end));
  } catch (e) {
    return null;
  }
}

function hasPlayableStreams(data) {
  var status = data.playabilityStatus ? data.playabilityStatus.status : "";
  if (status === "ERROR" || status === "LOGIN_REQUIRED" || status === "UNPLAYABLE") return false;
  var sd = data.streamingData || {};
  return !!(sd.hlsManifestUrl || (sd.formats && sd.formats.length > 0));
}

function extractResult(data) {
  var sd = data.streamingData || {};
  var vd = data.videoDetails || {};

  var formats = (sd.formats || []).filter(function(f) { return !!f.url; });
  var videoStreams = formats.map(function(f) {
    return {
      url: f.url,
      quality: f.qualityLabel || (f.height + "p"),
      height: f.height || 0,
      mimeType: f.mimeType || "",
      videoOnly: false
    };
  });

  var thumbs = vd.thumbnail && vd.thumbnail.thumbnails ? vd.thumbnail.thumbnails : [];
  var thumbnailUrl = thumbs.length > 0 ? thumbs[thumbs.length - 1].url : null;

  return {
    title: vd.title || "",
    hls: sd.hlsManifestUrl || null,
    videoStreams: videoStreams,
    thumbnailUrl: thumbnailUrl,
    duration: parseInt(vd.lengthSeconds || "0", 10)
  };
}

function debugAll(videoId) {
  var clients = [
    { name: "WEB", ver: "2.20260301.00.00", ua: null },
    { name: "MWEB", ver: "2.20260301.01.00", ua: null },
    { name: "IOS", ver: "19.45.4", ua: "com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X;)" },
    { name: "ANDROID", ver: "19.09.37", ua: "com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip" }
  ];

  var results = [];
  clients.forEach(function(c) {
    var r = { client: c.name, playability: null, hasHls: false, formats: 0, error: null };
    try {
      var data = callPlayer(videoId, c.name, c.ver, c.ua);
      if (data) {
        r.playability = data.playabilityStatus ? data.playabilityStatus.status : "UNKNOWN";
        r.hasHls = !!(data.streamingData && data.streamingData.hlsManifestUrl);
        r.formats = ((data.streamingData && data.streamingData.formats) ? data.streamingData.formats.length : 0) +
                    ((data.streamingData && data.streamingData.adaptiveFormats) ? data.streamingData.adaptiveFormats.length : 0);
        r.error = data.playabilityStatus ? (data.playabilityStatus.reason || null) : null;
      } else {
        r.error = "No response";
      }
    } catch (e) {
      r.error = e.toString();
    }
    results.push(r);
  });

  // 스크래핑 테스트
  var r5 = { client: "WEB_SCRAPE", playability: null, hasHls: false, formats: 0, error: null };
  try {
    var data = scrapeWatch(videoId);
    if (data) {
      r5.playability = data.playabilityStatus ? data.playabilityStatus.status : "UNKNOWN";
      r5.hasHls = !!(data.streamingData && data.streamingData.hlsManifestUrl);
      r5.formats = ((data.streamingData && data.streamingData.formats) ? data.streamingData.formats.length : 0) +
                   ((data.streamingData && data.streamingData.adaptiveFormats) ? data.streamingData.adaptiveFormats.length : 0);
    } else {
      r5.error = "Scrape failed";
    }
  } catch (e) {
    r5.error = e.toString();
  }
  results.push(r5);

  return { videoId: videoId, results: results };
}

function jsonOut(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
