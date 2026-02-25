/**
 * @name Hover Info Panel
 * @description Shows episode info panel when hovering cards on home screen
 * @version 1.0.0
 * @author EZOBOSS
 * @dependencies metadatadb.plugin.js
 */

(function () {
    "use strict";

    class HoverInfoPanel {
        static CONFIG = {
            CARD_SELECTOR: ".meta-item-container-Tj0Ib",
            CONTAINER_SELECTOR: ".meta-items-container-qcuUA",
            PANEL_ID: "hover-info-panel",
            HOVER_DELAY: 150, // ms before showing panel
            MAX_EPISODES: 50, // Max episodes to display per section
        };

        constructor() {
            this.panel = null;
            this.hoverTimeout = null;
            this.currentCardId = null;
            this.metadataDB = null;
            this.isVisible = false;
            this.metadataDB = window.MetadataDB;

            this.init();
        }

        async init() {
            console.log("[HoverInfoPanel] Initializing...");

            this.createPanel();
            console.log("[HoverInfoPanel] Panel created");

            this.setupEventListeners();
            console.log("[HoverInfoPanel] Event listeners ready");
        }

        createPanel() {
            if (document.getElementById(HoverInfoPanel.CONFIG.PANEL_ID)) return;

            this.panel = document.createElement("div");
            this.panel.id = HoverInfoPanel.CONFIG.PANEL_ID;
            this.panel.className = "hover-info-panel";
            this.panel.innerHTML = `
               <img src="" class="hover-info-background">
                <div class="hover-info-header">
                    <div class="hover-info-title"></div>
                    <div class="hover-info-subtitle"></div>
                </div>
                <div class="hover-info-content">
                    <div class="hover-info-section hover-info-upcoming">
                        <h4>📅 Upcoming</h4>
                        <div class="hover-info-grid"></div>
                    </div>
                    <div class="hover-info-section hover-info-released">
                        <h4>📺 Released</h4>
                        <div class="hover-info-grid"></div>
                    </div>
                </div>
            `;

            document.body.appendChild(this.panel);
        }

        setupEventListeners() {
            // Use event delegation on document for efficiency
            document.addEventListener(
                "mouseenter",
                this.handleMouseEnter.bind(this),
                true,
            );
            document.addEventListener(
                "mouseleave",
                this.handleMouseLeave.bind(this),
                true,
            );

            // Hide panel when navigating away
            window.addEventListener("hashchange", () => this.hidePanel());
        }

        handleMouseEnter(e) {
            if (!e.target || typeof e.target.closest !== "function") return;
            const card = e.target.closest(HoverInfoPanel.CONFIG.CARD_SELECTOR);
            if (!card) return;

            // Only show on home screen
            if (!this.isBoardPage()) {
                console.log("[HoverInfoPanel] Not on board page");
                return;
            }

            // Clear any existing timeout
            if (this.hoverTimeout) {
                clearTimeout(this.hoverTimeout);
            }

            const cardId = this.extractCardId(card);

            if (!cardId) {
                console.log("[HoverInfoPanel] No card ID found");
                return;
            }

            // Delay before showing to prevent flicker
            this.hoverTimeout = setTimeout(() => {
                this.showPanelForCard(card, cardId);
            }, HoverInfoPanel.CONFIG.HOVER_DELAY);
        }

        handleMouseLeave(e) {
            if (!e.target || typeof e.target.closest !== "function") return;
            const card = e.target.closest(HoverInfoPanel.CONFIG.CARD_SELECTOR);
            if (!card) return;

            // Clear pending show
            if (this.hoverTimeout) {
                clearTimeout(this.hoverTimeout);
                this.hoverTimeout = null;
            }

            // Check if mouse moved to the panel itself
            const relatedTarget = e.relatedTarget;
            if (
                relatedTarget &&
                (relatedTarget === this.panel ||
                    this.panel.contains(relatedTarget))
            ) {
                return; // Don't hide if moving to panel
            }

            this.hidePanel();
        }

        isBoardPage() {
            const h = window.location.hash;
            return h === "#/" || h === "" || h === "#";
        }

        extractCardId(card) {
            // 3. Check anchor link ID
            const anchor = card.querySelector("a");
            if (anchor?.id && anchor.id.startsWith("tt")) return anchor.id;

            // 4. Check anchor href for IMDB ID pattern
            const href = anchor?.getAttribute("href") || "";
            const match = href.match(/\/(tt\d+)/);
            if (match) return match[1];

            // 6. Check data-id on img
            const img = card.querySelector("img");
            const imgId = img.src?.match(/\/(tt\d+)/);
            if (imgId) return imgId[1];

            return null;
        }

        async showPanelForCard(card, cardId) {
            const enchanedTitleBar = card.querySelector(".enhanced-title-bar");

            if (enchanedTitleBar?.dataset.type === "movie") return;
            if (this.currentCardId === cardId && this.isVisible) return;

            if (this.currentCardId === cardId && this.panel) {
                // Same ID but hidden, just show it again without re-render
                this.panel.classList.add("visible");
                this.isVisible = true;
                return;
            }

            this.currentCardId = cardId;

            try {
                // Determine type - check if series (tt prefix with series type)
                const type = card.dataset.type || "series";
                const meta = await this.metadataDB.get(cardId, type);

                if (!meta) {
                    // Try fetching as series if movie lookup failed
                    if (type !== "series") {
                        const seriesMeta = await this.metadataDB.get(
                            cardId,
                            "series",
                        );
                        if (seriesMeta && seriesMeta.videos) {
                            this.renderPanel(card, seriesMeta);
                            return;
                        }
                    }
                    this.hidePanel();
                    return;
                }

                // Only show for series with episodes
                if (!meta.videos || meta.videos.length === 0) {
                    this.hidePanel();
                    return;
                }

                this.renderPanel(card, meta);
            } catch (error) {
                console.error(
                    "[HoverInfoPanel] Error fetching metadata:",
                    error,
                );
                this.hidePanel();
            }
        }

        renderPanel(card, meta) {
            const now = Date.now();

            // Parse episodes into upcoming and released
            const upcoming = [];
            const released = [];

            for (const video of meta.videos) {
                if (!video.released) continue;

                const releaseDate = Date.parse(video.released);
                if (isNaN(releaseDate)) continue;

                const episodeData = {
                    season: video.season || 0,
                    episode: video.episode || video.number || 0,
                    title:
                        video.title ||
                        video.name ||
                        `Episode ${video.episode || video.number || 0}`,
                    released: video.released,
                    releaseDate: releaseDate,
                    watched: video.watched === true,
                };

                if (releaseDate > now) {
                    upcoming.push(episodeData);
                } else {
                    released.push(episodeData);
                }
            }

            // Sort episodes by season then episode (ascending for left-to-right display)
            upcoming.sort(
                (a, b) => a.season - b.season || a.episode - b.episode,
            );
            released.sort(
                (a, b) => a.season - b.season || a.episode - b.episode,
            );

            // If no episodes to show, hide panel
            if (upcoming.length === 0 && released.length === 0) {
                this.hidePanel();
                return;
            }

            const bgImg = this.panel.querySelector(".hover-info-background");
            bgImg.src = meta.background;

            // Update header
            const titleEl = this.panel.querySelector(".hover-info-title");
            const subtitleEl = this.panel.querySelector(".hover-info-subtitle");
            titleEl.textContent = meta.name || "Unknown Series";

            // Count seasons
            const seasons = new Set(
                meta.videos.map((v) => v.season).filter((s) => s > 0),
            );
            const episodeCount = meta.videos.filter(
                (v) => (v.season || 0) > 0,
            ).length;
            subtitleEl.textContent = `${seasons.size} seasons · ${episodeCount} episodes`;

            // Render upcoming section
            const upcomingSection = this.panel.querySelector(
                ".hover-info-upcoming",
            );
            const upcomingGrid =
                upcomingSection.querySelector(".hover-info-grid");

            if (upcoming.length > 0) {
                upcomingSection.style.display = "";
                upcomingGrid.innerHTML = this.renderGroupedBySeason(
                    upcoming,
                    true,
                );
            } else {
                upcomingSection.style.display = "none";
            }

            // Render released section
            const releasedSection = this.panel.querySelector(
                ".hover-info-released",
            );
            const releasedGrid =
                releasedSection.querySelector(".hover-info-grid");

            if (released.length > 0) {
                releasedSection.style.display = "";
                releasedGrid.innerHTML = this.renderGroupedBySeason(
                    released,
                    false,
                );
            } else {
                releasedSection.style.display = "none";
            }

            // Show panel (fixed position in CSS)
            this.panel.classList.add("visible");
            this.isVisible = true;
        }

        renderGroupedBySeason(episodes, isUpcoming) {
            // Group by season, skip season 0
            const bySeason = new Map();
            for (const ep of episodes) {
                const s = ep.season || 0;
                if (s === 0) continue; // Skip season 0 (specials)
                if (!bySeason.has(s)) bySeason.set(s, []);
                bySeason.get(s).push(ep);
            }

            // Sort seasons (ascending for upcoming, descending for released)
            const sortedSeasons = [...bySeason.keys()].sort((a, b) =>
                isUpcoming ? a - b : b - a,
            );

            return sortedSeasons
                .map((season) => {
                    const seasonEpisodes = bySeason.get(season);
                    // Find earliest release year for this season
                    const years = seasonEpisodes
                        .map((ep) =>
                            ep.released
                                ? new Date(ep.released).getFullYear()
                                : null,
                        )
                        .filter((y) => y !== null && !isNaN(y));

                    const seasonYear =
                        years.length > 0 ? Math.min(...years) : null;
                    const yearDisplay = seasonYear ? ` (${seasonYear})` : "";

                    return `
                        <div class="season-group">
                            <div class="season-header">Season ${season}${yearDisplay}</div>
                            <div class="season-episodes">
                                ${seasonEpisodes
                                    .map((ep) =>
                                        this.renderEpisodeItem(ep, isUpcoming),
                                    )
                                    .join("")}
                            </div>
                        </div>
                    `;
                })
                .join("");
        }

        renderEpisodeItem(episode, isUpcoming) {
            const dateStr = this.formatDate(episode.released);

            const watchedClass = episode.watched ? "watched" : "";
            const typeClass = isUpcoming ? "upcoming" : "released";

            return `
                <div class="episode-card ${watchedClass} ${typeClass}">
                    <div class="episode-badge">${episode.episode}</div>
                    <div class="episode-title">${this.escapeHtml(episode.title)}</div>
                    <div class="episode-meta">
                        <span class="episode-date">${dateStr}</span>
                    </div>
                    ${episode.watched ? '<div class="episode-watched">✓</div>' : ""}
                </div>
            `;
        }

        formatDate(dateString) {
            const date = new Date(dateString);
            return date.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
            });
        }

        escapeHtml(text) {
            const div = document.createElement("div");
            div.textContent = text;
            return div.innerHTML;
        }

        hidePanel() {
            if (!this.isVisible) return;

            this.panel.classList.remove("visible");
            this.isVisible = false;
        }
    }

    requestIdleCallback(() => {
        if (
            window.StremioSettings &&
            window.StremioSettings.isEnabled("HoverInfoPanel")
        ) {
            new HoverInfoPanel();
        } else if (!window.StremioSettings) {
            // Fallback if settings-toggle.plugin.js is not loaded or failed
            new HoverInfoPanel();
        }
    });
})();
