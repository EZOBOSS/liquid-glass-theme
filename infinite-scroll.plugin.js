/*
 * @name Infinite Scroll
 * @description Infinite scroll for homescreen.
 * @version 1.1.0
 * @author EZOBOSS
 */

(async function () {
    console.log("[AppleTVWheelInfiniteScroll] Loaded");

    // --------------------------
    // Config & helper functions
    // --------------------------
    const CONFIG = {
        FETCH_TIMEOUT: 5000,
        CACHE_TTL: 1000 * 60 * 60 * 12, // 12 hour
        CACHE_PREFIX: "scroll_cache_",
    };

    // --------------------------
    // Caching (Memory + localStorage)
    // --------------------------

    const memoryCache = new Map();
    const idLookupSets = new Map();

    const cacheKey = (key) => CONFIG.CACHE_PREFIX + key;

    const cacheSet = (key, value) => {
        const entry = { value, timestamp: Date.now() };
        memoryCache.set(key, entry);

        requestIdleCallback(() => {
            try {
                localStorage.setItem(cacheKey(key), JSON.stringify(entry));
            } catch (e) {
                console.warn("Cache quota exceeded");
            }
        });
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
                memoryCache.delete(key);
                return null;
            }
            memoryCache.set(key, data);
            idLookupSets.set(key, new Set(data.value.map((i) => i.id)));
            return data.value;
        } catch {
            return null;
        }
    };

    const logger = {
        warn: (...a) => console.warn("[API]", ...a),
    };

    // --------------------------
    // Safe fetch with timeout/retries
    // --------------------------
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
    // Helper function to map the full API metadata to the minimal list item format
    function mapToListItem(m, type) {
        return {
            id: m.id,
            title: m.name,
            background: `https://images.metahub.space/background/large/${m.id}/img`,
            logo: `https://images.metahub.space/logo/medium/${m.id}/img`,
            description: m.description || `Discover ${m.name}`,
            year: String(m.year || "2024"),
            runtime: m.runtime || null,
            type: m.type || type,
            href:
                type === "movie"
                    ? `#/detail/${type}/${m.id}/${m.id}`
                    : `#/detail/${type}/${m.id}`,
        };
    }
    // --------------------------
    // Fetch catalog titles with per-type+catalog offset
    // --------------------------
    const fetchProgress = {}; // Track offsets per type+catalog combo

    async function fetchCatalogTitles(
        type,
        limit = 10,
        catalog = "top",
        track
    ) {
        if (!type) throw new Error("fetchCatalogTitles: 'type' is required");

        const key = `${type}_${catalog}`;
        const cacheKey = `catalog_${key}`;
        let allData = cacheGet(cacheKey) || []; // Initialize to empty array if not found
        const offset = fetchProgress[key] || 0;

        // Determine the base URL for the catalog
        const baseUrl = `https://cinemeta-catalogs.strem.io/top/catalog/${type}/${catalog}`;
        let fetchUrl = `${baseUrl}.json`;

        // Ensure we have the lookup set ready
        if (!idLookupSets.has(cacheKey)) {
            idLookupSets.set(cacheKey, new Set(allData.map((i) => i.id)));
        }
        const seenIds = idLookupSets.get(cacheKey);

        // ----------------------------------------------------------------------
        // 1. Determine if a new API fetch is needed
        // A fetch is needed if:
        // a) No data is cached (allData.length === 0)
        // b) The current offset exceeds the length of the cached data (allData is exhausted)
        // ----------------------------------------------------------------------
        const itemsRemainingInCache = allData.length - offset;

        // Check if the cache is empty OR if the items remaining are less than or equal to the limit
        const needsFetch =
            allData.length === 0 || itemsRemainingInCache <= limit;

        if (needsFetch) {
            const skip = allData.length + 10;

            if (skip > 0) {
                fetchUrl = `${baseUrl}/skip=${skip}.json`;
            }

            console.log(
                `[fetchCatalogTitles] Fetching data (skip=${skip}) for "${key}" → ${fetchUrl}`
            );

            try {
                const json = await safeFetch(fetchUrl, {
                    timeout: CONFIG.FETCH_TIMEOUT,
                    retries: 1,
                });

                if (!json || !json.metas) {
                    // If API returns no more metas (e.g., end of catalog), return what we have
                    if (allData.length > 0) {
                        console.log(
                            `[fetchCatalogTitles] End of catalog reached for "${key}"`
                        );
                        return []; // Indicate no new items, stopping further attempts
                    }
                    throw new Error("Invalid API response or empty catalog");
                }

                const newMetas = json.metas;
                let filteredMetas = [];
                for (const item of newMetas) {
                    // O(1) Lookup - Instant, no matter how big the list is
                    if (!seenIds.has(item.id)) {
                        seenIds.add(item.id);
                        filteredMetas.push(mapToListItem(item, type));
                    }
                }

                // 3. Append new, filtered data to the existing cache
                allData = [...allData, ...filteredMetas];
                cacheSet(cacheKey, allData);
            } catch (e) {
                logger.warn(
                    `[fetchCatalogTitles] failed for ${key} at skip=${skip}`,
                    e
                );
                return [];
            }
        } else {
            logger.warn(
                `[fetchCatalogTitles] Using cached data for "${key}" starting at offset ${offset}`
            );
        }

        // ----------------------------------------------------------------------
        // 4. Return the next batch from the (now possibly updated) allData
        // ----------------------------------------------------------------------

        const nextBatch = allData.slice(offset, offset + limit);

        // 5. Update offset for the next call
        fetchProgress[key] = offset + nextBatch.length;

        return nextBatch;
    }

    // --------------------------
    // Infinite scroll setup
    // --------------------------
    const containerSelector =
        ".meta-row-container-xtlB1 .meta-items-container-qcuUA";

    function initWheelScroll(track, catalog = "top") {
        if (!track || track.dataset.wheelScrollInitialized === "true") return;
        track.dataset.wheelScrollInitialized = "true";
        // CSS Optimization for GPU compositing
        track.style.willChange = "scroll-position";

        const type = track.firstChild?.href?.split?.("/")[5];
        if (!type) return;

        const key = `${type}_${catalog}`;
        fetchProgress[key] = 0;

        let scrollTarget = track.scrollLeft;
        let velocity = 0;
        let isScrolling = false;

        const friction = 0.97;
        const ease = 0.02;
        const wheelForce = 0.35;
        const minVelocity = 0.05;
        const threshold = 0.4;

        // --- CACHED WIDTHS (improved performance) ---
        let widthCache = {
            scrollWidth: track.scrollWidth,
            clientWidth: track.clientWidth,
        };

        const updateWidths = () => {
            widthCache.scrollWidth = track.scrollWidth;
            widthCache.clientWidth = track.clientWidth;
        };

        const resizeObserver = new ResizeObserver(updateWidths);
        resizeObserver.observe(track);

        const smoothScroll = () => {
            if (isScrolling) return;
            isScrolling = true;

            const tick = () => {
                // READS FIRST
                const maxScroll =
                    widthCache.scrollWidth - widthCache.clientWidth;
                const currentLeft = track.scrollLeft;
                const diff = scrollTarget - currentLeft;

                // WRITE after all reads → avoids layout thrash
                track.scrollLeft = Math.max(
                    0,
                    Math.min(currentLeft + diff * ease, maxScroll)
                );

                // Update velocity/momentum AFTER writing
                velocity *= friction;
                scrollTarget += velocity;

                if (
                    Math.abs(diff) > threshold ||
                    Math.abs(velocity) > minVelocity
                ) {
                    requestAnimationFrame(tick);
                } else {
                    isScrolling = false;
                    velocity = 0;
                    scrollTarget = track.scrollLeft;
                }
            };

            requestAnimationFrame(tick);
        };

        const handleWheel = (e) => {
            e.preventDefault();

            const atStart = track.scrollLeft <= 0 && e.deltaY < 0;
            const atEnd =
                track.scrollLeft + widthCache.clientWidth >=
                    widthCache.scrollWidth && e.deltaY > 0;

            if (atStart || atEnd) return;

            velocity += e.deltaY * wheelForce;
            velocity = Math.max(-120, Math.min(velocity, 120));

            if (!isScrolling) smoothScroll();
            const preloadOffset = widthCache.clientWidth * 2;

            if (
                track.scrollLeft + widthCache.clientWidth >=
                widthCache.scrollWidth - preloadOffset
            ) {
                fetchMoreItems(track, type, catalog)
                    .then(updateWidths)
                    .catch(console.error);
            }
        };

        track.addEventListener("wheel", handleWheel, { passive: false });

        // Sync scrollTarget on user/keyboard scroll
        track.addEventListener(
            "scroll",
            () => {
                if (!isScrolling) {
                    scrollTarget = track.scrollLeft;
                }
            },
            { passive: true }
        );
    }

    // --------------------------
    // Fetch next batch and append
    // --------------------------
    async function fetchMoreItems(track, type = "movie", catalog = "top") {
        if (track.dataset.loading === "true") return;
        track.dataset.loading = "true";

        console.log("[AppleTVWheelInfiniteScroll] Fetching more items...");

        try {
            const items = await fetchCatalogTitles(type, 9, catalog, track);
            if (!items?.length) {
                console.log(
                    "[AppleTVWheelInfiniteScroll] No more items to load."
                );
                return;
            }

            // --- 1. Build HTML strings instead of DOM nodes ---
            // This avoids hundreds of createElement() calls and is 2–4× faster in most browsers.
            let html = "";
            for (const meta of items) {
                html += `
                <a
                    id="${meta.id}"
                    href="${meta.href}"
                    title="${meta.title}"
                    tabindex="0"
                    class="meta-item-container-Tj0Ib meta-row-container-xtlB1 poster-shape-poster-MEhNx"
                >
                    <div class="poster-container-qkw48">
                        <div class="poster-image-layer-KimPZ">
                            <img
                                class="poster-image-NiV7O"
                                src="${meta.background}"
                                alt=""
                                loading="lazy"
                                decoding="async"
                            />
                        </div>
                    </div>
                    <div class="title-bar-container-1Ba0x">
                        <div class="title-label-VnEAc">${meta.title}</div>
                    </div>
                </a>`;
            }

            // --- 2. Use Range fragment for minimal DOM parsing ---
            const fragment = document
                .createRange()
                .createContextualFragment(html);

            // --- 3. Append all at once ---
            track.appendChild(fragment);
        } catch (err) {
            console.error("[AppleTVWheelInfiniteScroll] Fetch error", err);
        } finally {
            track.dataset.loading = "false";
        }
    }

    // --------------------------
    // Track detection & init loop
    // --------------------------
    function findAndInitTrack() {
        const tracks = document.querySelectorAll(containerSelector);

        if (tracks.length > 2) {
            const track = tracks[1]; // second container "Popular - Movies"
            const track2 = tracks[2]; // third container "Popular - TV Shows"
            const track3 = tracks[3]; // fourth container "Featured - Movies"
            const track4 = tracks[4]; // fifth container "Featured - TV Shows"
            initWheelScroll(track, "top");
            initWheelScroll(track2, "top");
            initWheelScroll(track3, "imdbRating");
            initWheelScroll(track4, "imdbRating");

            return true;
        }
        return false;
    }

    // Function to start the polling mechanism
    function startTrackPoller() {
        const intervalId = setInterval(() => {
            try {
                // Call the function and check its return value (true on success, false on failure)
                if (findAndInitTrack()) {
                    // Success: Clear the timer
                    clearInterval(intervalId);
                    console.log(
                        "[AppleTVWheelInfiniteScroll] Tracks initialized and polling stopped."
                    );
                } else {
                    // Failure: Log and wait for the next interval
                    console.log("Tracks not found yet, polling again...");
                }
            } catch (err) {
                console.error("Error during track initialization:", err);
            }
        }, 1500);
    }

    // Call the function to start the process
    startTrackPoller();
})();
