/**
 * @name Upcoming Releases List
 * @description Shows a list of upcoming releases (with IndexedDB metadata caching)
 * @version 2.1.0
 * @author EZOBOSS
 * @dependencies metadatadb.plugin.js
 */

(function () {
    // UpcomingReleasesPlugin Main class
    class UpcomingReleasesPlugin {
        static CONFIG = {
            FETCH_TIMEOUT: 5000,
            CACHE_TTL: 1000 * 60 * 60 * 12, // 12 hours for the main catalog list
            CACHE_PREFIX: "upcoming_cache_",
            CACHE_DEBOUNCE_MS: 500, // Debounce cache updates
            DAY_BUFFER: 86400000 * 4, // Include 4 days of future videos
            BATCH_SIZE: 50, // Number of concurrent promises to process at once
            URLS: {
                CINEMETA_CATALOG:
                    "https://cinemeta-catalogs.strem.io/top/catalog",
                CINEMETA_META: "https://cinemeta-live.strem.io/meta",
                POSTER: "https://images.metahub.space/background/large",
                LOGO: "https://images.metahub.space/logo/medium",
            },
            STORAGE_KEYS: {
                LIBRARY_RECENT: "library_recent",
                UPCOMING_MODE: "upcoming_mode",
            },
        };

        constructor() {
            this.memoryCache = new Map();
            this.libraryRecentCache = null;
            this.updateState = false;
            this.renderTimeout = null;
            this.intlDateTimeFormat = new Intl.DateTimeFormat("en-GB", {
                month: "short",
                timeZone: "UTC",
            });
            this.observer = null;
            this.currentMode = null;
            this.currentDataSignature = null;
            this.metadataDB = window.MetadataDB;
            console.log(this.metadataDB);

            this.init();
        }

        init() {
            // Initial render
            this.waitForHero();

            // Event listeners
            window.addEventListener("hashchange", (event) => {
                if (event.oldURL.includes("player")) {
                    this.updateState = true;
                    this.libraryItemsCache = null;
                }
                // Debounce render
                if (this.renderTimeout) clearTimeout(this.renderTimeout);
                this.waitForHero();
            });
        }

        waitForHero() {
            if (this.heroObserver) {
                this.heroObserver.disconnect();
                this.heroObserver = null;
            }

            const check = () => {
                const hero = document.querySelector(".hero-container");
                if (hero) {
                    // Prevent duplicate render if already present
                    if (!hero.querySelector(".upcoming-toggle-bar")) {
                        this.render();
                    }
                    return true;
                }
                return false;
            };

            if (check()) return;

            this.heroObserver = new MutationObserver((mutations) => {
                let found = false;
                for (const mutation of mutations) {
                    // Optimization: Ignore if target is inside hero (we only care about hero creation)
                    if (
                        mutation.target.closest &&
                        mutation.target.closest(".hero-container")
                    )
                        continue;

                    for (const node of mutation.addedNodes) {
                        if (
                            node.nodeType === 1 &&
                            (node.classList?.contains("hero-container") ||
                                node.querySelector?.(".hero-container"))
                        ) {
                            found = true;
                            break;
                        }
                    }
                    if (found) break;
                }

                if (found && check()) {
                    if (this.heroObserver) {
                        this.heroObserver.disconnect();
                        this.heroObserver = null;
                    }
                }
            });

            this.heroObserver.observe(document.body, {
                childList: true,
                subtree: true,
            });
        }

        // --- Cache Methods ---

        get cacheKey() {
            return (key) => UpcomingReleasesPlugin.CONFIG.CACHE_PREFIX + key;
        }

        cacheSet(key, value) {
            const entry = { value, timestamp: Date.now() };
            this.memoryCache.set(key, entry);
            requestIdleCallback(() => {
                try {
                    localStorage.setItem(
                        this.cacheKey(key),
                        JSON.stringify(entry)
                    );
                } catch (e) {
                    console.warn("[UpcomingReleases] LocalStorage error:", e);
                }
            });
        }

        cacheGet(key) {
            const now = Date.now();
            // Check memory first
            const mem = this.memoryCache.get(key);
            if (
                mem &&
                now - mem.timestamp < UpcomingReleasesPlugin.CONFIG.CACHE_TTL
            )
                return mem.value;

            // Check localStorage
            try {
                const raw = localStorage.getItem(this.cacheKey(key));
                if (!raw) return null;
                const data = JSON.parse(raw);
                if (
                    now - data.timestamp >
                    UpcomingReleasesPlugin.CONFIG.CACHE_TTL
                ) {
                    localStorage.removeItem(this.cacheKey(key));
                    return null;
                }
                this.memoryCache.set(key, data);
                return data.value;
            } catch {
                return null;
            }
        }

        // --- Helper Methods ---

        async safeFetch(
            url,
            {
                timeout = UpcomingReleasesPlugin.CONFIG.FETCH_TIMEOUT,
                retries = 1,
            } = {}
        ) {
            console.log("[UpcomingReleases] API Request:", url);
            let attempt = 0;
            while (attempt <= retries) {
                attempt++;
                const controller = new AbortController();
                const id = setTimeout(() => controller.abort(), timeout);
                try {
                    const res = await fetch(url, { signal: controller.signal });
                    clearTimeout(id);
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    return res.json();
                } catch (err) {
                    clearTimeout(id);
                    if (attempt > retries) throw err;
                    await new Promise((r) => setTimeout(r, 300 * attempt));
                }
            }
        }

        formatDaysUntil(dateMs, now = Date.now()) {
            const target = new Date(dateMs);
            const current = new Date(now);

            // Reset to midnight for calendar day comparison
            target.setHours(0, 0, 0, 0);
            current.setHours(0, 0, 0, 0);

            const diffMs = target.getTime() - current.getTime();
            const diff = Math.round(diffMs / 86400000);

            if (diff < 0) {
                const absoluteDaysDiff = Math.abs(diff);
                if (absoluteDaysDiff === 1) return "Yesterday";
                return `${absoluteDaysDiff} days ago`;
            }
            if (diff === 0) return "Today";
            if (diff === 1) return "Tomorrow";
            if (diff < 30) return `in ${diff} days`;
            if (diff < 365) {
                const months = Math.round(diff / 30);
                return `in ${months} month${months > 1 ? "s" : ""}`;
            }
            const years = Math.round(diff / 365);
            return `in ${years} year${years > 1 ? "s" : ""}`;
        }

        formatDate(dateString) {
            const date = new Date(dateString);
            const day = date.getUTCDate();
            const month = this.intlDateTimeFormat.format(date);
            return `${day}<br>${month}`;
        }

        async batchPromiseAllSettled(
            promiseFns,
            batchSize = UpcomingReleasesPlugin.CONFIG.BATCH_SIZE
        ) {
            const results = [];

            for (let i = 0; i < promiseFns.length; i += batchSize) {
                const batch = promiseFns.slice(i, i + batchSize);
                const batchPromises = batch.map((fn) => fn());
                const batchResults = await Promise.allSettled(batchPromises);
                results.push(...batchResults);

                console.log(
                    `[UpcomingReleases] Processed batch ${
                        Math.floor(i / batchSize) + 1
                    }/${Math.ceil(promiseFns.length / batchSize)} (${
                        i + batch.length
                    }/${promiseFns.length} total)`
                );
            }

            return results;
        }

        // --- Data Logic ---

        getUserLibrarySeries() {
            if (this.libraryRecentCache) return this.libraryRecentCache;

            try {
                const raw = localStorage.getItem(
                    UpcomingReleasesPlugin.CONFIG.STORAGE_KEYS.LIBRARY_RECENT
                );
                if (!raw) return [];
                const library = JSON.parse(raw);
                const libraryItems = Object.values(library.items || {});

                const filtered = libraryItems.filter((item) => {
                    if (item?.type !== "series") return false;
                    if (!item?._id?.startsWith("tt")) return false;

                    const watched = item?.state?.watched;
                    if (!watched) return false;

                    const [, s, e] = watched.split(":");
                    return +s > 1 || +e > 1; // exclude only-watched pilot
                });

                this.libraryRecentCache = filtered;
                return filtered;
            } catch (err) {
                console.warn(
                    "[UpcomingReleases] Failed to read library_recent",
                    err
                );
                return [];
            }
        }

        _parseWatchState(watchedState) {
            if (!watchedState) return { season: 0, episode: 0 };
            const parts = watchedState.split(":");
            return parts.length >= 3
                ? { season: +parts[1], episode: +parts[2] }
                : { season: 0, episode: 0 };
        }

        _shouldBeWatched(video, currentSeason, currentEpisode) {
            if (currentSeason === 0) return false;
            if (video.season < currentSeason && video.season > 0) return true;
            if (
                video.season === currentSeason &&
                video.episode <= currentEpisode
            )
                return true;
            return false;
        }

        async _syncWatchStateToDB(episodesBySeries) {
            for (const [seriesId, episodes] of episodesBySeries) {
                try {
                    const rawMeta = await this.metadataDB.get(seriesId);
                    if (!rawMeta?.videos) continue;

                    const meta = structuredClone(rawMeta);
                    const videoMap = new Map(
                        meta.videos.map((v) => [`${v.season}-${v.episode}`, v])
                    );

                    let modified = false;
                    for (const { season, episode, watched } of episodes) {
                        const match = videoMap.get(`${season}-${episode}`);
                        if (match && !!match.watched !== watched) {
                            match.watched = watched;
                            modified = true;
                        }
                    }

                    if (modified) {
                        await this.metadataDB.putImmediate(
                            seriesId,
                            meta,
                            "series",
                            true,
                            true
                        );
                        console.log(
                            `[UpcomingReleases] Updated ${episodes.length} episodes for ${seriesId}`
                        );
                    }
                } catch (err) {
                    console.warn(
                        `[UpcomingReleases] Failed to update ${seriesId}:`,
                        err
                    );
                }
            }
        }

        async getUserData(list) {
            const recentItems = this._getLibraryItems();
            if (!recentItems) return list;

            const updates = [];

            for (const item of list) {
                if (item.type !== "series" || !item.videos) continue;

                const lib = recentItems[item.id];
                if (!lib) continue;

                const watchedState = lib.state?.watched;
                const { season: currentSeason, episode: currentEpisode } =
                    this._parseWatchState(watchedState);

                item.watched = watchedState;

                for (const video of item.videos) {
                    const shouldBeWatched = this._shouldBeWatched(
                        video,
                        currentSeason,
                        currentEpisode
                    );
                    if (!!video.watched !== shouldBeWatched) {
                        video.watched = shouldBeWatched;
                        updates.push({
                            id: item.id,
                            season: video.season,
                            episode: video.episode,
                            watched: shouldBeWatched,
                        });
                    }
                }
            }

            if (updates.length > 0) {
                const episodesBySeries = updates.reduce((map, ep) => {
                    if (!map.has(ep.id)) map.set(ep.id, []);
                    map.get(ep.id).push(ep);
                    return map;
                }, new Map());

                await this._syncWatchStateToDB(episodesBySeries);
            }

            return list;
        }

        _getLibraryItems() {
            if (this.libraryItemsCache) return this.libraryItemsCache;
            try {
                const raw = localStorage.getItem(
                    UpcomingReleasesPlugin.CONFIG.STORAGE_KEYS.LIBRARY_RECENT
                );
                const items = raw ? JSON.parse(raw).items : null;
                this.libraryItemsCache = items;
                return items;
            } catch {
                return null;
            }
        }

        getClosestFutureVideo(meta) {
            const now = Date.now();
            const threshold = now - UpcomingReleasesPlugin.CONFIG.DAY_BUFFER;
            const futureVideos = [];

            if (meta.released) {
                const d = Date.parse(meta.released);
                if (d > threshold) {
                    futureVideos.push({
                        dateMs: d,
                        video: {
                            released: meta.released,
                            season: 0,
                            episode: 0,
                            title: "Series Release",
                        },
                    });
                }
            }

            if (Array.isArray(meta.videos)) {
                for (const v of meta.videos) {
                    if (v.released) {
                        const vd = Date.parse(v.released);
                        if (vd > threshold && v.watched !== true) {
                            futureVideos.push({ dateMs: vd, video: v });
                        }
                    }
                }
            }

            if (!futureVideos.length) return null;
            return futureVideos.reduce((min, curr) =>
                curr.dateMs < min.dateMs ? curr : min
            );
        }

        async refreshWatchedState(cache) {
            if (!Array.isArray(cache)) return [];

            const enriched = await this.getUserData(cache);
            const updated = [];
            const now = Date.now();

            for (const m of enriched) {
                const closest = this.getClosestFutureVideo(m);
                if (!closest) continue; // Skip if no future video found

                const { dateMs, video } = closest;
                const episodeText =
                    video.season > 0 && video.episode > 0
                        ? `S${video.season} E${video.episode}`
                        : "Movie";

                m.releaseDate = new Date(dateMs);
                m.releaseText = this.formatDaysUntil(dateMs, now);
                m.isNewSeason = video.episode === 1;
                m.episodeText = episodeText;

                updated.push(m);
            }

            updated.sort((a, b) => a.releaseDate - b.releaseDate);
            return updated;
        }

        mapToListItem(m, type) {
            return {
                id: m.id,
                title: m.name,
                imdbRating: m.imdbRating,
                genres: Array.isArray(m.genre)
                    ? m.genre
                    : Array.isArray(m.genres)
                    ? m.genres
                    : [],
                description: m.description || `Discover ${m.name}`,
                year: String(m.year || "2024"),
                runtime: m.runtime || null,
                type: m.type || type,
                trailer: m?.trailers?.[0]?.source,
                videos: m.videos || [],
                releaseInfo: m.releaseInfo,
            };
        }

        // --- Fetching Logic ---

        async fetchLibraryUpcoming(limit = 6) {
            const key = `userLibrary_${limit}`;
            const cached = this.cacheGet(key);

            if (cached) {
                console.log("[UpcomingReleases] Fetched cached", key);
                if (this.updateState) {
                    this.updateState = false;
                    const updated = await this.refreshWatchedState(cached);
                    this.cacheSet(key, updated);
                    return updated;
                }
                return cached;
            }

            const seriesIds = this.getUserLibrarySeries();
            if (!seriesIds.length) {
                console.log(
                    "[UpcomingReleases] No series found in library_recent"
                );
                return [];
            }

            // Use batched processing for large libraries (300+ items)
            const promiseFns = seriesIds.map((meta) => async () => {
                const id = meta._id;
                let cachedMeta = await this.metadataDB.get(id);

                if (!cachedMeta) {
                    try {
                        const data = await this.safeFetch(
                            `${UpcomingReleasesPlugin.CONFIG.URLS.CINEMETA_META}/series/${id}.json`
                        );
                        const fetchedMeta = data?.meta;

                        if (fetchedMeta) {
                            await this.metadataDB.put(
                                id,
                                fetchedMeta,
                                "series"
                            );
                            console.log(
                                "[UpcomingReleases] Fetched meta for",
                                id
                            );
                            cachedMeta = fetchedMeta;
                        }
                    } catch (err) {
                        console.warn(
                            "[UpcomingReleases] Failed to fetch meta for",
                            id,
                            err
                        );
                        return null;
                    }
                }
                if (cachedMeta) {
                    Object.assign(
                        meta,
                        this.mapToListItem(cachedMeta, "series")
                    );
                }
                return meta;
            });

            const results = await this.batchPromiseAllSettled(promiseFns);

            let metas = results
                .filter((r) => r.status === "fulfilled" && r.value)
                .map((r) => r.value);

            metas = await this.getUserData(metas);
            const list = this.processMetasToList(metas);

            list.sort((a, b) => a.releaseDate - b.releaseDate);
            //const finalList = list.slice(0, limit);

            this.cacheSet(key, list);
            return list;
        }

        async fetchUpcomingTitles(type = "movie", catalog = "top", limit = 10) {
            const key = `${type}_${catalog}_${limit}`;
            const cached = this.cacheGet(key);

            if (cached) {
                console.log("[UpcomingReleases] Fetched cached", key);
                if (this.updateState) {
                    this.updateState = false;
                    const updated = await this.refreshWatchedState(cached);
                    this.cacheSet(key, updated);
                    return updated;
                }
                return cached;
            }

            try {
                // 1. Initial Catalog Fetch (3 pages per type for more content)
                const types = ["movie", "series"];
                const skipValues = [0, 50, 100]; // Fetch 3 pages

                const fetchPromises = [];
                for (const t of types) {
                    for (const skip of skipValues) {
                        const url =
                            skip === 0
                                ? `${UpcomingReleasesPlugin.CONFIG.URLS.CINEMETA_CATALOG}/${t}/${catalog}.json`
                                : `${UpcomingReleasesPlugin.CONFIG.URLS.CINEMETA_CATALOG}/${t}/${catalog}/skip=${skip}.json`;
                        fetchPromises.push(this.safeFetch(url));
                    }
                }

                const results = await Promise.allSettled(fetchPromises);

                const all = [];
                const seenIds = new Set(); // Track unique IDs

                for (const res of results) {
                    if (res.status === "fulfilled" && res.value) {
                        const payload = res.value;
                        const metas = Array.isArray(payload.metas)
                            ? payload.metas
                            : Array.isArray(payload)
                            ? payload
                            : [];

                        // Only add items with unique IDs
                        for (const meta of metas) {
                            if (meta.id && !seenIds.has(meta.id)) {
                                seenIds.add(meta.id);
                                all.push(meta);
                            }
                        }
                    }
                }

                console.log(
                    `[UpcomingReleases] Fetched ${all.length} unique items from ${results.length} catalog pages`
                );

                // 2. Filter and optimize series for metadata fetching
                let seriesMetas = all.filter((m) => m.type === "series");
                const movieMetas = all.filter((m) => m.type === "movie");

                // Only process series that are still Continuing or Upcoming
                const activeSeries = seriesMetas.filter((m) => {
                    const status = m.status?.toLowerCase();
                    return status === "continuing" || status === "upcoming";
                });

                console.log(
                    `[UpcomingReleases] Filtered series: ${activeSeries.length} active (from ${seriesMetas.length} total)`
                );

                const promiseFns = activeSeries.map((m) => async () => {
                    let cachedMeta = await this.metadataDB.get(m.id);

                    if (!cachedMeta) {
                        try {
                            const data = await this.safeFetch(
                                `${UpcomingReleasesPlugin.CONFIG.URLS.CINEMETA_META}/${m.type}/${m.id}.json`
                            );
                            const fetchedMeta = data?.meta;
                            if (fetchedMeta) {
                                await this.metadataDB.put(
                                    m.id,
                                    fetchedMeta,
                                    m.type
                                );
                                console.log(
                                    "[UpcomingReleases] Fetched meta for",
                                    m.id
                                );
                                cachedMeta = fetchedMeta;
                            }
                        } catch (err) {
                            console.warn(
                                "[UpcomingReleases] Failed to pre-fetch meta for",
                                m.id,
                                err
                            );
                        }
                    }
                    if (cachedMeta) {
                        Object.assign(
                            m,
                            this.mapToListItem(cachedMeta, m.type)
                        );
                    }
                    return m;
                });

                const seriesEnrichmentResults =
                    await this.batchPromiseAllSettled(promiseFns);

                let allMetasWithVideos = [
                    ...movieMetas,
                    ...seriesEnrichmentResults
                        .filter((r) => r.status === "fulfilled")
                        .map((r) => r.value),
                ];

                // Apply user watch data before processing
                allMetasWithVideos = await this.getUserData(allMetasWithVideos);

                // Process and filter: only items with upcoming releases will be included
                const metadataList =
                    this.processMetasToList(allMetasWithVideos);

                metadataList.sort((a, b) => a.releaseDate - b.releaseDate);
                //const finalList = metadataList.slice(0, limit);

                this.cacheSet(key, metadataList);
                return metadataList;
            } catch (e) {
                console.warn(
                    "[UpcomingReleases] Failed to fetch upcoming titles",
                    e
                );
                return [];
            }
        }

        processMetasToList(metas) {
            const list = [];
            const posterBase = UpcomingReleasesPlugin.CONFIG.URLS.POSTER;
            const logoBase = UpcomingReleasesPlugin.CONFIG.URLS.LOGO;

            for (const m of metas) {
                const closest = this.getClosestFutureVideo(m);
                if (!closest) continue;

                const { dateMs, video } = closest;
                const isSeries = video.season > 0 && video.episode > 0;
                const id = m.id || m._id;

                // Compute episode-related data once
                const episodeText = isSeries
                    ? `S${video.season} E${video.episode}`
                    : "Movie";
                const href = isSeries
                    ? `#/detail/${m.type}/${id}/${id}%3A${video.season}%3A${video.episode}`
                    : `#/detail/${m.type}/${id}/${id}`;
                const isNewSeason = video.episode === 1;

                // Only filter videos if it's a series
                const latestSeasonVideos = isSeries
                    ? m.videos.filter(
                          (v) =>
                              v.season === video.season ||
                              (v.season === 0 && v.episode === 0)
                      )
                    : [];

                list.push({
                    id,
                    type: m.type,
                    title: m.name,
                    releaseDate: new Date(dateMs),
                    releaseText: this.formatDaysUntil(dateMs),
                    episodeText,
                    poster: `${posterBase}/${id}/img`,
                    logo: `${logoBase}/${id}/img`,
                    href,
                    videos: latestSeasonVideos,
                    isNewSeason,
                });
            }
            return list;
        }

        // --- Rendering Logic ---

        async render() {
            const heroContainer = document.querySelector(".hero-container");
            if (!heroContainer) return;

            // Ensure wrapper structure exists
            let wrapper = heroContainer.querySelector(".upcoming-wrapper");
            if (!wrapper) {
                wrapper = document.createElement("div");
                wrapper.className = "upcoming-wrapper";
                wrapper.innerHTML = `
                    <div class="upcoming-vertical-tab">
                        <span>UPCOMING</span>
                    </div>
                    <div class="upcoming-container">
                        <div class="calendar-container"></div>
                        <div class="floating-date-indicator"></div>
                        <div class="upcoming-date-list"></div>
                    </div>
                `;
                heroContainer.appendChild(wrapper);
            }

            const container = wrapper.querySelector(".upcoming-container");

            this.renderButtonBar(container);

            const lastMode =
                localStorage.getItem(
                    UpcomingReleasesPlugin.CONFIG.STORAGE_KEYS.UPCOMING_MODE
                ) || "all";
            await this.renderListMode(lastMode, container);
        }

        renderButtonBar(container) {
            let buttonBar = container.querySelector(".upcoming-toggle-bar");
            if (buttonBar) return;

            const lastMode =
                localStorage.getItem(
                    UpcomingReleasesPlugin.CONFIG.STORAGE_KEYS.UPCOMING_MODE
                ) || "all";

            buttonBar = document.createElement("div");
            buttonBar.className = "upcoming-toggle-bar";
            buttonBar.innerHTML = `
                <button class="toggle-btn ${
                    lastMode === "all" ? "active" : ""
                }" data-mode="all" aria-label="Popular">
                    <span class="btn-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
                    </svg>
                    </span>
                    <span class="btn-label">Popular</span>
                </button>
                <button class="toggle-btn ${
                    lastMode === "library" ? "active" : ""
                }" data-mode="library" aria-label="My Library">
                    <span class="btn-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M3 6.5A1.5 1.5 0 014.5 5h3.55l1.2 1.6H19a1 1 0 011 1V18.5A1.5 1.5 0 0118.5 20h-14A1.5 1.5 0 013 18.5v-12z" fill="currentColor" />
                        <path d="M10 9.5v5l4-2.5-4-2.5z" fill="#fff" opacity="0.95" />
                    </svg>
                    </span>
                    <span class="btn-label">My Library</span>
                </button>
            `;
            container.appendChild(buttonBar);

            buttonBar.addEventListener("click", (e) => {
                const btn = e.target.closest(".toggle-btn");
                if (!btn) return;

                buttonBar
                    .querySelectorAll(".toggle-btn")
                    .forEach((b) => b.classList.remove("active"));
                btn.classList.add("active");

                const mode = btn.dataset.mode;
                localStorage.setItem(
                    UpcomingReleasesPlugin.CONFIG.STORAGE_KEYS.UPCOMING_MODE,
                    mode
                );
                this.renderListMode(mode, container);
            });
        }

        async renderListMode(mode = "all", container) {
            if (!container) return;

            // 1. Start fetching immediately (Parallel execution)
            const fetchPromise =
                mode === "library"
                    ? this.fetchLibraryUpcoming(8)
                    : this.fetchUpcomingTitles("movie", "top", 8);

            const existingList = container.querySelector(".upcoming-list");

            // 2. If mode changed, trigger fade out immediately for responsiveness
            let fadeOutPromise = Promise.resolve();
            if (existingList && mode !== this.currentMode) {
                existingList.classList.add("fade-out");
                fadeOutPromise = new Promise((resolve) =>
                    setTimeout(resolve, 300)
                );
            }

            // 3. Wait for both
            const [upcoming] = await Promise.all([
                fetchPromise,
                fadeOutPromise,
            ]);

            // 4. Data Change Detection
            // Create a simple signature based on IDs and release text
            const newSignature = upcoming
                .map((i) => i.id + i.releaseText)
                .join("|");

            if (
                this.currentMode === mode &&
                this.currentDataSignature === newSignature &&
                container.querySelector(".upcoming-groups-container") // Ensure list exists
            ) {
                // Data hasn't changed and we are in the same mode, skip re-render
                // But ensure we remove any stale loading state if it exists
                this.hideLoading(container);
                return;
            }

            // 5. Render
            // If we didn't fade out yet (same mode but data changed), do it now
            if (existingList && !existingList.classList.contains("fade-out")) {
                existingList.classList.add("fade-out");
                // Short wait to allow animation to start, but don't block too long
                await new Promise((resolve) => setTimeout(resolve, 150));
            }

            if (existingList) existingList.remove();

            // Update state
            this.currentMode = mode;
            this.currentDataSignature = newSignature;

            if (!upcoming.length) {
                this.hideLoading(container);
                container.insertAdjacentHTML(
                    "beforeend",
                    `<div class="upcoming-list empty"><p>No upcoming releases found.</p></div>`
                );
                return;
            }

            // Group by date
            const groupedByDate = {};
            upcoming.forEach((item) => {
                const dateKey = item.releaseText || "Unknown";
                if (!groupedByDate[dateKey]) {
                    groupedByDate[dateKey] = [];
                }
                groupedByDate[dateKey].push(item);
            });

            // Set initial indicator text
            const indicator = container.querySelector(
                ".floating-date-indicator"
            );
            if (indicator && Object.keys(groupedByDate).length > 0) {
                indicator.innerText = Object.keys(groupedByDate)[0];
            }

            const now = Date.now();
            const groupsHtmlArray = Object.entries(groupedByDate).map(
                ([dateKey, items]) => {
                    // Check if this group is in the past or future
                    const firstItemDate = items[0]?.releaseDate;
                    const isPast =
                        firstItemDate &&
                        new Date(firstItemDate).getTime() < now;

                    const dateObj = new Date(firstItemDate);
                    const dayNum = dateObj
                        .getDate()
                        .toString()
                        .padStart(2, "0");
                    const dayName = dateObj.toLocaleDateString("en-US", {
                        weekday: "long",
                    });

                    return {
                        html: `
                <div class="upcoming-date-group ${
                    !isPast ? "future" : ""
                }" data-date-key="${dateKey}">
                    <h3 class="date-group-title">
                        <span class="date-number">${dayNum}</span>
                        <div class="date-text-col">
                            <span class="date-day">${dayName}</span>
                            <span class="date-relative">${dateKey}</span>
                        </div>
                    </h3>
                    <div class="upcoming-grid">
                        ${this.buildGridHtml(items)}
                    </div>
                </div>`,
                        isPast,
                        dateKey,
                    };
                }
            );

            const groupsHtml = groupsHtmlArray.map((g) => g.html).join("");

            container.insertAdjacentHTML(
                "beforeend",
                `<div class="upcoming-list">
                    <div class="upcoming-groups-container">
                        ${groupsHtml}
                    </div>
                </div>`
            );

            // Render calendar
            const calendarContainer = container.querySelector(
                ".calendar-container"
            );
            if (calendarContainer) {
                calendarContainer.innerHTML = this.buildCalendar(upcoming);
                this.initCalendarNavigation(container, upcoming);
            }

            // Initialize intersection observer
            this.initIntersectionObserver(container);
        }

        initIntersectionObserver(container) {
            const scrollContainer = container.querySelector(
                ".upcoming-groups-container"
            );
            const indicator = container.querySelector(
                ".floating-date-indicator"
            );
            const dateList = container.querySelector(".upcoming-date-list");
            const groups = container.querySelectorAll(".upcoming-date-group");

            if (!scrollContainer || !indicator || !groups.length) return;

            // Build the date list navigation
            this.buildDateList(groups, dateList, scrollContainer);

            // Set initial active class
            groups[0].classList.add("active");
            let activeGroup = groups[0];

            const observerOptions = {
                root: scrollContainer,
                rootMargin: "-10% 0px -90% 0px", // Detects items at the top 10% of the container
                threshold: 0,
            };

            const observerCallback = (entries) => {
                const intersectingEntries = entries.filter(
                    (entry) => entry.isIntersecting
                );

                if (intersectingEntries.length === 0) return;

                const targetEntry =
                    intersectingEntries[intersectingEntries.length - 1];
                const targetElement = targetEntry.target;
                const dateKey = targetElement.dataset.dateKey;

                if (activeGroup !== targetElement) {
                    requestAnimationFrame(() => {
                        if (dateKey) {
                            indicator.innerText = dateKey;
                            // Update date list active state
                            this.updateDateListActive(dateList, dateKey);
                        }
                        if (activeGroup) {
                            activeGroup.classList.remove("active");
                        }
                        targetElement.classList.add("active");
                        activeGroup = targetElement;
                    });
                }
            };

            this.observer = new IntersectionObserver(
                observerCallback,
                observerOptions
            );
            groups.forEach((el) => this.observer.observe(el));
        }

        buildDateList(groups, dateList, scrollContainer) {
            if (!dateList) return;

            const dateItems = [];
            groups.forEach((group, index) => {
                const dateKey = group.dataset.dateKey;
                if (!dateKey) return;

                const isActive = index === 0 ? "active" : "";
                dateItems.push(`
                    <div class="date-list-item ${isActive}" data-date-key="${dateKey}">
                        <span class="date-list-text">${dateKey}</span>
                    </div>
                `);
            });

            dateList.innerHTML = dateItems.join("");

            // Add click handlers to navigate to date groups
            dateList.addEventListener("click", (e) => {
                const item = e.target.closest(".date-list-item");
                if (!item) return;

                const dateKey = item.dataset.dateKey;
                const targetGroup = Array.from(groups).find(
                    (g) => g.dataset.dateKey === dateKey
                );

                if (targetGroup) {
                    targetGroup.scrollIntoView({
                        behavior: "smooth",
                        block: "center",
                    });
                }
            });
        }

        updateDateListActive(dateList, activeDateKey) {
            if (!dateList) return;

            const items = dateList.querySelectorAll(".date-list-item");
            items.forEach((item) => {
                if (item.dataset.dateKey === activeDateKey) {
                    item.classList.add("active");
                } else {
                    item.classList.remove("active");
                }
            });
        }

        getReleasesPerDay(upcoming) {
            const releasesByDate = new Map();

            upcoming.forEach((item) => {
                // Process all episodes from the videos array (latestSeasonVideos)
                if (Array.isArray(item.videos) && item.videos.length > 0) {
                    item.videos.forEach((video) => {
                        if (!video.released) return;

                        const date = new Date(video.released);
                        const dateKey = `${date.getFullYear()}-${String(
                            date.getMonth() + 1
                        ).padStart(2, "0")}-${String(date.getDate()).padStart(
                            2,
                            "0"
                        )}`;

                        if (!releasesByDate.has(dateKey)) {
                            releasesByDate.set(dateKey, []);
                        }

                        // Add the series item for this episode date
                        // Check if this series is already in the array for this date
                        let existing = releasesByDate
                            .get(dateKey)
                            .find((r) => r.id === item.id);

                        const isPremiere = video.episode === 1;

                        if (!existing) {
                            // Create a shallow copy to avoid mutating the original item shared across dates
                            const entry = { ...item };
                            entry.isNewSeason = isPremiere;
                            releasesByDate.get(dateKey).push(entry);
                        } else {
                            // If already exists (e.g. E1 and E2 on same day), update isNewSeason if this one is premiere
                            if (isPremiere) {
                                existing.isNewSeason = true;
                            }
                        }
                    });
                } else if (item.releaseDate) {
                    // Fallback for items without videos array (movies)
                    const date = new Date(item.releaseDate);
                    const dateKey = `${date.getFullYear()}-${String(
                        date.getMonth() + 1
                    ).padStart(2, "0")}-${String(date.getDate()).padStart(
                        2,
                        "0"
                    )}`;

                    if (!releasesByDate.has(dateKey)) {
                        releasesByDate.set(dateKey, []);
                    }
                    releasesByDate.get(dateKey).push({ ...item });
                }
            });

            return releasesByDate;
        }

        buildCalendar(upcoming) {
            const now = new Date();
            const currentYear = now.getFullYear();
            const currentMonth = now.getMonth();
            const currentDay = now.getDate();

            const releasesByDate = this.getReleasesPerDay(upcoming);

            const monthNames = [
                "January",
                "February",
                "March",
                "April",
                "May",
                "June",
                "July",
                "August",
                "September",
                "October",
                "November",
                "December",
            ];

            const renderMonth = (year, month) => {
                const firstDay = new Date(year, month, 1);
                const lastDay = new Date(year, month + 1, 0);
                const daysInMonth = lastDay.getDate();
                const startingDayOfWeek = (firstDay.getDay() + 6) % 7; // Monday-first

                let html = `
            <div class="calendar-header">
                <div class="calendar-month">${monthNames[month]} ${year}</div>
            </div>
            <div class="calendar-weekdays">
                <div class="calendar-weekday">M</div>
                <div class="calendar-weekday">T</div>
                <div class="calendar-weekday">W</div>
                <div class="calendar-weekday">T</div>
                <div class="calendar-weekday">F</div>
                <div class="calendar-weekday">S</div>
                <div class="calendar-weekday">S</div>
            </div>
            <div class="calendar-grid">
        `;

                for (let i = 0; i < startingDayOfWeek; i++) {
                    html += `<div class="calendar-day empty"></div>`;
                }

                for (let day = 1; day <= daysInMonth; day++) {
                    const dateKey = `${year}-${String(month + 1).padStart(
                        2,
                        "0"
                    )}-${String(day).padStart(2, "0")}`;
                    const releases = releasesByDate.get(dateKey) || [];
                    const isToday =
                        month === currentMonth && day === currentDay;
                    const seriesIds = releases.map((r) => r.id).join(",");
                    const posterBadge = `
                            <img src="" alt="" loading="lazy" class="calendar-poster" />
                        `;

                    const premiereRelease = releases.find((r) => r.isNewSeason);
                    const premiereBadge = premiereRelease
                        ? `<img src="${premiereRelease.poster}" alt="Premiere" loading="lazy" class="premiere-badge" title="Season Premiere" />`
                        : "";

                    html += `
                        <div class="calendar-day${isToday ? " today" : ""}${
                        releases.length ? " has-releases" : ""
                    }"
                            data-date="${dateKey}" data-series-ids="${seriesIds}">
                            <div class="day-number">${day}</div>
                            ${premiereBadge}
                            ${posterBadge}
                            <div class="calendar-posters-grid">
                                ${releases
                                    .map(
                                        (r) =>
                                            `<img src="${r.poster}" alt="${r.title}" loading="lazy" class="calendar-poster-mini" />`
                                    )
                                    .join("")}
                            </div>
                        </div>
                    `;
                }

                html += `</div>`;
                return html;
            };

            // Build both current + next month
            const nextMonthDate = new Date(currentYear, currentMonth + 1);
            const nextMonthYear = nextMonthDate.getFullYear();
            const nextMonth = nextMonthDate.getMonth();

            return (
                renderMonth(currentYear, currentMonth) +
                renderMonth(nextMonthYear, nextMonth)
            );
        }

        initCalendarNavigation(container, upcoming) {
            const calendarContainer = container.querySelector(
                ".calendar-container"
            );
            if (!calendarContainer) return;

            const scrollContainer = container.querySelector(
                ".upcoming-groups-container"
            );
            const groups = container.querySelectorAll(".upcoming-date-group");

            // Click to navigate
            calendarContainer.addEventListener("click", (e) => {
                const dayCell = e.target.closest(".calendar-day.has-releases");
                if (!dayCell) return;

                const dateKey = dayCell.dataset.date;
                if (!dateKey) return;

                // Convert YYYY-MM-DD to release text format to find matching group
                const clickedDate = new Date(dateKey + "T00:00:00");
                const now = Date.now();
                const releaseText = this.formatDaysUntil(
                    clickedDate.getTime(),
                    now
                );

                // Find the group with matching release text
                const targetGroup = Array.from(groups).find(
                    (g) => g.dataset.dateKey === releaseText
                );

                if (targetGroup) {
                    targetGroup.scrollIntoView({
                        behavior: "smooth",
                        block: "start",
                    });
                }
            });

            // Hover to highlight calendar dates for series
            this.initSeriesHoverHighlight(container);
        }

        initSeriesHoverHighlight(container) {
            const calendarContainer = container.querySelector(
                ".calendar-container"
            );
            if (!calendarContainer) return;

            // 1. Pre-calculate map of SeriesID -> Array<CalendarDayElements>
            const seriesDayMap = new Map();
            const calendarDays =
                calendarContainer.querySelectorAll(".calendar-day");

            calendarDays.forEach((day) => {
                const seriesIds = day.dataset.seriesIds;
                if (!seriesIds) return;

                seriesIds.split(",").forEach((id) => {
                    if (!seriesDayMap.has(id)) {
                        seriesDayMap.set(id, []);
                    }
                    seriesDayMap.get(id).push(day);
                });
            });

            // 2. Event Delegation
            // We'll track currently highlighted elements to remove classes efficiently
            let activeHighlights = [];

            const clearHighlights = () => {
                if (activeHighlights.length === 0) return;

                activeHighlights.forEach(({ day, poster }) => {
                    day.classList.remove("highlight-series");
                    if (poster) poster.style.opacity = "";

                    // Reset grid opacity
                    const grid = day.querySelector(".calendar-posters-grid");
                    if (grid) grid.style.opacity = "";
                });
                activeHighlights = [];
            };

            container.addEventListener("mouseover", (e) => {
                const card = e.target.closest(".upcoming-card");
                if (!card) {
                    return;
                }

                const seriesId = card.id;
                if (!seriesId) return;

                // If we are already highlighting this series, do nothing
                // (Optimization to avoid DOM thrashing)
                if (
                    activeHighlights.length > 0 &&
                    activeHighlights[0].seriesId === seriesId
                )
                    return;

                clearHighlights();

                const days = seriesDayMap.get(seriesId);
                if (days) {
                    days.forEach((day) => {
                        day.classList.add("highlight-series");

                        const posters = day.querySelectorAll(
                            ".calendar-poster-mini"
                        );
                        let targetPoster = null;

                        posters.forEach((img) => {
                            if (img.src.includes(seriesId)) {
                                targetPoster = img;
                            }
                        });

                        const mainPoster =
                            day.querySelector(".calendar-poster");
                        if (mainPoster) {
                            mainPoster.src =
                                UpcomingReleasesPlugin.CONFIG.URLS.POSTER +
                                "/" +
                                seriesId +
                                "/img";
                            mainPoster.style.opacity = "1";
                        }

                        const grid = day.querySelector(
                            ".calendar-posters-grid"
                        );
                        if (grid) grid.style.opacity = "0";

                        activeHighlights.push({
                            day,
                            poster: mainPoster,
                            seriesId,
                        });
                    });
                }
            });

            container.addEventListener("mouseout", (e) => {
                const card = e.target.closest(".upcoming-card");
                if (!card) return;

                // Check if we moved to a child element
                if (card.contains(e.relatedTarget)) return;

                clearHighlights();
            });
        }

        showLoading(container) {
            // Simple loading spinner or skeleton could go here
            // For now, let's just ensure we don't have duplicates
            if (container.querySelector(".upcoming-loading")) return;

            const loader = document.createElement("div");
            loader.className = "upcoming-list upcoming-loading";
            loader.innerHTML = `<div class="loading-spinner"></div>`;
            container.appendChild(loader);
        }

        hideLoading(container) {
            const loader = container.querySelector(".upcoming-loading");
            if (loader) loader.remove();
        }

        buildGridHtml(upcoming) {
            const thresholdMs =
                Date.now() - UpcomingReleasesPlugin.CONFIG.DAY_BUFFER;
            const now = Date.now();
            const gridItems = [];

            for (const m of upcoming) {
                let episodesContainerHtml = "";
                let unwatchedCount = 0;
                let watchedCount = 0;

                if (Array.isArray(m.videos) && m.videos.length) {
                    let nextUp = null;
                    let nextUpReleaseDate = null;
                    const match = m.episodeText?.match(/^S(\d+)\sE(\d+)$/);
                    if (match) {
                        nextUp = { season: +match[1], episode: +match[2] };
                        // Find the release date of the next episode
                        const nextEpisode = m.videos.find(
                            (v) =>
                                v.season === nextUp.season &&
                                v.episode === nextUp.episode
                        );
                        if (nextEpisode && nextEpisode.released) {
                            nextUpReleaseDate = new Date(
                                nextEpisode.released
                            ).toDateString();
                        }
                    }

                    const episodesHtmlParts = [];
                    for (const ep of m.videos) {
                        const released = Date.parse(ep.released) <= thresholdMs;
                        const available = Date.parse(ep.released) <= now;
                        const isWatched = ep.watched;
                        const watchedClass = isWatched ? " watched" : "";
                        let stateClass = "released" + watchedClass;

                        // Count unwatched released episodes
                        if (available && !isWatched) {
                            unwatchedCount++;
                        }

                        // Count watched episodes to check if user has started watching
                        if (isWatched) {
                            watchedCount++;
                        }

                        if (!released && !isWatched) {
                            // Mark all episodes on the same date as the next unwatched episode
                            if (
                                nextUpReleaseDate &&
                                ep.released &&
                                new Date(ep.released).toDateString() ===
                                    nextUpReleaseDate
                            ) {
                                stateClass = "upcoming-next";
                            } else {
                                stateClass = "upcoming";
                            }
                        }

                        const thumbnailHtml = ep.thumbnail
                            ? `<img src="${ep.thumbnail}" alt="" loading="lazy" onerror="this.style.display='none'" />`
                            : `<div class="upcoming-episode-placeholder">No image</div>`;

                        const watchedTextDiv = isWatched
                            ? '<div class="upcoming-episode-watched-tag">&#x2713;</div>'
                            : "";

                        episodesHtmlParts.push(`
                        <div class="upcoming-episode-card ${stateClass}">
                            <div class="upcoming-episode-number">${
                                ep.episode
                            }</div>
                            <div class="upcoming-episode-title">${
                                ep.name || "Untitled"
                            }</div>
                            <div class="upcoming-episode-date">${this.formatDate(
                                ep.released
                            )}</div>
                            ${watchedTextDiv}
                            <div class="upcoming-episode-thumbnail">${thumbnailHtml}</div>
                        </div>`);
                    }
                    episodesContainerHtml = `<div class="upcoming-episodes-container" data-count="${
                        episodesHtmlParts.length
                    }">${episodesHtmlParts.join("")}</div>`;
                }

                const upcomingSeasonNumber = m.isNewSeason
                    ? m.videos[0]?.season
                    : 0;
                const newSeasonClass = m.isNewSeason ? " new-season" : "";
                const isFuture = new Date(m.releaseDate) > new Date();
                const futureClass = isFuture ? " future" : "";

                const newSeasonIndicator = m.isNewSeason
                    ? `<div class="upcoming-new-season">SEASON ${upcomingSeasonNumber} PREMIERE</div>`
                    : "";

                // Create unwatched badge if there are unwatched episodes
                const unwatchedBadge =
                    unwatchedCount > 0 && watchedCount > 0
                        ? `<div class="unwatched-badge">${unwatchedCount}</div>`
                        : "";

                gridItems.push(`
                <a tabindex="0" class="upcoming-card${newSeasonClass}${futureClass}" href="${m.href}"
                   
                    id="${m.id}"
                    
                    
                >
                    <div class="upcoming-background-container">
                        <img src="${m.poster}" alt="${m.title}" loading="lazy" />
                        ${unwatchedBadge}
                    </div>
                    <div class="upcoming-info">
                        <img class="upcoming-logo" src="${m.logo}" alt="${m.title}" loading="lazy" />
                        ${newSeasonIndicator}
                       
                        <div class="upcoming-episode">${m.episodeText}</div>
                        ${episodesContainerHtml}
                    </div>
                </a>`);
            }
            return gridItems.join("");
        }
    }

    // Initialize
    requestIdleCallback(() => {
        new UpcomingReleasesPlugin();
    });
})();
