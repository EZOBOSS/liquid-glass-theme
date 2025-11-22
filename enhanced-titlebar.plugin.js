/*
 * @name Enhanced Title Bar Optimized
 * @description Optimized version with concurrency limit and better DOM handling.
 * @version 1.1.2 (Genre Fix)
 * @author Fxy, EZOBOSS
 */

const CONFIG = {
    apiBase: "https://v3-cinemeta.strem.io/meta",
    timeout: 5000,
    updateInterval: 10000, // refresh every 10s
    concurrency: 4, // limit simultaneous fetches
    // ADDED: Persistent Cache TTL (12 hours)
    CACHE_TTL: 12 * 60 * 60 * 1000,
    CACHE_PREFIX: "etb_meta_cache_v2_", // New prefix for localStorage
    CACHE_MAX_SIZE: 1000, // Max items in cache
    // ADDED: Intersection Observer Config
    OBSERVER_MARGIN: "600px 0px", // Preload before viewport
};

// --- Task Queue for Concurrency Control ---
const taskQueue = {
    queue: [],
    active: 0,

    add(task) {
        this.queue.push(task);
        this.process();
    },

    async process() {
        if (this.active >= CONFIG.concurrency || this.queue.length === 0)
            return;

        this.active++;
        const task = this.queue.shift();

        try {
            await task();
        } catch (e) {
            console.error("[ETB] Task failed", e);
        } finally {
            this.active--;
            this.process();
        }
    },
};

// --- Self-Pruning LRU Cache ---

class SelfPruningLRUCache {
    constructor(maxSize = 100, ttl = 3600000, storageKey = "lru_cache") {
        this.maxSize = maxSize;
        this.ttl = ttl;
        this.storageKey = storageKey;
        this.cache = new Map();
        this.load();
    }

    load() {
        try {
            const raw = localStorage.getItem(this.storageKey);
            if (raw) {
                const parsed = JSON.parse(raw);
                // Sort by timestamp to approximate LRU order if needed,
                // but mostly we rely on Map insertion order.
                // Re-inserting them preserves order if saved correctly.
                // However, JSON.stringify/parse might lose Map order if treated as object.
                // We'll assume parsed is an array of entries or an object.
                // If object, order is not guaranteed.
                // Better to store as array of [key, value].

                let entries = [];
                if (Array.isArray(parsed)) {
                    entries = parsed;
                } else {
                    // Migration or fallback for object format
                    entries = Object.entries(parsed);
                }

                const now = Date.now();
                entries.forEach(([key, value]) => {
                    if (now - value.timestamp <= this.ttl) {
                        this.cache.set(key, value);
                    }
                });
            }
        } catch (e) {
            console.warn("[ETB] Failed to load cache", e);
        }
    }

    save() {
        try {
            // Save as array of entries to preserve order
            const entries = Array.from(this.cache.entries());
            localStorage.setItem(this.storageKey, JSON.stringify(entries));
        } catch (e) {
            console.warn("[ETB] Failed to save cache", e);
        }
    }

    get(key) {
        if (!this.cache.has(key)) return null;

        const item = this.cache.get(key);
        const now = Date.now();

        if (now - item.timestamp > this.ttl) {
            this.cache.delete(key);
            this.scheduleSave();
            return null;
        }

        // Refresh item position (LRU logic: move to end)
        this.cache.delete(key);
        this.cache.set(key, item);
        // OPTIMIZATION: Don't save on every get() - only on set/prune
        // This reduces localStorage write frequency significantly

        return item.data;
    }

    set(key, data) {
        // Remove if exists to update position
        if (this.cache.has(key)) {
            this.cache.delete(key);
        }

        this.cache.set(key, {
            data,
            timestamp: Date.now(),
        });

        this.prune();
        this.scheduleSave();
    }

    prune() {
        if (this.cache.size > this.maxSize) {
            // Map.keys().next().value returns the first inserted (oldest) key
            // because we re-insert on access.
            const oldestKey = this.cache.keys().next().value;
            this.cache.delete(oldestKey);
            // Recurse in case we need to remove more (unlikely if size=1)
            if (this.cache.size > this.maxSize) {
                this.prune();
            }
        }
    }

    scheduleSave() {
        if (this.saveTimeout) clearTimeout(this.saveTimeout);
        this.saveTimeout = setTimeout(() => {
            this.save();
        }, 2000); // Increased to 2s to batch writes better
    }
}

const metadataCache = new SelfPruningLRUCache(
    CONFIG.CACHE_MAX_SIZE,
    CONFIG.CACHE_TTL,
    CONFIG.CACHE_PREFIX + "storage"
);

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

// --- External Cache Optimization ---
let externalCacheMemory = null;

function getExternalCache() {
    if (!externalCacheMemory) {
        try {
            const raw = localStorage.getItem("videos_cache_all");
            externalCacheMemory = raw ? JSON.parse(raw) : {};
        } catch {
            externalCacheMemory = {};
        }
    }
    return externalCacheMemory;
}

