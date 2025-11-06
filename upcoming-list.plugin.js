/**
 * @name Upcoming Releases List
 * @description Shows a list of upcoming releases (with localStorage caching)
 * @version 1.2.0
 * @author EZOBOSS
 */

(function () {
    const CONFIG = {
        FETCH_TIMEOUT: 5000,
        CACHE_TTL: 1000 * 60 * 60, // 1 hour
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

    function getDaysSinceRelease(releaseDateStr) {
        if (!releaseDateStr) return "";

        const oneDay = 86400000;
        const release = Date.parse(releaseDateStr);
        if (isNaN(release)) return "";

        const now = Date.now();
        const diffDays = Math.trunc((now - release) / oneDay);

        if (diffDays === 0) return "Today";
        if (diffDays > 0) {
            if (diffDays >= 365) {
                const years = Math.trunc(diffDays / 365);
                return `${years} year${years > 1 ? "s" : ""} ago`;
            }
            return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
        }

        const daysAhead = Math.abs(diffDays);
        return `in ${daysAhead} day${daysAhead > 1 ? "s" : ""}`;
    }

    async function fetchUpcomingTitles(
        type = "movie",
        catalog = "top",
        limit = 10
    ) {
        const baseUrl = "https://cinemeta-catalogs.strem.io/top/catalog";
        const types = ["movie", "series"];
        const now = new Date();

        const key = `${type}_${catalog}_${limit}`;
        const cached = cacheGet(key);
        if (cached) {
            console.log("[UpcomingReleases] Fetched cached", key);
            return cached;
        }

        try {
            const settled = await Promise.allSettled(
                types.map((t) => safeFetch(`${baseUrl}/${t}/${catalog}.json`))
            );

            const all = settled.flatMap((res) => {
                if (res.status !== "fulfilled" || !res.value) return [];
                const payload = res.value;
                if (Array.isArray(payload.metas)) return payload.metas;
                if (Array.isArray(payload)) return payload;
                return [];
            });

            console.log("[UpcomingReleases] Fetched", all.length, "metas");

            // --- Helper: find the closest *future* release date ---
            // --- Helper: find the closest *future* release video object ---
            function getClosestFutureVideo(meta) {
                const now = new Date(); // Using the 'now' from the outer scope

                const futureVideos = [];

                // 1. Check the main release date if it's in the future
                if (meta.released) {
                    const d = new Date(meta.released);
                    if (d > now) {
                        futureVideos.push({
                            releaseDate: d,
                            video: {
                                released: meta.released,
                                season: 0,
                                episode: 0,
                                title: "Series Release",
                            }, // Add placeholder metadata for the main release
                        });
                    }
                }

                // 2. Check all videos/episodes for future release dates
                if (Array.isArray(meta.videos)) {
                    meta.videos.forEach((v) => {
                        if (v.released) {
                            const vd = new Date(v.released);
                            if (vd > now) {
                                futureVideos.push({
                                    releaseDate: vd,
                                    video: v, // Push the entire video object
                                });
                            }
                        }
                    });
                }

                if (futureVideos.length === 0) return null;

                // Find the object with the minimum (closest) release date
                futureVideos.sort(
                    (a, b) => a.releaseDate.getTime() - b.releaseDate.getTime()
                );

                // Return the closest video object and its date
                return futureVideos[0];
            }

            // --- Helper: format as “in 2 days”, “Tomorrow”, “in 1 year”, etc. ---
            function formatDaysUntil(date) {
                const msPerDay = 1000 * 60 * 60 * 24;
                const diff = Math.ceil((date - now) / msPerDay);

                if (diff <= 0) return "Today";
                if (diff === 1) return "Tomorrow";
                if (diff < 30) return `in ${diff} days`;
                if (diff < 365) {
                    const months = Math.round(diff / 30);
                    return `in ${months} month${months > 1 ? "s" : ""}`;
                }
                const years = Math.round(diff / 365);
                return `in ${years} year${years > 1 ? "s" : ""}`;
            }

            // --- Filter & map to simplified metadata ---
            // --- Filter & map to simplified metadata ---
            const metadataList = all
                .map((m) => {
                    // Call the new helper
                    const closestFuture = getClosestFutureVideo(m);

                    // closestFuture will be null OR { releaseDate: Date, video: { ... } }
                    if (closestFuture) {
                        const { releaseDate, video } = closestFuture;

                        // Determine the season/episode text
                        let episodeText = "";
                        let hfef = "";
                        if (video.season > 0 && video.episode > 0) {
                            episodeText = `S${video.season} E${video.episode}`;
                            href = `#/detail/${m.type}/${m.id}`;
                        } else {
                            episodeText = "Movie";
                            href = `#/detail/${m.type}/${m.id}/${m.id}`;
                        }

                        return {
                            id: m.id,
                            type: m.type,
                            title: m.name,
                            releaseDate,
                            releaseText: formatDaysUntil(releaseDate),
                            episodeText: episodeText, // <<--- NEW FIELD
                            poster: `https://images.metahub.space/poster/medium/${m.id}/img`,
                            logo: `https://images.metahub.space/logo/medium/${m.id}/img`,
                            href: href,
                        };
                    } else {
                        return null;
                    }
                })
                .filter(Boolean)
                .sort((a, b) => a.releaseDate - b.releaseDate)
                .slice(0, limit);

            cacheSet(key, metadataList);
            return metadataList;
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
        // Check if the page is loaded from the bfcache (persisted is true)
        // or if it's a fresh load.
        if (event.persisted) {
            // This means the user came back via the back/forward button.
            console.log("Returned from bfcache, setting timer again...");
        } else {
            // This is the initial page load.
            console.log("Initial page load.");
        }

        // Set the timeout regardless of how the page was loaded.
        setTimeout(renderUpcomingList, 300);
    });
    setTimeout(renderUpcomingList, 2000);
})();
