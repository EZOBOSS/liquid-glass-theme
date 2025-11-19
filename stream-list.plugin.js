/**
 * Stream List Sorter Plugin
 * Adds a button to sort streams by file size (largest first)
 * Only active on detail pages (series/movie)
 * @author EZOBOSS
 */

class StreamListSorter {
    constructor() {
        this.observer = null;
        this.processedContainers = new WeakSet();
        this.sortButton = null;
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

        for (const mutation of mutations) {
            if (mutation.addedNodes.length) {
                this.checkForStreamsContainer();
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
            // Stop observing once we found the container
            //this.stopObserving();
        }
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
      top: 5%;
      right: 15%;
      z-index: 9999;
      padding: 10px 20px;
      background: rgba(0, 0, 0, 0.8);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 8px;
      color: white;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s ease;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    `;

        // Add hover effect
        this.sortButton.addEventListener("mouseenter", () => {
            this.sortButton.style.background = "rgba(255, 255, 255, 0.2)";
            this.sortButton.style.transform = "translateY(-2px)";
            this.sortButton.style.boxShadow = "0 6px 16px rgba(0, 0, 0, 0.4)";
        });

        this.sortButton.addEventListener("mouseleave", () => {
            this.sortButton.style.background = "rgba(0, 0, 0, 0.8)";
            this.sortButton.style.transform = "translateY(0)";
            this.sortButton.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.3)";
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
                sizeText: descriptionDiv ? descriptionDiv.textContent : "N/A",
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

        // Match resolution patterns: 4k, 2160p, 1080p, 720p, 480p, etc.
        const resolutionPattern =
            /\b(4k|8k|2160p?|1080p?|720p?|480p?|360p?|240p?)\b/i;
        const match = originalText.match(resolutionPattern);

        if (match) {
            let resolution = match[0].toUpperCase();

            // Normalize 4K/8K to standard p format
            if (resolution === "4K") {
                resolution = "2160P";
            } else if (resolution === "8K") {
                resolution = "4320P";
            }

            // Determine color based on resolution quality
            let badgeColor = "#607d8b"; // Default gray for lower resolutions
            if (resolution === "2160P" || resolution === "4320P") {
                badgeColor = "#9c27b0"; // Purple for 4K/8K
            } else if (resolution === "1080P" || resolution === "1080") {
                badgeColor = "#2196f3"; // Blue for 1080p
            } else if (resolution === "720P" || resolution === "720") {
                badgeColor = "#4caf50"; // Green for 720p
            }

            // Style the resolution with a color-coded badge
            addonNameDiv.innerHTML = `<span style="background: ${badgeColor}; color: #fff; padding: 3px 8px; border-radius: 4px; font-size: 0.85em; font-weight: 700; text-transform: uppercase; display: inline-block;">${resolution}</span>`;

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
        let fileSize = null;
        const qualityTags = [];

        // Extract file size (e.g., "12.34 GB", "1.5 TB")
        const sizePattern = /([\d.]+\s*(?:TB|GB|MB|KB))/i;
        const sizeMatch = originalText.match(sizePattern);
        if (sizeMatch) {
            fileSize = sizeMatch[1];
        }

        // Extract HDR if present
        if (/\bHDR\b/i.test(originalText)) {
            qualityTags.push("HDR");
        }

        // Extract DV (Dolby Vision) if present
        if (/\bDV\b/i.test(originalText)) {
            qualityTags.push("DV");
        }

        // Extract REMUX if present
        if (/\bREMUX\b/i.test(originalText)) {
            qualityTags.push("REMUX");
        }

        // Extract IMAX if present
        if (/\bIMAX\b/i.test(originalText)) {
            qualityTags.push("IMAX");
        }

        // Extract 7.1 audio if present
        if (/\b7\.1\b/i.test(originalText)) {
            qualityTags.push("7.1");
        }

        // Build styled HTML
        let styledHTML = "";

        if (fileSize) {
            // Parse size to determine color for meter
            const sizeValueMatch = fileSize.match(/([\d.]+)\s*(TB|GB|MB|KB)/i);
            let sizeInGB = 0;
            let meterColor = "#4caf50"; // Default green

            if (sizeValueMatch) {
                const value = parseFloat(sizeValueMatch[1]);
                const unit = sizeValueMatch[2].toUpperCase();

                // Convert to GB
                if (unit === "TB") {
                    sizeInGB = value * 1024;
                } else if (unit === "GB") {
                    sizeInGB = value;
                } else if (unit === "MB") {
                    sizeInGB = value / 1024;
                } else if (unit === "KB") {
                    sizeInGB = value / (1024 * 1024);
                }

                // Determine color based on size
                // Small (0-25 GB): Green
                // Medium (25-60 GB): Yellow
                // Large (60-85 GB): Orange
                // Very Large (85+ GB): Red
                if (sizeInGB < 25) {
                    meterColor = "#4caf50"; // Green
                } else if (sizeInGB < 60) {
                    meterColor = "#ffc107"; // Yellow
                } else if (sizeInGB < 85) {
                    meterColor = "#ff9800"; // Orange
                } else {
                    meterColor = "#f44336"; // Red
                }
            }

            // Create file size with meter bar (vertical stack)
            styledHTML += `
                <div style="display: flex; flex-direction: column; gap: 4px; width: 100px;">
                    <span style="font-size: 1.1em; font-weight: 700; color: #fff; white-space: nowrap;">${fileSize}</span>
                    <div style="position: absolute; bottom: 40%; width: 65%; height: 4px; background: rgba(255,255,255,0.2); border-radius: 2px; overflow: hidden;">
                        <div style="width: ${Math.min(
                            100,
                            (sizeInGB / 100) * 100
                        )}%; height: 100%; background: ${meterColor}; transition: all 0.3s ease; position: absolute; bottom: 0;"></div>
                    </div>
                </div>
            `;
        }

        if (qualityTags.length > 0) {
            qualityTags.forEach((tag) => {
                let color = "#888";
                if (tag === "HDR") color = "#ff9800"; // Orange
                if (tag === "DV") color = "#9c27b0"; // Purple
                if (tag === "REMUX") color = "#4caf50"; // Green
                if (tag === "IMAX") color = "#00bcd4"; // Cyan
                if (tag === "7.1") color = "#009688"; // Teal

                styledHTML += ` <span style="background: ${color}; color: #000; padding: 2px 6px; border-radius: 3px; font-size: 0.75em; font-weight: 700; text-transform: uppercase;">${tag}</span>`;
            });
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

        const text = descriptionDiv.textContent;

        // Match patterns like "12.34 GB", "1.5 TB", "500 MB", "100.5 KB"
        const sizePattern = /([\d.]+)\s*(TB|GB|MB|KB)/i;
        const match = text.match(sizePattern);

        if (!match) {
            return 0;
        }

        const value = parseFloat(match[1]);
        const unit = match[2].toUpperCase();

        // Convert everything to bytes for consistent comparison
        switch (unit) {
            case "TB":
                return value * 1024 * 1024 * 1024 * 1024;
            case "GB":
                return value * 1024 * 1024 * 1024;
            case "MB":
                return value * 1024 * 1024;
            case "KB":
                return value * 1024;
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
