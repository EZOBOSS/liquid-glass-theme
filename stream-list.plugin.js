/**
 * @name Stream List Sorter Plugin
 * @description Adds a button to sort streams by file size (largest first), quality tags, and episode matching
 * @version 1.1.0
 * @author EZOBOSS
 */

class StreamListSorter {
    constructor() {
        this.observer = null;
        this.processedContainers = new WeakSet();
        this.sortButton = null;

        // ========================================
        // QUALITY TAGS CONFIGURATION
        // To add a new tag, just add an entry here!
        // Use 6-digit hex colors only (e.g., #ff9800)
        // ========================================
        this.qualityTagsConfig = [
            { tag: "HDR", color: "#ff9800" }, // Orange
            { tag: "DV", color: "#9c27b0" }, // Purple
            { tag: "DOLBY VISION", color: "#9c27b0" }, // Purple - matches full text
            { tag: "(?:BD|UHD)?REMUX", color: "#4eb951" }, // Green - matches REMUX, BDRemux, UHDRemux
            { tag: "IMAX", color: "#00bcd4" }, // Cyan
            { tag: "TMAX", color: "#00bcd4" }, // Cyan
            { tag: "AI", color: "#00e5ff" }, // Bright Cyan
            { tag: "UPSCALE", color: "#00e5ff" }, // Bright Cyan
            { tag: "60FPS", color: "#00e5ff" }, // Bright Cyan
            { tag: "7\\.1", color: "#009688" }, // Teal (escaped dot for regex)
            { tag: "HDR10\\+", color: "#d92602" }, // Red-Orange (escaped + for regex)
            { tag: "HDR10", color: "#ff9800" }, // Orange

            // Add more tags here:
            // { tag: 'ATMOS', color: '#e91e63' },  // Pink
            // { tag: '5\\.1', color: '#03a9f4' },  // Light Blue
            // { tag: 'DOLBY', color: '#673ab7' },  // Deep Purple
        ];

        // Auto-generate quality colors map from config
        this.qualityColors = {};
        this.qualityTagsConfig.forEach(({ tag, color }) => {
            // Remove backslashes for map key (e.g., "7\\.1" becomes "7.1")
            const cleanTag = tag.replace(/\\/g, "");
            this.qualityColors[cleanTag] = color;
        });

        // Manually add normalized tag key for REMUX (pattern differs from display)
        const remuxConfig = this.qualityTagsConfig.find(({ tag }) =>
            tag.includes("REMUX")
        );
        if (remuxConfig) {
            this.qualityColors["REMUX"] = remuxConfig.color;
        }

        // Auto-generate regex pattern from quality tags config
        const tagPatterns = this.qualityTagsConfig
            .map(({ tag }) => {
                // If tag ends with escaped special char like \+ or \., use negative lookahead
                if (tag.match(/\\[^\w]$/)) {
                    return `\\b${tag}(?!\\w)`; // e.g., \bHDR10\+(?!\w)
                }
                return `\\b${tag}\\b`; // e.g., \bHDR\b
            })
            .join("|");
        this.qualityPattern = new RegExp(`(${tagPatterns})`, "gi");

        // Cache other regex patterns for performance
        this.resolutionPattern =
            /\b(4k|8k|2160p?|1080p?|720p?|480p?|360p?|240p?)\b/i;
        this.sizePattern = /([\d.]+)\s*(TB|GB|MB|KB)/i;

        // Cache color mappings for resolutions
        this.resolutionColors = {
            "2160P": "#9c27b0",
            "4320P": "#9c27b0", // Purple
            "1080P": "#2196f3",
            1080: "#2196f3", // Blue
            "720P": "#4caf50",
            720: "#4caf50", // Green
        };

        // Pre-calculated constants
        this.BYTES_PER_GB = 1073741824; // 1024^3
        this.BYTES_PER_MB = 1048576; // 1024^2
        this.BYTES_PER_KB = 1024;

        // Size meter color thresholds (in GB)
        this.SIZE_THRESHOLDS = [
            { max: 25, color: "#4caf50" }, // Green
            { max: 60, color: "#ffc107" }, // Yellow
            { max: 85, color: "#ff9800" }, // Orange
            { max: Infinity, color: "#f44336" }, // Red
        ];

        this.init();
    }

