/**
 * @name Upcoming Releases List
 * @description Shows a list of upcoming releases (with localStorage caching)
 * @version 1.2.0
 * @author EZOBOSS
 */

(function () {
    const CONFIG = {
        FETCH_TIMEOUT: 5000,
        CACHE_TTL: 1000 * 60 * 60 * 6, // 6 hour for the main catalog list
        CACHE_PREFIX: "upcoming_cache_",
        VIDEO_CACHE_EXPIRY_MS: 30 * 24 * 60 * 60 * 1000, // 30 days for individual series videos
        VIDEO_CACHE_PREFIX: "videos_cache_", // New prefix for long-term video cache
    };

    // --- Local + in-memory cache ---
    const memoryCache = new Map();

    const cacheKey = (key) => CONFIG.CACHE_PREFIX + key;
    //const videoCacheKey = (key) => CONFIG.VIDEO_CACHE_PREFIX + key; // Separate prefix

    // --- Short-Term Cache Logic (For main catalog) ---
    const cacheSet = (key, value) => {
        const entry = { value, timestamp: Date.now() };
        memoryCache.set(key, entry);
        try {
            localStorage.setItem(cacheKey(key), JSON.stringify(entry));
        } catch {
            // ignore quota or serialization errors
        }
    };

    const cacheGet = (key) => {
        const now = Date.now();
        // Check memory first
        const mem = memoryCache.get(key);
        if (mem && now - mem.timestamp < CONFIG.CACHE_TTL) return mem.value;

        // Check localStorage
        try {
            const raw = localStorage.getItem(cacheKey(key));
            if (!raw) return null;
            const data = JSON.parse(raw);
            if (now - data.timestamp > CONFIG.CACHE_TTL) {
                localStorage.removeItem(cacheKey(key));
                return null;
            }
            memoryCache.set(key, data);
            return data.value;
        } catch {
            return null;
        }
    };

    // --- NEW: Grouped Long-Term Video Cache ---
    const VIDEO_CACHE_KEY = CONFIG.VIDEO_CACHE_PREFIX + "all";

    // --- in-memory cache ---
    let videoMemoryCache = null;

    function loadVideoCache() {
        if (videoMemoryCache) return videoMemoryCache;

        try {
            const raw = localStorage.getItem(VIDEO_CACHE_KEY);
            const cache = raw ? JSON.parse(raw) : {};
            const now = Date.now();
            let dirty = false;

            for (const k in cache) {
                if (now - cache[k].timestamp > CONFIG.VIDEO_CACHE_EXPIRY_MS) {
                    delete cache[k];
                    dirty = true;
                }
            }

            if (dirty) saveVideoCache(cache);

            videoMemoryCache = cache; // store in memory
            return cache;
        } catch (err) {
            console.log("[UpcomingReleases] Failed to load video cache", err);
            videoMemoryCache = {};
            return {};
        }
    }

    function saveVideoCache(cache) {
        try {
            localStorage.setItem(VIDEO_CACHE_KEY, JSON.stringify(cache));
            videoMemoryCache = cache;
        } catch (err) {
            console.warn("[UpcomingReleases] Failed to save video cache", err);
        }
    }

    function videoCacheSet(key, value) {
        const cache = loadVideoCache();
        cache[key] = { value, timestamp: Date.now() };
        saveVideoCache(cache);
    }

    function videoCacheGet(key) {
        const cache = loadVideoCache(); // already pruned
        const entry = cache[key];
        return entry ? entry.value : null; // simple read
    }

    // --- Helper Functions ---

    const safeFetch = async (
        url,
        { timeout = CONFIG.FETCH_TIMEOUT, retries = 1 } = {}
    ) => {
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
    };

    const logger = {
        warn: (...a) => console.warn("[UpcomingReleases]", ...a),
    };

    // --- Main Logic ---
    // --- NEW: Load user's library (only series) ---
    function getUserLibrarySeries() {
        try {
            const raw = localStorage.getItem("library_recent");
            if (!raw) return [];
            const library = JSON.parse(raw);
            const libraryItems = Object.values(library.items || {});

            return libraryItems.filter((item) => {
                // Check if it's a series AND the _id property (the unique identifier) starts with "tt"
                const isSeries = item?.type === "series";
                const idStartsTt = item?._id?.startsWith("tt");

                return isSeries && idStartsTt;
            });
        } catch (err) {
            console.warn(
                "[UpcomingReleases] Failed to read library_recent",
                err
            );
            return [];
        }
    }

    // --- NEW: Fetch Upcoming for Library Series Only ---
    async function fetchLibraryUpcoming(limit = 6) {
        const metaUrl = "https://cinemeta-live.strem.io/meta";
        const key = `userLibrary_${limit}`;
        const cached = cacheGet(key);
        if (cached) {
            console.log("[UpcomingReleases] Fetched cached", key);
            return cached;
        }
        const seriesIds = getUserLibrarySeries();

        if (!seriesIds.length) {
            console.log("[UpcomingReleases] No series found in library_recent");
            return [];
        }

        const results = await Promise.allSettled(
            seriesIds.map(async (meta) => {
                const id = meta._id;
                const metaCacheKey = `fullmeta:${id}`;
                let cachedMeta = videoCacheGet(metaCacheKey);

                if (!cachedMeta) {
                    try {
                        const data = await safeFetch(
                            `${metaUrl}/series/${id}.json`
                        );
                        const fetchedMeta = data?.meta;

                        if (fetchedMeta) {
                            videoCacheSet(metaCacheKey, fetchedMeta);
                            cachedMeta = fetchedMeta;
                        }
                    } catch (err) {
                        logger.warn("Failed to fetch meta for", id, err);
                        return null;
                    }
                }
                if (cachedMeta) {
                    // Merge all properties from the fetched/cached meta into the library meta
                    Object.assign(meta, cachedMeta);
                }
                return meta;
            })
        );

        // Filter out null/failed results
        const metas = results
            .filter((r) => r.status === "fulfilled" && r.value)
            .map((r) => r.value);

        // Reuse filtering logic for upcoming episodes
        const now = Date.now();
        const dayMs = 86400000;

        // --- Helpers ---

        const formatDaysUntil = (dateMs) => {
            const diff = Math.ceil((dateMs - now) / dayMs);
            if (diff <= 0) return "Today";
            if (diff === 1) return "Tomorrow";
            if (diff < 30) return `in ${diff} days`;
            if (diff < 365) {
                const months = Math.round(diff / 30);
                return `in ${months} month${months > 1 ? "s" : ""}`;
            }
            const years = Math.round(diff / 365);
            return `in ${years} year${years > 1 ? "s" : ""}`;
        };

        const getClosestFutureVideo = (meta) => {
            const threshold = now - dayMs; // include today
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
                        if (vd > threshold) {
                            futureVideos.push({ dateMs: vd, video: v });
                        }
                    }
                }
            }

            if (!futureVideos.length) return null;
            return futureVideos.reduce((min, curr) =>
                curr.dateMs < min.dateMs ? curr : min
            );
        };

        const list = [];
        for (const m of metas) {
            const closest = getClosestFutureVideo(m);
            if (!closest) continue;
            const { dateMs, video } = closest;

            const releaseDate = new Date(video.released);
            const episodeText =
                video.season && video.episode
                    ? `S${video.season} E${video.episode}`
                    : "Upcoming";
            const href = `#/detail/${m.type}/${m._id}`;
            let latestSeasonVideos = [];
            if (video.season > 0) {
                latestSeasonVideos = m.videos.filter(
                    (v) =>
                        v.season === video.season ||
                        (v.season === 0 && v.episode === 0)
                );
            }
            const trailer =
                m?.trailer ||
                m?.trailers?.[0]?.source ||
                m?.trailers?.[0]?.url ||
                m?.videos?.[0]?.url ||
                null;

            list.push({
                id: m._id,
                type: m.type,
                title: m.name,
                releaseDate,
                releaseText: formatDaysUntil(dateMs),
                episodeText,
                poster: `https://images.metahub.space/background/large/${m._id}/img`,
                logo: `https://images.metahub.space/logo/medium/${m._id}/img`,
                href,
                trailer,
                description: m.description,
                rating: m.imdbRating || "",
                year: m.releaseInfo || "",
                runtime: m.runtime,
                genres: Array.isArray(m.genre)
                    ? m.genre
                    : Array.isArray(m.genres)
                    ? m.genres
                    : [],
                videos: latestSeasonVideos || [],
                isNewSeason: video.episode === 1,
            });
        }

        list.sort((a, b) => a.releaseDate - b.releaseDate);
        const finalList = list.slice(0, limit);

        cacheSet(key, finalList);
        return finalList;
    }

    async function fetchUpcomingTitles(
        type = "movie",
        catalog = "top",
        limit = 10
    ) {
        const baseUrl = "https://cinemeta-catalogs.strem.io/top/catalog";
        const metaUrl = "https://cinemeta-live.strem.io/meta";
        const types = ["movie", "series"];
        const now = Date.now();

        // Short-term cache check for the final catalog output (e.g., daily refresh)
        const key = `${type}_${catalog}_${limit}`;
        const cached = cacheGet(key);
        if (cached) {
            console.log("[UpcomingReleases] Fetched cached", key);
            return cached;
        }

        try {
            // 1. Initial Catalog Fetch (Movies + Series)
            const results = await Promise.allSettled(
                types.map((t) => safeFetch(`${baseUrl}/${t}/${catalog}.json`))
            );

            const all = [];
            for (const res of results) {
                if (res.status === "fulfilled" && res.value) {
                    const payload = res.value;
                    const metas = Array.isArray(payload.metas)
                        ? payload.metas
                        : Array.isArray(payload)
                        ? payload
                        : [];
                    all.push(...metas);
                }
            }
            console.log("[UpcomingReleases] Fetched", all.length, "metas");

            // 2. Optimized Series Videos Fetch
            const seriesMetas = all.filter((m) => m.type === "series");
            const movieMetas = all.filter((m) => m.type === "movie");

            console.log(
                `[UpcomingReleases] Checking cache/fetching meta for ${seriesMetas.length} series...`
            );

            const seriesEnrichmentResults = await Promise.allSettled(
                seriesMetas.map(async (m) => {
                    const metaCacheKey = `fullmeta:${m.id}`;
                    let cachedMeta = videoCacheGet(metaCacheKey); // 💡 CHECK LONG-TERM CACHE FIRST

                    if (!cachedMeta) {
                        // Cache miss: must fetch full meta
                        const url = `${metaUrl}/${m.type}/${m.id}.json`;
                        try {
                            const data = await safeFetch(url);
                            cachedMeta = data?.meta || [];
                            console.log(
                                `[UpcomingReleases] Fetched meta for ${m.id} - ${m.name}`
                            );

                            // 💡 SET LONG-TERM CACHE
                            if (cachedMeta.length) {
                                videoCacheSet(metaCacheKey, cachedMeta);
                            }
                        } catch (err) {
                            logger.warn(
                                "Failed to pre-fetch meta for",
                                m.id,
                                err
                            );
                        }
                    } else {
                        console.log(
                            `[UpcomingReleases] Videos cache hit for ${m.id} - ${m.name}`
                        );
                    }

                    // Attach videos to the meta object regardless of source (cache or fetch)
                    if (cachedMeta) {
                        // Merge all properties from the fetched/cached meta into the library meta
                        Object.assign(m, cachedMeta);
                    }
                    return m;
                })
            );

            // Recombine all metas (movies + enriched series)
            const allMetasWithVideos = [
                ...movieMetas,
                ...seriesEnrichmentResults
                    .filter((r) => r.status === "fulfilled")
                    .map((r) => r.value),
            ];

            console.log(
                "[UpcomingReleases] Completed pre-fetch/cache check for series."
            );

            // --- Helpers ---
            const dayMs = 86400000;

            const formatDaysUntil = (dateMs) => {
                const diff = Math.ceil((dateMs - now) / dayMs);
                if (diff <= 0) return "Today";
                if (diff === 1) return "Tomorrow";
                if (diff < 30) return `in ${diff} days`;
                if (diff < 365) {
                    const months = Math.round(diff / 30);
                    return `in ${months} month${months > 1 ? "s" : ""}`;
                }
                const years = Math.round(diff / 365);
                return `in ${years} year${years > 1 ? "s" : ""}`;
            };

            const getClosestFutureVideo = (meta) => {
                const threshold = now - dayMs; // include today
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
                            if (vd > threshold) {
                                futureVideos.push({ dateMs: vd, video: v });
                            }
                        }
                    }
                }

                if (!futureVideos.length) return null;
                return futureVideos.reduce((min, curr) =>
                    curr.dateMs < min.dateMs ? curr : min
                );
            };

            // 3. Filter and Map the List
            const metadataList = [];
            for (const m of allMetasWithVideos) {
                const closest = getClosestFutureVideo(m);
                if (!closest) continue;

                const { dateMs, video } = closest;
                const releaseDate = new Date(dateMs);

                const episodeText =
                    video.season > 0 && video.episode > 0
                        ? `S${video.season} E${video.episode}`
                        : "Movie";

                const href =
                    video.season > 0 && video.episode > 0
                        ? `#/detail/${m.type}/${m.id}`
                        : `#/detail/${m.type}/${m.id}/${m.id}`;

                const trailer =
                    m?.trailer ||
                    m?.trailers?.[0]?.source ||
                    m?.trailers?.[0]?.url ||
                    m?.videos?.[0]?.url ||
                    null;
                let latestSeasonVideos = [];
                if (video.season > 0) {
                    latestSeasonVideos = m.videos.filter(
                        (v) =>
                            v.season === video.season ||
                            (v.season === 0 && v.episode === 0)
                    );
                }
                let isNewSeason = false;
                if (video.episode === 1) {
                    isNewSeason = true;
                }
                metadataList.push({
                    id: m.id,
                    type: m.type,
                    title: m.name,
                    releaseDate,
                    releaseText: formatDaysUntil(dateMs),
                    episodeText,
                    poster: `https://images.metahub.space/background/large/${m.id}/img`,
                    logo: `https://images.metahub.space/logo/medium/${m.id}/img`,
                    href,
                    trailer,
                    description: m.description,
                    rating: m.imdbRating || "",
                    year: m.year,
                    runtime: m.runtime,
                    genres: Array.isArray(m.genre)
                        ? m.genre
                        : Array.isArray(m.genres)
                        ? m.genres
                        : [],
                    videos: latestSeasonVideos || [],
                    isNewSeason,
                });
            }

            // 4. Sort and Limit
            metadataList.sort((a, b) => a.releaseDate - b.releaseDate);

            console.log(
                "[UpcomingReleases] Sorted",
                metadataList.length,
                "upcomingitems"
            );
            const finalList = metadataList.slice(0, limit);

            // 5. Final Result
            cacheSet(key, finalList);
            return finalList;
        } catch (e) {
            logger.warn("Failed to fetch upcoming titles", e);
            return [];
        }
    }

    async function renderUpcomingList() {
        const heroContainer = document.querySelector(".hero-container");
        if (!heroContainer) return;
        // --- 🔘 Toggle Buttons ---
        let buttonBar = document.querySelector(".upcoming-toggle-bar");
        const lastMode = localStorage.getItem("upcoming_mode") || "all";

        if (!buttonBar) {
            buttonBar = document.createElement("div");
            buttonBar.className = "upcoming-toggle-bar";
            buttonBar.innerHTML = `
                <button class="toggle-btn ${
                    lastMode === "all" ? "active" : ""
                }" data-mode="all">All Upcoming</button>
                <button class="toggle-btn ${
                    lastMode === "library" ? "active" : ""
                }" data-mode="library">My Library</button>
            `;
            heroContainer.insertAdjacentElement("beforeend", buttonBar);

            buttonBar.addEventListener("click", (e) => {
                if (!e.target.matches(".toggle-btn")) return;
                buttonBar
                    .querySelectorAll(".toggle-btn")
                    .forEach((b) => b.classList.remove("active"));
                e.target.classList.add("active");
                const mode = e.target.dataset.mode;
                localStorage.setItem("upcoming_mode", mode);
                renderUpcomingListMode(mode);
            });
        }

        renderUpcomingListMode(lastMode);
    }

    // --- NEW: Mode Handler (All vs Library) ---
    async function renderUpcomingListMode(mode = "all") {
        const heroContainer = document.querySelector(".hero-container");
        if (!heroContainer) return;

        const existingList = heroContainer.querySelector(".upcoming-list");
        if (existingList) {
            // 1. Add class to start fade-out
            existingList.classList.add("fade-out");

            await new Promise((resolve) => setTimeout(resolve, 500));

            existingList.remove();
        }

        const upcoming =
            mode === "library"
                ? await fetchLibraryUpcoming(6)
                : await fetchUpcomingTitles("movie", "top", 6);

        if (!upcoming.length) {
            heroContainer.insertAdjacentHTML(
                "beforeend",
                `<div class="upcoming-list empty"><p>No upcoming releases found.</p></div>`
            );
            return;
        }

        // Define constants and date formatting once
        const twoDaysMs = 86400000 * 2;
        const thresholdMs = Date.now() - twoDaysMs;

        const formatDate = (dateString) => {
            const date = new Date(dateString);
            // Use getUTCDate() to get the day component based on the UTC date
            const day = date.getUTCDate();

            // Use toLocaleDateString() but force the time zone to UTC
            const month = date.toLocaleDateString("en-GB", {
                month: "short",
                timeZone: "UTC",
            });

            return `${day}<br>${month}`;
        };

        let gridHtml = "";

        // Use a standard for...of loop for better performance than forEach
        for (const m of upcoming) {
            let episodesContainerHtml = "";

            // --- 🔹 Episode Rendering Logic ---
            if (Array.isArray(m.videos) && m.videos.length) {
                // Parse next episode only if videos exist
                let nextUp = null;
                const match = m.episodeText?.match(/^S(\d+)\sE(\d+)$/);
                if (match) {
                    nextUp = { season: +match[1], episode: +match[2] };
                }

                let episodesHtml = "";
                // Inner loop: Pure string building
                for (const ep of m.videos) {
                    const released = Date.parse(ep.released) <= thresholdMs;
                    let stateClass = "released";

                    if (!released) {
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

                    // Thumbnail HTML uses single-line logic
                    const thumbnailHtml = ep.thumbnail
                        ? `<img src="${ep.thumbnail}" alt="" loading="lazy" onerror="this.style.display='none'" />`
                        : `<div class="upcoming-episode-placeholder">No image</div>`;

                    episodesHtml += `
                    <div class="upcoming-episode-card ${stateClass}">
                        <div class="upcoming-episode-number">${ep.episode}</div>
                        <div class="upcoming-episode-title">${
                            ep.name || "Untitled"
                        }</div>
                        <div class="upcoming-episode-date">
                            ${formatDate(ep.released)}
                        </div>
                        <div class="upcoming-episode-thumbnail">
                            ${thumbnailHtml}
                        </div>
                    </div>
                `;
                }

                // Wrap episodes in their container
                episodesContainerHtml = `<div class="upcoming-episodes-container">${episodesHtml}</div>`;
            }
            // 💡 NEW LOGIC: Create the "New Season" indicator HTML
            const upcomingSeasonNumber = m.isNewSeason
                ? m.videos[0]?.season
                : 0;
            const newSeasonClass = m.isNewSeason ? " new-season" : "";

            // 2. Build the indicator string using template literals
            const newSeasonIndicator = m.isNewSeason
                ? `<div class="upcoming-new-season">SEASON ${upcomingSeasonNumber} PREMIERES</div>`
                : "";

            // --- Card Structure Builder (Pure string) ---
            // Replace all card creation/attribute setting with a single string
            gridHtml += `
            <a 
                tabindex="0" 
                class="upcoming-card${newSeasonClass}"
                href="${m.href}"
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
                    <img src="${m.poster}" alt="${m.title}" loading="lazy" />
                </div>
                <div class="upcoming-info">
                    <img class="upcoming-logo" src="${m.logo}" alt="${
                m.title
            }" loading="lazy" />
                    ${newSeasonIndicator}
                    <div class="upcoming-release-date">${m.releaseText}</div>
                    <div class="upcoming-episode">${m.episodeText}</div>
                    ${episodesContainerHtml} </div>
            </a>
        `;
        }

        // 3. 🎯 CRITICAL SPEEDUP: Single DOM Injection
        heroContainer.insertAdjacentHTML(
            "beforeend",
            `<div class="upcoming-list">
            <div class="upcoming-grid">
                ${gridHtml}
            </div>
        </div>`
        );
    }
    // Slight delay to allow DOM readiness
    window.addEventListener("hashchange", function (event) {
        // Set the timeout regardless of how the page was loaded.
        setTimeout(renderUpcomingList, 1000);
    });
    setTimeout(renderUpcomingList, 2000);
})();
