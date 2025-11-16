/*
 * @name Enhanced Title Bar Optimized
 * @description Optimized version with concurrency limit and better DOM handling.
 * @version 1.1.1 (Persistent Caching & Smart Update)
 * @author Fxy, EZOBOSS
 */

const CONFIG = {
    apiBase: "https://v3-cinemeta.strem.io/meta",
    timeout: 5000,
    updateInterval: 10000, // refresh every 10s
    concurrency: 4, // limit simultaneous fetches
    // ADDED: Persistent Cache TTL (12 hours)
    CACHE_TTL: 1000 * 60 * 60 * 12,
    CACHE_PREFIX: "etb_meta_cache_", // New prefix for localStorage
};

const metadataCache = new Map();

// --- Persistent Grouped Cache With Memory Cache ---

const GROUP_KEY = CONFIG.CACHE_PREFIX + "all"; // single localStorage key

// Load grouped cache into memory once at startup
let persistentCache = (() => {
    try {
        const raw = localStorage.getItem(GROUP_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (e) {
        console.warn("[ETB] Failed to load grouped cache, clearing", e);
        localStorage.removeItem(GROUP_KEY);
        return {};
    }
})();

/**
 * Save in-memory grouped cache to localStorage
 */
function flushCache() {
    try {
        localStorage.setItem(GROUP_KEY, JSON.stringify(persistentCache));
    } catch (e) {
        console.warn("[ETB] Failed to save grouped cache", e);
    }
}

/**
 * Get metadata from memory OR persistent cache
 */
function getCachedMetadata(key) {
    const memKey = GROUP_KEY + "_" + key; // differentiate memory key entries

    // Fast: check in-memory Map first
    if (metadataCache.has(memKey)) {
        return metadataCache.get(memKey);
    }

    const entry = persistentCache[key];
    if (!entry) return null;

    const now = Date.now();
    if (now - entry.timestamp > CONFIG.CACHE_TTL) {
        delete persistentCache[key];
        flushCache();
        return null;
    }

    // Cache into memory for next time
    metadataCache.set(memKey, entry.data);
    return entry.data;
}

/**
 * Set metadata into memory + persistent grouped storage
 */
function setCachedMetadata(key, data) {
    persistentCache[key] = {
        data,
        timestamp: Date.now(),
    };

    metadataCache.set(GROUP_KEY + "_" + key, data);
    flushCache();
}

function getDaysSinceRelease(releaseDateStr) {
    if (!releaseDateStr) return "";
    const oneDay = 86400000;
    const release = Date.parse(releaseDateStr);
    if (isNaN(release)) return "";

    // 1. Calculate difference in milliseconds, then days
    const diffMs = Date.now() - release;
    const diffDays = diffMs / oneDay;

    if (diffDays >= 0) {
        // Past or current day
        const days = Math.trunc(diffDays); // Use Math.trunc for whole days passed
        if (days === 0) return "Today";

        if (days >= 365) {
            const years = Math.trunc(days / 365);
            // 3. FIX: Pluralize based on the calculated number of years
            return `${years} year${years > 1 ? "s" : ""} ago`;
        }
        return `${days} day${days > 1 ? "s" : ""} ago`;
    }

    // Future release
    // 1. FIX: Use Math.ceil on the absolute difference to correctly count days ahead
    const daysAhead = Math.ceil(Math.abs(diffDays));
    return `in ${daysAhead} day${daysAhead > 1 ? "s" : ""}`;
}

function injectStyles() {
    if (document.getElementById("enhanced-title-bar-styles")) return;
    const style = document.createElement("style");
    style.id = "enhanced-title-bar-styles";
    style.textContent = `
            .enhanced-title-bar { position: relative !important; padding: 5px 10px !important; overflow: hidden !important; max-width: 400px !important; transform: translateZ(0) !important; }
            .enhanced-title { font-size: 16px !important; font-weight: 600 !important; color: #fff !important; margin-bottom: 3px !important; line-height: 1.3 !important; }
            .enhanced-metadata { display: flex !important; align-items: center !important; gap: 8px !important; flex-wrap: wrap !important; font-size: 12px !important; color: #999 !important; }
            .enhanced-metadata-item { display: inline-flex !important; align-items: center !important; gap: 4px !important; }
            .enhanced-separator { color: #666 !important; margin: 0 4px !important; }
            .enhanced-loading { background: linear-gradient(90deg, #333 25%, #444 50%, #333 75%) !important; background-size: 200% 100% !important; animation: enhanced-loading 1.5s infinite !important; border-radius: 3px !important; height: 12px !important; width: 60px !important; display: inline-block !important; }
            @keyframes enhanced-loading { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
        `;
    document.head.appendChild(style);
}

async function fetchMetadataLimited(tasks, limit = CONFIG.concurrency) {
    const results = [];
    let index = 0;

    async function worker() {
        while (index < tasks.length) {
            const i = index++;
            try {
                results[i] = await tasks[i]();
            } catch {
                results[i] = null;
            }
        }
    }

    const workers = Array.from({ length: limit }, worker);
    await Promise.all(workers);
    return results;
}

async function getMetadata(id, type) {
    const key = `${type}-${id}`;

    // 1. Check for short-term cache (using the passed 'key')
    const cachedData = getCachedMetadata(key);
    if (cachedData) {
        return cachedData;
    }

    let meta = null;

    try {
        const longTermCacheKey = `fullmeta:${id}`;

        const cacheString = localStorage.getItem("videos_cache_all");

        if (cacheString) {
            const cache = JSON.parse(cacheString);
            const cachedMeta = cache[longTermCacheKey];

            if (cachedMeta) {
                meta = cachedMeta.value;
            }
        }

        if (!meta) {
            const controller = new AbortController();
            const timeoutId = setTimeout(
                () => controller.abort(),
                CONFIG.timeout
            );
            const res = await fetch(`${CONFIG.apiBase}/${type}/${id}.json`, {
                signal: controller.signal,
            });
            clearTimeout(timeoutId);

            if (!res.ok) throw new Error(res.statusText);

            const data = await res.json();
            meta = data.meta; // Assign fetched data to the 'meta' variable

            if (!meta) {
                return null;
            }
        }

        // --- Metadata Processing (Runs for both cached and fetched data) ---

        // Compute release date
        const videos = meta.videos || [];
        let closestFuture = null,
            latestPast = null;
        const now = new Date();
        // Adjust for UTC offset and include videos released today at 00:00
        now.setDate(now.getDate() - 1);
        for (const v of videos) {
            if (!v.released) continue;
            const date = new Date(v.released);
            if (isNaN(date)) continue;
            if (date > now && (!closestFuture || date < closestFuture.date))
                closestFuture = { date, released: v.released };
            if (date <= now && (!latestPast || date > latestPast.date))
                latestPast = { date, released: v.released };
        }

        const releaseDate = getDaysSinceRelease(
            (closestFuture || latestPast || { released: meta.released })
                .released
        );

        // --- Compute newTag from releaseDate ---
        const newTag = (() => {
            const releaseStr = releaseDate;
            if (releaseStr && releaseStr.includes("day")) {
                const match = releaseStr.match(/^(\d+)/);
                if (match) {
                    const days = parseInt(match[1], 10);
                    if (days <= 14) return "NEW";
                } else {
                    return "UPCOMING";
                }
            }
            return null;
        })();

        const trailer =
            meta?.trailer ||
            meta?.trailers?.[0]?.source ||
            meta?.trailers?.[0]?.url ||
            meta?.videos?.[0]?.url ||
            null;

        // --- Final Metadata Object Construction ---

        const metadata = {
            title: meta.name || meta.title,
            year: meta.year?.toString() || meta.releaseInfo?.toString() || null,
            rating: meta.imdbRating?.toString() || null,
            genres: Array.isArray(meta.genre)
                ? meta.genre
                : Array.isArray(meta.genres)
                ? meta.genres
                : [],
            runtime: meta.runtime || null,
            type: meta.type || type,
            description: meta.description || null,
            logo: `https://images.metahub.space/logo/medium/${id}/img`,
            releaseDate,
            newTag,
            trailer,
        };

        setCachedMetadata(key, metadata);
        return metadata;
    } catch (e) {
        console.error(`Error fetching/processing metadata for ${id}:`, e);
        return null;
    }
}
function extractMediaInfo(element) {
    let el = element;

    // Define the ID regex once outside the loop for slight performance gain
    const idRegex = /tt\d{7,}/;
    const typeRegex = /\/(movie|series)\//i;

    // Iterate up to 5 parent elements, starting with the element itself
    for (let i = 0; i < 5 && el; i++, el = el.parentElement) {
        // 1. Check if the current element is an <a> tag
        if (el.tagName === "A" && el.href.includes("tt")) {
            const href = el.href;
            const idMatch = href.match(idRegex);

            if (idMatch) {
                const typeMatch = href.match(typeRegex);
                return {
                    id: idMatch[0],
                    type: typeMatch ? typeMatch[1].toLowerCase() : "movie",
                };
            }
        }

        // 2. Use querySelectorAll to check for both <a> and <img> children in one DOM query.
        // This is the most significant change.
        const children = el.querySelectorAll("a[href*='tt'], img[src*='tt']");

        for (const child of children) {
            // Check Anchor tags
            if (child.tagName === "A") {
                const href = child.href;
                const idMatch = href.match(idRegex);

                if (idMatch) {
                    const typeMatch = href.match(typeRegex);

                    return {
                        id: idMatch[0],
                        type: typeMatch ? typeMatch[1].toLowerCase() : "movie",
                    };
                }
            }

            // Check Image tags
            else if (child.tagName === "IMG") {
                const src = child.src;
                const idMatch = src.match(idRegex);

                if (idMatch) {
                    return {
                        id: idMatch[0],
                        type: "movie", // Default to 'movie' for image sources
                    };
                }
            }
        }

        // Optimization: if we are at the top element (i=4) and still haven't returned,
        // we can skip the next parentElement assignment (which will be null).
        if (!el.parentElement) break;
    }

    // Default return if nothing is found
    return { id: "tt0000000", type: "movie" };
}
function createMetadataElements(metadata) {
    const elements = [];

    if (metadata.rating) {
        const rating = document.createElement("span");
        rating.className = "enhanced-metadata-item enhanced-rating";
        rating.textContent = `${metadata.rating}`;
        elements.push(rating);
    }

    if (metadata.year || metadata.releaseInfo) {
        const year = document.createElement("span");
        year.className = "enhanced-metadata-item";
        year.textContent = metadata.year || metadata.releaseInfo;
        elements.push(year);
    }

    if (metadata.genres && metadata.genres.length > 0) {
        const genres = document.createElement("span");
        genres.className = "enhanced-metadata-item";
        genres.textContent = metadata.genres.slice(0, 3).join(", ");
        elements.push(genres);
    }
    if (metadata.description) {
        const description = document.createElement("span");
        description.className = "enhanced-metadata-item enhanced-description";
        description.dataset.description = metadata.description;
        description.dataset.runtime = metadata.runtime;
        elements.push(description);
    }

    if (metadata.trailer) {
        const trailer = document.createElement("a");
        trailer.className = "enhanced-metadata-item enhanced-trailer";
        trailer.dataset.trailerUrl = metadata.trailer;
        trailer.target = "_blank";
        trailer.rel = "noopener noreferrer";
        trailer.textContent = "";
        elements.push(trailer);
    }
    if (metadata.releaseDate) {
        const releaseDate = document.createElement("span");
        releaseDate.className = "enhanced-metadata-item enhanced-release-date";
        releaseDate.textContent = metadata.releaseDate;
        elements.push(releaseDate);
    }
    if (metadata.newTag) {
        const newTag = document.createElement("span");
        newTag.className = "enhanced-metadata-item enhanced-new-tag";
        newTag.textContent = metadata.newTag;
        elements.push(newTag);
    }

    return elements;
}

async function enhanceTitleBar(titleBar) {
    if (titleBar.classList.contains("enhanced-title-bar")) return;
    const titleEl = titleBar.querySelector(
        ".title-label-VnEAc,[class*='title-label'],[class*='title']"
    );
    if (!titleEl) return;
    const originalTitle = titleEl.textContent.trim();
    if (!originalTitle) return;

    titleBar.classList.add("enhanced-title-bar");
    titleBar.dataset.originalHtml = titleBar.innerHTML.trim();
    titleBar.innerHTML = "";

    const mediaInfo = extractMediaInfo(titleBar);

    const titleContainer = Object.assign(document.createElement("div"), {
        className: "enhanced-title",
    });
    titleBar.appendChild(titleContainer);

    const metadataContainer = Object.assign(document.createElement("div"), {
        className: "enhanced-metadata",
    });
    const loading = Object.assign(document.createElement("div"), {
        className: "enhanced-loading",
    });
    metadataContainer.appendChild(loading);
    titleBar.appendChild(metadataContainer);

    const metadata = await getMetadata(mediaInfo.id, mediaInfo.type);
    metadataContainer.innerHTML = "";

    if (metadata) {
        if (metadata.logo) {
            const logoImg = Object.assign(document.createElement("img"), {
                src: metadata.logo,
                alt: metadata.title || originalTitle,
                style: "max-width:75%;height:65px;object-fit:contain;",
            });
            titleContainer.appendChild(logoImg);
        } else {
            titleContainer.textContent = metadata.title || originalTitle;
        }

        const elements = createMetadataElements(metadata);
        elements.forEach((el) => metadataContainer.appendChild(el));
    } else {
        const fallback = Object.assign(document.createElement("span"), {
            className: "enhanced-metadata-item",
            textContent: originalTitle,
            style: "color:#fff;",
        });
        metadataContainer.appendChild(fallback);
    }
}

async function enhanceAllTitleBars() {
    const elements = document.querySelectorAll(
        ".title-bar-container-1Ba0x,[class*='title-bar-container'],[class*='titleBarContainer'],[class*='title-container'],[class*='media-title']"
    );

    const tasks = [];
    elements.forEach((el) => {
        if (!el.classList.contains("enhanced-title-bar"))
            tasks.push(() => enhanceTitleBar(el));
    });
    if (tasks.length) await fetchMetadataLimited(tasks);
}

function init() {
    injectStyles();
    enhanceAllTitleBars();

    setInterval(enhanceAllTitleBars, CONFIG.updateInterval);

    let timeoutId = null;
    if (typeof MutationObserver !== "undefined") {
        const observer = new MutationObserver((muts) => {
            if (
                muts.some(
                    (m) => m.type === "childList" && m.addedNodes.length > 0
                )
            ) {
                clearTimeout(timeoutId);
                timeoutId = setTimeout(enhanceAllTitleBars, 100);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}
