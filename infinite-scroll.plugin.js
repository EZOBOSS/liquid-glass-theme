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
            href: `#/detail/${type}/${m.id}/${m.id}`,
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
        const type = track.firstChild.href.split("/")[5];

        const initialCount = track.children.length;
        const key = `${type}_${catalog}`;
        fetchProgress[key] = initialCount; // <-- START OFFSET HERE

        console.log(
            `[AppleTVWheelInfiniteScroll] Initialized track with ${initialCount} existing items`
        );

        const speedFactor = 2; // adjust scroll sensitivity

        const handleWheel = (e) => {
            //if (!e.ctrlKey) return; // optional: only scroll if Ctrl is pressed
            e.preventDefault();

            track.scrollLeft += e.deltaY * speedFactor;

            if (
                track.scrollLeft + track.clientWidth >=
                track.scrollWidth - 300
            ) {
                fetchMoreItems(track, type, catalog);
            }
        };

        track.addEventListener("wheel", handleWheel, { passive: false });
    }

    // --------------------------
    // Fetch next batch and append
    // --------------------------
    async function fetchMoreItems(track, type = "movie", catalog = "top") {
        if (track.dataset.loading === "true") return;
        track.dataset.loading = "true";

        console.log("[AppleTVWheelInfiniteScroll] Fetching more items...");

        try {
            const items = await fetchCatalogTitles(type, 6, catalog);

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