async function getMetadata(id, type) {
    const key = `${type}-${id}`;

    // 1. Check for short-term cache (using the passed 'key')
    const cachedData = metadataCache.get(key);
    if (cachedData) {
        return cachedData;
    }

    let meta = null;

    try {
        const longTermCacheKey = `fullmeta:${id}`;

        // Optimized: Use memory-cached version of localStorage data
        const cache = getExternalCache();
        const cachedMeta = cache[longTermCacheKey];

        if (cachedMeta) {
            meta = cachedMeta.value;
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
            id: meta.id || id,
            title: meta.name || meta.title,
            year: meta.year?.toString() || meta.releaseInfo?.toString() || null,
            rating: meta.imdbRating?.toString() || null,
            genres:
                [meta.genre, meta.genres].find(
                    (g) => Array.isArray(g) && g.length > 0
                ) || [],
            runtime: meta.runtime || null,
            type: meta.type || type,
            description: meta.description || null,
            logo: `https://images.metahub.space/logo/medium/${id}/img`,
            releaseDate,
            newTag,
            trailer,
        };

        metadataCache.set(key, metadata);
        return metadata;
    } catch (e) {
        console.error(`Error fetching/processing metadata for ${id}:`, e);
        return null;
    }
}
//regexes
const RE_ID = /tt\d{7,}/;
const RE_TYPE = /\/(movie|series)\//i;
function extractMediaInfo(element) {
    // Optimization: Use closest() to find link context immediately
    // This replaces the loop and querySelectorAll logic
    const link =
        element.closest('a[href*="tt"]') ||
        element.querySelector('a[href*="tt"]');

    if (link) {
        const href = link.href;
        const idMatch = href.match(RE_ID);
        if (idMatch) {
            const typeMatch = href.match(RE_TYPE);
            return {
                id: idMatch[0],
                type: typeMatch ? typeMatch[1].toLowerCase() : "movie",
            };
        }
    }

    // Fallback: check images if no link found
    const img =
        element.previousElementSibling?.querySelector?.('img[src*="tt"]');

    if (img) {
        const idMatch = img.src.match(RE_ID);
        if (idMatch) return { id: idMatch[0], type: "movie" };
    }

    return { id: "tt0000000", type: "movie" }; // Default safe return
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
    titleBar.textContent = ""; // Faster than innerHTML

    const mediaInfo = extractMediaInfo(titleBar);

    const fragment = document.createDocumentFragment();
    const titleContainer = Object.assign(document.createElement("div"), {
        className: "enhanced-title",
    });
    fragment.appendChild(titleContainer);

    const metadataContainer = Object.assign(document.createElement("div"), {
        className: "enhanced-metadata",
    });
    const loading = Object.assign(document.createElement("div"), {
        className: "enhanced-loading",
    });
    metadataContainer.appendChild(loading);
    fragment.appendChild(metadataContainer);

    // Single append to DOM
    titleBar.appendChild(fragment);

    const metadata = await getMetadata(mediaInfo.id, mediaInfo.type);
    metadataContainer.textContent = ""; // Faster than innerHTML

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
        const metaFragment = document.createDocumentFragment();
        elements.forEach((el) => metaFragment.appendChild(el));
        metadataContainer.appendChild(metaFragment);
    } else {
        const fallback = Object.assign(document.createElement("span"), {
            className: "enhanced-metadata-item",
            textContent: originalTitle,
            style: "color:#fff;",
        });
        metadataContainer.appendChild(fallback);
    }
}

const TITLE_BAR_SELECTOR =
    ".title-bar-container-1Ba0x,[class*='title-bar-container'],[class*='titleBarContainer'],[class*='title-container'],[class*='media-title']";

// --- Intersection Observer for Lazy Loading ---
let intersectionObserver;

function handleIntersection(entries) {
    entries.forEach((entry) => {
        if (entry.isIntersecting) {
            const target = entry.target;
            // Double check if already enhanced to avoid duplicate work
            if (!target.classList.contains("enhanced-title-bar")) {
                taskQueue.add(() => enhanceTitleBar(target));
                // Unobserve after enhancement to prevent double work
                intersectionObserver.unobserve(target);
            }
        }
    });
}

function observeElement(el) {
    if (
        !el.classList.contains("enhanced-title-bar") &&
        !el.dataset.etbObserved
    ) {
        el.dataset.etbObserved = "true";
        intersectionObserver.observe(el);
    }
}

function initObservers() {
    if (intersectionObserver) return;

    intersectionObserver = new IntersectionObserver(handleIntersection, {
        rootMargin: CONFIG.OBSERVER_MARGIN,
        threshold: 0.01,
    });

    // Initial scan
    document.querySelectorAll(TITLE_BAR_SELECTOR).forEach(observeElement);

    // Mutation Observer for new content
    if (typeof MutationObserver !== "undefined") {
        const mutationObserver = new MutationObserver((mutations) => {
            for (const m of mutations) {
                if (m.type === "childList") {
                    m.addedNodes.forEach((node) => {
                        if (node.nodeType !== Node.ELEMENT_NODE) return;

                        // Check if the node itself is a title bar
                        if (node.matches && node.matches(TITLE_BAR_SELECTOR)) {
                            observeElement(node);
                        }

                        // Check children of the added node
                        if (node.querySelectorAll) {
                            node.querySelectorAll(TITLE_BAR_SELECTOR).forEach(
                                observeElement
                            );
                        }
                    });
                }
            }
        });

        mutationObserver.observe(document.body, {
            childList: true,
            subtree: true,
        });
    }
}

function init() {
    injectStyles();
    initObservers();
    // Removed fallback setInterval and eager enhanceAllTitleBars
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}
