/* ============================================
   SchoolTube – script.js
   Piped API + HLS.js  ·  No iframe needed
   ============================================ */

(() => {
  "use strict";

  // ── Constants ──
  const YT_API_BASE = "https://www.googleapis.com/youtube/v3";
  const MAX_RESULTS = 12;
  const STORAGE_KEY = "schooltube_api_key";
  const PROXY_KEY = "schooltube_piped_api";

  // ─────────────────────────────────────────────
  // Piped API instances — returns stream URLs
  // These proxy the actual video data through
  // their own servers, bypassing YouTube blocks
  // ─────────────────────────────────────────────
  const PIPED_API_LIST = [
    { name: "Kavin (공식) 🌐", url: "https://pipedapi.kavin.rocks" },
    { name: "Adminforge 🇩🇪", url: "https://pipedapi.adminforge.de" },
    { name: "Leptons 🇦🇹", url: "https://pipedapi.leptons.xyz" },
    { name: "Private.coffee 🇦🇹", url: "https://api.piped.private.coffee" },
    { name: "Nosebs 🇫🇮", url: "https://pipedapi.nosebs.ru" },
    { name: "Kavin Libre 🇳🇱", url: "https://pipedapi-libre.kavin.rocks" },
    { name: "Drgns 🇺🇸", url: "https://pipedapi.drgns.space" },
    { name: "Privacy.com.de 🇩🇪", url: "https://piped-api.privacy.com.de" },
    { name: "Piped.yt 🇩🇪", url: "https://api.piped.yt" },
    { name: "Codespace 🇨🇿", url: "https://piped-api.codespace.cz" },
  ];

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
  const proxySelect = $("#proxy-select");
  const settingsSaveBtn = $("#settings-save-btn");
  const settingsCancelBtn = $("#settings-cancel-btn");
  const settingsTestBtn = $("#settings-test-btn");
  const autoDetectBtn = $("#auto-detect-btn");
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
  const retryApiBtn = $("#retry-api-btn");
  const retrySameBtn = $("#retry-same-btn");
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
  let currentApiIndex = parseInt(localStorage.getItem(PROXY_KEY), 10) || 0;
  if (currentApiIndex >= PIPED_API_LIST.length) currentApiIndex = 0;
  let currentQuery = "";
  let nextPageToken = "";
  let currentVideoId = "";
  let currentVideoMeta = {};
  let hlsInstance = null;

  // ── Init ──
  function init() {
    if (!apiKey) showApiModal();

    populateProxySelect();

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
    settingsTestBtn.addEventListener("click", () =>
      testProxy(parseInt(proxySelect.value, 10))
    );
    autoDetectBtn.addEventListener("click", autoDetect);
    settingsModal.addEventListener("click", (e) => {
      if (e.target === settingsModal) hideSettingsModal();
    });

    retryApiBtn.addEventListener("click", cycleApiAndRetry);
    retrySameBtn.addEventListener("click", retrySame);

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

  function populateProxySelect() {
    proxySelect.innerHTML = "";
    PIPED_API_LIST.forEach((p, i) => {
      const opt = document.createElement("option");
      opt.value = i;
      opt.textContent = p.name;
      if (i === currentApiIndex) opt.selected = true;
      proxySelect.appendChild(opt);
    });
  }

  // ─────────────────────────────────────────────
  // VIDEO PLAYER — Piped API + HLS.js
  // ─────────────────────────────────────────────

  async function playVideo(videoId, title, channel, date, desc) {
    currentVideoId = videoId;
    currentVideoMeta = { title, channel, date, desc };

    // Show player UI
    playerTitle.textContent = decodeHtml(title);
    playerChannel.textContent = decodeHtml(channel);
    playerDate.textContent = formatDate(date);
    playerDesc.textContent = decodeHtml(desc);
    playerSection.hidden = false;
    playerError.hidden = true;
    playerLoading.hidden = false;

    updateBadge();
    playerSection.scrollIntoView({ behavior: "smooth", block: "start" });

    // Destroy previous HLS instance
    destroyHls();

    // Try loading stream
    await loadStream(videoId, currentApiIndex);
  }

  async function loadStream(videoId, apiIndex) {
    const api = PIPED_API_LIST[apiIndex];
    playerLoading.hidden = false;
    playerError.hidden = true;

    try {
      const streamData = await fetchPipedStream(api.url, videoId);
      applyStream(streamData);
    } catch (err) {
      console.error(`[${api.name}] Stream fetch failed:`, err);
      showPlayerError(`${api.name}: ${err.message}`);
    }
  }

  async function fetchPipedStream(apiBase, videoId) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(`${apiBase}/streams/${videoId}`, {
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      throw new Error(`API 응답 오류 (${res.status})`);
    }

    const data = await res.json();

    if (data.error) {
      throw new Error(data.error);
    }

    return data;
  }

  function applyStream(data) {
    destroyHls();
    playerLoading.hidden = true;
    playerError.hidden = true;

    // Set poster
    if (data.thumbnailUrl) {
      playerVideo.poster = data.thumbnailUrl;
    }

    // Strategy 1: HLS stream (best quality, adaptive)
    if (data.hls) {
      if (Hls && Hls.isSupported()) {
        hlsInstance = new Hls({
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
          startLevel: -1, // auto quality
        });
        hlsInstance.loadSource(data.hls);
        hlsInstance.attachMedia(playerVideo);

        hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
          playerVideo.play().catch(() => {});
        });

        hlsInstance.on(Hls.Events.ERROR, (event, errorData) => {
          if (errorData.fatal) {
            console.error("HLS fatal error, trying MP4 fallback");
            destroyHls();
            tryMp4Fallback(data);
          }
        });
        return;
      }

      // Native HLS (Safari)
      if (playerVideo.canPlayType("application/vnd.apple.mpegurl")) {
        playerVideo.src = data.hls;
        playerVideo.play().catch(() => {});
        return;
      }
    }

    // Strategy 2: Direct MP4 stream
    tryMp4Fallback(data);
  }

  function tryMp4Fallback(data) {
    // Pick best muxed (video+audio) stream
    const muxed = (data.videoStreams || [])
      .filter((s) => !s.videoOnly && s.url)
      .sort((a, b) => (b.height || 0) - (a.height || 0));

    if (muxed.length > 0) {
      playerVideo.src = muxed[0].url;
      playerVideo.play().catch(() => {});
      return;
    }

    // Strategy 3: Video-only stream (no audio, but at least shows video)
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

  function cycleApiAndRetry() {
    currentApiIndex = (currentApiIndex + 1) % PIPED_API_LIST.length;
    localStorage.setItem(PROXY_KEY, currentApiIndex);
    proxySelect.value = currentApiIndex;
    updateBadge();
    showToast(`🔄 ${PIPED_API_LIST[currentApiIndex].name} 으로 전환`);

    if (currentVideoId) {
      loadStream(currentVideoId, currentApiIndex);
    }
  }

  function retrySame() {
    if (currentVideoId) {
      loadStream(currentVideoId, currentApiIndex);
    }
  }

  function updateBadge() {
    if (proxyBadge) {
      proxyBadge.textContent = `API: ${PIPED_API_LIST[currentApiIndex].name}`;
      proxyBadge.hidden = false;
    }
  }

  // ─────────────────────────────────────────────
  // AUTO DETECT — find first working Piped API
  // ─────────────────────────────────────────────

  async function autoDetect() {
    autoDetectBtn.disabled = true;
    autoDetectBtn.textContent = "🔍 탐지 중…";
    testResult.textContent = "모든 API를 순서대로 테스트합니다…";
    testResult.className = "test-result testing";

    let foundIndex = -1;

    for (let i = 0; i < PIPED_API_LIST.length; i++) {
      const api = PIPED_API_LIST[i];
      testResult.textContent = `(${i + 1}/${PIPED_API_LIST.length}) ${api.name} 테스트 중…`;

      const ok = await checkApiHealth(api.url);
      if (ok) {
        foundIndex = i;
        break;
      }
    }

    autoDetectBtn.disabled = false;
    autoDetectBtn.textContent = "🔍 자동 탐지";

    if (foundIndex >= 0) {
      proxySelect.value = foundIndex;
      testResult.textContent = `✅ ${PIPED_API_LIST[foundIndex].name} — 정상 연결! 적용 버튼을 눌러주세요.`;
      testResult.className = "test-result success";
    } else {
      testResult.textContent =
        "❌ 모든 API 연결 실패. 네트워크를 확인하거나 나중에 다시 시도해 주세요.";
      testResult.className = "test-result fail";
    }
  }

  async function checkApiHealth(apiUrl) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      // Piped API healthcheck — just fetch a known video stream info
      const res = await fetch(`${apiUrl}/streams/dQw4w9WgXcQ`, {
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return false;
      const data = await res.json();
      return !data.error && (data.hls || (data.videoStreams && data.videoStreams.length > 0));
    } catch {
      return false;
    }
  }

  async function testProxy(idx) {
    const api = PIPED_API_LIST[idx];
    settingsTestBtn.disabled = true;
    testResult.textContent = `${api.name} 테스트 중…`;
    testResult.className = "test-result testing";

    const ok = await checkApiHealth(api.url);

    settingsTestBtn.disabled = false;
    if (ok) {
      testResult.textContent = "✅ API 정상 — 영상 스트림 수신 가능";
      testResult.className = "test-result success";
    } else {
      testResult.textContent = "❌ API 연결 실패 또는 차단됨";
      testResult.className = "test-result fail";
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
  }

  // ── Settings Modal ──
  function showSettingsModal() {
    proxySelect.value = currentApiIndex;
    testResult.textContent = "";
    testResult.className = "test-result";
    settingsModal.hidden = false;
  }
  function hideSettingsModal() {
    settingsModal.hidden = true;
  }
  function saveSettings() {
    currentApiIndex = parseInt(proxySelect.value, 10);
    localStorage.setItem(PROXY_KEY, currentApiIndex);
    hideSettingsModal();
    updateBadge();
    showToast(`✅ ${PIPED_API_LIST[currentApiIndex].name} 적용됨`);

    // Re-load current video with new API
    if (currentVideoId) {
      loadStream(currentVideoId, currentApiIndex);
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
        throw new Error(
          "API 키가 유효하지 않거나 할당량이 초과되었습니다."
        );
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
