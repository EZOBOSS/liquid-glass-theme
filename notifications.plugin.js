/**
 * @name Notifications Plugin
 * @description Shows notifications for unwatched episodes of watched series
 * @version 1.0.0
 * @author EZOBOSS
 */

(function () {
    class NotificationsPlugin {
        static CONFIG = {
            CACHE_KEY: "videos_cache_all",
            SEEN_CACHE_KEY: "notifications_seen",
        };

        constructor() {
            this.notifications = [];
            this.seenNotifications = this.loadSeenState();
            this.init();
        }

        init() {
            this.renderBell();
            this.updateNotifications();

            // Check on navigation to home
            window.addEventListener("hashchange", () => {
                // Hide bell in player, show otherwise
                this.toggleBellVisibility();

                if (!window.location.hash || window.location.hash === "#/") {
                    this.updateNotifications();
                }
            });

            // Listen for storage changes (in case upcoming list updates cache)
            window.addEventListener("storage", (e) => {
                if (e.key === NotificationsPlugin.CONFIG.CACHE_KEY) {
                    this.updateNotifications();
                }
            });
        }

        toggleBellVisibility() {
            const container = document.querySelector(
                ".notifications-container"
            );
            if (!container) return;

            const hash = window.location.hash;
            const isInPlayer = hash.includes("/player/");

            container.style.display = isInPlayer ? "none" : "block";
        }

        loadSeenState() {
            try {
                const raw = localStorage.getItem(
                    NotificationsPlugin.CONFIG.SEEN_CACHE_KEY
                );
                return raw ? new Set(JSON.parse(raw)) : new Set();
            } catch {
                return new Set();
            }
        }

        saveSeenState() {
            try {
                requestIdleCallback(() => {
                    localStorage.setItem(
                        NotificationsPlugin.CONFIG.SEEN_CACHE_KEY,
                        JSON.stringify([...this.seenNotifications])
                    );
                });
            } catch (e) {
                console.warn("Failed to save seen notifications", e);
            }
        }

        markAsSeen(id) {
            if (!this.seenNotifications.has(id)) {
                this.seenNotifications.add(id);
                this.saveSeenState();

                // Update the isSeen property in the notifications array
                const notif = this.notifications.find((n) => n.id === id);
                if (notif) {
                    notif.isSeen = true;
                }

                this.updateBadge();

                // Visually mark as seen
                const el = document.getElementById(`notif-${id}`);
                if (el) {
                    el.classList.add("seen");
                }
            }
        }

        markAllAsSeen() {
            // Get all unseen notifications
            const unseenNotifications = this.notifications.filter(
                (n) => !n.isSeen
            );

            if (unseenNotifications.length === 0) return;

            // Mark each as seen
            unseenNotifications.forEach((notif) => {
                this.seenNotifications.add(notif.id);
                notif.isSeen = true;

                // Visually mark as seen
                const el = document.getElementById(`notif-${notif.id}`);
                if (el) {
                    el.classList.add("seen");
                }
            });

            this.saveSeenState();
            this.updateBadge();
        }

        getTimeSinceRelease(releaseDate) {
            const now = Date.now();
            const released = new Date(releaseDate).getTime();
            const diffMs = now - released;

            const minute = 60 * 1000;
            const hour = 60 * minute;
            const day = 24 * hour;
            const month = 30 * day;
            const year = 365 * day;

            if (diffMs < hour) {
                const minutes = Math.floor(diffMs / minute);
                return minutes <= 1 ? "1m" : `${minutes}m`;
            } else if (diffMs < day) {
                const hours = Math.floor(diffMs / hour);
                return `${hours}h`;
            } else if (diffMs < month) {
                const days = Math.floor(diffMs / day);
                return `${days}d`;
            } else if (diffMs < year) {
                const months = Math.floor(diffMs / month);
                return `${months}mo`;
            } else {
                const years = Math.floor(diffMs / year);
                return `${years}y`;
            }
        }

        getMetadata() {
            try {
                const raw = localStorage.getItem(
                    NotificationsPlugin.CONFIG.CACHE_KEY
                );
                if (!raw) return {};
                // The cache structure is { key: { value: data, timestamp: ... } }
                const cache = JSON.parse(raw);
                return cache;
            } catch (e) {
                console.warn("Failed to read video cache", e);
                return {};
            }
        }

        updateNotifications() {
            const cache = this.getMetadata();
            const notifications = [];
            const now = Date.now();

            Object.values(cache).forEach((entry) => {
                const series = entry.value;
                if (!series || series.type !== "series" || !series.videos)
                    return;

                // 1. Find the latest season where user watched Ep 1
                const watchedSeasons = new Set();
                series.videos.forEach((v) => {
                    // Check individual video watched status
                    if (v.watched === true && v.episode === 1) {
                        watchedSeasons.add(v.season);
                    }
                });

                if (watchedSeasons.size === 0) return;
                const latestStartedSeason = Math.max(...watchedSeasons);

                // 2. Find the absolute latest released season for the show
                let latestReleasedSeason = 0;
                series.videos.forEach((v) => {
                    if (
                        v.season > latestReleasedSeason &&
                        v.season > 0 &&
                        v.released
                    ) {
                        // Check if released date is in the past
                        if (new Date(v.released).getTime() <= now) {
                            latestReleasedSeason = v.season;
                        }
                    }
                });

                // 3. Relevance Check:
                // If user is more than 1 season behind, don't show notifications.
                // e.g. User on S2, Show on S4. Gap = 2. Skip.
                // e.g. User on S3, Show on S4. Gap = 1. Allow (New season alert).
                if (latestReleasedSeason - latestStartedSeason > 1) return;

                // 4. Find unwatched, released episodes
                // Constraint: Only show notifications for the LATEST released season.
                // This prevents "backlog" notifications (e.g. S3E5) when S4 is already out.
                series.videos.forEach((video) => {
                    if (video.season !== latestReleasedSeason) return;
                    if (video.season === 0) return;

                    // Check if released
                    if (!video.released) return;
                    const releaseDate = new Date(video.released).getTime();
                    if (releaseDate > now) return; // Not released yet

                    // Check if too old (more than 1 year)
                    const oneYearMs = 365 * 24 * 60 * 60 * 1000;
                    if (now - releaseDate > oneYearMs) return;

                    // Check if watched (individual video property)
                    if (video.watched === true) return;

                    // Unique ID for the notification
                    const notifId = `${series.id}-${video.season}-${video.episode}`;

                    // if (this.seenNotifications.has(notifId)) return;

                    const isSeen = this.seenNotifications.has(notifId);

                    notifications.push({
                        id: notifId,
                        seriesId: series.id,
                        seriesName: series.name || series.title,
                        season: video.season,
                        episode: video.episode,
                        title: video.title || `Episode ${video.episode}`,
                        thumbnail:
                            video.thumbnail ||
                            series.poster ||
                            `https://images.metahub.space/poster/small/${series.id}/img`,
                        released: video.released,
                        isSeen: isSeen,
                    });
                });
            });

            // Sort by released date (newest first)
            notifications.sort(
                (a, b) => new Date(b.released) - new Date(a.released)
            );
            // Limit to 50 notifications
            //  notifications = notifications.slice(0, 50);

            this.notifications = notifications;
            this.renderList();
            this.updateBadge();
        }

        renderBell() {
            const container = document.createElement("div");
            container.className = "notifications-container";
            container.innerHTML = `
                <div class="notification-bell">
                    <svg viewBox="0 0 24 24">
                        <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2zm-2 1H8v-6c0-2.48 1.51-4.5 4-4.5s4 2.02 4 4.5v6z"/>
                    </svg>
                    <div class="notification-badge" style="display: none;">0</div>
                </div>
                <div class="notifications-dropdown">
                    <div class="notifications-header">
                        <span>New Episodes</span>
                        <button class="mark-all-seen-btn">Mark All as Seen</button>
                    </div>
                    <ul class="notification-list"></ul>
                </div>
            `;
            document.body.appendChild(container);

            // Add event listener for "Mark All as Seen" button
            const markAllBtn = container.querySelector(".mark-all-seen-btn");
            if (markAllBtn) {
                markAllBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    this.markAllAsSeen();
                });
            }
        }

        renderList() {
            const list = document.querySelector(".notification-list");
            if (!list) return;

            list.innerHTML = "";

            if (this.notifications.length === 0) {
                list.innerHTML =
                    '<div class="empty-state">No new episodes</div>';
                return;
            }

            this.notifications.forEach((notif) => {
                const li = document.createElement("li");
                li.className = `notification-item ${
                    notif.isSeen ? "seen" : ""
                }`;
                li.id = `notif-${notif.id}`;
                li.innerHTML = `
                    <img src="${
                        notif.thumbnail
                    }" class="notif-thumb" onerror="this.onerror=null; this.src='https://images.metahub.space/poster/small/${
                    notif.seriesId
                }/img';">
                    <div class="notif-content">
                        <div class="notif-time-since">${this.getTimeSinceRelease(
                            notif.released
                        )}</div>
                        <div class="notif-series">${notif.seriesName}</div>
                        <div class="notif-episode">S${notif.season} E${
                    notif.episode
                } - ${notif.title}</div>
                        <div class="notif-time">${new Date(
                            notif.released
                        ).toLocaleDateString()}</div>
                    </div>
                `;

                // Mark as seen on hover
                li.addEventListener("mouseenter", () => {
                    // Small delay to prevent accidental clearing
                    this.markTimeout = setTimeout(() => {
                        this.markAsSeen(notif.id);
                    }, 1000);
                });

                li.addEventListener("mouseleave", () => {
                    if (this.markTimeout) clearTimeout(this.markTimeout);
                });

                // Click to navigate (optional, can be added later)
                li.addEventListener("click", () => {
                    window.location.hash = `#/detail/series/${notif.seriesId}`;
                });

                list.appendChild(li);
            });
        }

        updateBadge() {
            const badge = document.querySelector(".notification-badge");
            if (!badge) return;

            const count = this.notifications.filter((n) => !n.isSeen).length;
            if (count > 0) {
                badge.style.display = "flex";
                badge.textContent = count > 99 ? "99+" : count;
            } else {
                badge.style.display = "none";
            }
        }
    }

    new NotificationsPlugin();
})();
