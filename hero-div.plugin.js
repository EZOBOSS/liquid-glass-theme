/*
 * @name Dynamic Hero
 * @description Netflix-style rotating hero banner.
 * @version 2.0.0
 * @author Fxy, EZOBOSS
 */

(function () {
    // -------------------------
    // Configuration
    // -------------------------
    const CONFIG = {
        ROTATION_INTERVAL: 8000,
        FETCH_TIMEOUT: 10000,
        DETAIL_TIMEOUT: 5000,
        MAX_RETRIES: 2,
        BATCH_SIZE: 6, // concurrent detail fetches
        CACHE_TTL_MS: 1000 * 60 * 5, // 5 minutes
        LOG_LEVEL: "debug", // 'silent'|'debug'|'info'
    };

    // -------------------------
    // Lightweight logger
    // -------------------------
    const logger = {
        debug: (...args) =>
            CONFIG.LOG_LEVEL === "debug" && console.debug("[Hero]", ...args),
        info: (...args) =>
            (CONFIG.LOG_LEVEL === "debug" || CONFIG.LOG_LEVEL === "info") &&
            console.info("[Hero]", ...args),
        warn: (...args) => console.warn("[Hero]", ...args),
        error: (...args) => console.error("[Hero]", ...args),
    };

    // -------------------------
    // Utilities
    // -------------------------
    const debounce = (fn, wait = 200) => {
        let t;
        return (...args) => {
            clearTimeout(t);
            t = setTimeout(() => fn(...args), wait);
        };
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

    const cacheKey = (k) => `hero_cache_${k}`;
    const cacheSet = (k, v) => {
        try {
            sessionStorage.setItem(
                cacheKey(k),
                JSON.stringify({ t: Date.now(), v })
            );
        } catch (e) {
            logger.debug("Cache set failed", e);
        }
    };
    const cacheGet = (k) => {
        try {
            const raw = sessionStorage.getItem(cacheKey(k));
            if (!raw) return null;
            const { t, v } = JSON.parse(raw);
            if (Date.now() - t > CONFIG.CACHE_TTL_MS) {
                sessionStorage.removeItem(cacheKey(k));
                return null;
            }
            return v;
        } catch (e) {
            logger.debug("Cache get failed", e);
            return null;
        }
    };
    function getDaysSinceRelease(releaseDateStr) {
        if (!releaseDateStr) return "";

        const releaseDate = new Date(releaseDateStr);
        const today = new Date();

        // Normalize both to midnight to avoid partial-day rounding issues
        releaseDate.setHours(0, 0, 0, 0);
        today.setHours(0, 0, 0, 0);

        const diffMs = today - releaseDate;
        const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

        if (diffDays === 0) return "Released today";
        if (diffDays > 0)
            return `Released ${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
        return `Releases in ${Math.abs(diffDays)} day${
            Math.abs(diffDays) > 1 ? "s" : ""
        }`;
    }

    // -------------------------
    // Fallback titles
    // -------------------------
    const FALLBACK_TITLES = [
        {
            id: "tt0903747",
            title: "Breaking Bad",
            background:
                "https://images.metahub.space/background/large/tt0903747/img",
            logo: "https://images.metahub.space/logo/medium/tt0903747/img",
            description: "A chemistry teacher...",
            year: "2008",
            duration: "45 min",
            seasons: "5 seasons",
            rating: "9.5",
            numericRating: 9.5,
            type: "series",
        },
        {
            id: "tt1375666",
            title: "Inception",
            background:
                "https://images.metahub.space/background/large/tt1375666/img",
            logo: "https://images.metahub.space/logo/medium/tt1375666/img",
            description: "A thief who steals...",
            year: "2010",
            duration: "148 min",
            seasons: "Movie",
            rating: "8.8",
            numericRating: 8.8,
            type: "movie",
        },
        {
            id: "tt0468569",
            title: "The Dark Knight",
            background:
                "https://images.metahub.space/background/large/tt0468569/img",
            logo: "https://images.metahub.space/logo/medium/tt0468569/img",
            description: "When the menace known as the Joker...",
            year: "2008",
            duration: "152 min",
            seasons: "Movie",
            rating: "9.0",
            numericRating: 9.0,
            type: "movie",
        },
    ];

    // -------------------------
    // State
    // -------------------------
    const state = {
        heroTitles: [],
        currentIndex: 0,
        isAutoRotating: true,
        autoRotateTimer: null,
        autoRotateInterval: null,
        observers: [],
        ytPlayer: null,
        isInitializing: false,
        retryCount: 0,
    };

    // -------------------------
    // DOM helpers (cache once hero is created)
    // -------------------------
    const DOM = {};
    function cacheDOM() {
        DOM.hero = document.querySelector(".hero-container");
        if (!DOM.hero) return;
        DOM.heroOverlay = DOM.hero.querySelector(".hero-overlay");
        DOM.heroImage = DOM.hero.querySelector("#heroImage");
        DOM.heroLogo = DOM.hero.querySelector("#heroLogo");
        DOM.heroDescription = DOM.hero.querySelector("#heroDescription");
        DOM.heroInfo = DOM.hero.querySelector("#heroInfo");
        DOM.autoToggle = DOM.hero.querySelector("#autoToggle");
        DOM.indicators = DOM.hero.querySelector(".hero-indicators");
        DOM.heroButtonWatch = DOM.hero.querySelector(
            ".hero-overlay-button-watch"
        );
        DOM.heroButtonMoreInfo = DOM.hero.querySelector(".hero-overlay-button");
        DOM.heroIndicators = DOM.hero.querySelector(".hero-indicators");
        DOM.cardContainer = DOM.hero.querySelector(".board-content-nPWv1");
    }

    // -------------------------
    // API & metadata
    // -------------------------
    async function fetchCatalogTitles(type, limit = 10) {
        const cache = cacheGet(`catalog_${type}`);
        if (cache) {
            console.log("fetched cache", cache);
            return cache;
        }

        const url = `https://cinemeta-catalogs.strem.io/top/catalog/${type}/top.json`;
        try {
            const json = await safeFetch(url, {
                timeout: CONFIG.FETCH_TIMEOUT,
                retries: 1,
            });
            const metas = (json.metas || []).slice(0, limit).map((m) => ({
                id: m.id,
                title: m.name,
                background: `https://images.metahub.space/background/large/${m.id}/img`,
                logo: `https://images.metahub.space/logo/medium/${m.id}/img`,
                description: m.description || `Discover ${m.name}`,
                year: m.year ? String(m.year) : "2024",
                runtime: m.runtime || null,
                type,
            }));
            cacheSet(`catalog_${type}`, metas);
            return metas;
        } catch (e) {
            logger.warn("fetchCatalogTitles failed", e);
            return [];
        }
    }

    async function getDetailedMetaData(id, type) {
        const cache = cacheGet(`meta_${id}`);
        if (cache) return cache;
        try {
            const json = await safeFetch(
                `https://v3-cinemeta.strem.io/meta/${type}/${id}.json`,
                { timeout: CONFIG.DETAIL_TIMEOUT, retries: 1 }
            );
            const meta = json.meta;
            if (!meta) return null;
            const actualType =
                meta.type ||
                (meta.videos && meta.videos.length ? "series" : type);
            const duration = meta.runtime
                ? `${meta.runtime}`
                : actualType === "series"
                ? "45 min per episode"
                : "Unknown";
            const releaseDate = (() => {
                // If videos array exists and has at least one item, use the last item's release date
                if (meta.videos && meta.videos.length > 0) {
                    // Get the next to last episode incase upcoming season is undefined
                    const lastIndex = meta.videos.length - 1;
                    const lastVideo = meta.videos[lastIndex].released
                        ? meta.videos[lastIndex]
                        : meta.videos[lastIndex - 1];

                    return getDaysSinceRelease(lastVideo?.released || null);
                }

                // Otherwise, fallback to meta.released
                return getDaysSinceRelease(meta.released || null);
            })();

            const seasons = (() => {
                if (actualType === "movie") return "Movie";
                if (meta.videos && meta.videos.length) {
                    const seasonSet = new Set(
                        meta.videos.map((v) => v.season).filter(Boolean)
                    );
                    if (seasonSet.size > 1) return `${seasonSet.size} seasons`;
                    return `${meta.videos.length} episodes`;
                }
                return "Series";
            })();
            const result = {
                year: meta.year ? String(meta.year) : "2024",
                duration,
                rating: meta.imdbRating || "na",
                numericRating: parseFloat(meta.imdbRating) || 0,
                seasons,
                description: meta.description || `Discover ${meta.name}`,
                type: actualType,
                genres: meta.genre || meta.genres || [],
                cast: meta.cast || [],
                director: Array.isArray(meta.director)
                    ? meta.director.join(", ")
                    : meta.director || "",
                awards: meta.awards || "",
                releaseDate,
            };
            cacheSet(`meta_${id}`, result);
            return result;
        } catch (e) {
            logger.warn("getDetailedMetaData failed", id, e);
            return null;
        }
    }

    // Batched details fetch using Promise.allSettled with limited concurrency
    async function enrichTitles(titles) {
        // Map to promises but chunk to avoid too many concurrent requests
        const chunks = [];
        for (let i = 0; i < titles.length; i += CONFIG.BATCH_SIZE)
            chunks.push(titles.slice(i, i + CONFIG.BATCH_SIZE));
        const enriched = [];
        for (const chunk of chunks) {
            const promises = chunk.map(async (t) => {
                const details = await getDetailedMetaData(t.id, t.type);
                if (details) Object.assign(t, details);
                return t;
            });
            const settled = await Promise.allSettled(promises);
            settled.forEach((s) => {
                if (s.status === "fulfilled") enriched.push(s.value);
            });
        }
        return enriched;
    }

    async function collectTitlesFromAPI() {
        const cached = cacheGet("hero_titles");
        if (cached) {
            logger.info("fetched cached titles", cached);
            return cached;
        }
        logger.info("Collecting titles from API");
        try {
            const [movies, series] = await Promise.all([
                fetchCatalogTitles("movie", 8),
                fetchCatalogTitles("series", 8),
            ]);
            // interleave
            const result = [];
            let m = 0,
                s = 0,
                expectMovie = true;
            while (
                result.length < 10 &&
                (m < movies.length || s < series.length)
            ) {
                let pick = null;
                if (expectMovie && m < movies.length) pick = movies[m++];
                else if (!expectMovie && s < series.length) pick = series[s++];
                else if (m < movies.length) pick = movies[m++];
                else if (s < series.length) pick = series[s++];
                expectMovie = !expectMovie;
                if (pick) result.push(pick);
            }
            const enriched = await enrichTitles(result);
            cacheSet("hero_titles", enriched);
            return enriched;
        } catch (e) {
            logger.warn("collectTitlesFromAPI failed", e);
            return [];
        }
    }

    // -------------------------
    // UI: Create and update hero
    // -------------------------
    function createHeroHTML(title, titles) {
        const info = [title.year].filter(Boolean);
        if (title.duration && title.duration !== "Unknown")
            info.push(title.duration);
        if (title.seasons && title.seasons !== "Unknown")
            info.push(title.seasons);
        if (title.releaseDate && title.releaseDate !== "")
            info.push(title.releaseDate);

        const ratingHTML =
            title.rating && title.rating !== "na"
                ? `<p class="rating-item"><span class="rating-text">⭐ ${title.rating}/10</span></p>`
                : "";

        const indicators = (titles || state.heroTitles)
            .map(
                (_, i) =>
                    `<div class="hero-indicator ${
                        i === state.currentIndex ? "active" : ""
                    }" data-index="${i}" aria-label="Go to ${i + 1}"></div>`
            )
            .join("");

        return `
      <div class="hero-container" role="region" aria-label="Featured">
        <img id="heroImage" class="hero-image" src="${title.background}" alt="${
            title.title
        } background" />
        <div class="hero-overlay">
          <img id="heroLogo" class="hero-overlay-image" src="${
              title.logo
          }" alt="${title.title} logo" />
          <p id="heroDescription" class="hero-overlay-description">${
              title.description
          }</p>
          <div id="heroInfo" class="hero-overlay-info">${info
              .map((i) => `<p>${i}</p>`)
              .join("")}${ratingHTML}</div>
          <div class="hero-overlay-actions">
            <button class="hero-overlay-button-watch" id="watchBtn">▶ Watch Now</button>
            <button class="hero-overlay-button" id="infoBtn">ⓘ More Info</button>
          </div>
        </div>
        <div class="hero-controls">
          <button id="autoToggle">${
              state.isAutoRotating ? "Pause" : "Play"
          }</button>
          <button id="prevBtn">◀</button>
          <button id="nextBtn">▶</button>
        </div>
        <div class="hero-indicators">${indicators}</div>
      </div>
    `;
    }

    function mountHeroTo(parent, initialTitle) {
        // Remove any existing hero
        const existing = parent.querySelector(".hero-container");
        if (existing) existing.remove();
        parent.insertAdjacentHTML("afterbegin", createHeroHTML(initialTitle));
        cacheDOM();

        // wire events
        if (DOM.hero) {
            DOM.heroOverlay.addEventListener("mouseenter", () =>
                stopAutoRotate()
            );
            DOM.heroOverlay.addEventListener("mouseleave", () => {
                startAutoRotate();
            });

            document
                .getElementById("nextBtn")
                ?.addEventListener("click", nextTitle);
            document
                .getElementById("prevBtn")
                ?.addEventListener("click", previousTitle);
            document
                .getElementById("autoToggle")
                ?.addEventListener("click", toggleAutoRotate);
            document
                .getElementById("watchBtn")
                ?.addEventListener("click", () =>
                    playTitle(state.heroTitles[state.currentIndex]?.id)
                );
            document
                .getElementById("infoBtn")
                ?.addEventListener("click", () =>
                    showMoreInfo(state.heroTitles[state.currentIndex]?.id)
                );
            // indicators click
            DOM.indicators?.addEventListener("click", (e) => {
                const el = e.target.closest(".hero-indicator");

                if (!el) return;
                const idx = Number(el.dataset.index);
                goToTitle(idx);
            });
        }
    }

    function updateHeroContent(title, animate = true) {
        if (!DOM.hero) return;

        // --- 1. Start Fade-Out Animation ---
        if (animate) {
            DOM.hero.classList.add("is-transitioning");
        }

        setTimeout(
            () => {
                if (DOM.heroImage && title.background)
                    DOM.heroImage.src = title.background;
                if (DOM.heroLogo && title.logo) DOM.heroLogo.src = title.logo;

                // Description Text
                if (DOM.heroDescription)
                    DOM.heroDescription.textContent = title.description || "";

                // Info Block (Year, Duration, Seasons, Rating)
                if (DOM.heroInfo) {
                    const info = [title.year].filter(Boolean);
                    if (title.duration && title.duration !== "Unknown")
                        info.push(title.duration);
                    if (title.seasons && title.seasons !== "Unknown")
                        info.push(title.seasons);
                    if (title.releaseDate && title.releaseDate !== "")
                        info.push(title.releaseDate);

                    const ratingHTML =
                        title.rating && title.rating !== "na"
                            ? `<p class="rating-item"><span class="rating-text">⭐ ${title.rating}</span></p>`
                            : `<p class="rating-item"><span class="rating-text"></span></p>`;

                    DOM.heroInfo.innerHTML =
                        info.map((i) => `<p>${i}</p>`).join("") + ratingHTML;
                }

                DOM.heroButtonWatch?.setAttribute(
                    "onclick",
                    `event.stopPropagation(); playTitle('${title.id}')`
                );
                DOM.heroButtonMoreInfo?.setAttribute(
                    "onclick",
                    `event.stopPropagation(); showMoreInfo('${title.id}')`
                );

                // --- 3. End Fade-In Animation ---
                if (animate) {
                    // Remove class to trigger CSS fade-in effect on the NEW content
                    // Using rAF or a zero-delay timeout ensures removal happens
                    // after the content swap is complete.
                    requestAnimationFrame(() => {
                        DOM.hero.classList.remove("is-transitioning");
                    });
                }
            },
            animate ? 400 : 0
        );

        // --- 4. Update Indicators (Does not need delay) ---
        DOM.indicators
            ?.querySelectorAll(".hero-indicator")
            ?.forEach((ind, i) =>
                ind.classList.toggle("active", i === state.currentIndex)
            );
    }

    // -------------------------
    // Rotation control
    // -------------------------
    function startAutoRotate() {
        if (state.heroTitles.length === 0) {
            console.log("Cannot start rotation: heroTitles is empty.");
            return; // Stop execution if there's nothing to rotate
        }
        if (state.autoRotateTimer) clearInterval(state.autoRotateTimer);

        state.autoRotateTimer = setInterval(() => {
            state.currentIndex =
                (state.currentIndex + 1) % state.heroTitles.length;
            updateHeroContent(state.heroTitles[state.currentIndex]);
        }, CONFIG.ROTATION_INTERVAL);

        state.isAutoRotating = true;
        DOM.autoToggle && (DOM.autoToggle.textContent = "Playing");
    }
    function stopAutoRotate() {
        if (state.autoRotateTimer) clearInterval(state.autoRotateTimer);
        state.autoRotateTimer = null;
        state.isAutoRotating = false;
        DOM.autoToggle && (DOM.autoToggle.textContent = "Pause");
    }
    function resetAutoRotate() {
        if (state.isAutoRotating) {
            stopAutoRotate();
            startAutoRotate();
        }
    }
    function toggleAutoRotate() {
        state.isAutoRotating = !state.isAutoRotating;
        if (state.isAutoRotating) startAutoRotate();
        else stopAutoRotate();
    }
    function nextTitle() {
        state.currentIndex = (state.currentIndex + 1) % state.heroTitles.length;
        updateHeroContent(state.heroTitles[state.currentIndex]);
        resetAutoRotate();
    }
    function previousTitle() {
        state.currentIndex =
            (state.currentIndex - 1 + state.heroTitles.length) %
            state.heroTitles.length;
        updateHeroContent(state.heroTitles[state.currentIndex]);
        resetAutoRotate();
    }
    function goToTitle(idx) {
        if (
            idx >= 0 &&
            idx < state.heroTitles.length &&
            idx !== state.currentIndex
        ) {
            state.currentIndex = idx;
            updateHeroContent(state.heroTitles[state.currentIndex]);
            resetAutoRotate();
        }
    }

    // -------------------------
    // Navigation & visibility handling
    // -------------------------
    function isBoardPage() {
        const h = window.location.hash;
        return h === "#/" || h === "" || h === "#";
    }
    function isBoardTabSelected() {
        const boardTab = document.querySelector(
            'a[title="Board"].selected, a[href="#/"].selected, .nav-tab-button-container-dYhs0.selected[href="#/"]'
        );
        return boardTab !== null;
    }
    function shouldShowHero() {
        return isBoardPage() && isBoardTabSelected();
    }

    function findParentElement() {
        const selectors = [
            "#app > div.router-_65XU.routes-container > div > div.route-content > div.board-container-DTN_b > div > div > div",
            ".board-container-DTN_b > div > div > div",
            ".board-container-DTN_b",
            '[class*="board-container"]',
            ".route-content > div",
        ];
        for (const s of selectors) {
            const el = document.querySelector(s);
            if (el) return el;
        }
        const rows = document.querySelectorAll(".board-row-CoJrZ");
        if (rows.length) return rows[0].parentElement;
        return null;
    }

    // -------------------------
    // YouTube helper: singleton player
    // -------------------------
    let ytReady = false;
    function ensureYouTubeAPI() {
        return new Promise((resolve) => {
            if (window.YT && window.YT.Player) {
                ytReady = true;
                resolve();
                return;
            }
            if (window._hero_yt_loading) {
                const check = () => {
                    if (window.YT && window.YT.Player) {
                        ytReady = true;
                        resolve();
                    } else requestAnimationFrame(check);
                };
                check();
                return;
            }
            window._hero_yt_loading = true;
            const tag = document.createElement("script");
            tag.src = "https://www.youtube.com/iframe_api";
            document.head.appendChild(tag);
            window.onYouTubeIframeAPIReady = () => {
                ytReady = true;
                resolve();
            };
        });
    }

    function getYouTubeId(url) {
        const m = url.match(
            /(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{11})/
        );
        return m ? m[1] : null;
    }

    async function createOrUpdateYTPlayer(videoId) {
        if (!ytReady) await ensureYouTubeAPI();
        if (!window.YT || !window.YT.Player) return null;

        // create container if missing
        let iframeContainer = document.getElementById("heroIframe");
        if (!iframeContainer && DOM.hero) {
            iframeContainer = document.createElement("div");
            iframeContainer.id = "heroIframe";
            iframeContainer.style.cssText =
                "position:absolute;top:0;left:0;width:100%;height:100vh;z-index:2;opacity:0;transform: scale(2);transition: opacity 1s ease, transform 1s ease;pointer-events:none;";
            DOM.hero.prepend(iframeContainer);
        }

        if (!state.ytPlayer) {
            state.ytPlayer = new YT.Player("heroIframe", {
                videoId,
                width: "1920",
                height: "1080",
                playerVars: {
                    autoplay: 1,
                    loop: 1,
                    playlist: videoId,
                    controls: 0,
                    rel: 0,
                    modestbranding: 1,
                    playsinline: 1,
                },
                events: {
                    onReady: (e) => {
                        e.target.playVideo();
                        try {
                            e.target.setVolume(15);
                        } catch (e) {}
                        if (iframeContainer) {
                            heroIframe.style.opacity = "1";
                            heroIframe.style.transform = "scale(1.375)";
                        }
                    },
                    onStateChange: (ev) => {
                        if (ev.data === YT.PlayerState.PLAYING)
                            try {
                                ev.target.setPlaybackQuality("hd1080");
                            } catch (e) {}
                    },
                },
            });
        }

        return state.ytPlayer;
    }

    function cleanupMedia() {
        const v = document.getElementById("heroVideo");
        if (v) v.remove();
        const f = document.getElementById("heroIframe");
        if (f) f.remove();
        if (state.ytPlayer && typeof state.ytPlayer.destroy === "function") {
            try {
                state.ytPlayer.destroy();
            } catch (e) {}
        }
        state.ytPlayer = null;
    }

    // -------------------------
    // Trailer hover setup (attach to cards)
    const visibleCards = new Set();

    // 🔍 Track which cards are visible
    const intersectionObserver = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) visibleCards.add(entry.target);
                else visibleCards.delete(entry.target);
            });
        },
        {
            root: null, // viewport
            rootMargin: "-50% 0px -10% 0px",
            threshold: 0,
        }
    );
    // -------------------------
    function setupHeroTrailerHover() {
        const containers = document.querySelectorAll(
            ".meta-items-container-qcuUA"
        );
        const hero = document.querySelector(".hero-container");
        if (!containers.length || !hero) return;

        const cardTimers = new WeakMap();

        containers.forEach((container) => {
            // Observe any cards currently in this container
            container
                .querySelectorAll(
                    '.meta-item-container-Tj0Ib, [class*="meta-item-container"]'
                )
                .forEach((card) => {
                    if (!card.dataset._observed) {
                        intersectionObserver.observe(card);
                        card.dataset._observed = "1";
                    }
                });
            container.addEventListener(
                "mouseenter",
                async (e) => {
                    if (e.target.matches(".meta-item-container-Tj0Ib")) {
                        const card = e.target;

                        if (!card || !container.contains(card)) return;

                        const existing = cardTimers.get(card);
                        if (existing) {
                            clearTimeout(existing.fadeTimer);
                            clearTimeout(existing.playTimeout);
                        }

                        stopAutoRotate();

                        const link = card.querySelector("a.enhanced-trailer");
                        const upcomingList =
                            document.querySelector(".upcoming-list");
                        const url = link?.href || card.dataset.trailerUrl;

                        // lightweight update first
                        updateHeroFromHover(card);
                        cleanupMedia();
                        if (!url) return;

                        fadeTimer = setTimeout(() => {
                            upcomingList?.classList.add("dim");
                            visibleCards.forEach((c) => {
                                if (c !== card) c.classList.add("dim");
                            });
                        }, 2000);

                        let playTimeout;
                        if (
                            url.includes("youtube.com") ||
                            url.includes("youtu.be")
                        ) {
                            const id = getYouTubeId(url);
                            if (id)
                                playTimeout = setTimeout(async () => {
                                    // check if the card is still hovered before playing
                                    if (card.matches(":hover")) {
                                        await createOrUpdateYTPlayer(id);
                                    } else {
                                        console.log(
                                            "Skipped trailer play — user already left card"
                                        );
                                    }
                                }, 1000);
                        }
                        cardTimers.set(card, { fadeTimer, playTimeout });
                    }
                },
                true
            );

            container.addEventListener(
                "mouseleave",
                (e) => {
                    if (e.target.matches(".meta-item-container-Tj0Ib")) {
                        const card = e.target;
                        if (!card || !container.contains(card)) return;

                        const timers = cardTimers.get(card);
                        if (timers) {
                            clearTimeout(timers.fadeTimer);
                            clearTimeout(timers.playTimeout);
                            cardTimers.delete(card);
                        }

                        const upcomingList =
                            document.querySelector(".upcoming-list");
                        visibleCards.forEach((c) => c.classList.remove("dim"));
                        upcomingList?.classList.remove("dim");

                        const v = document.getElementById("heroVideo");
                        const f = document.getElementById("heroIframe");
                        [v, f].forEach((el) => {
                            if (!el) return;
                            el.style.opacity = "0";
                            el.style.transform = "scale(2)";
                            el.addEventListener(
                                "transitionend",
                                () => el.remove(),
                                {
                                    once: true,
                                }
                            );
                        });

                        if (
                            state.ytPlayer &&
                            typeof state.ytPlayer.getVolume === "function"
                        ) {
                            try {
                                state.ytPlayer.setVolume(0);
                            } catch (e) {}
                        }

                        startAutoRotate();
                    }
                },
                true
            );
        });
    }

    /**
     * Updates the main hero section content based on the provided card element.
     * Assumes hero DOM elements are pre-queried and stored in a global/accessible DOM object.
     *
     * @param {HTMLElement} card - The card element being hovered over.
     */
    function updateHeroFromHover(card) {
        // Check for both the card element and the main hero container
        if (!card || !DOM.hero) return;

        // --- Card Data Extraction ---
        // Extract data from the card, using optional chaining and nullish coalescing for safety
        const cardLogo = card.querySelector(".enhanced-title img");
        const cardImg = card.querySelector("img");
        const desc = card.querySelector(".enhanced-description");
        const rating =
            card.querySelector(".enhanced-rating")?.textContent || "";
        const cardIMDB = card.id;
        // Get all metadata items from the card
        const cardMetadata = [
            ...card.querySelectorAll('[class="enhanced-metadata-item"]'),
        ];
        const cardReleaseDate = card.querySelector(".enhanced-release-date");

        // --- Hero DOM Updates ---

        // 1. Logos and Main Image
        if (DOM.heroLogo && cardLogo) DOM.heroLogo.src = cardLogo.src;
        if (DOM.heroImage && cardImg) DOM.heroImage.src = cardImg.src;

        // 2. Description
        if (DOM.heroDescription)
            DOM.heroDescription.textContent = desc.textContent;

        // 3. Rating (The corrected logic)

        if (DOM.heroInfo) {
            const ratingElement = DOM.heroInfo.querySelector(".rating-text");
            if (ratingElement) {
                ratingElement.textContent = rating ? `⭐ ${rating}` : "";
            }
        }

        // 4. Action Buttons (Using the DOM properties corresponding to the original queries)
        if (DOM.heroButtonWatch) {
            DOM.heroButtonWatch.setAttribute(
                "onclick",
                `playTitle('${cardIMDB}')`
            );
        }
        if (DOM.heroButtonMoreInfo) {
            DOM.heroButtonMoreInfo.setAttribute(
                "onclick",
                `showMoreInfo('${cardIMDB}')`
            );
        }

        // 5. Metadata/Overlay Info

        // We'll re-query the target elements here if DOM.heroOverlayInfo is not defined,
        // or assume DOM.heroOverlayInfo has been pre-queried as the NodeList of target <p> tags.
        const heroOverlayInfoTargets =
            DOM.heroOverlayInfo ||
            DOM.heroInfo?.querySelectorAll("p:not([class])") ||
            [];
        const runTime = desc.getAttribute("runtime");

        const metadataWithDate = cardReleaseDate
            ? [
                  ...cardMetadata,
                  {
                      textContent:
                          runTime === "null" || !runTime ? "" : runTime,
                  }, // wrap runtime string
                  { textContent: cardReleaseDate.textContent || "" }, // wrap release date element text
              ]
            : [
                  ...cardMetadata,
                  { textContent: runTime || "" }, // fallback if no date
              ];

        heroOverlayInfoTargets.forEach((item, index) => {
            item.textContent = metadataWithDate[index]
                ? metadataWithDate[index].textContent
                : null;
        });
    }

    // -------------------------
    // Observers & lifecycle
    // -------------------------
    function setupObservers() {
        console.log("[Lifecycle] Setting up observers");
        if (state.observers.length > 0) {
            console.log("[Lifecycle] Observers already active, skipping setup");
            return;
        }

        // --- your existing observer code ---
        const mutationHandler = debounce(() => {
            try {
                handleNavigation();
            } catch (e) {
                logger.warn("mutation handler error", e);
            }
        }, 250);

        const mainObserver = new MutationObserver(mutationHandler);
        mainObserver.observe(document.body, { childList: true, subtree: true });
        state.observers.push(mainObserver);

        // Trailer hover observer (your code)
        const trailerHoverObserver = new MutationObserver((mutations) => {
            let addedNewCards = false;

            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (
                        node.nodeType === 1 &&
                        node.matches(".meta-row-container-xtlB1")
                    ) {
                        addedNewCards = true;
                    }
                });
            });

            if (addedNewCards) {
                console.log(
                    "New boards detected — reinitializing trailer hover setup"
                );
                setupHeroTrailerHover();

                const boards = document.querySelectorAll(
                    ".meta-row-container-xtlB1"
                );
                boards.forEach((card) => cardHideObserver.observe(card));
            }
        });

        trailerHoverObserver.observe(document.body, {
            childList: true,
            subtree: true,
        });
        state.observers.push(trailerHoverObserver);

        // IntersectionObserver for card visibility
        const cardHideObserver = new IntersectionObserver(
            (cards) => {
                cards.forEach((card) => {
                    if (card.isIntersecting) card.target.classList.add("show");
                    else card.target.classList.remove("show");
                });
            },
            { rootMargin: "-60% 0px 0px 0px", threshold: 0 }
        );
        const boards = document.querySelectorAll(".meta-row-container-xtlB1");
        boards.forEach((card) => cardHideObserver.observe(card));
        state.observers.push(cardHideObserver);
    }

    // -------------------------
    // Creation & destruction
    // -------------------------
    async function initializeTitles() {
        if (state.isInitializing) return;
        state.isInitializing = true;
        try {
            const timeout = new Promise((r) => setTimeout(() => r([]), 12000));
            const collected = await Promise.race([
                collectTitlesFromAPI(),
                timeout,
            ]);
            if (collected && collected.length) state.heroTitles = collected;
            else state.heroTitles = FALLBACK_TITLES.slice();
            cacheSet("hero_titles", state.heroTitles);
            return true;
        } catch (e) {
            logger.warn("initializeTitles error", e);
            state.heroTitles = FALLBACK_TITLES.slice();
            return true;
        } finally {
            state.isInitializing = false;
        }
    }

    async function addHeroDiv() {
        if (!shouldShowHero()) return;
        if (document.querySelector(".hero-container")) return;
        const parent = findParentElement();
        if (!parent) return;

        if (!state.heroTitles.length) await initializeTitles();
        if (!state.heroTitles.length)
            state.heroTitles = FALLBACK_TITLES.slice();

        state.currentIndex = 0;
        mountHeroTo(parent, state.heroTitles[0]);
        cacheDOM();
        setupHeroTrailerHover();
        setupObservers();

        if (state.isAutoRotating) startAutoRotate();
    }

    function cleanupAll() {
        cleanupMedia();
        // remove hero
        const h = document.querySelector(".hero-container");
        if (h) h.remove();
        // disconnect observers
        state.observers.forEach((o) => {
            try {
                o.disconnect();
            } catch (e) {}
        });
        state.observers = [];
        stopAutoRotate();
        state.heroTitles = [];
    }

    function handleNavigation() {
        const heroExists = !!document.querySelector(".hero-container");
        const shouldShow = shouldShowHero();
        if (!shouldShow && heroExists) {
            logger.info("Navigated away; cleaning up hero");
            cleanupAll();
            return;
        }
        if (shouldShow && !heroExists) {
            // delayed tries to allow UI to settle
            setTimeout(() => addHeroDiv(), 100);
            setTimeout(() => addHeroDiv(), 600);
        }
    }

    // wire basic events
    window.addEventListener("hashchange", handleNavigation);
    window.addEventListener("popstate", () =>
        setTimeout(handleNavigation, 100)
    );
    window.addEventListener("focus", () => setTimeout(handleNavigation, 200));
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) setTimeout(handleNavigation, 300);
    });
    window.playTitle = function (titleId) {
        const element = document.querySelector(`a[id="${titleId}"]`);
        if (element) {
            element.click();
        } else {
            const title = heroTitles.find((t) => t.id === titleId);
            if (title) {
                const type = title.type === "movie" ? "movie" : "series";
                window.location.hash = `#/detail/${type}/${titleId}`;
            }
        }
    };

    window.showMoreInfo = function (titleId) {
        const element = document.querySelector(`a[id="${titleId}"]`);
        if (element) {
            element.click();
        } else {
            const title = heroTitles.find((t) => t.id === titleId);
            if (title) {
                const type = title.type === "movie" ? "movie" : "series";
                window.location.hash = `#/detail/${type}/${titleId}`;
            }
        }
    };

    // initial attempt
    setTimeout(() => handleNavigation(), 1200);

    // Expose some debug utilities (safe to remove in production)
    window._hero_debug = {
        addHeroDiv: () => addHeroDiv(),
        cleanupAll: () => cleanupAll(),
        state,
    };
})();
