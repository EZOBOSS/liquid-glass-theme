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
    const videoCacheKey = (key) => CONFIG.VIDEO_CACHE_PREFIX + key; // Separate prefix

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

    // --- NEW: Long-Term Cache Logic (For individual videos array) ---
    const videoCacheSet = (key, value) => {
        const entry = { value, timestamp: Date.now() };
        try {
            // Use the video-specific key and prefix
            localStorage.setItem(videoCacheKey(key), JSON.stringify(entry));
        } catch {
            // ignore quota or serialization errors
        }
    };

    const videoCacheGet = (key) => {
        const now = Date.now();
        try {
            const raw = localStorage.getItem(videoCacheKey(key));
            if (!raw) return null;
            const data = JSON.parse(raw);

            // Check against the special long-term expiry (VIDEO_CACHE_EXPIRY_MS)
            if (now - data.timestamp > CONFIG.VIDEO_CACHE_EXPIRY_MS) {
                localStorage.removeItem(videoCacheKey(key));
                return null;
            }
            // Return only the stored array of videos
            return data.value;
        } catch {
            return null;
        }
    };

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
                    const vidCacheKey = `videos:${m.id}`;
                    let videos = videoCacheGet(vidCacheKey); // 💡 CHECK LONG-TERM CACHE FIRST

                    if (!videos) {
                        // Cache miss: must fetch full meta
                        const url = `${metaUrl}/${m.type}/${m.id}.json`;
                        try {
                            const data = await safeFetch(url);
                            videos = data?.meta?.videos || [];
                            console.log(
                                `[UpcomingReleases] Fetched meta for ${m.id}`
                            );

                            // 💡 SET LONG-TERM CACHE
                            if (videos.length) {
                                videoCacheSet(videoCacheKey, videos);
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
                            `[UpcomingReleases] Videos cache hit for ${m.id}`
                        );
                    }

                    // Attach videos to the meta object regardless of source (cache or fetch)
                    m.videos = videos || [];
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
                });
            }

            // 4. Sort and Limit
            metadataList.sort((a, b) => a.releaseDate - b.releaseDate);
            console.log(
                "[UpcomingReleases] Sorted",
                metadataList.length,
                "items"
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

        // Use fast array for-loop for iteration
        const upcoming = await fetchUpcomingTitles("movie", "top", 6);
        if (upcoming.length === 0) return;

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

            // --- Card Structure Builder (Pure string) ---
            // Replace all card creation/attribute setting with a single string
            gridHtml += `
            <a 
                tabindex="0" 
                class="upcoming-card" 
                href="${m.href}"
                data-trailer-url="${m.trailer || ""}"
                data-description="${m.description || ""}"
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
