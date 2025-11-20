/*
 * @name Dynamic Hero
 * @description Netflix-style rotating hero banner.
 * @version 3.0.0
 * @author Fxy, EZOBOSS
 */

(function () {
    class HeroPlugin {
        constructor() {
            this.config = {
                ROTATION_INTERVAL: 8000,
                FETCH_TIMEOUT: 10000,
                DETAIL_TIMEOUT: 5000,
                MAX_RETRIES: 2,
                BATCH_SIZE: 6,
                CACHE_TTL_MS: 1000 * 60 * 60 * 6, // 6 hours
                LOG_LEVEL: "debug",
                PLAY_TRAILER_ON_HOVER:
                    JSON.parse(localStorage.getItem("custom_setting") || "{}")
                        .play_trailer_on_hover ?? true,
            };

            this.state = {
                heroTitles: [],
                currentIndex: 0,
                isAutoRotating: true,
                autoRotateTimer: null,
                observers: [],
                ytPlayer: null,
                isInitializing: false,
                retryCount: 0,
                visibleCards: new Set(),
                cardTimers: new WeakMap(),
            };

            this.dom = {};
            this.ytReady = false;

            // Bind methods
            this.handleNavigation = this.handleNavigation.bind(this);
            this.handleVisibilityChange =
                this.handleVisibilityChange.bind(this);
            this.nextTitle = this.nextTitle.bind(this);
            this.previousTitle = this.previousTitle.bind(this);
            this.toggleAutoRotate = this.toggleAutoRotate.bind(this);
            this.stopAutoRotate = this.stopAutoRotate.bind(this);
            this.startAutoRotate = this.startAutoRotate.bind(this);

            // Fallback titles
            this.FALLBACK_TITLES = [
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

            this.init();
        }

        // -------------------------
        // Logger
        // -------------------------
        log(level, ...args) {
            if (this.config.LOG_LEVEL === "silent") return;
            if (level === "debug" && this.config.LOG_LEVEL !== "debug") return;
            console[level]("[Hero]", ...args);
        }

        // -------------------------
        // Utilities
        // -------------------------
        debounce(fn, wait = 200) {
            let t;
            return (...args) => {
                clearTimeout(t);
                t = setTimeout(() => fn(...args), wait);
            };
        }

        async safeFetch(
            url,
            { timeout = this.config.FETCH_TIMEOUT, retries = 1 } = {}
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

        cacheKey(k) {
            return `hero_cache_${k}`;
        }

        cacheSet(k, v) {
            try {
                sessionStorage.setItem(
                    this.cacheKey(k),
                    JSON.stringify({ t: Date.now(), v })
                );
            } catch (e) {
                this.log("debug", "Cache set failed", e);
            }
        }

        cacheGet(k) {
            try {
                const raw = sessionStorage.getItem(this.cacheKey(k));
                if (!raw) return null;
                const { t, v } = JSON.parse(raw);
                if (Date.now() - t > this.config.CACHE_TTL_MS) {
                    sessionStorage.removeItem(this.cacheKey(k));
                    return null;
                }
                return v;
            } catch (e) {
                this.log("debug", "Cache get failed", e);
                return null;
            }
        }

        getDaysSinceRelease(releaseDateStr) {
            if (!releaseDateStr) return "";
            const releaseDate = new Date(releaseDateStr);
            const today = new Date();
            releaseDate.setHours(0, 0, 0, 0);
            today.setHours(0, 0, 0, 0);
            const diffMs = today - releaseDate;
            const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

            if (diffDays === 0) return "Released today";
            if (diffDays > 0)
                return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
            return `in ${Math.abs(diffDays)} day${
                Math.abs(diffDays) > 1 ? "s" : ""
            }`;
        }

        // -------------------------
        // API & Metadata
        // -------------------------
        async fetchCatalogTitles(type, limit = 10) {
            const cache = this.cacheGet(`catalog_${type}`);
            if (cache) return cache;

            const url = `https://cinemeta-catalogs.strem.io/top/catalog/${type}/top.json`;
            try {
                const json = await this.safeFetch(url, {
                    timeout: this.config.FETCH_TIMEOUT,
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
                this.cacheSet(`catalog_${type}`, metas);
                return metas;
            } catch (e) {
                this.log("warn", "fetchCatalogTitles failed", e);
                return [];
            }
        }

        async getDetailedMetaData(id, type) {
            const cache = this.cacheGet(`meta_${id}`);
            if (cache) return cache;
            try {
                const json = await this.safeFetch(
                    `https://v3-cinemeta.strem.io/meta/${type}/${id}.json`,
                    { timeout: this.config.DETAIL_TIMEOUT, retries: 1 }
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

                const releaseDate = this.calculateReleaseDate(meta, actualType);
                const seasons = this.calculateSeasons(meta, actualType);

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
                    releaseDate:
                        actualType === "series"
                            ? `New episode ${releaseDate}`
                            : releaseDate,
                };
                this.cacheSet(`meta_${id}`, result);
                return result;
            } catch (e) {
                this.log("warn", "getDetailedMetaData failed", id, e);
                return null;
            }
        }

        calculateReleaseDate(meta, actualType) {
            const videos = meta.videos;
            if (!Array.isArray(videos) || videos.length === 0) {
                return this.getDaysSinceRelease(meta.released || null);
            }

            const now = new Date();
            let closestFuture = null;
            let latestPast = null;

            for (const v of videos) {
                if (!v.released) continue;
                const date = new Date(v.released);
                if (isNaN(date)) continue;

                if (date > now) {
                    if (!closestFuture || date < closestFuture.date) {
                        closestFuture = { released: v.released, date };
                    }
                } else {
                    if (!latestPast || date > latestPast.date) {
                        latestPast = { released: v.released, date };
                    }
                }
            }

            if (closestFuture)
                return this.getDaysSinceRelease(closestFuture.released);
            if (latestPast)
                return this.getDaysSinceRelease(latestPast.released);
            return this.getDaysSinceRelease(meta.released || null);
        }

        calculateSeasons(meta, actualType) {
            if (actualType === "movie") return "Movie";
            if (meta.videos && meta.videos.length) {
                const seasonSet = new Set(
                    meta.videos.map((v) => v.season).filter(Boolean)
                );
                if (seasonSet.size > 1) return `${seasonSet.size} seasons`;
                return `${meta.videos.length} episodes`;
            }
            return "Series";
        }

        async enrichTitles(titles) {
            const chunks = [];
            for (let i = 0; i < titles.length; i += this.config.BATCH_SIZE)
                chunks.push(titles.slice(i, i + this.config.BATCH_SIZE));

            const enriched = [];
            for (const chunk of chunks) {
                const promises = chunk.map(async (t) => {
                    const details = await this.getDetailedMetaData(
                        t.id,
                        t.type
                    );
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

        async collectTitlesFromAPI() {
            const cached = this.cacheGet("hero_titles");
            if (cached) {
                this.log("info", "fetched cached titles", cached);
                return cached;
            }
            this.log("info", "Collecting titles from API");
            try {
                const [movies, series] = await Promise.all([
                    this.fetchCatalogTitles("movie", 8),
                    this.fetchCatalogTitles("series", 8),
                ]);

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
                    else if (!expectMovie && s < series.length)
                        pick = series[s++];
                    else if (m < movies.length) pick = movies[m++];
                    else if (s < series.length) pick = series[s++];
                    expectMovie = !expectMovie;
                    if (pick) result.push(pick);
                }

                const enriched = await this.enrichTitles(result);
                this.cacheSet("hero_titles", enriched);
                return enriched;
            } catch (e) {
                this.log("warn", "collectTitlesFromAPI failed", e);
                return [];
            }
        }

        async initializeTitles() {
            if (this.state.isInitializing) return;
            this.state.isInitializing = true;
            try {
                const timeout = new Promise((r) =>
                    setTimeout(() => r([]), 12000)
                );
                const collected = await Promise.race([
                    this.collectTitlesFromAPI(),
                    timeout,
                ]);
                if (collected && collected.length)
                    this.state.heroTitles = collected;
                else this.state.heroTitles = this.FALLBACK_TITLES.slice();
                this.cacheSet("hero_titles", this.state.heroTitles);
            } catch (e) {
                this.log("warn", "initializeTitles error", e);
                this.state.heroTitles = this.FALLBACK_TITLES.slice();
            } finally {
                this.state.isInitializing = false;
            }
        }

        // -------------------------
        // DOM & UI
        // -------------------------
        cacheDOM() {
            const hero = document.querySelector(".hero-container");
            if (!hero) return;

            this.dom = {
                hero,
                heroOverlay: hero.querySelector(".hero-overlay"),
                heroImage: hero.querySelector("#heroImage"),
                heroLogo: hero.querySelector("#heroLogo"),
                heroDescription: hero.querySelector("#heroDescription"),
                heroInfo: hero.querySelector("#heroInfo"),
                autoToggle: hero.querySelector("#autoToggle"),
                indicators: hero.querySelector(".hero-indicators"),
                heroButtonWatch: hero.querySelector(
                    ".hero-overlay-button-watch"
                ),
                heroButtonMoreInfo: hero.querySelector(".hero-overlay-button"),
                cardContainer: hero.querySelector(".board-content-nPWv1"),
            };
        }

        createHeroHTML(title) {
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

            const indicators = this.state.heroTitles
                .map(
                    (_, i) =>
                        `<div class="hero-indicator ${
                            i === this.state.currentIndex ? "active" : ""
                        }" 
                          data-index="${i}" aria-label="Go to ${i + 1}"></div>`
                )
                .join("");

            return `
                <div class="hero-container" role="region" aria-label="Featured">
                    <img id="heroImage" class="hero-image" src="${
                        title.background
                    }" alt="${title.title} background" />
                    <div class="hero-overlay">
                        <img id="heroLogo" class="hero-overlay-image" src="${
                            title.logo
                        }" alt="${title.title} logo" />
                        <p id="heroDescription" class="hero-overlay-description">${
                            title.description
                        }</p>
                        <div id="heroInfo" class="hero-overlay-info">
                            ${info
                                .map((i) => `<p>${i}</p>`)
                                .join("")}${ratingHTML}
                        </div>
                        <div class="hero-overlay-actions">
                            <button class="hero-overlay-button-watch" id="watchBtn">▶ Watch Now</button>
                            <button class="hero-overlay-button" id="infoBtn">ⓘ More Info</button>
                        </div>
                    </div>
                    <div class="hero-controls">
                        <button id="autoToggle">${
                            this.state.isAutoRotating ? "Pause" : "Play"
                        }</button>
                        <button id="prevBtn">◀</button>
                        <button id="nextBtn">▶</button>
                    </div>
                    <div class="hero-indicators">${indicators}</div>
                </div>
            `;
        }

        mountHeroTo(parent, initialTitle) {
            const existing = parent.querySelector(".hero-container");
            if (existing) existing.remove();

            parent.insertAdjacentHTML(
                "afterbegin",
                this.createHeroHTML(initialTitle)
            );
            this.cacheDOM();

            if (this.dom.hero) {
                this.dom.heroOverlay.addEventListener("mouseenter", () =>
                    this.stopAutoRotate()
                );
                this.dom.heroOverlay.addEventListener("mouseleave", () =>
                    this.startAutoRotate()
                );

                document
                    .getElementById("nextBtn")
                    ?.addEventListener("click", this.nextTitle);
                document
                    .getElementById("prevBtn")
                    ?.addEventListener("click", this.previousTitle);
                document
                    .getElementById("autoToggle")
                    ?.addEventListener("click", this.toggleAutoRotate);

                document
                    .getElementById("watchBtn")
                    ?.addEventListener("click", () =>
                        this.playTitle(
                            this.state.heroTitles[this.state.currentIndex]?.id
                        )
                    );
                document
                    .getElementById("infoBtn")
                    ?.addEventListener("click", () =>
                        this.showMoreInfo(
                            this.state.heroTitles[this.state.currentIndex]?.id
                        )
                    );

                this.dom.indicators?.addEventListener("click", (e) => {
                    const el = e.target.closest(".hero-indicator");
                    if (!el) return;
                    const idx = Number(el.dataset.index);
                    this.goToTitle(idx);
                });
            }
        }

        updateHeroContent(title, animate = true) {
            if (!this.dom.hero) return;

            if (animate) this.dom.hero.classList.add("is-transitioning");

            setTimeout(
                () => {
                    if (this.dom.heroImage && title.background)
                        this.dom.heroImage.src = title.background;
                    if (this.dom.heroLogo && title.logo)
                        this.dom.heroLogo.src = title.logo;
                    if (this.dom.heroDescription)
                        this.dom.heroDescription.textContent =
                            title.description || "";

                    if (this.dom.heroInfo) {
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

                        this.dom.heroInfo.innerHTML =
                            info.map((i) => `<p>${i}</p>`).join("") +
                            ratingHTML;
                    }

                    this.dom.heroButtonWatch?.setAttribute(
                        "onclick",
                        `event.stopPropagation(); window.playTitle('${title.id}')`
                    );
                    this.dom.heroButtonMoreInfo?.setAttribute(
                        "onclick",
                        `event.stopPropagation(); window.showMoreInfo('${title.id}')`
                    );

                    if (animate) {
                        requestAnimationFrame(() => {
                            this.dom.hero.classList.remove("is-transitioning");
                        });
                    }
                },
                animate ? 400 : 0
            );

            this.dom.indicators
                ?.querySelectorAll(".hero-indicator")
                ?.forEach((ind, i) =>
                    ind.classList.toggle(
                        "active",
                        i === this.state.currentIndex
                    )
                );
        }

        // -------------------------
        // Rotation
        // -------------------------
        startAutoRotate() {
            if (this.state.heroTitles.length === 0) return;
            if (this.state.autoRotateTimer)
                clearInterval(this.state.autoRotateTimer);

            this.state.autoRotateTimer = setInterval(() => {
                this.state.currentIndex =
                    (this.state.currentIndex + 1) %
                    this.state.heroTitles.length;
                this.updateHeroContent(
                    this.state.heroTitles[this.state.currentIndex]
                );
            }, this.config.ROTATION_INTERVAL);

            this.state.isAutoRotating = true;
            if (this.dom.autoToggle)
                this.dom.autoToggle.textContent = "Playing";
        }

        stopAutoRotate() {
            if (this.state.autoRotateTimer)
                clearInterval(this.state.autoRotateTimer);
            this.state.autoRotateTimer = null;
            this.state.isAutoRotating = false;
            if (this.dom.autoToggle) this.dom.autoToggle.textContent = "Pause";
        }

        toggleAutoRotate() {
            if (this.state.isAutoRotating) this.stopAutoRotate();
            else this.startAutoRotate();
        }

        nextTitle() {
            this.state.currentIndex =
                (this.state.currentIndex + 1) % this.state.heroTitles.length;
            this.updateHeroContent(
                this.state.heroTitles[this.state.currentIndex]
            );
            this.resetAutoRotate();
        }

        previousTitle() {
            this.state.currentIndex =
                (this.state.currentIndex - 1 + this.state.heroTitles.length) %
                this.state.heroTitles.length;
            this.updateHeroContent(
                this.state.heroTitles[this.state.currentIndex]
            );
            this.resetAutoRotate();
        }

        goToTitle(idx) {
            if (
                idx >= 0 &&
                idx < this.state.heroTitles.length &&
                idx !== this.state.currentIndex
            ) {
                this.state.currentIndex = idx;
                this.updateHeroContent(
                    this.state.heroTitles[this.state.currentIndex]
                );
                this.resetAutoRotate();
            }
        }

        resetAutoRotate() {
            if (this.state.isAutoRotating) {
                this.stopAutoRotate();
                this.startAutoRotate();
            }
        }

        // -------------------------
        // Navigation & Visibility
        // -------------------------
        isBoardPage() {
            const h = window.location.hash;
            return h === "#/" || h === "" || h === "#";
        }

        isBoardTabSelected() {
            const boardTab = document.querySelector(
                'a[title="Board"].selected, a[href="#/"].selected, .nav-tab-button-container-dYhs0.selected[href="#/"]'
            );
            return boardTab !== null;
        }

        shouldShowHero() {
            return this.isBoardPage() && this.isBoardTabSelected();
        }

        findParentElement() {
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

        async addHeroDiv() {
            if (!this.shouldShowHero()) return;
            if (document.querySelector(".hero-container")) return;
            const parent = this.findParentElement();
            if (!parent) return;

            if (!this.state.heroTitles.length) await this.initializeTitles();
            if (!this.state.heroTitles.length)
                this.state.heroTitles = this.FALLBACK_TITLES.slice();

            this.state.currentIndex = 0;
            this.mountHeroTo(parent, this.state.heroTitles[0]);
            this.setupObservers();
            setTimeout(() => this.setupHeroTrailerHover(), 2000);

            if (this.state.isAutoRotating) this.startAutoRotate();
        }

        cleanupAll() {
            this.cleanupMedia();
            const h = document.querySelector(".hero-container");
            if (h) h.remove();

            this.state.observers.forEach((o) => {
                try {
                    o.disconnect();
                } catch (e) {}
            });
            this.state.observers = [];
            this.stopAutoRotate();
        }

        handleNavigation() {
            const heroExists = !!document.querySelector(".hero-container");
            const shouldShow = this.shouldShowHero();

            if (!shouldShow && heroExists) {
                this.log("info", "Navigated away; cleaning up hero");
                this.cleanupAll();
                return;
            }
            if (shouldShow && !heroExists) {
                setTimeout(() => this.addHeroDiv(), 100);
                setTimeout(() => this.addHeroDiv(), 600);
            }
        }

        handleVisibilityChange() {
            if (!document.hidden) setTimeout(this.handleNavigation, 300);
        }

        // -------------------------
        // YouTube & Media
        // -------------------------
        ensureYouTubeAPI() {
            return new Promise((resolve) => {
                if (window.YT && window.YT.Player) {
                    this.ytReady = true;
                    resolve();
                    return;
                }
                if (window._hero_yt_loading) {
                    const check = () => {
                        if (window.YT && window.YT.Player) {
                            this.ytReady = true;
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
                    this.ytReady = true;
                    resolve();
                };
            });
        }

        async createOrUpdateYTPlayer(videoId) {
            if (!this.ytReady) await this.ensureYouTubeAPI();
            if (!window.YT || !window.YT.Player) return null;

            let iframeContainer = document.getElementById("heroIframe");
            if (!iframeContainer && this.dom.hero) {
                iframeContainer = document.createElement("div");
                iframeContainer.id = "heroIframe";
                iframeContainer.style.cssText =
                    "position:absolute;top:0;left:0;width:100%;height:100vh;z-index:2;opacity:0;transform: scale(2);transition: opacity 1s ease, transform 1s ease;pointer-events:none;";
                this.dom.hero.prepend(iframeContainer);
            }

            if (!this.state.ytPlayer) {
                this.state.ytPlayer = new YT.Player("heroIframe", {
                    videoId,
                    width: "3840",
                    height: "2160",
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
                            let maxQuality =
                                ev.target.playerInfo.availableQualityLevels[0];
                            ev.target.setPlaybackQuality(maxQuality);
                        },
                    },
                });
            }
            return this.state.ytPlayer;
        }

        cleanupMedia() {
            const v = document.getElementById("heroVideo");
            if (v) v.remove();
            const f = document.getElementById("heroIframe");
            if (f) f.remove();
            if (
                this.state.ytPlayer &&
                typeof this.state.ytPlayer.destroy === "function"
            ) {
                try {
                    this.state.ytPlayer.destroy();
                } catch (e) {}
            }
            this.state.ytPlayer = null;
        }

        // -------------------------
        // Observers
        // -------------------------
        setupObservers() {
            this.log("debug", "[Lifecycle] Setting up observers");
            if (this.state.observers.length > 0) return;

            const mutationHandler = this.debounce(() => {
                try {
                    this.handleNavigation();
                } catch (e) {
                    this.log("warn", "mutation handler error", e);
                }
            }, 250);

            const mainObserver = new MutationObserver(mutationHandler);
            mainObserver.observe(document.body, {
                childList: true,
                subtree: true,
            });
            this.state.observers.push(mainObserver);

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
                    this.setupHeroTrailerHover();
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
            this.state.observers.push(trailerHoverObserver);

            const cardHideObserver = new IntersectionObserver(
                (cards) => {
                    cards.forEach((card) => {
                        if (card.isIntersecting)
                            card.target.classList.add("show");
                        else card.target.classList.remove("show");
                    });
                },
                { rootMargin: "-60% 0px 0px 0px", threshold: 0 }
            );
            const boards = document.querySelectorAll(
                ".meta-row-container-xtlB1"
            );
            boards.forEach((card) => cardHideObserver.observe(card));
            this.state.observers.push(cardHideObserver);
        }

        setupHeroTrailerHover() {
            const containers = document.querySelectorAll(
                ".meta-items-container-qcuUA"
            );
            const hero = document.querySelector(".hero-container");
            if (!containers.length || !hero) return;

            // Intersection observer for visible cards
            if (!this.cardVisibilityObserver) {
                this.cardVisibilityObserver = new IntersectionObserver(
                    (entries) => {
                        entries.forEach((entry) => {
                            if (entry.isIntersecting)
                                this.state.visibleCards.add(entry.target);
                            else this.state.visibleCards.delete(entry.target);
                        });
                    },
                    {
                        root: null,
                        rootMargin: "-50% 0px -10% 0px",
                        threshold: 0,
                    }
                );
            }

            containers.forEach((container) => {
                // Always check for new cards, even if listeners are attached
                container
                    .querySelectorAll(
                        '.meta-item-container-Tj0Ib, [class*="meta-item-container"]'
                    )
                    .forEach((card) => {
                        if (!card.dataset._observed) {
                            this.cardVisibilityObserver.observe(card);
                            card.dataset._observed = "1";
                        }
                    });

                // Prevent duplicate listeners
                if (container.dataset._heroHoverAttached) return;
                container.dataset._heroHoverAttached = "true";

                container.addEventListener(
                    "mouseenter",
                    async (e) => {
                        if (e.target.matches(".meta-item-container-Tj0Ib")) {
                            const card = e.target;
                            if (!card || !container.contains(card)) return;

                            const existing = this.state.cardTimers.get(card);
                            if (existing) {
                                clearTimeout(existing.fadeTimer);
                                clearTimeout(existing.playTimeout);
                            }

                            this.stopAutoRotate();

                            const link =
                                card.querySelector("a.enhanced-trailer");
                            const url =
                                link?.dataset.trailerUrl ||
                                card.dataset.trailerUrl;

                            this.cleanupMedia();
                            this.updateHeroFromHover(card);

                            if (!url || !this.config.PLAY_TRAILER_ON_HOVER)
                                return;

                            const fadeTimer = setTimeout(() => {
                                document
                                    .querySelector(".upcoming-list")
                                    ?.classList.add("dim");
                                document
                                    .querySelectorAll(".upcoming-card")
                                    ?.forEach((c) => {
                                        if (c !== card) c.classList.add("dim");
                                        else c.classList.add("hover");
                                    });

                                this.state.visibleCards.forEach((c) => {
                                    if (c !== card) c.classList.add("dim");
                                });
                            }, 2000);

                            let playTimeout;
                            if (url && url !== "null") {
                                playTimeout = setTimeout(async () => {
                                    if (card.matches(":hover")) {
                                        await this.createOrUpdateYTPlayer(url);
                                    }
                                }, 1000);
                            }

                            this.state.cardTimers.set(card, {
                                fadeTimer,
                                playTimeout,
                            });
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

                            const timers = this.state.cardTimers.get(card);
                            if (timers) {
                                clearTimeout(timers.fadeTimer);
                                clearTimeout(timers.playTimeout);
                                this.state.cardTimers.delete(card);
                            }

                            document
                                .querySelectorAll(".upcoming-card")
                                ?.forEach((c) =>
                                    c.classList.remove("dim", "hover")
                                );
                            document
                                .querySelector(".upcoming-list")
                                ?.classList.remove("dim");
                            this.state.visibleCards.forEach((c) =>
                                c.classList.remove("dim")
                            );

                            const v = document.getElementById("heroVideo");
                            const f = document.getElementById("heroIframe");
                            [v, f].forEach((el) => {
                                if (!el) return;
                                el.style.opacity = "0";
                                el.style.transform = "scale(2)";
                                el.addEventListener(
                                    "transitionend",
                                    () => el.remove(),
                                    { once: true }
                                );
                            });

                            if (
                                this.state.ytPlayer &&
                                typeof this.state.ytPlayer.setVolume ===
                                    "function"
                            ) {
                                try {
                                    this.state.ytPlayer.setVolume(0);
                                } catch (e) {}
                            }

                            this.startAutoRotate();
                        }
                    },
                    true
                );
            });
        }

        updateHeroFromHover(card) {
            if (!card || !this.dom.hero) return;

            const cardLogo =
                card.querySelector(".enhanced-title img") ||
                card.querySelector(".upcoming-logo");
            const cardImg = card.querySelector("img");
            const desc =
                card.querySelector(".enhanced-description")?.dataset
                    .description || card.dataset.description;
            const rating =
                card.querySelector(".enhanced-rating")?.textContent ||
                card.dataset.rating ||
                "";
            const cardIMDB = card.id || card.dataset.id;
            const cardYear = card.dataset.year;
            const cardGenres = card.dataset.genres;
            const cardReleaseDate = card.querySelector(
                ".enhanced-release-date"
            );
            const cardRuntime =
                card.querySelector(".enhanced-description")?.dataset.runtime ||
                card.dataset.runtime;
            const cardMetadata = [
                ...card.querySelectorAll('[class="enhanced-metadata-item"]'),
            ];

            if (this.dom.heroLogo && cardLogo)
                this.dom.heroLogo.src = cardLogo.src;
            if (this.dom.heroImage && cardImg)
                this.dom.heroImage.src = cardImg.src;
            if (this.dom.heroDescription && desc)
                this.dom.heroDescription.textContent = desc;

            if (this.dom.heroInfo) {
                const ratingElement =
                    this.dom.heroInfo.querySelector(".rating-text");
                if (ratingElement)
                    ratingElement.textContent = rating ? `⭐ ${rating}` : "";
            }

            if (this.dom.heroButtonWatch && cardIMDB) {
                this.dom.heroButtonWatch.setAttribute(
                    "onclick",
                    `event.stopPropagation(); window.playTitle('${cardIMDB}')`
                );
            }
            if (this.dom.heroButtonMoreInfo && cardIMDB) {
                this.dom.heroButtonMoreInfo.setAttribute(
                    "onclick",
                    `event.stopPropagation(); window.showMoreInfo('${cardIMDB}')`
                );
            }

            const heroOverlayInfoTargets =
                this.dom.heroInfo?.querySelectorAll("p:not([class])") || [];

            let optionalMetadata = [];

            if (cardYear && cardYear !== "null")
                optionalMetadata.push({ textContent: cardYear });
            if (cardRuntime && cardRuntime !== "null")
                optionalMetadata.push({ textContent: cardRuntime });
            if (cardGenres && cardGenres.length > 0)
                optionalMetadata.push({ textContent: cardGenres });

            const metadataWithDate = cardReleaseDate
                ? [
                      ...cardMetadata, // Original metadata items
                      ...optionalMetadata, // New: Year and Runtime
                      { textContent: cardReleaseDate.textContent || "" }, // Release Date is last
                  ]
                : [
                      ...cardMetadata, // Original metadata items
                      ...optionalMetadata, // Fallback list: Year and Runtime
                  ];

            heroOverlayInfoTargets.forEach((item, index) => {
                item.textContent = metadataWithDate[index]
                    ? metadataWithDate[index].textContent
                    : "";
            });
        }

        playTitle(titleId) {
            const element = document.querySelector(`a[id="${titleId}"]`);
            if (element) {
                element.click();
            } else {
                const title = this.state.heroTitles.find(
                    (t) => t.id === titleId
                );
                if (title) {
                    const type = title.type === "movie" ? "movie" : "series";
                    window.location.hash = `#/detail/${type}/${titleId}`;
                }
            }
        }

        showMoreInfo(titleId) {
            const element = document.querySelector(`a[id="${titleId}"]`);
            if (element) {
                element.click();
            } else {
                const title = this.state.heroTitles.find(
                    (t) => t.id === titleId
                );
                if (title) {
                    const type = title.type === "movie" ? "movie" : "series";
                    window.location.hash = `#/detail/${type}/${titleId}`;
                }
            }
        }

        init() {
            // Global helpers for HTML onclick attributes
            window.playTitle = this.playTitle.bind(this);
            window.showMoreInfo = this.showMoreInfo.bind(this);

            window.addEventListener("hashchange", this.handleNavigation);
            window.addEventListener("popstate", () =>
                setTimeout(this.handleNavigation, 100)
            );
            window.addEventListener("focus", () =>
                setTimeout(this.handleNavigation, 200)
            );
            document.addEventListener(
                "visibilitychange",
                this.handleVisibilityChange
            );

            // Initial check
            setTimeout(() => this.handleNavigation(), 1200);
        }
    }

    // Instantiate the plugin
    new HeroPlugin();
})();
