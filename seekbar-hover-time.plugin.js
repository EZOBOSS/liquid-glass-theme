/**
 * @name Timeline Hover Time Display
 * @description Shows time position when hovering over the video timeline
 * @version 2.0.0
 * @author allecsc
 * @optimization Improved performance with caching, RAF throttling, and proper cleanup
 */

(function () {
    "use strict";

    // Configuration
    const CONFIG = {
        tooltipOffset: 10, // Pixels above the timeline
        timeFormat: "HH:MM:SS", // or 'MM:SS' for shorter format
        durationPollInterval: 5000, // How often to poll for duration updates
        reinitRetryDelay: 1000, // Delay before retrying initialization
        transitionDuration: 200, // Tooltip fade transition duration (ms)
    };

    // State management
    const state = {
        tooltipElement: null,
        currentVideoDuration: 0,
        seekBarRect: null,
        resizeObserver: null,
        durationInterval: null,
        mutationObserver: null,
        rafId: null,
        isInitialized: false,
        currentSeekBar: null,
        isHovering: false,
    };

    // Create tooltip element with smooth transitions
    function createTooltip() {
        if (state.tooltipElement) return state.tooltipElement;

        const tooltip = document.createElement("div");
        tooltip.id = "timeline-tooltip";
        tooltip.style.cssText = `
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
            opacity: 0;
            white-space: nowrap;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2), 0 4px 16px rgba(0, 0, 0, 0.1), 
                        inset 0 1px 0 rgba(255, 255, 255, 0.15), inset 0 -1px 0 rgba(0, 0, 0, 0.1);
            backdrop-filter: blur(12px) saturate(160%);
            border: 1px solid rgba(255, 255, 255, 0.04);
            text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
            transition: opacity ${CONFIG.transitionDuration}ms ease-in-out;
            will-change: transform, opacity;
        `;

        document.body.appendChild(tooltip);
        state.tooltipElement = tooltip;
        return tooltip;
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
        }
        return `${minutes.toString().padStart(2, "0")}:${secs
            .toString()
            .padStart(2, "0")}`;
    }

    // Helper function to parse time string to seconds
    function parseTimeToSeconds(timeString) {
        const match =
            timeString.match(/(\d{1,2}):(\d{2}):(\d{2})/) ||
            timeString.match(/(\d{1,2}):(\d{2})/);

        if (!match) return 0;

        const parts = match.slice(1).map(Number);
        if (parts.length === 3) {
            return parts[0] * 3600 + parts[1] * 60 + parts[2];
        }
        return parts[0] * 60 + parts[1];
    }

    // Get video duration from Stremio's player (optimized)
    function getVideoDuration() {
        // Try video element first (most reliable)
        const videoSelectors = [
            "video",
            ".video-player video",
            '[class*="video"] video',
            ".player video",
        ];

        for (const selector of videoSelectors) {
            const video = document.querySelector(selector);
            if (video?.duration && !isNaN(video.duration)) {
                return video.duration;
            }
        }

        // Fallback: parse duration from UI labels
        const durationLabels = document.querySelectorAll(
            ".seek-bar-I7WeY .label-QFbsS, " +
                '[class*="time"], [class*="duration"]'
        );

        let maxDuration = 0;
        for (const label of durationLabels) {
            const duration = parseTimeToSeconds(label.textContent || "");
            if (duration > maxDuration) {
                maxDuration = duration;
            }
        }

        return maxDuration;
    }

    // Find the seek bar element
    function findSeekBar() {
        const seekBarSelectors = [
            ".seek-bar-I7WeY .slider-hBDOf",
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

    // Update cached seek bar rect
    function updateSeekBarRect(seekBar) {
        state.seekBarRect = seekBar.getBoundingClientRect();
    }

    // Handle mouse movement over seek bar (throttled with RAF)
    function handleSeekBarHover(event) {
        if (!state.isHovering) {
            state.isHovering = true;
            showTooltip();
        }

        // Cancel any pending RAF
        if (state.rafId) {
            cancelAnimationFrame(state.rafId);
        }

        // Throttle updates using RAF
        state.rafId = requestAnimationFrame(() => {
            const tooltip = state.tooltipElement;
            if (!tooltip || !state.seekBarRect) return;

            // Calculate progress using cached rect
            const progress = Math.max(
                0,
                Math.min(
                    1,
                    (event.clientX - state.seekBarRect.left) /
                        state.seekBarRect.width
                )
            );

            const duration = state.currentVideoDuration;
            const timePosition = duration * progress;

            // Update tooltip content
            tooltip.textContent = formatTime(timePosition);

            // Position tooltip (use cached height if available)
            const tooltipHeight = tooltip.offsetHeight || 40; // Fallback height
            let left = event.clientX;
            const top =
                state.seekBarRect.top - CONFIG.tooltipOffset - tooltipHeight;

            // Apply initial position
            tooltip.style.top = `${top}px`;
            tooltip.style.left = `${left}px`;

            // Center horizontally on cursor and keep within viewport
            const tooltipWidth = tooltip.offsetWidth;
            left = event.clientX - tooltipWidth / 2;

            const viewportWidth = window.innerWidth;
            if (left + tooltipWidth > viewportWidth) {
                left = viewportWidth - tooltipWidth - 5;
            }
            if (left < 5) {
                left = 5;
            }

            tooltip.style.left = `${left}px`;
            state.rafId = null;
        });
    }

    // Show tooltip with smooth transition
    function showTooltip() {
        if (state.tooltipElement) {
            state.tooltipElement.style.opacity = "1";
        }
    }

    // Hide tooltip when mouse leaves seek bar
    function handleSeekBarLeave() {
        state.isHovering = false;

        if (state.rafId) {
            cancelAnimationFrame(state.rafId);
            state.rafId = null;
        }

        if (state.tooltipElement) {
            state.tooltipElement.style.opacity = "0";
        }
    }

    // Start duration polling
    function startDurationPolling() {
        // Clear existing interval
        if (state.durationInterval) {
            clearInterval(state.durationInterval);
        }

        // Update immediately
        state.currentVideoDuration = getVideoDuration();

        // Poll periodically
        state.durationInterval = setInterval(() => {
            state.currentVideoDuration = getVideoDuration();
        }, CONFIG.durationPollInterval);
    }

    // Stop duration polling
    function stopDurationPolling() {
        if (state.durationInterval) {
            clearInterval(state.durationInterval);
            state.durationInterval = null;
        }
    }

    // Setup ResizeObserver for seek bar
    function observeSeekBarResize(seekBar) {
        // Disconnect existing observer
        if (state.resizeObserver) {
            state.resizeObserver.disconnect();
        }

        // Create new ResizeObserver
        state.resizeObserver = new ResizeObserver(() => {
            updateSeekBarRect(seekBar);
        });

        state.resizeObserver.observe(seekBar);

        // Initial rect cache
        updateSeekBarRect(seekBar);
    }

    // Cleanup function
    function cleanup() {
        // Remove event listeners
        if (state.currentSeekBar) {
            state.currentSeekBar.removeEventListener(
                "mousemove",
                handleSeekBarHover
            );
            state.currentSeekBar.removeEventListener(
                "mouseleave",
                handleSeekBarLeave
            );
            state.currentSeekBar = null;
        }

        // Stop polling
        stopDurationPolling();

        // Disconnect observers
        if (state.resizeObserver) {
            state.resizeObserver.disconnect();
            state.resizeObserver = null;
        }

        // Cancel RAF
        if (state.rafId) {
            cancelAnimationFrame(state.rafId);
            state.rafId = null;
        }

        state.isInitialized = false;
        state.seekBarRect = null;
    }

    // Initialize hover functionality
    function initializeTimelineHover() {
        const seekBar = findSeekBar();

        if (!seekBar) {
            // Retry after a delay if seek bar not found
            setTimeout(initializeTimelineHover, CONFIG.reinitRetryDelay);
            return;
        }

        // Don't re-initialize the same seek bar
        if (state.isInitialized && state.currentSeekBar === seekBar) {
            return;
        }

        // Cleanup previous initialization
        cleanup();

        // Store reference
        state.currentSeekBar = seekBar;

        // Add event listeners
        seekBar.addEventListener("mousemove", handleSeekBarHover);
        seekBar.addEventListener("mouseleave", handleSeekBarLeave);

        // Setup resize observer for rect caching
        observeSeekBarResize(seekBar);

        // Start duration polling
        startDurationPolling();

        state.isInitialized = true;

        // Disconnect mutation observer once initialized successfully
        if (state.mutationObserver) {
            state.mutationObserver.disconnect();
            state.mutationObserver = null;
        }
    }

    // Watch for video player changes (only until first successful init)
    function watchForPlayerChanges() {
        if (state.mutationObserver) return; // Already observing

        state.mutationObserver = new MutationObserver((mutations) => {
            let shouldReinitialize = false;

            for (const mutation of mutations) {
                if (mutation.type === "childList") {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === 1) {
                            // Check if a video player or control bar was added
                            if (
                                node.matches?.(
                                    '[class*="seek-bar"], [class*="control-bar"], [class*="player"]'
                                ) ||
                                node.querySelector?.(
                                    '[class*="seek-bar"], [class*="control-bar"]'
                                )
                            ) {
                                shouldReinitialize = true;
                                break;
                            }
                        }
                    }
                }
                if (shouldReinitialize) break;
            }

            if (shouldReinitialize) {
                setTimeout(initializeTimelineHover, 500);
            }
        });

        state.mutationObserver.observe(document.body, {
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
            setTimeout(initializeTimelineHover, CONFIG.reinitRetryDelay);
        });
    }

    // Start initialization when browser is idle
    if (window.requestIdleCallback) {
        window.requestIdleCallback(() => init());
    } else {
        // Fallback for browsers without requestIdleCallback
        setTimeout(init, 500);
    }
})();
