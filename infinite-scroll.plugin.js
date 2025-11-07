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
        CACHE_TTL: 1000 * 60 * 60 * 6, // 6 hour
        CACHE_PREFIX: "scroll_cache_",
    };

    // --------------------------
    // Caching (Memory + localStorage)
    // --------------------------

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

    // --------------------------
    // Fetch catalog titles with per-type+catalog offset
    // --------------------------
    const fetchProgress = {}; // Track offsets per type+catalog combo

    async function fetchCatalogTitles(type, limit = 10, catalog = "top") {
        if (!type) throw new Error("fetchCatalogTitles: 'type' is required");

        const key = `${type}_${catalog}`;
        const cacheKey = `catalog_${key}`;
        let allData = cacheGet(cacheKey);
        const offset = fetchProgress[key] || 0;

        // Fetch from API if not cached
        if (!allData || !Array.isArray(allData) || allData.length === 0) {
            const url = `https://cinemeta-catalogs.strem.io/top/catalog/${type}/${catalog}.json`;
            console.log(
                `[fetchCatalogTitles] Fetching fresh data for "${key}" → ${url} ${fetchProgress[key]}`
            );

            try {
                const json = await safeFetch(url, {
                    timeout: CONFIG.FETCH_TIMEOUT,
                    retries: 1,
                });

                if (!json || !json.metas)
                    throw new Error("Invalid API response");
                allData = json.metas;
                cacheSet(cacheKey, allData);
            } catch (e) {
                logger.warn(`[fetchCatalogTitles] failed for ${key}`, e);
                return [];
            }
        } else {
            logger.warn(
                `[fetchCatalogTitles] Using cached data for "${key}" → ${fetchProgress[key]}`
            );
        }

        const nextBatch = allData.slice(offset, offset + limit).map((m) => ({
            id: m.id,
            title: m.name,
            background: `https://images.metahub.space/background/large/${m.id}/img`,
            logo: `https://images.metahub.space/logo/medium/${m.id}/img`,
            description: m.description || `Discover ${m.name}`,
            year: String(m.year || "2024"),
            runtime: m.runtime || null,
            type,
            href:
                type === "movie"
                    ? `#/detail/${type}/${m.id}/${m.id}`
                    : `#/detail/${type}/${m.id}`,
        }));

        // Update offset
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

        const type = track.firstChild?.href?.split?.("/")[5];
        if (!type) return;

        const initialCount = track.children.length;
        const key = `${type}_${catalog}`;
        // Assuming fetchProgress is defined and accessible
        fetchProgress[key] = initialCount;

        let scrollTarget = track.scrollLeft;
        let velocity = 0;
        let isScrolling = false;
        // Removed lastWheelTime as throttling is counter-productive for input

        const friction = 0.95;
        const ease = 0.12;
        const minVelocity = 0.1;
        const threshold = 0.5;

        const smoothScroll = () => {
            scrollTarget = Math.max(
                0,
                Math.min(scrollTarget, track.scrollWidth - track.clientWidth)
            );

            const currentLeft = track.scrollLeft;
            const diff = scrollTarget - currentLeft;

            // DOM Write: main performance hit
            track.scrollLeft = currentLeft + diff * ease;

            velocity *= friction;
            scrollTarget += velocity;

            if (
                Math.abs(diff) > threshold ||
                Math.abs(velocity) > minVelocity
            ) {
                requestAnimationFrame(smoothScroll);
            } else {
                isScrolling = false;
                velocity = 0;
                // Synchronize the target position when momentum ends
                scrollTarget = track.scrollLeft;
            }
        };

        const handleWheel = (e) => {
            e.preventDefault();

            // OPTIMIZATION: Check for track boundaries to stop velocity accumulation
            const isAtStart = track.scrollLeft <= 0 && e.deltaY < 0;
            const isAtEnd =
                track.scrollLeft + track.clientWidth >= track.scrollWidth &&
                e.deltaY > 0;

            if (!isAtStart && !isAtEnd) {
                velocity += e.deltaY * 0.2;
                // Velocity clamping for robustness
                velocity = Math.max(-100, Math.min(velocity, 100));
            }

            if (!isScrolling) {
                isScrolling = true;
                requestAnimationFrame(smoothScroll);
            }

            if (
                track.scrollLeft + track.clientWidth >=
                track.scrollWidth - 300
            ) {
                // Note: This fetchMoreItems must be non-blocking (async) and should
                // append elements in a way that minimizes DOM reflows (e.g., DocumentFragment).
                fetchMoreItems(track, type, catalog);
            }
        };

        track.addEventListener("wheel", handleWheel, { passive: false });

        // FIX: Synchronize scrollTarget when the user manually scrolls
        track.addEventListener(
            "scroll",
            () => {
                if (!isScrolling) {
                    scrollTarget = track.scrollLeft;
                }
            },
            {
                passive: true,
            }
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
            const items = await fetchCatalogTitles(type, 9, catalog);
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
                                loading="eager"
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

        console.log(
            "[AppleTVWheelInfiniteScroll] Interval started for",
            containerSelector
        );
    }

    // Call the function to start the process
    startTrackPoller();
})();
