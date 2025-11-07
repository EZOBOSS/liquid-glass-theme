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
            cacheSet(key, limited);
            return limited;
        } catch (e) {
            logger.warn("Failed to fetch upcoming titles", e);
            return [];
        }
    }

    async function renderUpcomingList() {
        const heroContainer = document.querySelector(".hero-container");
        if (!heroContainer) return;

        const upcoming = await fetchUpcomingTitles("movie", "top", 6);
        if (upcoming.length === 0) return;

        const list = document.createElement("div");
        list.className = "upcoming-list";

        const grid = document.createElement("div");
        grid.className = "upcoming-grid";

        upcoming.forEach((m) => {
            const card = document.createElement("a");
            card.setAttribute("tabindex", 0);
            card.className = "upcoming-card";
            card.setAttribute("href", m.href);
            card.dataset.trailerUrl = m.trailer;
            card.dataset.description = m.description;
            card.id = m.id;
            card.dataset.rating = m.rating;
            card.dataset.year = m.year;
            card.dataset.runtime = m.runtime;
            card.dataset.genres = m.genres;

            card.innerHTML = `
                <div class="upcoming-background-container">
                    <img src="${m.poster}" alt="${m.title}" />
                </div>
                <div class="upcoming-info">
                    <img class="upcoming-logo" src="${m.logo}" alt="${m.title}" />
                    <div class="upcoming-release-date">${m.releaseText}</div>
                    <div class="upcoming-episode">${m.episodeText}</div>
                </div>
            `;
            grid.appendChild(card);
        });

        list.appendChild(grid);
        heroContainer.appendChild(list);
    }

    // Slight delay to allow DOM readiness
    window.addEventListener("hashchange", function (event) {
        // Set the timeout regardless of how the page was loaded.
        setTimeout(renderUpcomingList, 1000);
    });
    setTimeout(renderUpcomingList, 2000);
})();
