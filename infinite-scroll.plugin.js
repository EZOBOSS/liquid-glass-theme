/**
 * @name Infinite Scroll
 * @description Infinite scroll for homescreen.
 * @version 2.0.0
 * @author EZOBOSS
 */

(function () {
    class InfiniteScrollPlugin {
        static CONFIG = {
            FETCH_TIMEOUT: 5000,
            CACHE_TTL: 1000 * 60 * 60 * 12, // 12 hours
            CACHE_PREFIX: "scroll_cache_",
            CONTAINER_SELECTOR:
                ".meta-row-container-xtlB1 .meta-items-container-qcuUA",
            SCROLL: {
                FRICTION: 0.97,
                EASE: 0.02,
                WHEEL_FORCE: 0.35,
                MIN_VELOCITY: 0.05,
                THRESHOLD: 0.4,
                MAX_VELOCITY: 120,
            },
        };

        constructor() {
            console.log("[InfiniteScrollPlugin] Initializing...");

            // State
            this.memoryCache = new Map();
            this.idLookupSets = new Map();
            this.fetchProgress = {};
            this.observer = null;

            // Scroll State
            this.activeScrolls = new Set();
            this.isLoopRunning = false;

            // Bind methods
            this.globalTick = this.globalTick.bind(this);
            this.onHashChange = this.onHashChange.bind(this);

            this.init();
        }

        init() {
            window.addEventListener("hashchange", this.onHashChange);
            this.initObserver();
            // Try initial check
            this.findAndInitTracks();
        }

        onHashChange() {
            if (!this.isHomepage()) {
                console.log(
                    "[InfiniteScrollPlugin] Navigated away from homepage. Clearing state."
                );
                this.activeScrolls.clear();
                this.isLoopRunning = false;
                this.disconnectObserver();
            } else {
                console.log(
                    "[InfiniteScrollPlugin] Navigated to homepage. Re-checking."
                );
                if (!this.findAndInitTracks()) {
                    this.initObserver();
                }
            }
        }

        initObserver() {
            if (this.observer) return;

            console.log("[InfiniteScrollPlugin] Starting MutationObserver");
            this.observer = new MutationObserver((mutations) => {
                if (!this.isHomepage()) return;

                let shouldCheck = false;
                for (const m of mutations) {
                    if (m.addedNodes.length > 0) {
                        shouldCheck = true;
                        break;
                    }
                }

                if (shouldCheck) {
                    this.findAndInitTracks();
                }
            });

            this.observer.observe(document.body, {
                childList: true,
                subtree: true,
            });
        }

        disconnectObserver() {
            if (this.observer) {
                console.log(
                    "[InfiniteScrollPlugin] Disconnecting MutationObserver"
                );
                this.observer.disconnect();
                this.observer = null;
            }
        }

        // --- Observer & Track Detection ---

        isHomepage() {
            // Stremio homepage is usually #/ or just #
            const hash = window.location.hash;
            return !hash || hash === "#" || hash === "#/";
        }

        findAndInitTracks() {
            if (!this.isHomepage()) return false;

            const tracks = document.querySelectorAll(
                InfiniteScrollPlugin.CONFIG.CONTAINER_SELECTOR
            );

            // We need at least 5 tracks to match the original logic's hardcoded indices
            if (tracks.length > 4) {
                // Check if already initialized to prevent double logs/work
                if (tracks[1].dataset.wheelScrollInitialized === "true") {
                    this.disconnectObserver();
                    return true;
                }

                console.log(
                    "[InfiniteScrollPlugin] Tracks found. Initializing."
                );
                // Original logic:
                // track[1] -> Popular Movies (top)
                // track[2] -> Popular TV Shows (top)
                // track[3] -> Featured Movies (imdbRating)
                // track[4] -> Featured TV Shows (imdbRating)

                this.initWheelScroll(tracks[1], "top");
                this.initWheelScroll(tracks[2], "top");
                this.initWheelScroll(tracks[3], "imdbRating");
                this.initWheelScroll(tracks[4], "imdbRating");

                // Ensure observer is stopped if it was running
                this.disconnectObserver();
                return true;
            }
            return false;
        }

        // --- Scroll Logic ---

        globalTick() {
            if (this.activeScrolls.size === 0) {
                this.isLoopRunning = false;
                return;
            }

            const { FRICTION, EASE, MIN_VELOCITY, THRESHOLD } =
                InfiniteScrollPlugin.CONFIG.SCROLL;
            const updates = [];

            // Phase 1: Read & Calculate (No DOM writes here)
            for (const state of this.activeScrolls) {
                const { track, widthCache, scrollTarget, velocity } = state;

                // Re-read scrollWidth/clientWidth if needed, or rely on ResizeObserver cache
                // For strict separation, we rely on widthCache which is updated via ResizeObserver
                const maxScroll =
                    widthCache.scrollWidth - widthCache.clientWidth;
                const currentLeft = track.scrollLeft; // DOM Read
                const diff = state.scrollTarget - currentLeft;

                let newVelocity = state.velocity * FRICTION;
                let newTarget = state.scrollTarget + newVelocity;

                // Calculate next position
                const nextPos = Math.max(
                    0,
                    Math.min(currentLeft + diff * EASE, maxScroll)
                );

                // Check if we should stop
                const isStopped =
                    Math.abs(diff) <= THRESHOLD &&
                    Math.abs(newVelocity) <= MIN_VELOCITY;

                updates.push({
                    state,
                    nextPos,
                    newVelocity,
                    newTarget,
                    isStopped,
                    maxScroll,
                });
            }

            // Phase 2: Write (No DOM reads here)
            for (const update of updates) {
                const {
                    state,
                    nextPos,
                    newVelocity,
                    newTarget,
                    isStopped,
                    maxScroll,
                } = update;

                state.track.scrollLeft = nextPos; // DOM Write
                state.velocity = newVelocity;
                state.scrollTarget = newTarget;

                if (isStopped) {
                    this.activeScrolls.delete(state);
                    state.velocity = 0;
                    state.scrollTarget = state.track.scrollLeft;
                } else {
                    // Check for fetch trigger
                    const preloadOffset = state.widthCache.clientWidth * 2;
                    if (
                        nextPos + state.widthCache.clientWidth >=
                        maxScroll - preloadOffset
                    ) {
                        // Debounce fetch? The original didn't really debounce other than the loading flag
                        this.fetchMoreItems(
                            state.track,
                            state.type,
                            state.catalog
                        )
                            .then(() => {
                                // Update widths after fetch
                                state.widthCache.scrollWidth =
                                    state.track.scrollWidth;
                                state.widthCache.clientWidth =
                                    state.track.clientWidth;
                            })
                            .catch(console.error);
                    }
                }
            }

            if (this.activeScrolls.size > 0) {
                requestAnimationFrame(this.globalTick);
            } else {
                this.isLoopRunning = false;
            }
        }

        createScrollIndicator(track) {
            // Create the scroll indicator element
            const indicator = document.createElement("div");
            indicator.className = "infinite-scroll-indicator";

            // Create left and right arrow icons with unique IDs
            indicator.innerHTML = `
                <svg id="left-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin-right: 8px; transition: opacity 0.3s ease;">
                    <path d="M15 18L9 12L15 6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                <svg id="right-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin-left: 8px; transition: opacity 0.3s ease;">
                    <path d="M9 18L15 12L9 6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            `;

            // Style the indicator with glassmorphism - centered at bottom
            Object.assign(indicator.style, {
                position: "absolute",
                left: "50%",
                bottom: "0",
                transform: "translateX(-50%)",
                padding: "12px 20px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(0, 0, 0, 0.6)",
                backdropFilter: "blur(15px)",
                borderRadius: "30px",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)",
                pointerEvents: "none",
                zIndex: "10",
                opacity: "1",
                transition: "opacity 0.4s ease, transform 0.4s ease",
                color: "rgba(255, 255, 255, 0.9)",
                animation: "scroll-pulse 2.5s ease-in-out infinite",
            });

            // Add keyframe animation if not already added
            if (!document.querySelector("#scroll-indicator-animation")) {
                const style = document.createElement("style");
                style.id = "scroll-indicator-animation";
                style.textContent = `
                    @keyframes scroll-pulse {
                        0%, 100% { opacity: 0.7; transform: translateX(-50%) scale(1); }
                        50% { opacity: 1; transform: translateX(-50%) scale(1.05); }
                    }
                `;
                document.head.appendChild(style);
            }

            // Make track parent positioned if not already
            const trackParent = track.parentElement;
            if (
                trackParent &&
                getComputedStyle(trackParent).position === "static"
            ) {
                trackParent.style.position = "relative";
            }

            trackParent.appendChild(indicator);

            return indicator;
        }

        updateScrollIndicator(track, indicator) {
            const scrollLeft = track.scrollLeft;
            const maxScroll = track.scrollWidth - track.clientWidth;
            const threshold = 5; // Small threshold to account for rounding

            // Get the arrow elements
            const leftArrow = indicator.querySelector("#left-arrow");
            const rightArrow = indicator.querySelector("#right-arrow");

            // Hide entire indicator if there's no scrollable content
            if (maxScroll <= 0) {
                indicator.style.opacity = "0";
                return;
            }

            // Determine which arrows to show
            const atStart = scrollLeft <= threshold;
            const atEnd = scrollLeft >= maxScroll - threshold;

            // Control individual arrow visibility
            if (leftArrow) {
                leftArrow.style.opacity = atStart ? "0" : "1";
                leftArrow.style.display = atStart ? "none" : "block";
            }

            if (rightArrow) {
                rightArrow.style.opacity = atEnd ? "0" : "1";
                rightArrow.style.display = atEnd ? "none" : "block";
            }

            // Hide the entire indicator if both arrows are hidden
            if (atStart && atEnd) {
                indicator.style.opacity = "0";
            } else {
                indicator.style.opacity = "1";
            }
        }

        initWheelScroll(track, catalog = "top") {
            if (!track || track.dataset.wheelScrollInitialized === "true")
                return;
            track.dataset.wheelScrollInitialized = "true";

            // CSS Optimization
            track.style.willChange = "scroll-position";
            track.style.contain = "layout style";

            // Try to determine type from first child
            const type = track.firstChild?.href?.split?.("/")[5];
            if (!type) return;

            const key = `${type}_${catalog}`;
            this.fetchProgress[key] = 0;

            // Create scroll indicator
            const scrollIndicator = this.createScrollIndicator(track);

            // Initial State
            const state = {
                track,
                type,
                catalog,
                scrollTarget: track.scrollLeft,
                velocity: 0,
                widthCache: {
                    scrollWidth: track.scrollWidth,
                    clientWidth: track.clientWidth,
                },
                scrollIndicator,
            };

            const updateWidths = () => {
                state.widthCache.scrollWidth = track.scrollWidth;
                state.widthCache.clientWidth = track.clientWidth;
                // Update indicator visibility when widths change
                this.updateScrollIndicator(track, scrollIndicator);
            };

            const resizeObserver = new ResizeObserver(updateWidths);
            resizeObserver.observe(track);

            // Initial indicator update
            this.updateScrollIndicator(track, scrollIndicator);

            const handleWheel = (e) => {
                e.preventDefault();

                // Update widths just in case
                // updateWidths(); // Optional: might cause read, but usually safe in event handler

                const atStart = track.scrollLeft <= 0 && e.deltaY < 0;
                const atEnd =
                    track.scrollLeft + state.widthCache.clientWidth >=
                        state.widthCache.scrollWidth && e.deltaY > 0;

                if (atStart || atEnd) return;

                const { WHEEL_FORCE, MAX_VELOCITY } =
                    InfiniteScrollPlugin.CONFIG.SCROLL;

                state.velocity += e.deltaY * WHEEL_FORCE;
                state.velocity = Math.max(
                    -MAX_VELOCITY,
                    Math.min(state.velocity, MAX_VELOCITY)
                );

                // Add to active loop
                if (!this.activeScrolls.has(state)) {
                    // Reset target to current position to avoid jumps if re-engaging
                    state.scrollTarget = track.scrollLeft;
                    this.activeScrolls.add(state);

                    if (!this.isLoopRunning) {
                        this.isLoopRunning = true;
                        requestAnimationFrame(this.globalTick);
                    }
                }
            };

            track.addEventListener("wheel", handleWheel, { passive: false });

            // Sync state on manual scroll (e.g. drag)
            track.addEventListener(
                "scroll",
                () => {
                    if (!this.activeScrolls.has(state)) {
                        state.scrollTarget = track.scrollLeft;
                    }
                    // Update indicator on scroll
                    this.updateScrollIndicator(track, scrollIndicator);
                },
                { passive: true }
            );
        }

        // --- Fetching & Caching ---

        get cacheKey() {
            return (key) => InfiniteScrollPlugin.CONFIG.CACHE_PREFIX + key;
        }

        cacheSet(key, value) {
            const entry = { value, timestamp: Date.now() };
            this.memoryCache.set(key, entry);

            requestIdleCallback(() => {
                try {
                    localStorage.setItem(
                        this.cacheKey(key),
                        JSON.stringify(entry)
                    );
                } catch (e) {
                    console.warn("Cache quota exceeded");
                }
            });
        }

        cacheGet(key) {
            const now = Date.now();
            const mem = this.memoryCache.get(key);
            if (
                mem &&
                now - mem.timestamp < InfiniteScrollPlugin.CONFIG.CACHE_TTL
            )
                return mem.value;

            try {
                const raw = localStorage.getItem(this.cacheKey(key));
                if (!raw) return null;
                const data = JSON.parse(raw);
                if (
                    now - data.timestamp >
                    InfiniteScrollPlugin.CONFIG.CACHE_TTL
                ) {
                    localStorage.removeItem(this.cacheKey(key));
                    this.memoryCache.delete(key);
                    return null;
                }
                this.memoryCache.set(key, data);
                this.idLookupSets.set(
                    key,
                    new Set(data.value.map((i) => i.id))
                );
                return data.value;
            } catch {
                return null;
            }
        }

        async safeFetch(
            url,
            {
                timeout = InfiniteScrollPlugin.CONFIG.FETCH_TIMEOUT,
                retries = 1,
            } = {}
        ) {
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
        }

        mapToListItem(m, type) {
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

        async fetchCatalogTitles(type, limit = 10, catalog = "top") {
            if (!type)
                throw new Error("fetchCatalogTitles: 'type' is required");

            const key = `${type}_${catalog}`;
            const cacheKey = `catalog_${key}`;
            let allData = this.cacheGet(cacheKey) || [];
            const offset = this.fetchProgress[key] || 0;

            const baseUrl = `https://cinemeta-catalogs.strem.io/top/catalog/${type}/${catalog}`;
            let fetchUrl = `${baseUrl}.json`;

            if (!this.idLookupSets.has(cacheKey)) {
                this.idLookupSets.set(
                    cacheKey,
                    new Set(allData.map((i) => i.id))
                );
            }
            const seenIds = this.idLookupSets.get(cacheKey);

            const itemsRemainingInCache = allData.length - offset;
            const needsFetch =
                allData.length === 0 || itemsRemainingInCache <= limit;

            if (needsFetch) {
                const skip = allData.length + 10;
                if (skip > 0) {
                    fetchUrl = `${baseUrl}/skip=${skip}.json`;
                }

                console.log(
                    `[InfiniteScrollPlugin] Fetching data (skip=${skip}) for "${key}"`
                );

                try {
                    const json = await this.safeFetch(fetchUrl);

                    if (!json || !json.metas) {
                        if (allData.length > 0) {
                            console.log(
                                `[InfiniteScrollPlugin] End of catalog reached for "${key}"`
                            );
                            return [];
                        }
                        throw new Error(
                            "Invalid API response or empty catalog"
                        );
                    }

                    const newMetas = json.metas;
                    let filteredMetas = [];
                    for (const item of newMetas) {
                        if (!seenIds.has(item.id)) {
                            seenIds.add(item.id);
                            filteredMetas.push(this.mapToListItem(item, type));
                        }
                    }

                    allData = [...allData, ...filteredMetas];
                    this.cacheSet(cacheKey, allData);
                } catch (e) {
                    console.warn(
                        `[InfiniteScrollPlugin] fetch failed for ${key}`,
                        e
                    );
                    return [];
                }
            }

            const nextBatch = allData.slice(offset, offset + limit);
            this.fetchProgress[key] = offset + nextBatch.length;

            console.log(
                `[InfiniteScrollPlugin] Fetched offset ${offset}  for ${key}`
            );

            return nextBatch;
        }

        async fetchMoreItems(track, type = "movie", catalog = "top") {
            if (track.dataset.loading === "true") return;
            track.dataset.loading = "true";

            console.log("[InfiniteScrollPlugin] Fetching more items...");

            try {
                const items = await this.fetchCatalogTitles(type, 9, catalog);
                if (!items?.length) {
                    console.log(
                        "[InfiniteScrollPlugin] No more items to load."
                    );
                    return;
                }

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

                const fragment = document
                    .createRange()
                    .createContextualFragment(html);
                track.appendChild(fragment);
            } catch (err) {
                console.error("[InfiniteScrollPlugin] Fetch error", err);
            } finally {
                track.dataset.loading = "false";
            }
        }
    }

    // Initialize
    new InfiniteScrollPlugin();
})();
