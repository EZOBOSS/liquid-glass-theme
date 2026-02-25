/* *
 * @name New Season Reminder
 * @description Right-side banner with countdown for new season premieres within 7 days
 * @version 1.0.0
 * @author EZOBOSS
 * @dependencies metadatadb.plugin.js
 */

(function () {
    class NewSeasonReminderPlugin {
        static CONFIG = {
            COUNTDOWN_WINDOW_MS: 7 * 24 * 60 * 60 * 1000, // 7 days
            TICK_INTERVAL: 60000, // 1 minute
            FETCH_TIMEOUT: 5000,
            REFRESH_INTERVAL: 1000 * 60 * 30, // Re-scan every 30 minutes
            URLS: {
                CINEMETA_META: "https://cinemeta-live.strem.io/meta",
                POSTER: "https://images.metahub.space/background/medium",
                LOGO: "https://images.metahub.space/logo/medium",
            },
            STORAGE_KEY: "library_recent",
        };

        constructor() {
            this.metadataDB = window.MetadataDB;
            this.countdownInterval = null;
            this.refreshInterval = null;
            this.reminders = []; // { id, title, season, releaseDate, poster, logo, href }
            this.bannerEl = null;
            this.init();
        }

        isBoardPage() {
            const h = window.location.hash;
            return h === "#/" || h === "" || h === "#";
        }

        init() {
            this.scanAndRender();

            // Re-scan on navigation
            window.addEventListener("hashchange", () => {
                if (this.isBoardPage()) {
                    this.scanAndRender();
                } else {
                    this.removeBanner();
                }
            });

            // Periodic refresh
            this.refreshInterval = setInterval(() => {
                if (this.isBoardPage()) this.scanAndRender();
            }, NewSeasonReminderPlugin.CONFIG.REFRESH_INTERVAL);
        }

        // ─── Data ────────────────────────────────────────────

        getUserLibrarySeries() {
            try {
                const raw = localStorage.getItem(
                    NewSeasonReminderPlugin.CONFIG.STORAGE_KEY,
                );
                if (!raw) return [];
                const library = JSON.parse(raw);
                const items = Object.values(library.items || {});

                return items.filter((item) => {
                    if (item?.type !== "series") return false;
                    if (!item?._id?.startsWith("tt")) return false;
                    const watched = item?.state?.watched;
                    if (!watched) return false;
                    const [, s, e] = watched.split(":");
                    return +s > 1 || +e > 1;
                });
            } catch {
                return [];
            }
        }

        /**
         * Find the first episode of a new season releasing within 7 days.
         * Returns { season, releaseDate } or null.
         */
        findUpcomingNewSeason(meta) {
            if (!Array.isArray(meta.videos)) return null;

            const now = Date.now();
            const cutoff =
                now + NewSeasonReminderPlugin.CONFIG.COUNTDOWN_WINDOW_MS;
            let best = null;

            for (const v of meta.videos) {
                // Only care about season premieres (episode 1, season > 0)
                if (v.episode !== 1 || v.season < 1) continue;
                if (!v.released) continue;

                const releaseMs = Date.parse(v.released);
                if (isNaN(releaseMs)) continue;

                // Must be in the future and within the 7-day window
                if (releaseMs <= now || releaseMs > cutoff) continue;

                if (!best || releaseMs < best.releaseMs) {
                    best = {
                        season: v.season,
                        releaseMs,
                        releaseDate: new Date(releaseMs),
                    };
                }
            }

            return best;
        }

        async scanLibrary() {
            const series = this.getUserLibrarySeries();
            if (!series.length) return [];

            const reminders = [];
            const { CINEMETA_META, POSTER, LOGO } =
                NewSeasonReminderPlugin.CONFIG.URLS;

            for (const item of series) {
                const id = item._id;
                try {
                    let meta = await this.metadataDB.get(id, "series");

                    if (!meta) {
                        // Fetch from API if not cached
                        const controller = new AbortController();
                        const tid = setTimeout(
                            () => controller.abort(),
                            NewSeasonReminderPlugin.CONFIG.FETCH_TIMEOUT,
                        );
                        try {
                            const res = await fetch(
                                `${CINEMETA_META}/series/${id}.json`,
                                { signal: controller.signal },
                            );
                            clearTimeout(tid);
                            if (!res.ok) continue;
                            const data = await res.json();
                            meta = data?.meta;
                            if (meta) {
                                await this.metadataDB.put(id, meta, "series");
                            }
                        } catch {
                            clearTimeout(tid);
                            continue;
                        }
                    }

                    if (!meta) continue;

                    const upcoming = this.findUpcomingNewSeason(meta);
                    if (!upcoming) continue;

                    reminders.push({
                        id,
                        title: meta.name,
                        season: upcoming.season,
                        releaseDate: upcoming.releaseDate,
                        releaseMs: upcoming.releaseMs,
                        poster: `${POSTER}/${id}/img`,
                        logo: `${LOGO}/${id}/img`,
                        href: `#/detail/series/${id}/${id}%3A${upcoming.season}%3A1`,
                    });
                } catch (err) {
                    console.warn(
                        `[NewSeasonReminder] Error processing ${id}:`,
                        err,
                    );
                }
            }

            // Sort by closest release first
            reminders.sort((a, b) => a.releaseMs - b.releaseMs);
            return reminders;
        }

        // ─── Countdown ──────────────────────────────────────

        formatCountdown(targetMs) {
            const diff = targetMs - Date.now();
            if (diff <= 0) return { text: "NOW", ended: true };

            const days = Math.floor(diff / 86400000);
            const hours = Math.floor((diff % 86400000) / 3600000);
            const minutes = Math.floor((diff % 3600000) / 60000);

            const parts = [];
            if (days > 0) parts.push(`${days}d`);
            parts.push(`${String(hours).padStart(2, "0")}h`);
            parts.push(`${String(minutes).padStart(2, "0")}m`);

            return { text: parts.join(" "), ended: false };
        }

        startCountdown() {
            this.stopCountdown();
            this.tickCountdowns(); // Immediate tick

            this.countdownInterval = setInterval(
                () => this.tickCountdowns(),
                NewSeasonReminderPlugin.CONFIG.TICK_INTERVAL,
            );
        }

        stopCountdown() {
            if (this.countdownInterval) {
                clearInterval(this.countdownInterval);
                this.countdownInterval = null;
            }
        }

        tickCountdowns() {
            if (!this.bannerEl) return;

            const items = this.bannerEl.querySelectorAll(
                ".nsr-countdown-value",
            );
            let allEnded = true;

            items.forEach((el, i) => {
                const reminder = this.reminders[i];
                if (!reminder) return;

                const { text, ended } = this.formatCountdown(
                    reminder.releaseMs,
                );
                el.textContent = text;

                if (ended) {
                    el.classList.add("nsr-ended");
                } else {
                    allEnded = false;
                }
            });

            if (allEnded && this.reminders.length > 0) {
                this.stopCountdown();
            }
        }

        // ─── Rendering ──────────────────────────────────────

        async scanAndRender() {
            const reminders = await this.scanLibrary();
            this.reminders = reminders;

            if (reminders.length === 0) {
                this.removeBanner();
                return;
            }

            this.renderBanner();
            this.startCountdown();
        }

        renderBanner() {
            // Remove existing
            this.removeBanner();

            const banner = document.createElement("div");
            banner.className = "nsr-banner";
            banner.innerHTML = `
                <div class="nsr-items">
                    ${this.reminders.map((r) => this.renderItem(r)).join("")}
                </div>
            `;

            // Click handler via delegation
            banner.addEventListener("click", (e) => {
                const item = e.target.closest(".nsr-item");
                if (item?.dataset.href) {
                    window.location.hash = item.dataset.href.replace("#", "");
                }
            });

            document.body.appendChild(banner);
            this.bannerEl = banner;

            // Trigger entrance animation
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    banner.classList.add("nsr-visible");
                });
            });
        }

        renderItem(reminder) {
            return `
                <a class="nsr-item" data-href="${reminder.href}" tabindex="0">
                    <div class="nsr-poster-wrap">
                        <img class="nsr-poster" src="${reminder.poster}" alt="${reminder.title}" loading="lazy" />
                    </div>
                    <div class="nsr-details">
                        <img class="nsr-logo" src="${reminder.logo}" alt="${reminder.title}" loading="lazy"
                             onerror="this.style.display='none'; this.nextElementSibling.style.display='block';" />
                        <span class="nsr-title-fallback" style="display:none;">${reminder.title}</span>
                        <span class="nsr-season-label">Season ${reminder.season}</span>
                        <div class="nsr-countdown">
                            <span class="nsr-countdown-label">Premieres in</span>
                            <span class="nsr-countdown-value">--</span>
                        </div>
                    </div>
                </a>
            `;
        }

        removeBanner() {
            this.stopCountdown();
            if (this.bannerEl) {
                this.bannerEl.remove();
                this.bannerEl = null;
            }
        }
    }

    // Initialize
    requestIdleCallback(() => {
        if (window.MetadataDB) {
            new NewSeasonReminderPlugin();
        } else {
            // Wait for MetadataDB to be available
            const check = setInterval(() => {
                if (window.MetadataDB) {
                    clearInterval(check);
                    new NewSeasonReminderPlugin();
                }
            }, 500);
        }
    });
})();
