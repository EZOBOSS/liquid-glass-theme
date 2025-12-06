/**
 * @name Continue Watching Plugin
 * @description Adds a quick continue watching button with a dropdown for recent series
 * @version 1.2.0
 * @author EZOBOSS
 * @dependencies metadatadb.plugin.js
 */

(function () {
    class ContinueWatchingPlugin {
        static CONFIG = {
            HISTORY_KEY: "continue_watching_history",
            MAX_HISTORY: 10,
        };

        constructor() {
            this.metadataDB = window.MetadataDB;
            this.history = this.loadHistory();
            this.init();
        }

        init() {
            this.renderContainer();

            // Check on navigation
            window.addEventListener("hashchange", (e) => {
                const oldHash = e.oldURL ? new URL(e.oldURL).hash : "";
                const newHash = window.location.hash;

                // If leaving player, check for updates
                if (
                    oldHash.includes("/player/") &&
                    !newHash.includes("/player/")
                ) {
                    // Give a small delay for localStorage to be updated by the player
                    setTimeout(() => {
                        this.checkLastVideo();
                    }, 1000);
                }

                this.checkVisibility();
                this.updateList();
            });

            // Listen for storage changes (sync across tabs)
            window.addEventListener("storage", (e) => {
                if (e.key === ContinueWatchingPlugin.CONFIG.HISTORY_KEY) {
                    this.history = this.loadHistory();
                    this.updateList();
                }
                if (e.key === "library_recent") {
                    this.updateList();
                }
            });

            // Initial check
            this.checkVisibility();
            this.updateList();
        }

        loadHistory() {
            try {
                const raw = localStorage.getItem(
                    ContinueWatchingPlugin.CONFIG.HISTORY_KEY
                );
                return raw ? JSON.parse(raw) : [];
            } catch {
                return [];
            }
        }

        saveHistory() {
            try {
                localStorage.setItem(
                    ContinueWatchingPlugin.CONFIG.HISTORY_KEY,
                    JSON.stringify(this.history)
                );
            } catch (e) {
                console.warn("Failed to save continue watching history", e);
            }
        }

        getLibraryRecent() {
            try {
                const raw = localStorage.getItem("library_recent");
                return raw ? JSON.parse(raw).items : [];
            } catch {
                return [];
            }
        }

        formatLastWatched(isoString) {
            if (!isoString) return "";
            const date = new Date(isoString);
            const now = new Date();
            const diffMs = now - date;
            const diffMins = Math.floor(diffMs / 60000);
            const diffHours = Math.floor(diffMins / 60);
            const diffDays = Math.floor(diffHours / 24);

            if (diffMins < 1) return "now";
            if (diffMins < 60) return `${diffMins}m`;
            if (diffHours < 24) return `${diffHours}h`;
            if (diffDays < 7) return `${diffDays}d`;
            return date.toLocaleDateString();
        }

        checkLastVideo() {
            try {
                const profileRaw = localStorage.getItem("localProfile");
                if (!profileRaw) return;

                const profile = JSON.parse(profileRaw);
                if (!profile.lastVideo) return;

                const lastId = profile.lastVideo;

                // Add to history if not already at the top
                if (this.history[0] !== lastId) {
                    // Remove if exists elsewhere to avoid duplicates
                    this.history = this.history.filter((id) => id !== lastId);

                    // Add to front
                    this.history.unshift(lastId);

                    // Limit size
                    if (
                        this.history.length >
                        ContinueWatchingPlugin.CONFIG.MAX_HISTORY
                    ) {
                        this.history.length =
                            ContinueWatchingPlugin.CONFIG.MAX_HISTORY;
                    }

                    this.saveHistory();
                    this.updateList();
                }
            } catch (e) {
                // Ignore errors reading profile
            }
        }

        async getNextEpisodeForSeries(seriesId, libItem) {
            const series = await this.metadataDB.get(seriesId);
            if (!series || series.type !== "series" || !series.videos)
                return null;

            // Sort videos
            const sortedVideos = [...series.videos].sort((a, b) => {
                if (a.season !== b.season) return a.season - b.season;
                return a.episode - b.episode;
            });

            let latestWatched = null;
            let lastWatchedTime = null;
            let timeOffset = 0;
            let duration = 0;

            // Try to use library item state first
            if (libItem && libItem.state) {
                if (libItem.state.video_id) {
                    // watched format: "tt123:1:2:..."
                    const parts = libItem.state.video_id.split(":");
                    const season = parseInt(parts[1]);
                    const episode = parseInt(parts[2]);

                    if (!isNaN(season) && !isNaN(episode)) {
                        latestWatched = { season, episode };
                        lastWatchedTime = libItem.state.lastWatched;
                    }
                }

                timeOffset = libItem.state.timeOffset || 0;
                duration = libItem.state.duration || 0;
            }

            // Fallback to MetadataDB watched status if library lookup failed
            if (!latestWatched) {
                for (let i = sortedVideos.length - 1; i >= 0; i--) {
                    if (sortedVideos[i].watched === true) {
                        latestWatched = sortedVideos[i];
                        break;
                    }
                }
            }

            if (!latestWatched) return null;

            // Determine if we should resume the current episode or play the next one
            let targetVideo = null;

            // If we have duration and we are less than 90% through, resume
            if (duration > 0 && timeOffset / duration < 0.9) {
                // Find the episode matching latestWatched
                targetVideo = sortedVideos.find(
                    (v) =>
                        v.season === latestWatched.season &&
                        v.episode === latestWatched.episode
                );
            }

            // If not resuming (or target not found), find next episode
            if (!targetVideo) {
                targetVideo = sortedVideos.find((v) => {
                    if (v.season > latestWatched.season) return true;
                    if (
                        v.season === latestWatched.season &&
                        v.episode > latestWatched.episode
                    )
                        return true;
                    return false;
                });
                // Reset progress for next episode
                timeOffset = 0;
                duration = 0;
            }

            if (targetVideo) {
                // Check released date
                const isLocked =
                    targetVideo.released &&
                    new Date(targetVideo.released).getTime() > Date.now();

                return {
                    seriesId: series.id,
                    seriesName: series.name || series.title,
                    logo: series.logo,
                    poster:
                        series.background ||
                        `https://images.metahub.space/background/medium/${series.id}/img`,
                    season: targetVideo.season,
                    episode: targetVideo.episode,
                    title:
                        targetVideo.name ||
                        targetVideo.title ||
                        `Episode ${targetVideo.episode}`,
                    videoId: `${series.id}:${targetVideo.season}:${targetVideo.episode}`,
                    lastWatched: lastWatchedTime,
                    timeOffset,
                    duration,
                    isLocked,
                    releaseDate: targetVideo.released,
                };
            }

            return null;
        }

        async getMovieProgress(movieId, libItem) {
            if (!libItem || !libItem.state) return null;
            const movie = await this.metadataDB.get(movieId);
            if (!movie) return null;

            const timeOffset = libItem.state.timeOffset || 0;
            const duration = libItem.state.duration || 0;
            const lastWatchedTime = libItem.state.lastWatched;

            // If we have duration and we are less than 90% through
            if (duration > 0 && timeOffset / duration < 0.9) {
                return {
                    seriesId: movie.id,
                    seriesName: movie.name,
                    logo: movie.logo,
                    poster: movie.poster,
                    background: movie.background,
                    isMovie: true,
                    title: movie.name,
                    videoId: movie.id,
                    lastWatched: lastWatchedTime,
                    timeOffset,
                    duration,
                    isLocked: false,
                };
            }
            return null;
        }

        async getContinueWatchingList() {
            if (this.history.length === 0) return [];

            await this.metadataDB.initPromise;
            const library = this.getLibraryRecent();

            const list = [];
            // Process all history items
            for (const seriesId of this.history) {
                // Handle potential malformed IDs in history
                const cleanId = seriesId.split(":")[0];
                if (!cleanId) continue;

                // Find in library_recent
                const libItem = library[cleanId];

                if (!libItem) continue;

                let next = null;
                if (libItem.type === "series") {
                    next = await this.getNextEpisodeForSeries(cleanId, libItem);
                } else if (libItem.type === "movie") {
                    next = await this.getMovieProgress(cleanId, libItem);
                }

                if (next && libItem.state.timeOffset > 0) {
                    list.push(next);
                } else {
                    this.removeItem(cleanId, true);
                }
            }

            // Sort locked items only to the end
            list.sort((a, b) => {
                if (a.isLocked === b.isLocked) return 0;
                return a.isLocked ? 1 : -1;
            });

            return list;
        }

        removeItem(seriesId, skipUpdate = false) {
            this.history = this.history.filter(
                (id) => id !== seriesId && !id.startsWith(seriesId + ":")
            );
            this.saveHistory();
            if (!skipUpdate) {
                this.updateList();
            }
        }

        renderContainer() {
            if (document.querySelector(".continue-watching-container")) return;

            const container = document.createElement("div");
            container.className = "continue-watching-container";
            container.style.display = "none";

            container.innerHTML = `
                <div class="cw-island">
                    <div class="cw-current-item">
                        <!-- Populated by updateList -->
                    </div>
                    <div class="cw-expanded-content">
                        <div class="cw-header">Continue Watching</div>
                        <ul class="cw-list"></ul>
                    </div>
                </div>
            `;

            document.body.appendChild(container);

            // Main click - play the most recent item
            const currentItem = container.querySelector(".cw-current-item");
            currentItem.addEventListener("click", async (e) => {
                // Ignore if clicked on remove button
                if (e.target.closest(".cw-remove-btn")) return;

                const list = await this.getContinueWatchingList();
                if (list.length > 0) {
                    const next = list[0];
                    window.location.hash = `#/detail/series/${
                        next.seriesId
                    }/${encodeURIComponent(next.videoId)}`;
                }
            });
        }

        checkVisibility() {
            const container = document.querySelector(
                ".continue-watching-container"
            );
            if (!container) return;

            const hash = window.location.hash;
            const isInPlayer = hash.includes("/player/");

            if (isInPlayer) {
                container.style.display = "none";
            } else {
                // We show it if we have items, which updateList handles
            }
        }

        async updateList() {
            const container = document.querySelector(
                ".continue-watching-container"
            );
            if (!container) return;

            const hash = window.location.hash;
            if (hash.includes("/player/")) {
                container.style.display = "none";
                return;
            }

            const listItems = await this.getContinueWatchingList();

            if (listItems.length === 0) {
                container.style.display = "none";
                return;
            }

            container.style.display = "block";

            const currentItemEl = container.querySelector(".cw-current-item");
            const listEl = container.querySelector(".cw-list");
            const islandEl = container.querySelector(".cw-island");

            // Update Current Item (First one)
            const first = listItems[0];
            const LogoOrTitle = first.logo
                ? `<img src="${first.logo}" class="cw-logo-mini" />`
                : `<div class="cw-title-mini">${first.seriesName}</div>`;

            let progressBarHtml = "";
            if (first.duration > 0 && first.timeOffset > 0 && !first.isLocked) {
                const percentage = Math.min(
                    100,
                    Math.max(0, (first.timeOffset / first.duration) * 100)
                );
                progressBarHtml = `
                    <div class="cw-progress-bar">
                        <div class="cw-progress-fill" style="width: ${percentage}%"></div>
                    </div>
                `;
            }

            let lockedOverlayHtml = "";
            if (first.isLocked) {
                lockedOverlayHtml = `
                    <div class="cw-locked-overlay">
                        <div class="cw-lock-icon">
                            <svg viewBox="0 0 24 24"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3 3.1-3 1.71 0 3.1 1.29 3.1 3v2z"/></svg>
                        </div>
                        <div class="cw-timer">${this.formatCountdown(
                            first.releaseDate
                        )}</div>
                    </div>
                `;
            }

            currentItemEl.innerHTML = `
                <div class="cw-poster-wrapper">
                    <img src="${
                        first.poster
                    }" class="cw-poster-mini" onerror="this.style.display='none'">
                    ${
                        !first.isLocked
                            ? `<div class="cw-play-icon">
                        <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                    </div>`
                            : ""
                    }
                    ${lockedOverlayHtml}
                </div>
                <div class="cw-info-mini">
                    ${LogoOrTitle}
                    ${
                        !first.isMovie
                            ? `<div class="cw-ep-mini">S${first.season} E${first.episode}</div>`
                            : ""
                    }
                    <div class="cw-ep-title-mini"> ${
                        first.isMovie ? "" : "- "
                    }${first.title}</div>
                    ${
                        first.lastWatched && !first.isLocked
                            ? `<div class="cw-last-watched-mini">${this.formatLastWatched(
                                  first.lastWatched
                              )}</div>`
                            : ""
                    }

                </div>
                <div class="cw-remove-btn" title="Remove from history">
                    <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                </div>
                ${progressBarHtml}
            `;

            // Add locked class if needed
            if (first.isLocked) {
                currentItemEl.classList.add("cw-locked");
            } else {
                currentItemEl.classList.remove("cw-locked");
            }

            const removeBtn = currentItemEl.querySelector(".cw-remove-btn");
            removeBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                this.removeItem(first.seriesId);
            });

            // Update List (Rest)
            const rest = listItems.slice(1);
            listEl.innerHTML = "";

            if (rest.length === 0) {
                islandEl.classList.add("only-one");
            } else {
                islandEl.classList.remove("only-one");
                rest.forEach((item) => {
                    const logoOrTitleRest = item.logo
                        ? `<img src="${item.logo}" class="cw-series-logo" />`
                        : `<div class="cw-series-title">${item.seriesName}</div>`;

                    let itemLockedHtml = "";
                    if (item.isLocked) {
                        itemLockedHtml = `
                            <div class="cw-locked-overlay small">
                                <div class="cw-lock-icon">
                                    <svg viewBox="0 0 24 24"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3 3.1-3 1.71 0 3.1 1.29 3.1 3v2z"/></svg>
                                </div>
                            </div>
                        `;
                    }

                    const li = document.createElement("li");
                    li.className = "cw-item";
                    if (item.isLocked) li.classList.add("cw-locked");

                    li.innerHTML = `
                        <div class="cw-poster-wrapper">
                        <img src="${
                            item.poster
                        }" class="cw-poster" onerror="this.style.display='none'">
                        ${
                            !item.isLocked
                                ? `<div class="cw-play-icon">
                        <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                    </div>`
                                : ""
                        }
                        ${itemLockedHtml}
                        </div>
                        <div class="cw-info">
                            ${logoOrTitleRest}
                            <div class="cw-episode-info">${
                                item.isMovie
                                    ? item.title
                                    : `S${item.season} E${item.episode} - ${item.title}`
                            }</div>
                             ${
                                 item.isLocked
                                     ? `<div class="cw-timer-small">${this.formatCountdown(
                                           item.releaseDate
                                       )}</div>`
                                     : item.lastWatched
                                     ? `<div class="cw-last-watched">${this.formatLastWatched(
                                           item.lastWatched
                                       )}</div>`
                                     : ""
                             }
                        </div>
                        <div class="cw-remove-btn" title="Remove from history">
                            <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                        </div>
                    `;

                    li.addEventListener("click", (e) => {
                        // Ignore if clicked on remove button
                        if (e.target.closest(".cw-remove-btn")) return;

                        // Prevent click if locked
                        if (item.isLocked) return;

                        e.stopPropagation();
                        if (item.isMovie) {
                            window.location.hash = `#/detail/movie/${item.seriesId}`;
                        } else {
                            window.location.hash = `#/detail/series/${
                                item.seriesId
                            }/${encodeURIComponent(item.videoId)}`;
                        }
                    });

                    const itemRemoveBtn = li.querySelector(".cw-remove-btn");
                    itemRemoveBtn.addEventListener("click", (e) => {
                        e.stopPropagation();
                        this.removeItem(item.seriesId);
                    });

                    listEl.appendChild(li);
                });
            }
        }

        formatCountdown(dateStr) {
            if (!dateStr) return "";
            const target = new Date(dateStr).getTime();
            const now = Date.now();
            const diff = target - now;

            if (diff <= 0) return "Available";

            const days = Math.floor(diff / (1000 * 60 * 60 * 24));
            const hours = Math.floor(
                (diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)
            );

            if (days > 0) return `${days}d ${hours}h`;
            return `${hours}h`;
        }
    }

    // Initialize
    if (window.MetadataDB) {
        new ContinueWatchingPlugin();
    } else {
        const checkInterval = setInterval(() => {
            if (window.MetadataDB) {
                clearInterval(checkInterval);
                new ContinueWatchingPlugin();
            }
        }, 100);
    }
})();
