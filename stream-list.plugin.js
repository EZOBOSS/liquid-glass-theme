/**
 * @name Stream List Sorter Plugin
 * @description Adds a button to sort streams by file size (largest first) and quality tags
 * @version 1.0.1
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
            { tag: "REMUX", color: "#4caf50" }, // Green
            { tag: "IMAX", color: "#00bcd4" }, // Cyan
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

        // Auto-generate regex pattern from quality tags config
        // Add word boundaries per-tag to handle special characters properly
        const tagPatterns = this.qualityTagsConfig
            .map(({ tag }) => {
                // If tag ends with escaped special char like \+ or \., use negative lookahead
                if (tag.match(/\\[^\w]$/)) {
                    return `\\b${tag}(?!\\w)`; // e.g., \bHDR10\+(?!\w)
                }
                return `\\b${tag}\\b`; // e.g., \bHDR\b
            })
            .join("|");
        // Don't add outer \b() because each tag has its own boundaries
        this.qualityPattern = new RegExp(`(${tagPatterns})`, "gi");

        // Cache other regex patterns for performance
        this.resolutionPattern =
            /\b(4k|8k|2160p?|1080p?|720p?|480p?|360p?|240p?)\b/i;
        this.sizePattern = /([\d.]+)\s*(TB|GB|MB|KB)/i;
        this.seederPattern = /[👤👥]\s*\d+/;

        // Cache color mappings for resolutions
        this.resolutionColors = {
            "2160P": "#9c27b0",
            "4320P": "#9c27b0", // Purple
            "1080P": "#2196f3",
            1080: "#2196f3", // Blue
            "720P": "#4caf50",
            720: "#4caf50", // Green
        };

        // Pre-calculated byte conversion constants
        this.BYTES_PER_GB = 1073741824; // 1024^3
        this.BYTES_PER_MB = 1048576; // 1024^2
        this.BYTES_PER_KB = 1024;

        this.init();
    }

    init() {
        console.log("[StreamListSorter] Initializing...");
        this.observeHashChanges();
        // Check current route on init
        this.handleRouteChange();
    }

    startObserving() {
        if (this.observer) {
            return; // Already observing
        }

        this.observer = new MutationObserver((mutations) => {
            this.handleMutations(mutations);
        });

        this.observer.observe(document.body, {
            childList: true,
            subtree: true,
        });

        console.log("[StreamListSorter] Started observing DOM");
    }

    stopObserving() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
            console.log("[StreamListSorter] Stopped observing DOM");
        }
    }

    observeHashChanges() {
        // Listen for hash changes
        window.addEventListener("hashchange", () => {
            this.handleRouteChange();
        });
    }

    handleRouteChange() {
        const hash = window.location.hash;

        if (this.isDetailPage(hash)) {
            console.log(
                "[StreamListSorter] On detail page, watching for streams container..."
            );
            // Reset processed containers when navigating to a new detail page
            this.processedContainers = new WeakSet();
            // Start observing DOM for streams container
            this.startObserving();
        } else {
            console.log(
                "[StreamListSorter] Not on detail page, removing button..."
            );
            this.removeSortButton();
            // Stop observing DOM when not on detail page
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
        // Only process mutations if we're on a detail page
        if (!this.isDetailPage(window.location.hash)) {
            return;
        }

        // Check if any added nodes contain the streams container
        for (const mutation of mutations) {
            if (mutation.addedNodes.length) {
                // Only check if we haven't found container yet
                if (this.checkForStreamsContainer()) {
                    return; // Found it, stop processing
                }
            }
        }
    }

    checkForStreamsContainer() {
        // Look for streams container with class pattern streams-container-*
        const streamsContainer = document.querySelector(
            '[class*="streams-container-"]'
        );

        if (
            streamsContainer &&
            !this.processedContainers.has(streamsContainer)
        ) {
            console.log(
                "[StreamListSorter] Found streams container, adding sort button..."
            );
            this.processedContainers.add(streamsContainer);
            this.addSortButton(streamsContainer);
            return true;
        }
        return false;
    }

    addSortButton(container) {
        // Remove existing button if any
        this.removeSortButton();

        // Create the sort button
        this.sortButton = document.createElement("button");
        this.sortButton.textContent = "↓ Sort by Size";
        this.sortButton.className = "stream-sort-button";
        this.sortButton.style.cssText = `
      position: fixed;
      top: 2%;
      right: 15%;
      z-index: 9999;
      padding: 12px 24px;
      background: rgba(255, 255, 255, 0.1);
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 12px;
      color: rgba(255, 255, 255, 0.95);
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.3px;
      cursor: pointer;
      transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.1);
    `;

        // Add hover effect
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

        // Add click handler
        this.sortButton.addEventListener("click", () => {
            this.sortStreams(container);

            // Visual feedback
            this.sortButton.textContent = "✓ Sorted!";
            setTimeout(() => {
                if (this.sortButton) {
                    this.sortButton.textContent = "↓ Sort by Size";
                }
            }, 2000);
        });

        // Add button to the DOM
        document.body.appendChild(this.sortButton);
    }

    removeSortButton() {
        if (this.sortButton && this.sortButton.parentNode) {
            this.sortButton.remove();
            this.sortButton = null;
        }
    }

    sortStreams(container) {
        // Find all stream items with class pattern stream-container-*
        const streamItems = Array.from(
            container.querySelectorAll('a[class*="stream-container-"]')
        );

        if (streamItems.length === 0) {
            return;
        }

        console.log(
            `[StreamListSorter] Found ${streamItems.length} stream items`
        );

        // Extract size information from each stream
        const streamsWithSize = streamItems.map((streamItem) => {
            const descriptionDiv = streamItem.querySelector(
                '[class*="description-container-"]'
            );
            const sizeInBytes = this.extractSize(descriptionDiv);

            return {
                element: streamItem,
                sizeInBytes,
            };
        });

        // Sort by size (largest first)
        streamsWithSize.sort((a, b) => b.sizeInBytes - a.sizeInBytes);

        // Separate streams with and without resolution
        const withResolution = [];
        const withoutResolution = [];

        streamsWithSize.forEach((stream) => {
            const hasResolution = this.cleanupAddonName(stream.element);
            if (hasResolution) {
                withResolution.push(stream);
            } else {
                withoutResolution.push(stream);
            }
        });

        // Reorder elements: first with resolution, then without
        [...withResolution, ...withoutResolution].forEach((stream) => {
            this.cleanupDescription(stream.element);
            container.appendChild(stream.element);
        });

        console.log(
            "[StreamListSorter] Streams reordered by size, addon names and descriptions cleaned up"
        );
    }

    cleanupAddonName(streamElement) {
        const addonNameDiv = streamElement.querySelector(
            '[class*="addon-name-"]'
        );

        if (!addonNameDiv) {
            return true; // No addon-name div, keep at normal position
        }

        const originalText = addonNameDiv.textContent;
        const match = originalText.match(this.resolutionPattern);

        if (match) {
            let resolution = match[0].toUpperCase();

            // Normalize 4K/8K to standard p format
            if (resolution === "4K") {
                resolution = "2160P";
            } else if (resolution === "8K") {
                resolution = "4320P";
            }

            // Get color from cache map or use default
            const badgeColor = this.resolutionColors[resolution] || "#607d8b";

            // Style the resolution with a glassmorphic color-coded badge
            addonNameDiv.innerHTML = `<span style="background: linear-gradient(135deg, ${badgeColor}88, ${badgeColor}cc); backdrop-filter: blur(10px);  border: 1px solid ${badgeColor}44; color: #fff; padding: 4px 10px; border-radius: 8px; font-size: 0.85em; font-weight: 600; text-transform: uppercase; display: inline-block; box-shadow: 0 4px 12px ${badgeColor}33, inset 0 1px 0 rgba(255,255,255,0.2); letter-spacing: 0.5px;">${resolution}</span>`;

            return true; // Has resolution, keep at normal position
        } else {
            return false; // No resolution, sort to end
        }
    }

    cleanupDescription(streamElement) {
        const descriptionDiv = streamElement.querySelector(
            '[class*="description-container-"]'
        );

        if (!descriptionDiv) {
            return;
        }

        const originalText = descriptionDiv.textContent;

        // Extract file size using cached pattern
        const sizeMatch = originalText.match(this.sizePattern);
        const fileSize = sizeMatch ? sizeMatch[0] : null;

        // Extract seeder count - just get the number, ignore emoji
        const seederMatch = originalText.match(/[👤👥]\s*(\d+)/);
        const seederCount = seederMatch ? seederMatch[1] : null;

        // Extract all quality tags in one pass using single regex, then deduplicate
        const qualityMatches = originalText.matchAll(this.qualityPattern);
        const qualityTags = [
            ...new Set(Array.from(qualityMatches, (m) => m[0].toUpperCase())),
        ];

        // Build styled HTML
        let styledHTML = "";

        if (fileSize) {
            // Parse size to determine color for meter (reuse cached pattern)
            const sizeValueMatch = this.sizePattern.exec(fileSize);
            let sizeInGB = 0;
            let meterColor = "#4caf50"; // Default green

            if (sizeValueMatch) {
                const value = parseFloat(sizeValueMatch[1]);
                const unit = sizeValueMatch[2].toUpperCase();

                // Convert to GB using switch for better performance
                switch (unit) {
                    case "TB":
                        sizeInGB = value * 1024;
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

                // Determine color based on size
                if (sizeInGB < 25) {
                    meterColor = "#4caf50";
                } else if (sizeInGB < 60) {
                    meterColor = "#ffc107";
                } else if (sizeInGB < 85) {
                    meterColor = "#ff9800";
                } else {
                    meterColor = "#f44336";
                }
            }

            // Calculate meter width once
            const meterWidth = Math.min(100, sizeInGB);

            // Create file size with meter bar (vertical stack)
            styledHTML += `
                <div style="display: flex; flex-direction: column; gap: 4px; width: 100px;">
                    <span style="font-size: 1.1em; font-weight: 700; color: #fff; white-space: nowrap;">${fileSize}</span>
                    <div style="position: absolute; bottom: 20%; width: 65%; height: 5px; background: rgba(255,255,255,0.08); backdrop-filter: blur(4px); border: 1px solid rgba(255,255,255,0.12); border-radius: 3px; overflow: hidden; box-shadow: inset 0 1px 2px rgba(0,0,0,0.1);">
                        <div style="width: ${meterWidth}%; height: 100%; background: linear-gradient(90deg, ${meterColor}cc, ${meterColor}); box-shadow: 0 0 8px ${meterColor}66; transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1); position: absolute; bottom: 0;"></div>
                    </div>
                </div>
            `;
        }

        if (qualityTags.length > 0) {
            for (const tag of qualityTags) {
                // Get color from cached map
                const color = this.qualityColors[tag] || "#888";
                styledHTML += ` <span style="background: linear-gradient(135deg, ${color}bb, ${color}ee); backdrop-filter: blur(8px); border: 1px solid ${color}55; color: rgba(0,0,0,0.9); padding: 3px 8px; border-radius: 6px; font-size: 0.7em; font-weight: 700; text-transform: uppercase; box-shadow: 0 2px 8px ${color}44, inset 0 1px 0 rgba(255,255,255,0.3); letter-spacing: 0.3px;">${tag}</span>`;
            }
        }

        // Add seeder count in absolutely positioned div (top-right)
        if (seederCount) {
            styledHTML += `
                <div style="position: absolute; top: 12px;left: 85px; background: linear-gradient(135deg, rgb(87 58 226 / 80%), rgb(0 0 0 / 95%)); backdrop-filter: blur(10px);color: #ffffffff; padding: 2px 6px; border-radius: 6px; font-size: 0.7em; font-weight: 600; display: inline-flex; align-items: center; justify-content: center;">➤ ${seederCount}</div>
            `;
        }

        // Update the description with styled content
        if (styledHTML) {
            descriptionDiv.innerHTML = styledHTML;
        }
    }

    extractSize(descriptionDiv) {
        if (!descriptionDiv) {
            return 0;
        }

        const match = this.sizePattern.exec(descriptionDiv.textContent);
        if (!match) {
            return 0;
        }

        const value = parseFloat(match[1]);
        const unit = match[2].toUpperCase();

        // Convert everything to bytes for consistent comparison using cached constants
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

    formatBytes(bytes) {
        if (bytes === 0) return "0 Bytes";

        const k = 1024;
        const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));

        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
    }

    destroy() {
        // Stop observing
        this.stopObserving();

        // Remove sort button
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
