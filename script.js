/* ============================================
   SchoolTube – script.js
   YouTube Data API v3  ·  Search & Play
   ============================================ */

(() => {
  "use strict";

  // ── Constants ──
  const API_BASE = "https://www.googleapis.com/youtube/v3";
  const MAX_RESULTS = 12;
  const STORAGE_KEY = "schooltube_api_key";

  // ── DOM refs ──
  const $ = (sel) => document.querySelector(sel);
  const searchForm = $("#search-form");
  const searchInput = $("#search-input");
  const apiKeyBtn = $("#api-key-btn");
  const apiModal = $("#api-modal");
  const apiKeyInput = $("#api-key-input");
  const apiSaveBtn = $("#api-save-btn");
  const apiCancelBtn = $("#api-cancel-btn");
  const welcomeHero = $("#welcome-hero");
  const playerSection = $("#player-section");
  const playerIframe = $("#player-iframe");
  const playerTitle = $("#player-title");
  const playerChannel = $("#player-channel");
  const playerDate = $("#player-date");
  const playerDesc = $("#player-desc");
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
  let currentQuery = "";
  let nextPageToken = "";

  // ── Init ──
  function init() {
    if (!apiKey) showApiModal();

    searchForm.addEventListener("submit", onSearch);
    apiKeyBtn.addEventListener("click", showApiModal);
    apiSaveBtn.addEventListener("click", saveApiKey);
    apiCancelBtn.addEventListener("click", hideApiModal);
    apiModal.addEventListener("click", (e) => {
      if (e.target === apiModal) hideApiModal();
    });
    loadMoreBtn.addEventListener("click", loadMore);
    logo.addEventListener("click", (e) => {
      e.preventDefault();
      resetToHome();
    });

    // Keyboard: Escape closes modal
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !apiModal.hidden) hideApiModal();
    });
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
      const msg =
        body?.error?.message || `API 오류 (${res.status})`;
      if (res.status === 403) {
        throw new Error("API 키가 유효하지 않거나 할당량이 초과되었습니다. 키를 확인해 주세요.");
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
      const card = createCard(item, append ? resultsGrid.children.length + i : i);
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
    playerIframe.src = `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`;
    playerTitle.textContent = decodeHtml(title);
    playerChannel.textContent = decodeHtml(channel);
    playerDate.textContent = formatDate(date);
    playerDesc.textContent = decodeHtml(desc);
    playerSection.hidden = false;

    // Smooth scroll to player
    playerSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ── Reset ──
  function resetToHome() {
    searchInput.value = "";
    currentQuery = "";
    nextPageToken = "";
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
