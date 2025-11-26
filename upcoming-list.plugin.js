/**
 * @name Upcoming Releases List
 * @description Shows a list of upcoming releases (with localStorage caching)
 * @version 2.0.0
 * @author EZOBOSS
 */

(function () {
    class UpcomingReleasesPlugin {
        static CONFIG = {
            FETCH_TIMEOUT: 5000,
            CACHE_TTL: 1000 * 60 * 60 * 12, // 12 hours for the main catalog list
            CACHE_PREFIX: "upcoming_cache_",
            VIDEO_CACHE_EXPIRY_MS: 14 * 24 * 60 * 60 * 1000, // 14 days for individual series videos
            VIDEO_CACHE_PREFIX: "videos_cache_", // Prefix for long-term video cache
            CACHE_DEBOUNCE_MS: 500, // Debounce cache updates
            DAY_BUFFER: 86400000 * 4, // Include 4 days of future videos
            BATCH_SIZE: 50, // Number of concurrent promises to process at once
            MAX_CACHE_ENTRIES: 200, // Maximum number of items to keep in video cache (LRU eviction)
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
            this.videoMemoryCache = null;
            this.libraryRecentCache = null; // New cache for library data
            this.videoCacheTimeoutId = null;
            this.updateState = false;
            this.renderTimeout = null;
            this.intlDateTimeFormat = new Intl.DateTimeFormat("en-GB", {
                month: "short",
                timeZone: "UTC",
            });
            this.observer = null;
            this.currentMode = null;
            this.currentDataSignature = null;

            this.init();
        }

        init() {
            // Initial render
            this.waitForHero();

            // Event listeners
            window.addEventListener("hashchange", (event) => {
                if (event.oldURL.includes("player")) {
                    this.updateState = true;
                    this.libraryRecentCache = null; // Invalidate cache on player exit
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

        get videoCacheKey() {
            return UpcomingReleasesPlugin.CONFIG.VIDEO_CACHE_PREFIX + "all";
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

        async loadVideoCache() {
            if (this.videoMemoryCache) return this.videoMemoryCache;

            // Yield to main thread to avoid blocking
            await new Promise((resolve) => setTimeout(resolve, 0));

            try {
                const raw = localStorage.getItem(this.videoCacheKey);
                let cache = {};

                if (raw) {
                    try {
                        // Use Response.json() for non-blocking JSON parsing if possible
                        cache = await new Response(raw).json();
                    } catch {
                        cache = JSON.parse(raw);
                    }
                } else {
                    cache = {};
                }

                const now = Date.now();
                let dirty = false;

                // Clean up expired entries
                for (const k in cache) {
                    if (
                        now - cache[k].timestamp >
                        UpcomingReleasesPlugin.CONFIG.VIDEO_CACHE_EXPIRY_MS
                    ) {
                        delete cache[k];
                        dirty = true;
                    }
                }

                // LRU eviction if cache is too large
                const entries = Object.entries(cache);
                if (
                    entries.length >
                    UpcomingReleasesPlugin.CONFIG.MAX_CACHE_ENTRIES
                ) {
                    // Sort by timestamp (oldest first)
                    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);

                    // Keep only the newest MAX_CACHE_ENTRIES items
                    const toKeep = entries.slice(
                        -UpcomingReleasesPlugin.CONFIG.MAX_CACHE_ENTRIES
                    );
                    const newCache = {};
                    for (const [key, value] of toKeep) {
                        newCache[key] = value;
                    }

                    console.log(
                        `[UpcomingReleases] Cache size limit reached. Evicted ${
                            entries.length - toKeep.length
                        } oldest entries`
                    );

                    this.videoMemoryCache = newCache;
                    this.saveVideoCache(newCache);
                    return newCache;
                }

                if (dirty) this.saveVideoCache(cache);

                this.videoMemoryCache = cache;
                return cache;
            } catch (err) {
                console.log(
                    "[UpcomingReleases] Failed to load video cache",
                    err
                );
                this.videoMemoryCache = {};
                return {};
            }
        }

        saveVideoCache(cache) {
            if (!cache) return;
            try {
                requestIdleCallback(() => {
                    localStorage.setItem(
                        this.videoCacheKey,
                        JSON.stringify(cache)
                    );
                });
                this.videoMemoryCache = cache;
            } catch (err) {
                console.warn(
                    "[UpcomingReleases] Failed to save video cache",
                    err
                );
            }
        }

        async videoCacheSet(key, value) {
            const cache = await this.loadVideoCache();
            cache[key] = { value, timestamp: Date.now() };

            if (this.videoCacheTimeoutId) {
                clearTimeout(this.videoCacheTimeoutId);
            }
            this.videoCacheTimeoutId = setTimeout(() => {
                this.saveVideoCache(cache);
                this.videoCacheTimeoutId = null;
            }, UpcomingReleasesPlugin.CONFIG.CACHE_DEBOUNCE_MS);
        }

        async videoCacheGet(key) {
            const cache = await this.loadVideoCache();
            const entry = cache[key];
            return entry ? entry.value : null;
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
            const dayMs = 86400000;
            const diff = Math.ceil((dateMs - now) / dayMs);

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

        async getUserData(list) {
            const recentStr = localStorage.getItem(
                UpcomingReleasesPlugin.CONFIG.STORAGE_KEYS.LIBRARY_RECENT
            );
            if (!recentStr) return list;

            let recent;
            try {
                recent = JSON.parse(recentStr);
            } catch {
                return list;
            }

            const recentItems = recent.items;
            if (!recentItems) return list;

            // Track which series have been updated so we can save them back to cache
            const updatedEpisodes = [];

            for (const item of list) {
                if (item.type !== "series") continue;

                const lib = recentItems[item.id];
                if (!lib) continue;

                const watchedState = lib.state && lib.state.watched;
                if (!watchedState) continue;

                const parts = watchedState.split(":", 3);
                if (parts.length < 3) continue;

                const season = +parts[1];
                const episode = +parts[2];

                item.watched = watchedState;

                const videos = item.videos;
                if (!videos) continue;

                const seasonVideos = videos.filter((v) => v.season === season);
                if (!seasonVideos.length) continue;

                for (const v of seasonVideos) {
                    if (v.episode <= episode && !v.watched) {
                        v.watched = true;
                        updatedEpisodes.push({
                            id: item.id,
                            season: v.season,
                            episode: v.episode,
                        });
                    }
                }
            }

            // Persist watched state changes back to videos_cache_all
            if (updatedEpisodes.length > 0) {
                const cache = await this.loadVideoCache();
                let modifiedCache = false;

                // Group episodes by series ID to minimize cache lookups
                const episodesBySeries = new Map();
                for (const ep of updatedEpisodes) {
                    if (!episodesBySeries.has(ep.id)) {
                        episodesBySeries.set(ep.id, []);
                    }
                    episodesBySeries.get(ep.id).push(ep);
                }

                // Process each series once
                for (const [seriesId, episodes] of episodesBySeries) {
                    const cacheKey = `fullmeta:${seriesId}`;
                    const cachedVideos = cache[cacheKey]?.value?.videos;
                    if (!cachedVideos) continue;

                    // Build lookup map for this series
                    const videoMap = new Map();
                    for (const v of cachedVideos) {
                        videoMap.set(`${v.season}-${v.episode}`, v);
                    }

                    // Update all episodes for this series
                    for (const { season, episode } of episodes) {
                        const match = videoMap.get(`${season}-${episode}`);
                        if (match && !match.watched) {
                            match.watched = true;
                            modifiedCache = true;
                        }
                    }
                }

                if (modifiedCache) this.saveVideoCache(cache);
            }

            return list;
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
                const metaCacheKey = `fullmeta:${id}`;
                let cachedMeta = await this.videoCacheGet(metaCacheKey);

                if (!cachedMeta) {
                    try {
                        const data = await this.safeFetch(
                            `${UpcomingReleasesPlugin.CONFIG.URLS.CINEMETA_META}/series/${id}.json`
                        );
                        const fetchedMeta = data?.meta;

                        if (fetchedMeta) {
                            await this.videoCacheSet(
                                metaCacheKey,
                                this.mapToListItem(fetchedMeta, "series")
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
                    Object.assign(meta, cachedMeta);
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
                    const updated = this.refreshWatchedState(cached);
                    this.cacheSet(key, updated);
                    return updated;
                }
                return cached;
            }

            try {
                // 1. Initial Catalog Fetch (2 pages per type for more content)
                const types = ["movie", "series"];
                const skipValues = [0, 50]; // Fetch 2 pages

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
                    const metaCacheKey = `fullmeta:${m.id}`;
                    let cachedMeta = await this.videoCacheGet(metaCacheKey);

                    if (!cachedMeta) {
                        try {
                            const data = await this.safeFetch(
                                `${UpcomingReleasesPlugin.CONFIG.URLS.CINEMETA_META}/${m.type}/${m.id}.json`
                            );
                            cachedMeta = data?.meta || [];
                            if (cachedMeta) {
                                await this.videoCacheSet(
                                    metaCacheKey,
                                    this.mapToListItem(cachedMeta)
                                );
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
                        Object.assign(m, cachedMeta);
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
                    ? `#/detail/${m.type}/${id}`
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
                    trailer:
                        m?.trailer ||
                        m?.trailers?.[0]?.source ||
                        m?.trailers?.[0]?.url ||
                        m?.videos?.[0]?.url ||
                        null,
                    description: m.description,
                    rating: m.imdbRating || "",
                    year: m.year || m.releaseInfo || "",
                    runtime: m.runtime,
                    genres: m.genre || m.genres || [],
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
                        <div class="floating-date-indicator"></div>
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

            const groupsHtml = Object.entries(groupedByDate)
                .map(
                    ([dateKey, items]) => `
                <div class="upcoming-date-group" data-date-key="${dateKey}">
                    <h3 class="date-group-title">${dateKey}</h3>
                    <div class="upcoming-grid">
                        ${this.buildGridHtml(items)}
                    </div>
                </div>`
                )
                .join("");

            container.insertAdjacentHTML(
                "beforeend",
                `<div class="upcoming-list">
                    <div class="upcoming-groups-container">
                        ${groupsHtml}
                    </div>
                </div>`
            );

            // Initialize intersection observer
            this.initIntersectionObserver(container);

            // Initialize smooth scroll if plugin is available
            if (window.InfiniteScrollPluginInstance) {
                const scrollContainer = container.querySelector(
                    ".upcoming-groups-container"
                );
                if (scrollContainer) {
                    window.InfiniteScrollPluginInstance.initWheelScroll(
                        scrollContainer,
                        "upcoming",
                        {
                            disableFetch: true,
                            type: "upcoming",
                            disableScrollIndicator: true,
                        }
                    );
                }
            }
        }

        initIntersectionObserver(container) {
            const scrollContainer = container.querySelector(
                ".upcoming-groups-container"
            );
            const indicator = container.querySelector(
                ".floating-date-indicator"
            );
            const groups = container.querySelectorAll(".upcoming-date-group");

            if (!scrollContainer || !indicator || !groups.length) return;

            // Set initial active class
            groups[0].classList.add("active");
            let activeGroup = groups[0];

            const observerOptions = {
                root: scrollContainer,
                rootMargin: "0px -50% 0px -50%",
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
            const gridItems = [];

            for (const m of upcoming) {
                let episodesContainerHtml = "";

                if (Array.isArray(m.videos) && m.videos.length) {
                    let nextUp = null;
                    const match = m.episodeText?.match(/^S(\d+)\sE(\d+)$/);
                    if (match) {
                        nextUp = { season: +match[1], episode: +match[2] };
                    }

                    const episodesHtmlParts = [];
                    for (const ep of m.videos) {
                        const released = Date.parse(ep.released) <= thresholdMs;
                        const isWatched = ep.watched;
                        const watchedClass = isWatched ? " watched" : "";
                        let stateClass = "released" + watchedClass;

                        if (!released && !isWatched) {
                            if (
                                nextUp &&
                                ep.season === nextUp.season &&
                                ep.episode === nextUp.episode
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
                    episodesContainerHtml = `<div class="upcoming-episodes-container">${episodesHtmlParts.join(
                        ""
                    )}</div>`;
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

                gridItems.push(`
                <a tabindex="0" class="upcoming-card${newSeasonClass}${futureClass}" href="${
                    m.href
                }"
                    data-trailer-url="${m.trailer || ""}"
                    data-description="${(m.description || "").replace(
                        /"/g,
                        "&quot;"
                    )}"
                    id="${m.id}"
                    data-rating="${m.rating || ""}"
                    data-year="${m.year || ""}"
                    data-runtime="${m.runtime || ""}"
                    data-genres="${m.genres || ""}"
                >
                    <div class="upcoming-background-container">
                        <img src="${m.poster}" alt="${
                    m.title
                }" loading="lazy" />
                    </div>
                    <div class="upcoming-info">
                        <img class="upcoming-logo" src="${m.logo}" alt="${
                    m.title
                }" loading="lazy" />
                        ${newSeasonIndicator}
                        <div class="upcoming-release-date">${
                            m.releaseText
                        }</div>
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
