/*
 * @name Infinite Scroll
 * @description Infinite scroll for homescreen.
 * @version 1.0.0
 * @author EZOBOSS
 */

(async function () {
    console.log("[AppleTVWheelInfiniteScroll] Loaded");

    // --------------------------
    // Config & helper functions
    // --------------------------
    const CONFIG = {
        FETCH_TIMEOUT: 5000,
    };

    const cache = new Map();
    const cacheGet = (k) => cache.get(k);
    const cacheSet = (k, v) => cache.set(k, v);
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
    // Fetch catalog titles with offset
    // --------------------------
    const fetchProgress = {}; // track current offset for each type

    async function fetchCatalogTitles(type, limit = 10) {
        const offset = fetchProgress[type] || 0;
        const cacheKey = `catalog_${type}`;
        let allData = cacheGet(cacheKey);

        // Fetch from API if not cached
        if (!allData) {
            const url = `https://cinemeta-catalogs.strem.io/top/catalog/${type}/top.json`;
            try {
                const json = await safeFetch(url, {
                    timeout: CONFIG.FETCH_TIMEOUT,
                    retries: 1,
                });
                allData = json.metas || [];
                cacheSet(cacheKey, allData);
            } catch (e) {
                logger.warn("fetchCatalogTitles failed", e);
                return [];
            }
        }

        // Slice the next batch
        const nextBatch = allData.slice(offset, offset + limit).map((m) => ({
            id: m.id,
            title: m.name,
            background: `https://images.metahub.space/background/large/${m.id}/img`,
            logo: `https://images.metahub.space/logo/medium/${m.id}/img`,
            description: m.description || `Discover ${m.name}`,
            year: m.year ? String(m.year) : "2024",
            runtime: m.runtime || null,
            type,
            href: `#/detail/${type}/${m.id}/${m.id}`,
        }));

        // Update offset
        fetchProgress[type] = offset + nextBatch.length;

        return nextBatch;
    }

    // --------------------------
    // Infinite scroll setup
    // --------------------------
    const containerSelector =
        ".meta-row-container-xtlB1 .meta-items-container-qcuUA";

    function initWheelScroll(track, fetchMoreItems) {
        if (!track || track.dataset.wheelScrollInitialized === "true") return;
        track.dataset.wheelScrollInitialized = "true";
        const type = "movie";
        const initialCount = track.children.length;
        console.log(initialCount);

        fetchProgress[type] = initialCount; // <-- START OFFSET HERE

        console.log(
            `[AppleTVWheelInfiniteScroll] Initialized track with ${initialCount} existing items`
        );

        const speedFactor = 2; // adjust scroll sensitivity

        const handleWheel = (e) => {
            if (!e.ctrlKey) return; // optional: only scroll if Ctrl is pressed
            e.preventDefault();

            track.scrollLeft += e.deltaY * speedFactor;

            if (
                track.scrollLeft + track.clientWidth >=
                track.scrollWidth - 300
            ) {
                fetchMoreItems(track);
            }
        };

        track.addEventListener("wheel", handleWheel, { passive: false });
    }

    // --------------------------
    // Fetch next batch and append
    // --------------------------
    async function fetchMoreItems(track, type = "movie") {
        if (track.dataset.loading === "true") return;
        track.dataset.loading = "true";

        console.log("[AppleTVWheelInfiniteScroll] Fetching more items...");

        try {
            const items = await fetchCatalogTitles(type, 6);

            if (items.length === 0) {
                console.log(
                    "[AppleTVWheelInfiniteScroll] No more items to load."
                );
                return;
            }

            // 1. Create a Document Fragment outside the loop
            const fragment = document.createDocumentFragment();

            items.forEach((meta) => {
                // Create the main link element
                const newItem = document.createElement("a");

                // Set classes and styles (Consider moving styles to CSS for better performance and separation of concerns)
                // Set attributes
                newItem.tabIndex = 0;
                newItem.title = meta.title;
                newItem.id = meta.id;
                newItem.href = meta.href;
                newItem.className =
                    "meta-item-container-Tj0Ib meta-row-container-xtlB1 poster-shape-poster-MEhNx";

                // Create inner structure
                const posterContainer = document.createElement("div");
                posterContainer.className = "poster-container-qkw48";

                const imageLayer = document.createElement("div");
                imageLayer.className = "poster-image-layer-KimPZ";

                const img = document.createElement("img");
                img.className = "poster-image-NiV7O";
                img.src = meta.background;
                img.alt = ""; // Set to empty string for purely decorative images
                img.loading = "lazy";

                const titleContainer = document.createElement("div");
                titleContainer.className = "title-bar-container-1Ba0x";
                const title = document.createElement("div");
                title.className = "title-label-VnEAc";
                title.textContent = meta.title;
                titleContainer.appendChild(title);

                // Combine structure
                imageLayer.appendChild(img);
                posterContainer.appendChild(imageLayer);
                newItem.appendChild(posterContainer);
                newItem.appendChild(titleContainer);

                // 2. Append the new item to the fragment, NOT the live DOM (track)
                fragment.appendChild(newItem);
            });

            // 3. Append the fragment to the DOM element in a single operation
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
        if (tracks.length > 1) {
            const track = tracks[1]; // second container
            initWheelScroll(track, fetchMoreItems);
        }
    }

    setInterval(() => {
        try {
            findAndInitTrack();
        } catch (err) {
            console.error(err);
        }
    }, 1500);

    console.log(
        "[AppleTVWheelInfiniteScroll] Interval started for",
        containerSelector
    );
})();
