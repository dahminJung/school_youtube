/* ============================================
   SchoolTube – script.js
   YouTube Data API v3  ·  Search & Play
   Multi-proxy fallback with auto-detection
   ============================================ */

(() => {
  "use strict";

  // ── Constants ──
  const API_BASE = "https://www.googleapis.com/youtube/v3";
  const MAX_RESULTS = 12;
  const STORAGE_KEY = "schooltube_api_key";
  const PROXY_KEY = "schooltube_proxy";

  // ─────────────────────────────────────────────
  // Proxy list — ordered by reliability
  // `local=true` on Invidious = server proxies the video stream
  // Piped always proxies video through its backend
  // ─────────────────────────────────────────────
  const PROXY_LIST = [
    {
      name: "Invidious (nadeko) 🇨🇱",
      embed: (id) =>
        `https://inv.nadeko.net/embed/${id}?autoplay=1&local=true`,
      test: "https://inv.nadeko.net",
      type: "invidious",
    },
    {
      name: "Invidious (nerdvpn) 🇺🇦",
      embed: (id) =>
        `https://invidious.nerdvpn.de/embed/${id}?autoplay=1&local=true`,
      test: "https://invidious.nerdvpn.de",
      type: "invidious",
    },
    {
      name: "Invidious (yewtu.be) 🇩🇪",
      embed: (id) =>
        `https://yewtu.be/embed/${id}?autoplay=1&local=true`,
      test: "https://yewtu.be",
      type: "invidious",
    },
    {
      name: "Piped (공식) 🌐",
      embed: (id) =>
        `https://piped.video/embed/${id}?autoplay=1`,
      test: "https://piped.video",
      type: "piped",
    },
    {
      name: "Piped (kavin) 🇳🇱",
      embed: (id) =>
        `https://piped.kavin.rocks/embed/${id}?autoplay=1`,
      test: "https://piped.kavin.rocks",
      type: "piped",
    },
    {
      name: "Piped (adminforge) 🇩🇪",
      embed: (id) =>
        `https://piped.adminforge.de/embed/${id}?autoplay=1`,
      test: "https://piped.adminforge.de",
      type: "piped",
    },
    {
      name: "Piped (private.coffee) 🇦🇹",
      embed: (id) =>
        `https://watch.piped.private.coffee/embed/${id}?autoplay=1`,
      test: "https://watch.piped.private.coffee",
      type: "piped",
    },
    {
      name: "Piped (leptons) 🇦🇹",
      embed: (id) =>
        `https://piped.leptons.xyz/embed/${id}?autoplay=1`,
      test: "https://piped.leptons.xyz",
      type: "piped",
    },
    {
      name: "YouTube (기본 - 차단 가능)",
      embed: (id) =>
        `https://www.youtube.com/embed/${id}?autoplay=1&rel=0`,
      test: "https://www.youtube.com",
      type: "youtube",
    },
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
  const playerIframe = $("#player-iframe");
  const playerTitle = $("#player-title");
  const playerChannel = $("#player-channel");
  const playerDate = $("#player-date");
  const playerDesc = $("#player-desc");
  const proxyBadge = $("#proxy-badge");
  const retryProxyBtn = $("#retry-proxy-btn");
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
  let currentProxyIndex = parseInt(localStorage.getItem(PROXY_KEY), 10) || 0;
  if (currentProxyIndex >= PROXY_LIST.length) currentProxyIndex = 0;
  let currentQuery = "";
  let nextPageToken = "";
  let currentVideoId = "";
  let currentVideoMeta = {};

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
    settingsTestBtn.addEventListener("click", () => testProxy(parseInt(proxySelect.value, 10)));
    autoDetectBtn.addEventListener("click", autoDetect);
    settingsModal.addEventListener("click", (e) => {
      if (e.target === settingsModal) hideSettingsModal();
    });

    retryProxyBtn.addEventListener("click", cycleProxy);

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
    PROXY_LIST.forEach((p, i) => {
      const opt = document.createElement("option");
      opt.value = i;
      opt.textContent = `${p.name} [${p.type}]`;
      if (i === currentProxyIndex) opt.selected = true;
      proxySelect.appendChild(opt);
    });
  }

  // ── Cycle to next proxy ──
  function cycleProxy() {
    const nextIndex = (currentProxyIndex + 1) % PROXY_LIST.length;
    currentProxyIndex = nextIndex;
    localStorage.setItem(PROXY_KEY, currentProxyIndex);
    proxySelect.value = currentProxyIndex;

    if (currentVideoId) {
      playVideo(
        currentVideoId,
        currentVideoMeta.title,
        currentVideoMeta.channel,
        currentVideoMeta.date,
        currentVideoMeta.desc
      );
    }

    showToast(`🔄 ${PROXY_LIST[currentProxyIndex].name} 으로 전환됨`);
  }

  // ── Auto-detect best proxy ──
  async function autoDetect() {
    autoDetectBtn.disabled = true;
    autoDetectBtn.textContent = "🔍 탐지 중…";
    testResult.textContent = "모든 프록시를 순서대로 테스트합니다…";
    testResult.className = "test-result testing";

    let foundIndex = -1;

    for (let i = 0; i < PROXY_LIST.length; i++) {
      const proxy = PROXY_LIST[i];
      testResult.textContent = `(${i + 1}/${PROXY_LIST.length}) ${proxy.name} 테스트 중…`;

      const ok = await checkProxyReachable(proxy.test);
      if (ok) {
        foundIndex = i;
        break;
      }
    }

    autoDetectBtn.disabled = false;
    autoDetectBtn.textContent = "🔍 자동 탐지";

    if (foundIndex >= 0) {
      proxySelect.value = foundIndex;
      testResult.textContent = `✅ ${PROXY_LIST[foundIndex].name} 연결 가능! 적용 버튼을 눌러주세요.`;
      testResult.className = "test-result success";
    } else {
      testResult.textContent = "❌ 연결 가능한 프록시를 찾지 못했습니다.";
      testResult.className = "test-result fail";
    }
  }

  async function checkProxyReachable(url) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      await fetch(url, { mode: "no-cors", signal: controller.signal });
      clearTimeout(timer);
      return true;
    } catch {
      return false;
    }
  }

  // ── Test single proxy ──
  async function testProxy(idx) {
    const proxy = PROXY_LIST[idx];
    settingsTestBtn.disabled = true;
    testResult.textContent = `${proxy.name} 테스트 중…`;
    testResult.className = "test-result testing";

    const ok = await checkProxyReachable(proxy.test);

    settingsTestBtn.disabled = false;
    if (ok) {
      testResult.textContent = "✅ 연결 가능 (차단되지 않음)";
      testResult.className = "test-result success";
    } else {
      testResult.textContent = "❌ 연결 실패 또는 차단됨";
      testResult.className = "test-result fail";
    }
  }

  // ── Toast Notification ──
  function showToast(msg) {
    let toast = document.getElementById("toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "toast";
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.remove("show");
    void toast.offsetWidth; // force reflow
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
    proxySelect.value = currentProxyIndex;
    testResult.textContent = "";
    testResult.className = "test-result";
    settingsModal.hidden = false;
  }

  function hideSettingsModal() {
    settingsModal.hidden = true;
  }

  function saveSettings() {
    currentProxyIndex = parseInt(proxySelect.value, 10);
    localStorage.setItem(PROXY_KEY, currentProxyIndex);
    hideSettingsModal();

    if (currentVideoId) {
      playVideo(
        currentVideoId,
        currentVideoMeta.title,
        currentVideoMeta.channel,
        currentVideoMeta.date,
        currentVideoMeta.desc
      );
    }
    showToast(`✅ ${PROXY_LIST[currentProxyIndex].name} 적용됨`);
  }

  // ── Search ──
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

  // ── YouTube API ──
  async function fetchVideos(query, pageToken = "") {
    const params = new URLSearchParams({
      part: "snippet",
      type: "video",
      maxResults: MAX_RESULTS,
      q: query,
      key: apiKey,
      videoEmbeddable: "true",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const res = await fetch(`${API_BASE}/search?${params}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const msg = body?.error?.message || `API 오류 (${res.status})`;
      if (res.status === 403) {
        throw new Error(
          "API 키가 유효하지 않거나 할당량이 초과되었습니다. 키를 확인해 주세요."
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

  // ── Player ──
  function playVideo(videoId, title, channel, date, desc) {
    currentVideoId = videoId;
    currentVideoMeta = { title, channel, date, desc };

    const proxy = PROXY_LIST[currentProxyIndex];
    playerIframe.src = proxy.embed(videoId);
    playerTitle.textContent = decodeHtml(title);
    playerChannel.textContent = decodeHtml(channel);
    playerDate.textContent = formatDate(date);
    playerDesc.textContent = decodeHtml(desc);
    playerSection.hidden = false;

    if (proxyBadge) {
      proxyBadge.textContent = proxy.name;
      proxyBadge.hidden = false;
    }

    playerSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ── Reset ──
  function resetToHome() {
    searchInput.value = "";
    currentQuery = "";
    nextPageToken = "";
    currentVideoId = "";
    currentVideoMeta = {};
    playerIframe.src = "";
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
