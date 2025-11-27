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
                WHEEL_FORCE: 0.4,
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

            // Lazy Loading Observer - preload images before they enter viewport
            this.lazyLoadObserver = new IntersectionObserver(
                (entries) => {
                    entries.forEach((entry) => {
                        if (entry.isIntersecting) {
                            const img = entry.target;
                            const src = img.dataset.src;
                            if (src && !img.src) {
                                img.src = src;
                                img.removeAttribute("data-src");
                                this.lazyLoadObserver.unobserve(img);
                            }
                        }
                    });
                },
                {
                    rootMargin: "2000px", // Start loading 2000px before entering viewport
                    threshold: 0,
                }
            );

            // Bind methods
            this.globalTick = this.globalTick.bind(this);
            this.onHashChange = this.onHashChange.bind(this);

            // Expose instance globally
            window.InfiniteScrollPluginInstance = this;

            this.init();
        }

        init() {
            this.clearExpiredCache();
            window.addEventListener("hashchange", this.onHashChange);
            this.initObserver();
            // Try initial check
            this.findAndInitTracks();
        }

        onHashChange() {
            if (!this.isHomepage()) {
                this.activeScrolls.clear();
                this.isLoopRunning = false;
                this.disconnectObserver();
            } else {
                if (!this.findAndInitTracks()) {
                    this.initObserver();
                }
            }
        }

        initObserver() {
            if (this.observer) return;

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

            // Ensure that DOM has loaded enough tracks
            if (tracks.length > 6) {
                // Check if already initialized to prevent double logs/work
                // Count how many tracks are already initialized
                let alreadyInitializedCount = 0;
                tracks.forEach((track) => {
                    if (track.dataset.wheelScrollInitialized === "true") {
                        alreadyInitializedCount++;
                    }
                });

                // If we already have 4+ initialized tracks, we're done
                if (alreadyInitializedCount >= 4) {
                    this.disconnectObserver();
                    return true;
                }

                console.log(
                    "[InfiniteScrollPlugin] Tracks found. Initializing."
                );

                // Dynamically detect tracks using header titles
                let initializedCount = 0;

                tracks.forEach((track) => {
                    // Find the neighboring header element
                    const headerContainer = track.parentElement?.querySelector(
                        ".header-container-tR3Ev .title-container-Mkwnq"
                    );

                    if (!headerContainer) return;

                    const titleText = headerContainer.textContent.trim();

                    // Determine catalog type based on title
                    let catalog = null;

                    if (titleText.toLowerCase().includes("popular")) {
                        catalog = "top";
                    } else if (titleText.toLowerCase().includes("featured")) {
                        catalog = "imdbRating";
                    }

                    // Only initialize if we detected a valid catalog type
                    if (catalog) {
                        this.initWheelScroll(track, catalog);
                        initializedCount++;
                    }
                });

                if (initializedCount >= 4) {
                    console.log(
                        `[InfiniteScrollPlugin] Successfully initialized ${initializedCount} tracks`
                    );
                    // Ensure observer is stopped if it was running
                    this.disconnectObserver();
                    return true;
                }
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
                const {
                    track,
                    widthCache,
                    scrollTarget,
                    velocity,
                    currentScroll,
                } = state;

                // Re-read scrollWidth/clientWidth if needed, or rely on ResizeObserver cache
                // For strict separation, we rely on widthCache which is updated via ResizeObserver
                const maxScroll =
                    widthCache.scrollWidth - widthCache.clientWidth;

                // Use cached scroll position instead of reading from DOM
                const currentLeft = currentScroll;
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
                state.currentScroll = nextPos; // Update cache
                state.velocity = newVelocity;
                state.scrollTarget = newTarget;

                // Update indicator with cached values to avoid it reading DOM
                state.scrollIndicator &&
                    this.updateScrollIndicator(
                        state.track,
                        state.scrollIndicator,
                        {
                            scrollLeft: nextPos,
                            scrollWidth: state.widthCache.scrollWidth,
                            clientWidth: state.widthCache.clientWidth,
                        }
                    );

                if (isStopped) {
                    this.activeScrolls.delete(state);
                    state.velocity = 0;
                    state.scrollTarget = state.track.scrollLeft;
                    state.currentScroll = state.track.scrollLeft; // Ensure sync
                } else {
                    // Check for fetch trigger
                    const preloadOffset = state.widthCache.clientWidth * 2;
                    if (
                        nextPos + state.widthCache.clientWidth >=
                        maxScroll - preloadOffset
                    ) {
                        if (!state.disableFetch) {
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

            // Create left arrow, scroll count, and right arrow
            indicator.innerHTML = `
                <svg class="scroll-arrow scroll-arrow-left" width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin-right: 8px; transition: opacity 0.3s ease;">
                    <path d="M15 18L9 12L15 6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                <span class="scroll-count" style="font-size: 14px; font-weight: 600; min-width: 30px; text-align: center;"></span>
                <svg class="scroll-arrow scroll-arrow-right" width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin-left: 8px; transition: opacity 0.3s ease;">
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

            // Add keyframe animation and CSS classes if not already added
            if (!document.querySelector("#scroll-indicator-animation")) {
                const style = document.createElement("style");
                style.id = "scroll-indicator-animation";
                style.textContent = `
                    @keyframes scroll-pulse {
                        0%, 100% { opacity: 0.7; transform: translateX(-50%) scale(1); }
                        50% { opacity: 1; transform: translateX(-50%) scale(1.05); }
                    }
                    .scroll-arrow-hidden { opacity: 0 !important; display: none !important; }
                    .scroll-count-hidden { display: none !important; }
                    .scroll-indicator-hidden { opacity: 0 !important; }
                `;
                document.head.appendChild(style);
            }

            // Cache child element references for performance
            indicator._leftArrow =
                indicator.querySelector(".scroll-arrow-left");
            indicator._rightArrow = indicator.querySelector(
                ".scroll-arrow-right"
            );
            indicator._scrollCount = indicator.querySelector(".scroll-count");

            // Initialize state tracking for preventing redundant updates
            indicator._lastState = {
                currentItem: -1,
                atStart: null,
                atEnd: null,
                totalItems: 0,
                itemWidth: 0,
            };

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

        updateScrollIndicator(track, indicator, values = null) {
            // PHASE 1: READ ALL LAYOUT PROPERTIES FIRST (batched reads)
            // If values are provided (from globalTick), use them to avoid DOM reads
            const scrollLeft = values ? values.scrollLeft : track.scrollLeft;
            const scrollWidth = values ? values.scrollWidth : track.scrollWidth;
            const clientWidth = values ? values.clientWidth : track.clientWidth;
            const childrenLength = track.children.length;

            // Use cached element references (no querySelector needed!)
            const leftArrow = indicator._leftArrow;
            const rightArrow = indicator._rightArrow;
            const scrollCount = indicator._scrollCount;
            const lastState = indicator._lastState;

            // Read current class states
            const isIndicatorHidden = indicator.classList.contains(
                "scroll-indicator-hidden"
            );

            const threshold = 5;
            const maxScroll = scrollWidth - clientWidth;

            // PHASE 2: CALCULATE (no DOM access)
            // Hide entire indicator if there's no scrollable content
            if (maxScroll <= 0) {
                if (!isIndicatorHidden) {
                    indicator.classList.add("scroll-indicator-hidden");
                }
                return;
            }

            // Recalculate totalItems and itemWidth only if they've changed
            let itemWidth = lastState.itemWidth;
            if (childrenLength !== lastState.totalItems) {
                lastState.totalItems = childrenLength;
                itemWidth =
                    childrenLength > 0 ? scrollWidth / childrenLength : 0;
                lastState.itemWidth = itemWidth;
            }

            // Calculate current item using cached values
            let currentItem = 1;
            if (lastState.totalItems > 0 && itemWidth > 0) {
                currentItem = Math.min(
                    Math.floor(scrollLeft / itemWidth) + 1,
                    lastState.totalItems
                );
            }

            // Determine arrow visibility
            const atStart = scrollLeft <= threshold;
            const atEnd = scrollLeft >= maxScroll - threshold;
            const shouldHideIndicator = atStart && atEnd;

            // PHASE 3: WRITE ALL DOM CHANGES (batched writes)
            // Show indicator if it was hidden and there's scrollable content
            if (isIndicatorHidden && !shouldHideIndicator) {
                indicator.classList.remove("scroll-indicator-hidden");
            }

            // Update scroll count only if changed
            if (currentItem !== lastState.currentItem) {
                lastState.currentItem = currentItem;

                if (currentItem > 1) {
                    scrollCount.textContent = `${currentItem}`;
                    scrollCount.classList.remove("scroll-count-hidden");
                } else {
                    scrollCount.classList.add("scroll-count-hidden");
                }
            }

            // Update left arrow only if state changed
            if (atStart !== lastState.atStart) {
                lastState.atStart = atStart;
                if (atStart) {
                    leftArrow.classList.add("scroll-arrow-hidden");
                } else {
                    leftArrow.classList.remove("scroll-arrow-hidden");
                }
            }

            // Update right arrow only if state changed
            if (atEnd !== lastState.atEnd) {
                lastState.atEnd = atEnd;
                if (atEnd) {
                    rightArrow.classList.add("scroll-arrow-hidden");
                } else {
                    rightArrow.classList.remove("scroll-arrow-hidden");
                }
            }

            // Hide entire indicator if both arrows are hidden
            if (shouldHideIndicator && !isIndicatorHidden) {
                indicator.classList.add("scroll-indicator-hidden");
            }
        }

        initWheelScroll(track, catalog = "top", options = {}) {
            if (!track || track.dataset.wheelScrollInitialized === "true")
                return;
            track.dataset.wheelScrollInitialized = "true";

            // CSS Optimization
            track.style.willChange = "scroll-position";
            track.style.contain = "layout style";

            // Try to determine type from first child
            let type = track.firstChild?.href?.split?.("/")[5];

            // Allow type override from options if not found in DOM
            if (!type && options.type) {
                type = options.type;
            }

            if (!type && !options.disableFetch) return; // Only require type if fetching is enabled

            const key = `${type}_${catalog}`;
            this.fetchProgress[key] = 0;

            // Create scroll indicator
            const scrollIndicator = options.disableScrollIndicator
                ? null
                : this.createScrollIndicator(track);

            // Initial State
            const state = {
                track,
                type,
                catalog,
                disableFetch: !!options.disableFetch,
                scrollTarget: track.scrollLeft,
                currentScroll: track.scrollLeft, // Cache initial scroll
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
                scrollIndicator &&
                    this.updateScrollIndicator(track, scrollIndicator);
            };

            const resizeObserver = new ResizeObserver(updateWidths);
            resizeObserver.observe(track);

            // Initial indicator update
            scrollIndicator &&
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
                    state.currentScroll = track.scrollLeft; // Sync cache
                    this.activeScrolls.add(state);

                    if (!this.isLoopRunning) {
                        this.isLoopRunning = true;
                        requestAnimationFrame(this.globalTick);
                    }
                }
            };

            track.addEventListener("wheel", handleWheel, { passive: false });

            // Throttle scroll updates with requestAnimationFrame
            let rafPending = false;

            // Sync state on manual scroll (e.g. drag)
            track.addEventListener(
                "scroll",
                () => {
                    // If this scroll is being driven by our physics loop, ignore it
                    // to prevent "Write (globalTick) -> Read (scroll listener)" thrashing
                    if (this.activeScrolls.has(state)) {
                        // Check if user interference happened (large discrepancy)
                        const diff = Math.abs(
                            track.scrollLeft - state.currentScroll
                        );
                        if (diff > 5) {
                            // User likely dragged the scrollbar or touched
                            state.scrollTarget = track.scrollLeft;
                            state.currentScroll = track.scrollLeft;
                            state.velocity = 0;
                        }
                        return;
                    }

                    if (!this.activeScrolls.has(state)) {
                        state.scrollTarget = track.scrollLeft;
                        state.currentScroll = track.scrollLeft;
                    }

                    // Throttle indicator updates to once per frame
                    if (!rafPending) {
                        rafPending = true;
                        requestAnimationFrame(() => {
                            scrollIndicator &&
                                this.updateScrollIndicator(
                                    track,
                                    scrollIndicator
                                );
                            rafPending = false;
                        });
                    }
                },
                { passive: true }
            );
        }

        // --- Fetching & Caching ---

        cacheKey(key) {
            return InfiniteScrollPlugin.CONFIG.CACHE_PREFIX + key;
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

        clearExpiredCache() {
            // Run cache cleanup during idle time to avoid blocking the main thread
            requestIdleCallback(() => {
                const now = Date.now();
                const prefix = InfiniteScrollPlugin.CONFIG.CACHE_PREFIX;
                let clearedCount = 0;

                try {
                    const keysToRemove = [];

                    // Iterate through localStorage to find expired cache entries
                    for (let i = 0; i < localStorage.length; i++) {
                        const storageKey = localStorage.key(i);
                        if (storageKey && storageKey.startsWith(prefix)) {
                            try {
                                const raw = localStorage.getItem(storageKey);
                                if (raw) {
                                    const data = JSON.parse(raw);
                                    if (
                                        now - data.timestamp >
                                        InfiniteScrollPlugin.CONFIG.CACHE_TTL
                                    ) {
                                        keysToRemove.push(storageKey);
                                    }
                                }
                            } catch (e) {
                                // If parsing fails, remove the corrupted entry
                                keysToRemove.push(storageKey);
                            }
                        }
                    }

                    // Remove expired entries
                    keysToRemove.forEach((key) => {
                        localStorage.removeItem(key);
                        clearedCount++;
                    });

                    if (clearedCount > 0) {
                        console.log(
                            `[InfiniteScrollPlugin] Cleared ${clearedCount} expired cache entries`
                        );
                    }
                } catch (e) {
                    console.warn(
                        "[InfiniteScrollPlugin] Error clearing expired cache:",
                        e
                    );
                }
            });
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
                    `[InfiniteScrollPlugin] Fetching fresh data (skip=${skip}) for "${key}"`
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

            return nextBatch;
        }

        async fetchMoreItems(track, type = "movie", catalog = "top") {
            if (track.dataset.loading === "true") return;
            track.dataset.loading = "true";

            console.log("[InfiniteScrollPlugin] Fetching more items...");

            try {
                const items = await this.fetchCatalogTitles(type, 15, catalog);
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
                                    class="poster-image-NiV7O lazy-load-img"
                                    data-src="${meta.background}"
                                    alt=""
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

                requestAnimationFrame(() => {
                    track.appendChild(fragment);

                    // Observe all newly added images for lazy loading
                    const newImages = track.querySelectorAll(
                        ".lazy-load-img[data-src]"
                    );
                    newImages.forEach((img) => {
                        this.lazyLoadObserver.observe(img);
                    });
                });
            } catch (err) {
                console.error("[InfiniteScrollPlugin] Fetch error", err);
            } finally {
                track.dataset.loading = "false";
            }
        }
    }

    // Initialize on idle callback to avoid blocking main thread
    requestIdleCallback(() => {
        new InfiniteScrollPlugin();
    });
})();
