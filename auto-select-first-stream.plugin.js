/**
 * @name Auto-Select First Stream Plugin
 * @description Automatically selects and plays the first available stream when the streams list appears.
 * @version 1.3.0
 * @author EZOBOSS
 */

class AutoSelectFirstStream {
    constructor() {
        this.observer = null;
        this.processedContainers = new WeakSet();
        this.lastAutoPlayedId = null;

        // Load from shared custom_setting object
        const settings = JSON.parse(
            localStorage.getItem("custom_setting") || "{}"
        );
        this.isEnabled = settings.auto_play_first_stream !== false;

        this.STREAMS_CONTAINER_SELECTOR = '[class*="streams-container-bbSc4"]';
        this.STREAM_ITEM_SELECTOR = 'a[class*="stream-container-"]';
        this.toggleButton = null;

        this.init();
    }

    init() {
        console.log("[AutoSelectFirstStream] Initializing...");
        this.injectStyles();
        this.observeHashChanges();
        this.handleRouteChange();
    }

    injectStyles() {
        if (document.getElementById("auto-select-styles")) return;
        const link = document.createElement("link");
        link.id = "auto-select-styles";
        link.rel = "stylesheet";
        link.href =
            "portable_config/webmods/liquid-glass-theme/auto-select-first-stream.plugin.css";
        document.head.appendChild(link);
    }

    startObserving() {
        if (this.observer) return;

        this.observer = new MutationObserver((mutations) => {
            this.handleMutations();
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
            this.createToggleButton();
            this.startObserving();
        } else {
            this.removeToggleButton();
            this.stopObserving();
        }
    }

    isDetailPage(hash) {
        return (
            hash.startsWith("#/detail/series/") ||
            hash.startsWith("#/detail/movie/")
        );
    }

    getContentId(hash) {
        const parts = hash.split("/");
        return parts[parts.length - 1];
    }

    shouldAutoPlay(hash) {
        if (!this.isEnabled) return false;
        if (hash.includes("?season=")) return false;

        const id = this.getContentId(hash);
        if (hash.startsWith("#/detail/series/")) {
            return id.includes(":") || id.includes("%3A");
        }
        return hash.startsWith("#/detail/movie/");
    }

    handleMutations() {
        const hash = window.location.hash;
        if (!this.isDetailPage(hash)) return;

        // Ensure button exists if we are on a detail page
        this.createToggleButton();

        if (!this.shouldAutoPlay(hash)) return;

        const currentId = this.getContentId(hash);
        if (this.lastAutoPlayedId === currentId) return;

        const streamsContainer = document.querySelector(
            this.STREAMS_CONTAINER_SELECTOR
        );

        if (
            streamsContainer &&
            !this.processedContainers.has(streamsContainer)
        ) {
            const firstStream = streamsContainer.querySelector(
                this.STREAM_ITEM_SELECTOR
            );

            if (firstStream) {
                console.log(
                    `[AutoSelectFirstStream] Auto-selecting first stream for ${currentId}...`
                );
                this.processedContainers.add(streamsContainer);
                this.lastAutoPlayedId = currentId;
                firstStream.click();
            }
        }
    }

    createToggleButton() {
        if (this.toggleButton || !this.isDetailPage(window.location.hash))
            return;

        this.toggleButton = document.createElement("button");
        this.toggleButton.className = `auto-select-toggle ${
            this.isEnabled ? "is-enabled" : "is-disabled"
        }`;
        this.updateButtonContent();

        this.toggleButton.addEventListener("click", () => {
            this.isEnabled = !this.isEnabled;

            // Update shared custom_setting object
            const settings = JSON.parse(
                localStorage.getItem("custom_setting") || "{}"
            );
            settings.auto_play_first_stream = this.isEnabled;
            localStorage.setItem("custom_setting", JSON.stringify(settings));

            this.toggleButton.className = `auto-select-toggle ${
                this.isEnabled ? "is-enabled" : "is-disabled"
            }`;
            this.updateButtonContent();

            if (this.isEnabled) {
                // If turning on, try to trigger immediately if container is present
                this.handleMutations();
            }
        });

        document.body.appendChild(this.toggleButton);
    }

    updateButtonContent() {
        if (!this.toggleButton) return;
        this.toggleButton.innerHTML = `
            <div class="status-dot"></div>
            <span>Auto-Play: ${this.isEnabled ? "ON" : "OFF"}</span>
        `;
    }

    removeToggleButton() {
        if (this.toggleButton) {
            this.toggleButton.remove();
            this.toggleButton = null;
        }
    }

    destroy() {
        this.stopObserving();
        this.removeToggleButton();
        this.processedContainers = new WeakSet();
        this.lastAutoPlayedId = null;
    }
}

// Initialize the plugin
if (window.requestIdleCallback) {
    window.requestIdleCallback(() => {
        window.autoSelectFirstStream = new AutoSelectFirstStream();
    });
} else {
    setTimeout(() => {
        window.autoSelectFirstStream = new AutoSelectFirstStream();
    }, 1);
}
