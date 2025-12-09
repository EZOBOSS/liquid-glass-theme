/*
 * @name Enhanced Title Bar Optimized
 * @description Optimized version with IndexedDB and Web Workers.
 * @version 1.2.0
 * @author Fxy, EZOBOSS
 * @dependancies: metadatadb.plugin.js
 */

const CONFIG = {
    apiBase: "https://v3-cinemeta.strem.io/meta",
    corsProxy: "https://corsproxy.io/?",
    timeout: 5000,
    updateInterval: 10000,
    concurrency: 4,
    OBSERVER_MARGIN: "2000px 0px",
};
let db;
const WORKER_CODE = `
self.onmessage = function(e) {
    const { meta, id } = e.data;
    
    if (!meta) {
        self.postMessage({ id, error: "No metadata provided" });
        return;
    }

    try {
       
        function getDaysSinceRelease(releaseDateStr) {
            if (!releaseDateStr) return "";
            const oneDay = 86400000;
            const release = Date.parse(releaseDateStr);
            if (isNaN(release)) return "";

            const diffMs = Date.now() - release;
            const diffDays = diffMs / oneDay;

            if (diffDays >= 0) {
                const days = Math.trunc(diffDays);
                if (days === 0) return "Today";
                if (days >= 365) {
                    const years = Math.trunc(days / 365);
                    return \`\${years} year\${years > 1 ? "s" : ""} ago\`;
                }
                return \`\${days} day\${days > 1 ? "s" : ""} ago\`;
            }

            const daysAhead = Math.ceil(Math.abs(diffDays));
            return \`in \${daysAhead} day\${daysAhead > 1 ? "s" : ""}\`;
        }

        const videos = meta.videos || [];
        let closestFuture = null;
        let latestPast = null;
        const now = new Date();
        now.setDate(now.getDate() - 1);

        for (const v of videos) {
            if (!v.released) continue;
            const date = new Date(v.released);
            if (isNaN(date.getTime())) continue;
            
            if (date > now && (!closestFuture || date < closestFuture.date))
                closestFuture = { date, released: v.released };
            if (date <= now && (!latestPast || date > latestPast.date))
                latestPast = { date, released: v.released };
        }

        const releaseDateStr = (closestFuture || latestPast || { released: meta.released }).released;
        const releaseDate = getDaysSinceRelease(releaseDateStr);

        let newTag = null;
        if (releaseDate && releaseDate.includes("day")) {
            const match = releaseDate.match(/^(\\d+)/);
            if (match) {
                const days = parseInt(match[1], 10);
                if (days <= 14) newTag = "NEW";
            } else {
                newTag = "UPCOMING";
            }
        }

        self.postMessage({ 
            id, 
            result: { 
                releaseDate, 
                newTag 
            } 
        });

    } catch (err) {
        self.postMessage({ id, error: err.message });
    }
};
`;

const workerBlob = new Blob([WORKER_CODE], { type: "application/javascript" });
const workerUrl = URL.createObjectURL(workerBlob);
const worker = new Worker(workerUrl);
URL.revokeObjectURL(workerUrl);

const workerCallbacks = new Map();
worker.onmessage = (e) => {
    const { id, result, error } = e.data;
    if (workerCallbacks.has(id)) {
        const { resolve, reject } = workerCallbacks.get(id);
        workerCallbacks.delete(id);
        if (error) reject(error);
        else resolve(result);
    }
};
worker.onerror = (e) => {
    console.error("[ETB] Worker Error:", e);
    // Optional: Reject all pending callbacks if the worker dies
    workerCallbacks.forEach(({ reject }) => reject("Worker crashed"));
    workerCallbacks.clear();
};

function calculateDynamicData(meta, id) {
    return new Promise((resolve, reject) => {
        workerCallbacks.set(id, { resolve, reject });
        worker.postMessage({ meta, id });
    });
}

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

// Main Logic
async function getMetadata(id, type) {
    try {
        let meta = await db.get(id);
        let source = "cache";

        // 2. If not in DB, fetch from API
        if (!meta) {
            source = "api";
            const controller = new AbortController();
            const timeoutId = setTimeout(
                () => controller.abort(),
                CONFIG.timeout
            );

            try {
                const res = await fetch(
                    `${CONFIG.corsProxy}${CONFIG.apiBase}/${type}/${id}.json`,
                    {
                        signal: controller.signal,
                        credentials: "omit",
                    }
                );
                clearTimeout(timeoutId);

                if (!res.ok) throw new Error(res.statusText);

                const data = await res.json();
                meta = data.meta;

                if (meta) {
                    console.log(`[ETB] Fetched ${id} from API`, meta.type);
                    // Save raw meta to DB with type for expiration logic
                    await db.put(id, meta, type);
                }
            } catch (fetchErr) {
                console.warn(`[ETB] Fetch failed for ${id}:`, fetchErr);
                return null;
            }
        }

        if (!meta) return null;

        // 3. Calculate dynamic data using Web Worker
        const dynamicData = await calculateDynamicData(meta, id);

        // 4. Construct final metadata object
        const trailer =
            meta?.trailer ||
            meta?.trailers?.[0]?.source ||
            meta?.trailers?.[0]?.url ||
            meta?.videos?.[0]?.url ||
            null;

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
            logo: `https://images.metahub.space/logo/small/${id}/img`,
            trailer,
            // Dynamic properties from Worker
            releaseDate: dynamicData.releaseDate,
            newTag: dynamicData.newTag,
        };

        // console.log(`[ETB] Loaded ${id} from ${source}`, metadata);
        return metadata;
    } catch (e) {
        console.error(`[ETB] Error in getMetadata for ${id}:`, e);
        return null;
    }
}

