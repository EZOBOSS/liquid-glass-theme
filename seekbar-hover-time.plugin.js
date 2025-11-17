/**
 * @name Timeline Hover Time Display
 * @description Shows time position when hovering over the video timeline
 * @version 1.0.0
 * @author allecsc
 */

(function () {
    "use strict";

    // Configuration
    const CONFIG = {
        updateInterval: 100, // How often to update time display during hover (ms)
        tooltipOffset: 10, // Pixels above the timeline
        timeFormat: "HH:MM:SS", // or 'MM:SS' for shorter format
    };

    let tooltipElement = null;
    let currentVideoDuration = 0;
    let hoverTimeout = null;

    // Create tooltip element
    function createTooltip() {
        if (tooltipElement) return tooltipElement;

        tooltipElement = document.createElement("div");
        tooltipElement.id = "timeline-tooltip";
        tooltipElement.style.cssText = `
            position: absolute;
            background: rgba(70, 70, 70, 0.22);
            color: white;
            padding: 6px 12px;
            border-radius: 999px;
            font-size: 16px;
            font-family: 'Nata Sans', sans-serif;
            font-weight: 600;
            pointer-events: none;
            z-index: 9999;
            display: none;
            white-space: nowrap;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2), 0 4px 16px rgba(0, 0, 0, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.15), inset 0 -1px 0 rgba(0, 0, 0, 0.1);
            backdrop-filter: blur(12px) saturate(160%);
            border: 1px solid rgba(255, 255, 255, 0.04);
            text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
        `;

        document.body.appendChild(tooltipElement);
        return tooltipElement;
    }

    // Format time in seconds to HH:MM:SS or MM:SS
    function formatTime(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        if (CONFIG.timeFormat === "HH:MM:SS" || hours > 0) {
            return `${hours.toString().padStart(2, "0")}:${minutes
                .toString()
                .padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
        } else {
            return `${minutes.toString().padStart(2, "0")}:${secs
                .toString()
                .padStart(2, "0")}`;
        }
    }

    // Get video duration from Stremio's player
    function getVideoDuration() {
        // Try different selectors for the video element
        const videoSelectors = [
            "video",
            ".video-player video",
            '[class*="video"] video',
            ".player video",
        ];

        for (const selector of videoSelectors) {
            const video = document.querySelector(selector);
            if (video && video.duration && !isNaN(video.duration)) {
                return video.duration;
            }
        }

        // Fallback: try to find duration in Stremio's UI labels
        // Based on HTML structure, look for the duration label in seek bar
        const durationLabels = document.querySelectorAll(
            ".seek-bar-I7WeY .label-QFbsS"
        );
        let maxDuration = 0;

        for (const label of durationLabels) {
            const text = label.textContent || "";

            // Look for time format like "00:24:00" (total duration)
            const match =
                text.match(/(\d{1,2}):(\d{2}):(\d{2})/) ||
                text.match(/(\d{1,2}):(\d{2})/);
            if (match) {
                const parts = match.slice(1).map(Number);
                let duration = 0;
                if (parts.length === 3) {
                    duration = parts[0] * 3600 + parts[1] * 60 + parts[2];
                } else if (parts.length === 2) {
                    duration = parts[0] * 60 + parts[1];
                }

                // Assume the larger time value is the total duration
                if (duration > maxDuration) {
                    maxDuration = duration;
                }
            }
        }

        if (maxDuration > 0) {
            return maxDuration;
        }

        // Additional fallback: look for any time elements
        const timeElements = document.querySelectorAll(
            '[class*="time"], [class*="duration"]'
        );
        for (const el of timeElements) {
            const text = el.textContent || "";
            const match =
                text.match(/(\d{1,2}):(\d{2}):(\d{2})/) ||
                text.match(/(\d{1,2}):(\d{2})/);
            if (match) {
                const parts = match.slice(1).map(Number);
                if (parts.length === 3) {
                    return parts[0] * 3600 + parts[1] * 60 + parts[2];
                } else if (parts.length === 2) {
                    return parts[0] * 60 + parts[1];
                }
            }
        }

        return 0;
    }

    // Find the seek bar element
    function findSeekBar() {
        const seekBarSelectors = [
            ".seek-bar-I7WeY .slider-hBDOf", // Primary selector based on HTML structure
            ".seek-bar-container-JGGTa .slider-hBDOf",
            '[class*="seek-bar"] [class*="slider"]',
            ".control-bar-container-xsWA7 .seek-bar-I7WeY",
            '[class*="progress"] [class*="bar"]',
            '[class*="timeline"] [class*="slider"]',
        ];

        for (const selector of seekBarSelectors) {
            const element = document.querySelector(selector);
            if (element) return element;
        }

        return null;
    }

    // Handle mouse movement over seek bar
    function handleSeekBarHover(event) {
        const seekBar = event.currentTarget;
        const tooltip = createTooltip();

        if (!tooltip) return;

        // Get seek bar dimensions
        const rect = seekBar.getBoundingClientRect();
        const progress = Math.max(
            0,
            Math.min(1, (event.clientX - rect.left) / rect.width)
        );

        // Calculate time position
        const duration = getVideoDuration() || currentVideoDuration;

        /*
        // Debug logging (only log occasionally to avoid spam)
        if (Math.random() < 0.1) {
            // Log only 10% of the time
            console.log("Seek bar hover:", {
                progress: progress.toFixed(3),
                duration: duration,
                timePosition: (duration * progress).toFixed(1),
                rect: { left: rect.left, width: rect.width },
                mouseX: event.clientX,
            });
        }
        */

        const timePosition = duration * progress;

        // Update tooltip content
        tooltip.textContent = formatTime(timePosition);

        // Position tooltip above the seek bar
        tooltip.style.left = `${event.clientX}px`;
        tooltip.style.top = `${
            rect.top - CONFIG.tooltipOffset - tooltip.offsetHeight
        }px`;
        tooltip.style.display = "block";

        // Center horizontally on cursor
        const tooltipRect = tooltip.getBoundingClientRect();
        tooltip.style.left = `${event.clientX - tooltipRect.width / 2}px`;

        // Keep tooltip within viewport bounds
        const viewportWidth = window.innerWidth;
        if (tooltipRect.right > viewportWidth) {
            tooltip.style.left = `${viewportWidth - tooltipRect.width - 5}px`;
        }
        if (tooltipRect.left < 0) {
            tooltip.style.left = "5px";
        }
    }

    // Hide tooltip when mouse leaves seek bar
    function handleSeekBarLeave() {
        if (tooltipElement) {
            tooltipElement.style.display = "none";
        }
    }

    // Initialize hover functionality
    function initializeTimelineHover() {
        const seekBar = findSeekBar();

        if (!seekBar) {
            // Retry after a short delay if seek bar not found
            setTimeout(initializeTimelineHover, 1000);
            return;
        }

        // Remove existing listeners to avoid duplicates
        seekBar.removeEventListener("mousemove", handleSeekBarHover);
        seekBar.removeEventListener("mouseleave", handleSeekBarLeave);

        // Add hover listeners
        seekBar.addEventListener("mousemove", handleSeekBarHover);
        seekBar.addEventListener("mouseleave", handleSeekBarLeave);

        // Update duration periodically
        currentVideoDuration = getVideoDuration();
        setInterval(() => {
            currentVideoDuration = getVideoDuration();
        }, 5000);
    }

    // Watch for video player changes
    function watchForPlayerChanges() {
        const observer = new MutationObserver((mutations) => {
            let shouldReinitialize = false;

            mutations.forEach((mutation) => {
                if (mutation.type === "childList") {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === 1) {
                            // Check if a video player or control bar was added
                            if (
                                node.matches &&
                                (node.matches('[class*="seek-bar"]') ||
                                    node.matches('[class*="control-bar"]') ||
                                    node.matches('[class*="player"]') ||
                                    node.querySelector('[class*="seek-bar"]') ||
                                    node.querySelector(
                                        '[class*="control-bar"]'
                                    ))
                            ) {
                                shouldReinitialize = true;
                            }
                        }
                    });
                }
            });

            if (shouldReinitialize) {
                setTimeout(initializeTimelineHover, 500);
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });
    }

    // Initialize when DOM is ready
    function init() {
        createTooltip();
        initializeTimelineHover();
        watchForPlayerChanges();

        // Re-initialize on navigation changes (Stremio-specific)
        window.addEventListener("hashchange", () => {
            setTimeout(initializeTimelineHover, 1000);
        });
    }

    // Start initialization
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }

    // Also initialize after a delay to catch dynamically loaded players
    setTimeout(init, 2000);
})();
