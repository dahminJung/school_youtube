/* ============================================
   SchoolTube – script.js
   Cloudflare Worker proxy + HLS.js
   ============================================ */

(() => {
  "use strict";

  // ── Constants ──
  const YT_API_BASE = "https://www.googleapis.com/youtube/v3";
  const MAX_RESULTS = 12;
  const STORAGE_KEY = "schooltube_api_key";
  const WORKER_KEY = "schooltube_worker_url";

  // ── DOM refs ──
  const $ = (sel) => document.querySelector(sel);
  const searchForm = $("#search-form");
  const searchInput = $("#search-input");
  const apiKeyBtn = $("#api-key-btn");
  const settingsBtn = $("#settings-btn");
  const apiModal = $("#api-modal");
  const apiKeyInput = $("#api-key-input");
  const apiSaveBtn = $("#api-save-btn");
  const apiCancelBtn = $("#api-cancel-btn");
  const settingsModal = $("#settings-modal");
  const workerUrlInput = $("#worker-url-input");
  const settingsSaveBtn = $("#settings-save-btn");
  const settingsCancelBtn = $("#settings-cancel-btn");
  const settingsTestBtn = $("#settings-test-btn");
  const testResult = $("#test-result");
  const welcomeHero = $("#welcome-hero");
  const playerSection = $("#player-section");
  const playerVideo = $("#player-video");
  const playerTitle = $("#player-title");
  const playerChannel = $("#player-channel");
  const playerDate = $("#player-date");
  const playerDesc = $("#player-desc");
  const proxyBadge = $("#proxy-badge");
  const playerLoading = $("#player-loading");
  const playerError = $("#player-error");
  const playerErrorMsg = $("#player-error-msg");
  const retryBtn = $("#retry-btn");
  const resultsSection = $("#results-section");
  const resultsHeading = $("#results-heading");
  const resultsGrid = $("#results-grid");
  const loadMoreWrap = $("#load-more-wrap");
  const loadMoreBtn = $("#load-more-btn");
  const loader = $("#loader");
  const errorMsg = $("#error-msg");
  const logo = $("#logo");

  // ── State ──
  let apiKey = localStorage.getItem(STORAGE_KEY) || "";
  let workerUrl = (localStorage.getItem(WORKER_KEY) || "").replace(/\/+$/, "");
  let currentQuery = "";
  let nextPageToken = "";
  let currentVideoId = "";
  let currentVideoMeta = {};
  let hlsInstance = null;

  // ── Init ──
  function init() {
    if (!apiKey) showApiModal();
    else if (!workerUrl) showSettingsModal();

    searchForm.addEventListener("submit", onSearch);
    apiKeyBtn.addEventListener("click", showApiModal);
    apiSaveBtn.addEventListener("click", saveApiKey);
    apiCancelBtn.addEventListener("click", hideApiModal);
    apiModal.addEventListener("click", (e) => {
      if (e.target === apiModal) hideApiModal();
    });

    settingsBtn.addEventListener("click", showSettingsModal);
    settingsSaveBtn.addEventListener("click", saveSettings);
    settingsCancelBtn.addEventListener("click", hideSettingsModal);
    settingsTestBtn.addEventListener("click", testWorker);
    settingsModal.addEventListener("click", (e) => {
      if (e.target === settingsModal) hideSettingsModal();
    });

    retryBtn.addEventListener("click", retryCurrent);
    loadMoreBtn.addEventListener("click", loadMore);
    logo.addEventListener("click", (e) => {
      e.preventDefault();
      resetToHome();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (!apiModal.hidden) hideApiModal();
        if (!settingsModal.hidden) hideSettingsModal();
      }
    });
  }

  // ─────────────────────────────────────────────
  // VIDEO PLAYER
  // ─────────────────────────────────────────────

  async function playVideo(videoId, title, channel, date, desc) {
    if (!workerUrl) {
      showSettingsModal();
      showToast("⚠️ Worker URL을 먼저 설정해주세요.");
      return;
    }

    currentVideoId = videoId;
    currentVideoMeta = { title, channel, date, desc };

    playerTitle.textContent = decodeHtml(title);
    playerChannel.textContent = decodeHtml(channel);
    playerDate.textContent = formatDate(date);
    playerDesc.textContent = decodeHtml(desc);
    playerSection.hidden = false;
    playerError.hidden = true;
    playerLoading.hidden = false;

    updateBadge();
    playerSection.scrollIntoView({ behavior: "smooth", block: "start" });

    destroyHls();
    await loadStream(videoId);
  }

  async function loadStream(videoId) {
    playerLoading.hidden = false;
    playerError.hidden = true;

    try {
      // Worker를 통해 Piped API 호출
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);

      const res = await fetch(`${workerUrl}/streams/${videoId}`, {
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `응답 오류 (${res.status})`);
      }

      const data = await res.json();
      if (data.error) throw new Error(data.error);

      // 썸네일 설정
      if (data.thumbnailUrl) {
        playerVideo.poster = data.thumbnailUrl;
      }

      applyStream(data);
    } catch (err) {
      console.error("Stream load failed:", err);
      showPlayerError(err.message);
    }
  }

  function applyStream(data) {
    destroyHls();
    playerLoading.hidden = true;
    playerError.hidden = true;

    // ── Strategy 1: HLS (adaptive streaming) ──
    if (data.hls) {
      if (typeof Hls !== "undefined" && Hls.isSupported()) {
        hlsInstance = new Hls({
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
          startLevel: -1,
          // Worker가 이미 URL을 재작성했으므로
          // HLS.js 요청은 자동으로 Worker를 경유
        });

        hlsInstance.loadSource(data.hls);
        hlsInstance.attachMedia(playerVideo);

        hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
          playerVideo.play().catch(() => {});
        });

        hlsInstance.on(Hls.Events.ERROR, (_event, errorData) => {
          if (errorData.fatal) {
            console.warn("HLS fatal error, trying MP4 fallback");
            destroyHls();
            tryMp4Fallback(data);
          }
        });
        return;
      }

      // Native HLS (Safari, iOS)
      if (playerVideo.canPlayType("application/vnd.apple.mpegurl")) {
        playerVideo.src = data.hls;
        playerVideo.play().catch(() => {});
        return;
      }
    }

    // ── Strategy 2: Direct MP4 ──
    tryMp4Fallback(data);
  }

  function tryMp4Fallback(data) {
    // Muxed streams (video + audio combined)
    const muxed = (data.videoStreams || [])
      .filter((s) => !s.videoOnly && s.url)
      .sort((a, b) => (b.height || 0) - (a.height || 0));

    if (muxed.length > 0) {
      // 720p 이하를 우선 선택 (크롬북 성능 고려)
      const preferred = muxed.find((s) => s.height <= 720) || muxed[0];
      playerVideo.src = preferred.url;
      playerVideo.play().catch(() => {});
      return;
    }

    // Video-only fallback
    const videoOnly = (data.videoStreams || [])
      .filter((s) => s.url)
      .sort((a, b) => (b.height || 0) - (a.height || 0));

    if (videoOnly.length > 0) {
      playerVideo.src = videoOnly[0].url;
      playerVideo.play().catch(() => {});
      return;
    }

    showPlayerError("재생 가능한 스트림을 찾지 못했습니다.");
  }

  function destroyHls() {
    if (hlsInstance) {
      hlsInstance.destroy();
      hlsInstance = null;
    }
    playerVideo.removeAttribute("src");
    playerVideo.load();
  }

  function showPlayerError(msg) {
    playerLoading.hidden = true;
    playerError.hidden = false;
    playerErrorMsg.textContent = msg;
  }

  function retryCurrent() {
    if (currentVideoId) {
      loadStream(currentVideoId);
    }
  }

  function updateBadge() {
    if (proxyBadge && workerUrl) {
      try {
        const host = new URL(workerUrl).host;
        proxyBadge.textContent = `via ${host}`;
        proxyBadge.hidden = false;
      } catch {
        proxyBadge.hidden = true;
      }
    }
  }

  // ─────────────────────────────────────────────
  // WORKER TEST
  // ─────────────────────────────────────────────

  async function testWorker() {
    const url = workerUrlInput.value.trim().replace(/\/+$/, "");
    if (!url) {
      testResult.textContent = "URL을 입력해주세요.";
      testResult.className = "test-result fail";
      return;
    }

    settingsTestBtn.disabled = true;
    testResult.textContent = "Worker 연결 테스트 중…";
    testResult.className = "test-result testing";

    try {
      // Step 1: Health check
      const controller1 = new AbortController();
      const timer1 = setTimeout(() => controller1.abort(), 6000);
      const res1 = await fetch(`${url}/health`, { signal: controller1.signal });
      clearTimeout(timer1);

      if (!res1.ok) throw new Error(`Health check 실패 (${res1.status})`);

      testResult.textContent = "✓ Worker 연결됨. 영상 스트림 테스트 중…";

      // Step 2: Stream test
      const controller2 = new AbortController();
      const timer2 = setTimeout(() => controller2.abort(), 12000);
      const res2 = await fetch(`${url}/streams/dQw4w9WgXcQ`, {
        signal: controller2.signal,
      });
      clearTimeout(timer2);

      if (!res2.ok) throw new Error(`스트림 API 실패 (${res2.status})`);

      const data = await res2.json();
      if (data.error) throw new Error(data.error);

      const hasStreams =
        data.hls || (data.videoStreams && data.videoStreams.length > 0);
      if (!hasStreams) throw new Error("스트림 URL 없음");

      testResult.textContent = "✅ 완벽하게 작동합니다! 적용 버튼을 눌러주세요.";
      testResult.className = "test-result success";
    } catch (err) {
      testResult.textContent = `❌ 실패: ${err.message}`;
      testResult.className = "test-result fail";
    } finally {
      settingsTestBtn.disabled = false;
    }
  }

  // ── Toast ──
  function showToast(msg) {
    let toast = document.getElementById("toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "toast";
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.remove("show");
    void toast.offsetWidth;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2800);
  }

  // ── API Key Modal ──
  function showApiModal() {
    apiKeyInput.value = apiKey;
    apiModal.hidden = false;
    setTimeout(() => apiKeyInput.focus(), 80);
  }
  function hideApiModal() {
    apiModal.hidden = true;
  }
  function saveApiKey() {
    const key = apiKeyInput.value.trim();
    if (!key) {
      apiKeyInput.focus();
      return;
    }
    apiKey = key;
    localStorage.setItem(STORAGE_KEY, apiKey);
    hideApiModal();
    if (!workerUrl) showSettingsModal();
  }

  // ── Settings Modal ──
  function showSettingsModal() {
    workerUrlInput.value = workerUrl;
    testResult.textContent = "";
    testResult.className = "test-result";
    settingsModal.hidden = false;
    setTimeout(() => workerUrlInput.focus(), 80);
  }
  function hideSettingsModal() {
    settingsModal.hidden = true;
  }
  function saveSettings() {
    const url = workerUrlInput.value.trim().replace(/\/+$/, "");
    if (!url) {
      workerUrlInput.focus();
      return;
    }
    workerUrl = url;
    localStorage.setItem(WORKER_KEY, workerUrl);
    hideSettingsModal();
    updateBadge();
    showToast("✅ Worker URL 저장됨");

    if (currentVideoId) {
      loadStream(currentVideoId);
    }
  }

  // ── YouTube Search ──
  async function onSearch(e) {
    e.preventDefault();
    const query = searchInput.value.trim();
    if (!query) return;
    if (!apiKey) {
      showApiModal();
      return;
    }

    currentQuery = query;
    nextPageToken = "";
    resultsGrid.innerHTML = "";
    showLoader();
    hideError();
    welcomeHero.hidden = true;

    try {
      const data = await fetchVideos(query);
      renderResults(data, false);
    } catch (err) {
      showError(err.message);
    } finally {
      hideLoader();
    }
  }

  async function loadMore() {
    if (!nextPageToken || !currentQuery) return;
    loadMoreBtn.disabled = true;
    loadMoreBtn.textContent = "로딩 중…";
    try {
      const data = await fetchVideos(currentQuery, nextPageToken);
      renderResults(data, true);
    } catch (err) {
      showError(err.message);
    } finally {
      loadMoreBtn.disabled = false;
      loadMoreBtn.textContent = "더 보기";
    }
  }

  async function fetchVideos(query, pageToken = "") {
    const params = new URLSearchParams({
      part: "snippet",
      type: "video",
      maxResults: MAX_RESULTS,
      q: query,
      key: apiKey,
    });
    if (pageToken) params.set("pageToken", pageToken);

    const res = await fetch(`${YT_API_BASE}/search?${params}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const msg = body?.error?.message || `API 오류 (${res.status})`;
      if (res.status === 403) {
        throw new Error("API 키가 유효하지 않거나 할당량이 초과되었습니다.");
      }
      throw new Error(msg);
    }
    return res.json();
  }

  // ── Render results ──
  function renderResults(data, append) {
    nextPageToken = data.nextPageToken || "";
    const items = data.items || [];

    if (!append && items.length === 0) {
      showError("검색 결과가 없습니다.");
      resultsSection.hidden = true;
      return;
    }

    resultsSection.hidden = false;
    resultsHeading.textContent = `"${currentQuery}" 검색 결과`;

    items.forEach((item, i) => {
      const card = createCard(
        item,
        append ? resultsGrid.children.length + i : i
      );
      resultsGrid.appendChild(card);
    });

    loadMoreWrap.hidden = !nextPageToken;
  }

  function createCard(item, index) {
    const { videoId } = item.id;
    const s = item.snippet;
    const thumb =
      s.thumbnails.high?.url ||
      s.thumbnails.medium?.url ||
      s.thumbnails.default?.url;

    const card = document.createElement("article");
    card.className = "video-card";
    card.style.animationDelay = `${Math.min(index * 0.03, 0.36)}s`;
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.setAttribute("aria-label", decodeHtml(s.title));

    card.innerHTML = `
      <div class="card-thumb">
        <img src="${thumb}" alt="" loading="lazy" />
        <div class="card-play-overlay">
          <svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="24" fill="rgba(0,0,0,0.6)"/><polygon points="18,14 18,34 36,24" fill="#fff"/></svg>
        </div>
      </div>
      <div class="card-body">
        <div class="card-title">${decodeHtml(s.title)}</div>
        <div class="card-channel">${decodeHtml(s.channelTitle)}</div>
        <div class="card-date">${formatDate(s.publishedAt)}</div>
      </div>
    `;

    const play = () =>
      playVideo(videoId, s.title, s.channelTitle, s.publishedAt, s.description);

    card.addEventListener("click", play);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        play();
      }
    });

    return card;
  }

  // ── Reset ──
  function resetToHome() {
    searchInput.value = "";
    currentQuery = "";
    nextPageToken = "";
    currentVideoId = "";
    currentVideoMeta = {};
    destroyHls();
    playerSection.hidden = true;
    resultsSection.hidden = true;
    resultsGrid.innerHTML = "";
    loadMoreWrap.hidden = true;
    hideError();
    welcomeHero.hidden = false;
  }

  // ── Helpers ──
  function showLoader() {
    loader.hidden = false;
  }
  function hideLoader() {
    loader.hidden = true;
  }
  function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.hidden = false;
  }
  function hideError() {
    errorMsg.hidden = true;
  }

  function decodeHtml(html) {
    const txt = document.createElement("textarea");
    txt.innerHTML = html || "";
    return txt.value;
  }

  function formatDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    const now = new Date();
    const diff = now - d;
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    const months = Math.floor(days / 30);
    const years = Math.floor(days / 365);

    if (mins < 1) return "방금 전";
    if (mins < 60) return `${mins}분 전`;
    if (hours < 24) return `${hours}시간 전`;
    if (days < 30) return `${days}일 전`;
    if (months < 12) return `${months}개월 전`;
    return `${years}년 전`;
  }

  // ── Boot ──
  init();
})();