const RE_ID = /tt\d{7,}/;
const RE_TYPE = /\/(movie|series)\//i;

async function extractMediaInfo(element) {
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

    const img =
        element.previousElementSibling?.querySelector?.('img[src*="tt"]');
    if (img) {
        const idMatch = img.src.match(RE_ID);
        if (idMatch && idMatch[0]) {
            const id = idMatch[0];
            const meta = await db.get(id).catch(() => null);
            if (meta && meta.type) {
                return { id, type: meta.type };
            }
        }
    }

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
    titleBar.textContent = "";

    const mediaInfo = await extractMediaInfo(titleBar);

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

    titleBar.appendChild(fragment);

    const metadata = await getMetadata(mediaInfo.id, mediaInfo.type);
    metadataContainer.textContent = "";

    if (metadata) {
        if (metadata.logo) {
            const logoImg = document.createElement("img");
            logoImg.setAttribute("data-src", metadata.logo);
            logoImg.alt = metadata.title || originalTitle;
            logoImg.style.cssText =
                "max-width:75%;height:65px;object-fit:contain;";
            logoImg.classList.add("etb-logo-lazy");
            logoLazyObserver.observe(logoImg);
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
    ".title-bar-container-1Ba0x,[class*='title-bar-container'],[class*='titleBarContainer'],[class*='title-container']:not([class*='search-hints']),[class*='media-title']";

// Intersection Observer
const containerObservers = new WeakMap();
let globalObserver;

function getObserverFor(element) {
    // Find closest scrollable container
    // Common selectors for Stremio horizontal lists and our custom lists
    const container = element.closest(
        ".meta-items-container-qcuUA, .upcoming-groups-container, .scroll-container"
    );

    if (!container) {
        if (!globalObserver) {
            globalObserver = new IntersectionObserver(handleIntersection, {
                rootMargin: CONFIG.OBSERVER_MARGIN,
                threshold: 0.01,
            });
        }
        return globalObserver;
    }

    if (!containerObservers.has(container)) {
        const observer = new IntersectionObserver(handleIntersection, {
            root: container,
            rootMargin: CONFIG.OBSERVER_MARGIN,
            threshold: 0.01,
        });
        containerObservers.set(container, observer);
    }
    return containerObservers.get(container);
}

const logoLazyObserver = new IntersectionObserver(
    (entries) => {
        entries.forEach((entry) => {
            if (!entry.isIntersecting) return;

            const img = entry.target;
            const src = img.dataset.src;

            if (src && !img.src) {
                img.src = src;
                img.removeAttribute("data-src");
            }

            logoLazyObserver.unobserve(img);
        });
    },
    {
        rootMargin: "1000px 0px", // preload early for smooth load
        threshold: 0.01,
    }
);

function handleIntersection(entries, observer) {
    entries.forEach((entry) => {
        if (entry.isIntersecting) {
            const target = entry.target;
            if (!target.classList.contains("enhanced-title-bar")) {
                taskQueue.add(() => enhanceTitleBar(target));
                observer.unobserve(target);
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
        const observer = getObserverFor(el);
        observer.observe(el);
    }
}

function initObservers() {
    document.querySelectorAll(TITLE_BAR_SELECTOR).forEach(observeElement);

    if (typeof MutationObserver !== "undefined") {
        const mutationObserver = new MutationObserver((mutations) => {
            for (const m of mutations) {
                if (m.type === "childList" && m.addedNodes.length > 0) {
                    m.addedNodes.forEach((node) => {
                        if (node.nodeType !== Node.ELEMENT_NODE) return;

                        if (node.matches && node.matches(TITLE_BAR_SELECTOR)) {
                            observeElement(node);
                        }

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

async function init() {
    try {
        db = window.MetadataDB;
        injectStyles();
        initObservers();
    } catch (error) {
        console.error("[ETB] Failed to initialize:", error);
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}
