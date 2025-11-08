/**
 * @name Upcoming Releases List
 * @description Shows a list of upcoming releases (with localStorage caching)
 * @version 1.2.0
 * @author EZOBOSS
 */

(function () {
    const CONFIG = {
        FETCH_TIMEOUT: 5000,
        CACHE_TTL: 1000 * 60 * 60 * 6, // 6 hour
        CACHE_PREFIX: "upcoming_cache_",
    };

    // --- Local + in-memory cache ---
    const memoryCache = new Map();

    const cacheKey = (key) => CONFIG.CACHE_PREFIX + key;

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

    const logger = {
        warn: (...a) => console.warn("[UpcomingReleases]", ...a),
    };

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

    async function fetchUpcomingTitles(
        type = "movie",
        catalog = "top",
        limit = 10
    ) {
        const baseUrl = "https://cinemeta-catalogs.strem.io/top/catalog";
        const metaUrl = "https://cinemeta-live.strem.io/meta";
        const types = ["movie", "series"];
        const now = Date.now(); // milliseconds, cheaper than new Date() objects

        const key = `${type}_${catalog}_${limit}`;
        const cached = cacheGet(key);
        if (cached) {
            console.log("[UpcomingReleases] Fetched cached", key);
            return cached;
        }

        try {
            // Fetch both types in parallel
            const results = await Promise.allSettled(
                types.map((t) => safeFetch(`${baseUrl}/${t}/${catalog}.json`))
            );

            // Combine fulfilled results into one metas array
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
                // use reduce instead of sort for performance
                return futureVideos.reduce((min, curr) =>
                    curr.dateMs < min.dateMs ? curr : min
                );
            };

            // --- Filter + map ---
            const metadataList = [];
            for (const m of all) {
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
                });
            }

            // Sort once at the end (in-place, minimal overhead)
            metadataList.sort((a, b) => a.releaseDate - b.releaseDate);

            const limited = metadataList.slice(0, limit);

            // --- 🔹 Fetch full meta for these items and keep only latest season episodes ---
            const enriched = await Promise.allSettled(
                limited.map(async (item) => {
                    const url = `${metaUrl}/${item.type}/${item.id}.json`;
                    try {
                        const data = await safeFetch(url);
                        const videos = data?.meta?.videos || [];

                        if (videos.length && item.type === "series") {
                            // find highest (latest) season number
                            const seasons = videos
                                .map((v) => v.season)
                                .filter((s) => typeof s === "number" && s > 0);
                            const latestSeason = Math.max(...seasons);

                            // filter and sort that season's episodes
                            item.latestSeasonEpisodes = videos
                                .filter((v) => v.season === latestSeason)
                                .map((v) => ({
                                    name: v.title,
                                    episode: v.episode,
                                    season: v.season,
                                    released: v.released,
                                    thumbnail: v.thumbnail,
                                }))
                                .sort((a, b) => a.episode - b.episode);
                        }
                    } catch (err) {
                        console.warn("Failed to fetch meta for", item.id, err);
                    }
                    return item;
                })
            );

            const finalList = enriched
                .filter((r) => r.status === "fulfilled")
                .map((r) => r.value);

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
            const day = date.getDate(); // returns 1–31 without leading zero
            const month = date.toLocaleDateString("en-GB", { month: "short" });
            return `${day}<br>${month}`;
        };

        let gridHtml = "";

        // Use a standard for...of loop for better performance than forEach
        for (const m of upcoming) {
            let episodesContainerHtml = "";

            // --- 🔹 Episode Rendering Logic ---
            if (
                Array.isArray(m.latestSeasonEpisodes) &&
                m.latestSeasonEpisodes.length
            ) {
                // Parse next episode only if videos exist
                let nextUp = null;
                const match = m.episodeText?.match(/^S(\d+)\sE(\d+)$/);
                if (match) {
                    nextUp = { season: +match[1], episode: +match[2] };
                }

                let episodesHtml = "";

                // Inner loop: Pure string building
                for (const ep of m.latestSeasonEpisodes) {
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