    init() {
        console.log("[StreamListSorter] Initializing...");
        this.observeHashChanges();
        this.handleRouteChange();
    }

    startObserving() {
        if (this.observer) return;

        this.observer = new MutationObserver((mutations) => {
            this.handleMutations(mutations);
        });

        this.observer.observe(document.body, {
            childList: true,
            subtree: true,
        });
    }

    stopObserving() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
    }

    observeHashChanges() {
        window.addEventListener("hashchange", () => {
            this.handleRouteChange();
        });
    }

    handleRouteChange() {
        const hash = window.location.hash;

        if (this.isDetailPage(hash)) {
            this.processedContainers = new WeakSet();
            this.startObserving();
        } else {
            this.removeSortButton();
            this.stopObserving();
        }
    }

    isDetailPage(hash) {
        return (
            hash.startsWith("#/detail/series/") ||
            hash.startsWith("#/detail/movie/")
        );
    }

    handleMutations(mutations) {
        if (!this.isDetailPage(window.location.hash)) return;

        for (const mutation of mutations) {
            if (mutation.addedNodes.length) {
                if (this.checkForStreamsContainer()) {
                    return;
                }
            }
        }
    }

    checkForStreamsContainer() {
        const streamsContainer = document.querySelector(
            '[class*="streams-container-"]'
        );

        if (
            streamsContainer &&
            !this.processedContainers.has(streamsContainer)
        ) {
            this.processedContainers.add(streamsContainer);
            this.addSortButton(streamsContainer);
            return true;
        }
        return false;
    }

    addSortButton(container) {
        this.removeSortButton();

        this.sortButton = document.createElement("button");
        this.sortButton.textContent = "↓ Sort by Size";
        this.sortButton.className = "stream-sort-button";
        this.sortButton.style.cssText = `
            position: fixed; top: 2%; right: 15%; z-index: 9999; padding: 12px 24px;
            background: rgba(255, 255, 255, 0.1); backdrop-filter: blur(20px) saturate(180%);
            -webkit-backdrop-filter: blur(20px) saturate(180%); border: 1px solid rgba(255, 255, 255, 0.18);
            border-radius: 12px; color: rgba(255, 255, 255, 0.95); font-size: 13px; font-weight: 600;
            letter-spacing: 0.3px; cursor: pointer; transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.1);
        `;

        this.sortButton.addEventListener("mouseenter", () => {
            this.sortButton.style.background = "rgba(255, 255, 255, 0.15)";
            this.sortButton.style.transform = "translateY(-2px) scale(1.02)";
            this.sortButton.style.boxShadow =
                "0 12px 40px rgba(0, 0, 0, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.2)";
            this.sortButton.style.borderColor = "rgba(255, 255, 255, 0.25)";
        });

        this.sortButton.addEventListener("mouseleave", () => {
            this.sortButton.style.background = "rgba(255, 255, 255, 0.1)";
            this.sortButton.style.transform = "translateY(0) scale(1)";
            this.sortButton.style.boxShadow =
                "0 8px 32px rgba(0, 0, 0, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.1)";
            this.sortButton.style.borderColor = "rgba(255, 255, 255, 0.18)";
        });

        this.sortButton.addEventListener("click", () => {
            this.sortStreams(container);
            this.sortButton.textContent = "✓ Sorted!";
            setTimeout(() => {
                if (this.sortButton)
                    this.sortButton.textContent = "↓ Sort by Size";
            }, 2000);
        });

        document.body.appendChild(this.sortButton);
    }

    removeSortButton() {
        if (this.sortButton && this.sortButton.parentNode) {
            this.sortButton.remove();
            this.sortButton = null;
        }
    }

    getCurrentEpisodeNumber() {
        const episodeTitleElement = document.querySelector(
            '[class*="episode-title-dln_c"]'
        );
        if (!episodeTitleElement) return null;

        const titleText = episodeTitleElement.textContent;
        // Match patterns like S1E4, S01E04, etc.
        const match = titleText.match(/S(\d+)E(\d+)/i);
        if (!match) return null;

        const season = match[1].padStart(2, "0");
        const episode = match[2].padStart(2, "0");
        return `S${season}E${episode}`;
    }

    hasEpisodeInDescription(streamElement, episodeNumber) {
        const descriptionDiv = streamElement.querySelector(
            '[class*="description-container-"]'
        );
        if (!descriptionDiv) return false;

        return descriptionDiv.textContent
            .toUpperCase()
            .includes(episodeNumber.toUpperCase());
    }

    sortStreams(container) {
        const streamItems = Array.from(
            container.querySelectorAll('a[class*="stream-container-"]')
        );
        if (streamItems.length === 0) return;

        console.log(
            `[StreamListSorter] Found ${streamItems.length} stream items`
        );

        // Get current episode number from page
        const currentEpisode = this.getCurrentEpisodeNumber();
        if (currentEpisode) {
            console.log(
                `[StreamListSorter] Current episode: ${currentEpisode}`
            );
        } else {
            console.log(
                `[StreamListSorter] No episode detected (movie page) - sorting by size only`
            );
        }

        const streamsWithSize = streamItems.map((streamItem) => {
            const descriptionDiv = streamItem.querySelector(
                '[class*="description-container-"]'
            );
            const streamData = {
                element: streamItem,
                sizeInBytes: this.extractSize(descriptionDiv),
            };

            // Only check episode match for series (when currentEpisode exists)
            if (currentEpisode) {
                streamData.hasEpisode = this.hasEpisodeInDescription(
                    streamItem,
                    currentEpisode
                );
            }

            return streamData;
        });

        streamsWithSize.sort((a, b) => {
            // For series: prioritize streams with matching episode numbers
            if (currentEpisode && a.hasEpisode !== b.hasEpisode) {
                return a.hasEpisode ? -1 : 1;
            }
            // Then sort by size (largest first)
            return b.sizeInBytes - a.sizeInBytes;
        });

        const withResolution = [];
        const withoutResolution = [];
        const downloadStreams = [];

        streamsWithSize.forEach((stream) => {
            const { hasResolution, isDownload } = this.cleanupAddonName(
                stream.element
            );
            if (isDownload) {
                downloadStreams.push(stream);
            } else if (hasResolution) {
                withResolution.push(stream);
            } else {
                withoutResolution.push(stream);
            }
        });

        [...withResolution, ...withoutResolution, ...downloadStreams].forEach(
            (stream) => {
                this.cleanupDescription(stream.element);
                container.appendChild(stream.element);
            }
        );
    }

    cleanupAddonName(streamElement) {
        const addonNameDiv = streamElement.querySelector(
            '[class*="addon-name-"]'
        );
        if (!addonNameDiv) return { hasResolution: true, isDownload: false };

        const originalText = addonNameDiv.textContent;
        const isDownload = /download/i.test(originalText);
        const match = originalText.match(this.resolutionPattern);

        if (match) {
            let resolution = match[0].toUpperCase();
            if (resolution === "4K") resolution = "2160P";
            else if (resolution === "8K") resolution = "4320P";

            const badgeColor = this.resolutionColors[resolution] || "#607d8b";
            addonNameDiv.innerHTML = `<span style="background: linear-gradient(135deg, ${badgeColor}88, ${badgeColor}cc); backdrop-filter: blur(10px); border: 1px solid ${badgeColor}44; color: #fff; padding: 4px 10px; border-radius: 8px; font-size: 0.85em; font-weight: 600; text-transform: uppercase; display: inline-block; box-shadow: 0 4px 12px ${badgeColor}33, inset 0 1px 0 rgba(255,255,255,0.2); letter-spacing: 0.5px;">${resolution}</span>`;
            return { hasResolution: true, isDownload };
        }
        return { hasResolution: false, isDownload };
    }

    cleanupDescription(streamElement) {
        const descriptionDiv = streamElement.querySelector(
            '[class*="description-container-"]'
        );
        if (!descriptionDiv) return;

        const originalText = descriptionDiv.textContent;
        const sizeMatch = originalText.match(this.sizePattern);
        const fileSize = sizeMatch ? sizeMatch[0] : null;

        const seederMatch = originalText.match(/[👤👥]\s*(\d+)/);
        const seederCount = seederMatch ? seederMatch[1] : null;

        const qualityMatches = originalText.matchAll(this.qualityPattern);
        const rawTags = Array.from(qualityMatches, (m) => m[0].toUpperCase());

        const normalizedTags = rawTags.map((tag) => {
            if (tag === "HDR10") return "HDR";
            if (tag === "DOLBY VISION") return "DV";
            if (/(?:BD|UHD)?REMUX/i.test(tag)) return "REMUX";
            if (tag === "UPSCALE" || tag === "60FPS") return "AI";
            return tag;
        });

        const qualityTags = [...new Set(normalizedTags)];
        let styledHTML = "";

        if (fileSize) {
            const sizeValueMatch = this.sizePattern.exec(fileSize);
            let sizeInGB = 0;

            if (sizeValueMatch) {
                const value = parseFloat(sizeValueMatch[1]);
                const unit = sizeValueMatch[2].toUpperCase();

                switch (unit) {
                    case "TB":
                        sizeInGB = value * 1024;
                        break;
                    case "GB":
                        sizeInGB = value;
                        break;
                    case "MB":
                        sizeInGB = value / 1024;
                        break;
                    case "KB":
                        sizeInGB = value / 1048576;
                        break;
                }
            }

            // Determine meter color based on size
            const meterColor = this.SIZE_THRESHOLDS.find(
                (t) => sizeInGB < t.max
            ).color;

            const meterWidth = Math.min(100, sizeInGB);
            styledHTML += `<div style="display: flex; flex-direction: column; gap: 4px; width: 100px;"><span style="font-size: 1.1em; font-weight: 700; color: #fff; white-space: nowrap;">${fileSize}</span><div style="position: absolute; bottom: 20%; width: 65%; height: 5px; background: rgba(255,255,255,0.08); backdrop-filter: blur(4px); border: 1px solid rgba(255,255,255,0.12); border-radius: 3px; overflow: hidden; box-shadow: inset 0 1px 2px rgba(0,0,0,0.1);"><div style="width: ${meterWidth}%; height: 100%; background: linear-gradient(90deg, ${meterColor}cc, ${meterColor}); box-shadow: 0 0 8px ${meterColor}66; transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1); position: absolute; bottom: 0;"></div></div></div>`;
        }

        if (qualityTags.length > 0) {
            for (const tag of qualityTags) {
                const color = this.qualityColors[tag] || "#888";
                styledHTML += ` <span style="background: linear-gradient(135deg, ${color}bb, ${color}ee); backdrop-filter: blur(8px); border: 1px solid ${color}55; color: rgba(0,0,0,0.9); padding: 3px 8px; border-radius: 6px; font-size: 0.7em; font-weight: 700; text-transform: uppercase; box-shadow: 0 2px 8px ${color}44, inset 0 1px 0 rgba(255,255,255,0.3); letter-spacing: 0.3px;">${tag}</span>`;
            }
        }

        if (seederCount) {
            styledHTML += `<div style="position: absolute; top: 12px; left: 85px; background: linear-gradient(135deg, rgb(87 58 226 / 80%), rgb(0 0 0 / 95%)); backdrop-filter: blur(10px); color: #fff; padding: 2px 6px; border-radius: 6px; font-size: 0.7em; font-weight: 600; display: inline-flex; align-items: center; justify-content: center;">➤ ${seederCount}</div>`;
        }

        if (styledHTML) descriptionDiv.innerHTML = styledHTML;
    }

    extractSize(descriptionDiv) {
        if (!descriptionDiv) return 0;

        const match = this.sizePattern.exec(descriptionDiv.textContent);
        if (!match) return 0;

        const value = parseFloat(match[1]);
        const unit = match[2].toUpperCase();

        switch (unit) {
            case "TB":
                return value * this.BYTES_PER_GB * 1024;
            case "GB":
                return value * this.BYTES_PER_GB;
            case "MB":
                return value * this.BYTES_PER_MB;
            case "KB":
                return value * this.BYTES_PER_KB;
            default:
                return 0;
        }
    }

    destroy() {
        this.stopObserving();
        this.removeSortButton();
        this.processedContainers = new WeakSet();
    }
}

// Initialize the plugin when DOM is ready
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
        window.streamListSorter = new StreamListSorter();
    });
} else {
    window.streamListSorter = new StreamListSorter();
}
