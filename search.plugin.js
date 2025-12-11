/**
 * @name Spotlight Search
 * @description Apple Spotlight-style search overlay for Stremio
 * @version 1.3.0
 * @author EZOBOSS
 */

(function () {
    "use strict";

    class SpotlightSearch {
        static CONFIG = {
            DEBOUNCE_MS: 300,
            API_BASE: "https://v3-cinemeta.strem.io/catalog",
            LOGO_BASE: "https://images.metahub.space/logo/medium",
            TYPES: ["movie", "series"],
            MAX_RESULTS: 10,
            CACHE_MAX_SIZE: 50,
            STORAGE_KEY: "spotlight_recent_searches",
            MAX_RECENT: 10,
        };

        // Search results cache
        static cache = new Map();

        constructor() {
            this.overlay = null;
            this.input = null;
            this.resultsContainer = null;
            this.isOpen = false;
            this.movieResults = [];
            this.seriesResults = [];
            this.selectedColumn = "movie";
            this.selectedIndex = 0;
            this.debounceTimer = null;
            this.abortController = null;
            this.recentSearchesCache = null;

            this.init();
        }

        init() {
            this.createOverlay();
            this.bindKeyboardShortcut();
            this.bindEvents();
            console.log(
                "[SpotlightSearch] Initialized - Press Ctrl+Space to open"
            );
        }

        createOverlay() {
            this.overlay = document.createElement("div");
            this.overlay.className = "spotlight-overlay";
            this.overlay.innerHTML = `
                <div class="spotlight-container">
                    <div class="spotlight-input-wrapper">
                        <svg class="spotlight-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="11" cy="11" r="8"/>
                            <path d="M21 21l-4.35-4.35"/>
                        </svg>
                        <input 
                            type="text" 
                            class="spotlight-input" 
                            placeholder="Search movies and series..."
                            autocomplete="off"
                            spellcheck="false"
                        />
                        <span class="spotlight-shortcut-hint">ESC</span>
                    </div>
                    <div class="spotlight-results"></div>
                </div>
            `;

            document.body.appendChild(this.overlay);

            this.input = this.overlay.querySelector(".spotlight-input");
            this.resultsContainer =
                this.overlay.querySelector(".spotlight-results");
        }

        bindKeyboardShortcut() {
            document.addEventListener("keydown", (e) => {
                // Ctrl+Space to open
                if (e.ctrlKey && e.code === "Space") {
                    e.preventDefault();
                    e.stopPropagation();
                    this.toggle();
                }

                // Escape to close
                if (e.key === "Escape" && this.isOpen) {
                    e.preventDefault();
                    this.close();
                }
            });
        }

        bindEvents() {
            // Close when clicking overlay background
            this.overlay.addEventListener("click", (e) => {
                if (e.target === this.overlay) {
                    this.close();
                }
            });

            // Input handling with debounce
            this.input.addEventListener("input", () => {
                this.handleSearch();
            });

            // Keyboard navigation in results
            this.input.addEventListener("keydown", (e) => {
                if (e.key === "ArrowDown") {
                    e.preventDefault();
                    this.navigateResults(1);
                } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    this.navigateResults(-1);
                } else if (e.key === "ArrowLeft") {
                    e.preventDefault();
                    this.switchColumn("movie");
                } else if (e.key === "ArrowRight") {
                    e.preventDefault();
                    this.switchColumn("series");
                } else if (e.key === "Enter") {
                    e.preventDefault();
                    this.selectResult();
                }
            });

            // Event Delegation for Results and Recent Searches
            this.resultsContainer.addEventListener("click", (e) => {
                // Handle Result Item Click
                const resultItem = e.target.closest(".spotlight-result-item");
                if (resultItem) {
                    const column = resultItem.dataset.column;
                    const index = parseInt(resultItem.dataset.index, 10);
                    this.selectedColumn = column;
                    this.selectedIndex = index;
                    this.selectResult();
                    return;
                }

                // Handle Recent Search Clean Button
                const clearBtn = e.target.closest(".spotlight-clear-btn");
                if (clearBtn) {
                    e.stopPropagation();
                    this.clearRecentSearches();
                    return;
                }

                // Handle Recent Search Remove Item
                const removeBtn = e.target.closest(".spotlight-recent-remove");
                if (removeBtn) {
                    e.stopPropagation();
                    const recentItem = removeBtn.closest(
                        ".spotlight-recent-item"
                    );
                    if (recentItem) {
                        const id = recentItem.dataset.id;
                        this.removeRecentSearch(id);
                    }
                    return;
                }

                // Handle Recent Search Item Click (excluding remove button)
                const recentItem = e.target.closest(".spotlight-recent-item");
                if (recentItem) {
                    const id = recentItem.dataset.id;
                    const type = recentItem.dataset.type;
                    if (id && type) {
                        window.location.hash = `#/detail/${type}/${id}`;
                        this.close();
                    }
                }
            });

            // Mouse Enter delegation for hover effect
            this.resultsContainer.addEventListener("mouseover", (e) => {
                const item = e.target.closest(".spotlight-result-item");
                if (item) {
                    const column = item.dataset.column;
                    const index = parseInt(item.dataset.index, 10);
                    // Only update if changed prevents unnecessary repaints
                    if (
                        this.selectedColumn !== column ||
                        this.selectedIndex !== index
                    ) {
                        this.selectedColumn = column;
                        this.selectedIndex = index;
                        this.updateSelection();
                    }
                }
            });
        }

        open() {
            this.isOpen = true;
            this.overlay.classList.add("active");
            this.input.value = "";
            this.selectedColumn = "movie";
            this.selectedIndex = 0;
            this.movieResults = [];
            this.seriesResults = [];

            // Show recent searches when opening
            this.showRecentSearches();

            setTimeout(() => {
                this.input.focus();
            }, 50);
        }

        close() {
            this.isOpen = false;
            this.overlay.classList.remove("active");
            this.input.blur();

            if (this.abortController) {
                this.abortController.abort();
            }
        }

        toggle() {
            if (this.isOpen) {
                this.close();
            } else {
                this.open();
            }
        }

        handleSearch() {
            const query = this.input.value.trim();

            if (this.debounceTimer) {
                clearTimeout(this.debounceTimer);
            }

            if (this.abortController) {
                this.abortController.abort();
            }

            if (!query) {
                this.showRecentSearches();
                this.movieResults = [];
                this.seriesResults = [];
                return;
            }

            this.debounceTimer = setTimeout(() => {
                this.showLoading();
                this.performSearch(query);
            }, SpotlightSearch.CONFIG.DEBOUNCE_MS);
        }

        async performSearch(query) {
            this.abortController = new AbortController();

            try {
                // Use Promise.allSettled for robustness
                const fetchPromises = SpotlightSearch.CONFIG.TYPES.map((type) =>
                    this.fetchResults(type, query)
                );

                const results = await Promise.allSettled(fetchPromises);

                const movieResult = results[0];
                const seriesResult = results[1];

                this.movieResults =
                    movieResult.status === "fulfilled"
                        ? (movieResult.value || []).slice(
                              0,
                              SpotlightSearch.CONFIG.MAX_RESULTS
                          )
                        : [];

                this.seriesResults =
                    seriesResult.status === "fulfilled"
                        ? (seriesResult.value || []).slice(
                              0,
                              SpotlightSearch.CONFIG.MAX_RESULTS
                          )
                        : [];

                // Mark types
                this.movieResults.forEach((m) => (m._type = "movie"));
                this.seriesResults.forEach((s) => (s._type = "series"));

                // Logic to set initial selection
                if (this.movieResults.length > 0) {
                    this.selectedColumn = "movie";
                    this.selectedIndex = 0;
                } else if (this.seriesResults.length > 0) {
                    this.selectedColumn = "series";
                    this.selectedIndex = 0;
                } else {
                    this.selectedColumn = "movie";
                    this.selectedIndex = -1;
                }

                // Check if both failed
                if (
                    movieResult.status === "rejected" &&
                    seriesResult.status === "rejected"
                ) {
                    // Log error but show empty state instead of breaking
                    console.error("[SpotlightSearch] All searches failed");
                    this.showEmpty("Search unavailable");
                } else {
                    this.renderResults();
                }
            } catch (err) {
                // catch other unexpected errors
                console.error("[SpotlightSearch] Unexpected error:", err);
            }
        }

        async fetchResults(type, query) {
            const cacheKey = `${type}:${query.toLowerCase()}`;

            // Check cache first
            if (SpotlightSearch.cache.has(cacheKey)) {
                return SpotlightSearch.cache.get(cacheKey);
            }

            const url = `${
                SpotlightSearch.CONFIG.API_BASE
            }/${type}/top/search=${encodeURIComponent(query)}.json`;

            const response = await fetch(url, {
                signal: this.abortController.signal,
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            const results = data.metas || [];

            // Store in cache
            if (
                SpotlightSearch.cache.size >=
                SpotlightSearch.CONFIG.CACHE_MAX_SIZE
            ) {
                // Remove oldest entry (first key)
                const firstKey = SpotlightSearch.cache.keys().next().value;
                SpotlightSearch.cache.delete(firstKey);
            }
            SpotlightSearch.cache.set(cacheKey, results);

            return results;
        }

        // Rendering
        showLoading() {
            this.resultsContainer.innerHTML = `
                <div class="spotlight-results-columns">
                    <div class="spotlight-loading">
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 2v4m0 12v4m10-10h-4M6 12H2m15.07-5.07l-2.83 2.83M9.76 14.24l-2.83 2.83m11.14 0l-2.83-2.83M9.76 9.76L6.93 6.93"/>
                        </svg>
                        <span>Searching...</span>
                    </div>
                </div>
            `;
        }

        showEmpty(message = "No results found") {
            this.resultsContainer.innerHTML = `
                <div class="spotlight-results-columns">
                    <div class="spotlight-empty">
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <circle cx="11" cy="11" r="8"/>
                            <path d="M21 21l-4.35-4.35"/>
                        </svg>
                        <span>${message}</span>
                    </div>
                </div>
            `;
            this.movieResults = [];
            this.seriesResults = [];
        }

        renderResults() {
            if (
                this.movieResults.length === 0 &&
                this.seriesResults.length === 0
            ) {
                this.showEmpty();
                return;
            }

            const movieIcon = `<svg class="spotlight-column-title-icon movie" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5"/></svg>`;
            const seriesIcon = `<svg class="spotlight-column-title-icon series" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="15" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/></svg>`;

            const html = `
                <div class="spotlight-results-columns">
                    <div class="spotlight-column" data-column="movie">
                        <div class="spotlight-column-header">
                            <span class="spotlight-column-title">${movieIcon} Movies</span>
                            <span class="spotlight-column-count">${
                                this.movieResults.length
                            }</span>
                        </div>
                        <div class="spotlight-column-list">
                            ${
                                this.movieResults.length > 0
                                    ? this.movieResults
                                          .map((m, i) =>
                                              this.renderResultItem(
                                                  m,
                                                  i,
                                                  "movie"
                                              )
                                          )
                                          .join("")
                                    : '<div class="spotlight-column-empty">No movies</div>'
                            }
                        </div>
                    </div>
                    <div class="spotlight-column" data-column="series">
                        <div class="spotlight-column-header">
                            <span class="spotlight-column-title">${seriesIcon} Series</span>
                            <span class="spotlight-column-count">${
                                this.seriesResults.length
                            }</span>
                        </div>
                        <div class="spotlight-column-list">
                            ${
                                this.seriesResults.length > 0
                                    ? this.seriesResults
                                          .map((s, i) =>
                                              this.renderResultItem(
                                                  s,
                                                  i,
                                                  "series"
                                              )
                                          )
                                          .join("")
                                    : '<div class="spotlight-column-empty">No series</div>'
                            }
                        </div>
                    </div>
                </div>
            `;

            this.resultsContainer.innerHTML = html;
            // No need to bind individual events, handled by delegation in bindEvents()

            this.updateSelection();
        }

        renderResultItem(meta, index, column) {
            const poster = meta.poster || "";
            const title = meta.name || "Unknown";
            const year = meta.releaseInfo || "";
            const isSelected =
                column === this.selectedColumn && index === this.selectedIndex;
            const logoUrl = `${SpotlightSearch.CONFIG.LOGO_BASE}/${meta.id}/img`;
            const background = meta.background || "";

            // Use logo with fallback to text title
            const titleContent = `
                <img 
                    class="spotlight-result-logo" 
                    src="${logoUrl}" 
                    alt="${title}"
                    onerror="this.outerHTML='<span class=\\'spotlight-result-title\\' title=\\'${title.replace(
                        /'/g,
                        "&#39;"
                    )}\\'>${title}</span>'"
                />
            `;

            return `
                <div class="spotlight-result-item${
                    isSelected ? " selected" : ""
                }" data-index="${index}" data-column="${column}" data-id="${
                meta.id
            }" data-type="${column}">
                    <img 
                        class="spotlight-result-poster" 
                        src="${poster}" 
                        alt="${title}"
                        loading="lazy"
                        onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 150%22><rect fill=%22%23222%22 width=%22100%22 height=%22150%22/></svg>'"
                    />
                    <img class="spotlight-result-background" src="${background}"></img>
                    <div class="spotlight-result-info">
                        ${titleContent}
                        <span class="spotlight-result-year">${year}</span>
                    </div>
                    <span class="spotlight-result-enter">↵</span>
                </div>
            `;
        }

        updateSelection() {
            const items = this.resultsContainer.querySelectorAll(
                ".spotlight-result-item"
            );
            items.forEach((item) => {
                const itemColumn = item.dataset.column;
                const itemIndex = parseInt(item.dataset.index, 10);
                const isSelected =
                    itemColumn === this.selectedColumn &&
                    itemIndex === this.selectedIndex;
                item.classList.toggle("selected", isSelected);
            });
        }

        getCurrentColumnResults() {
            return this.selectedColumn === "movie"
                ? this.movieResults
                : this.seriesResults;
        }

        switchColumn(column) {
            const targetResults =
                column === "movie" ? this.movieResults : this.seriesResults;
            if (targetResults.length === 0) return;

            this.selectedColumn = column;
            if (this.selectedIndex >= targetResults.length) {
                this.selectedIndex = targetResults.length - 1;
            }
            if (this.selectedIndex < 0) {
                this.selectedIndex = 0;
            }
            this.updateSelection();
        }

        navigateResults(direction) {
            const currentResults = this.getCurrentColumnResults();
            if (currentResults.length === 0) return;

            this.selectedIndex += direction;

            if (this.selectedIndex < 0) {
                this.selectedIndex = currentResults.length - 1;
            } else if (this.selectedIndex >= currentResults.length) {
                this.selectedIndex = 0;
            }

            this.updateSelection();

            const selectedItem = this.resultsContainer.querySelector(
                `.spotlight-result-item[data-column="${this.selectedColumn}"][data-index="${this.selectedIndex}"]`
            );
            if (selectedItem) {
                selectedItem.scrollIntoView({
                    block: "nearest",
                    behavior: "smooth",
                });
            }
        }

        selectResult() {
            const currentResults = this.getCurrentColumnResults();
            if (currentResults.length === 0) return;

            if (
                this.selectedIndex < 0 ||
                this.selectedIndex >= currentResults.length
            ) {
                this.selectedIndex = 0;
            }

            const selected = currentResults[this.selectedIndex];
            if (selected) {
                const type = selected._type || selected.type || "movie";
                const id = selected.id || selected.imdb_id;

                if (id) {
                    // Save to recent searches
                    this.addRecentSearch({
                        id,
                        type,
                        name: selected.name || "Unknown",
                        poster: selected.poster || "",
                        releaseInfo: selected.releaseInfo || "",
                    });

                    window.location.hash = `#/detail/${type}/${id}`;
                    this.close();
                }
            }
        }

        loadRecentSearches() {
            if (this.recentSearchesCache) {
                return this.recentSearchesCache;
            }
            try {
                const data = localStorage.getItem(
                    SpotlightSearch.CONFIG.STORAGE_KEY
                );
                this.recentSearchesCache = data ? JSON.parse(data) : [];
                return this.recentSearchesCache;
            } catch (e) {
                console.error(
                    "[SpotlightSearch] Failed to load recent searches:",
                    e
                );
                return [];
            }
        }

        saveRecentSearches(searches) {
            try {
                this.recentSearchesCache = searches;
                localStorage.setItem(
                    SpotlightSearch.CONFIG.STORAGE_KEY,
                    JSON.stringify(searches)
                );
            } catch (e) {
                console.error(
                    "[SpotlightSearch] Failed to save recent searches:",
                    e
                );
            }
        }

        addRecentSearch(item) {
            const searches = this.loadRecentSearches();

            // Remove duplicate if exists
            const filtered = searches.filter((s) => s.id !== item.id);

            // Add to beginning
            filtered.unshift({
                ...item,
                timestamp: Date.now(),
            });

            // Keep only max items
            const trimmed = filtered.slice(
                0,
                SpotlightSearch.CONFIG.MAX_RECENT
            );

            this.saveRecentSearches(trimmed);
        }

        removeRecentSearch(id) {
            const searches = this.loadRecentSearches();
            const filtered = searches.filter((s) => s.id !== id);
            this.saveRecentSearches(filtered);
            this.showRecentSearches();
        }

        clearRecentSearches() {
            this.saveRecentSearches([]);
            this.showRecentSearches();
        }

        showRecentSearches() {
            const searches = this.loadRecentSearches();

            if (searches.length === 0) {
                this.resultsContainer.innerHTML = `
                    <div class="spotlight-recent-empty">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <circle cx="12" cy="12" r="10"/>
                            <polyline points="12 6 12 12 16 14"/>
                        </svg>
                        <span>No recent searches</span>
                    </div>
                `;
                return;
            }

            const recentHtml = `
                <div class="spotlight-recent-section">
                    <div class="spotlight-recent-header">
                        <span class="spotlight-recent-title">
                            <svg class="spotlight-recent-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="10"/>
                                <polyline points="12 6 12 12 16 14"/>
                            </svg>
                            Recent Searches
                        </span>
                        <button class="spotlight-clear-btn" title="Clear all">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"/>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                            </svg>
                        </button>
                    </div>
                    <div class="spotlight-recent-list">
                        ${searches
                            .map((item, index) =>
                                this.renderRecentItem(item, index)
                            )
                            .join("")}
                    </div>
                </div>
            `;

            this.resultsContainer.innerHTML = recentHtml;
            // No need to bind events here anymore, delegation in bindEvents handles it
        }

        formatRelativeTime(timestamp) {
            if (!timestamp) return "";

            const now = Date.now();
            const diff = now - timestamp;

            const seconds = Math.floor(diff / 1000);
            const minutes = Math.floor(seconds / 60);
            const hours = Math.floor(minutes / 60);
            const days = Math.floor(hours / 24);
            const weeks = Math.floor(days / 7);
            const months = Math.floor(days / 30);

            if (months > 0) return `${months}mo`;
            if (weeks > 0) return `${weeks}w`;
            if (days > 0) return `${days}d`;
            if (hours > 0) return `${hours}h`;
            if (minutes > 0) return `${minutes}m`;
            return "now";
        }

        renderRecentItem(item, index) {
            const logoUrl = `${SpotlightSearch.CONFIG.LOGO_BASE}/${item.id}/img`;
            const relativeTime = this.formatRelativeTime(item.timestamp);
            const typeIcon =
                item.type === "movie"
                    ? `<svg class="spotlight-recent-type-icon movie" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5"/></svg>`
                    : `<svg class="spotlight-recent-type-icon series" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="15" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/></svg>`;

            // Fix: correctly escape the fallback name in onerror
            const escapedName = item.name
                .replace(/'/g, "&#39;")
                .replace(/"/g, "&quot;");

            return `
                <div class="spotlight-recent-item" data-id="${item.id}" data-type="${item.type}" data-index="${index}">
                    <img 
                        class="spotlight-recent-poster" 
                        src="${item.poster}" 
                        alt="${item.name}"
                        loading="lazy"
                        onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 150%22><rect fill=%22%23222%22 width=%22100%22 height=%22150%22/></svg>'"
                    />
                    <div class="spotlight-recent-info">
                        <img 
                            class="spotlight-recent-logo" 
                            src="${logoUrl}" 
                            alt="${escapedName}"
                            onerror="this.outerHTML='<span class=&quot;spotlight-recent-name&quot; title=&quot;${escapedName}&quot;>${escapedName}</span>'"
                        />
                        <div class="spotlight-recent-meta">
                            ${typeIcon}
                            <span class="spotlight-recent-year">${item.releaseInfo}</span>
                        </div>
                    </div>
                    <span class="spotlight-recent-time">${relativeTime}</span>
                    <button class="spotlight-recent-remove" title="Remove">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"/>
                            <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </button>
                </div>
            `;
        }
    }

    // Initialize when DOM is ready
    if (document.readyState === "loading") {
        document.addEventListener(
            "DOMContentLoaded",
            () => new SpotlightSearch()
        );
    } else {
        requestIdleCallback(() => new SpotlightSearch());
    }
})();
