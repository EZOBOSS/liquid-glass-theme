/**
 * @name Row Navigator
 * @description Displays a side navigation for rows on the homescreen.
 * @version 1.0.0
 * @author EZOBOSS
 */

(function () {
    class RowNavigatorPlugin {
        static CONFIG = {
            SELECTORS: {
                ROW: ".meta-row-container-xtlB1",
                TITLE: ".header-container-tR3Ev .title-container-Mkwnq",
                NAV_CONTAINER: "row-navigator-container",
            },
            OBSERVER_OPTIONS: {
                root: null,
                rootMargin: "-55% 0px -55% 0px", // Trigger when row is in the middle 10% of screen
                threshold: 0,
            },
        };

        constructor() {
            this.navContainer = null;
            this.rows = new Map(); // Map<Element, {id, title, navItem}>
            this.observer = null;
            this.mutationObserver = null;
            this.activeRow = null;

            // Delay init to ensure DOM is ready (reduced to prevent infinite scroll issues)
            setTimeout(() => this.init(), 500);
        }

        init() {
            // Inject CSS if not present
            if (!document.querySelector("#row-navigator-css")) {
                const link = document.createElement("link");
                link.id = "row-navigator-css";
                link.rel = "stylesheet";
                link.href = "row-navigator.plugin.css";
                document.head.appendChild(link);
            }

            this.createNavContainer();
            this.initObservers();
            this.scanRows();
            this.initSnapScrolling();

            // Re-scan on hash change (navigation)
            window.addEventListener("hashchange", () => {
                setTimeout(() => {
                    this.scanRows();
                    this.setFirstRowActive();
                }, 1000);
            });
        }

        createNavContainer() {
            if (
                document.getElementById(
                    RowNavigatorPlugin.CONFIG.SELECTORS.NAV_CONTAINER
                )
            )
                return;

            this.navContainer = document.createElement("div");
            this.navContainer.id =
                RowNavigatorPlugin.CONFIG.SELECTORS.NAV_CONTAINER;
            this.navContainer.className = "row-navigator-container";
            document.body.appendChild(this.navContainer);
        }

        createNavItem(row, title, id) {
            const item = document.createElement("div");
            item.className = "row-navigator-item";
            item.dataset.targetId = id;
            item.title = title; // Native tooltip as fallback

            const dot = document.createElement("div");
            dot.className = "row-navigator-dot";

            const label = document.createElement("div");
            label.className = "row-navigator-label";
            label.textContent = title;

            item.appendChild(label);
            item.appendChild(dot);

            item.addEventListener("click", (e) => {
                e.stopPropagation();
                row.scrollIntoView({ behavior: "smooth", block: "center" });
            });

            return item;
        }

        initObservers() {
            // Intersection Observer for highlighting active row
            this.observer = new IntersectionObserver((entries) => {
                // Don't update if we're in the middle of programmatic scrolling
                if (this.isProgrammaticScroll) return;

                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        this.setActiveRow(entry.target);
                    }
                });
            }, RowNavigatorPlugin.CONFIG.OBSERVER_OPTIONS);

            // Mutation Observer for dynamic content
            this.mutationObserver = new MutationObserver((mutations) => {
                let shouldScan = false;
                const rowSelector = RowNavigatorPlugin.CONFIG.SELECTORS.ROW;

                for (const m of mutations) {
                    // Ignore changes to the nav container itself to prevent loops
                    if (
                        m.target.closest &&
                        m.target.closest(".row-navigator-container")
                    )
                        continue;
                    if (
                        m.target.classList &&
                        m.target.classList.contains("row-navigator-container")
                    )
                        continue;

                    // Check if added nodes are relevant
                    if (m.addedNodes.length > 0) {
                        for (const node of m.addedNodes) {
                            if (node.nodeType !== 1) continue; // Skip non-element nodes

                            // Check if the node itself is a row (actual new row container)
                            if (node.matches && node.matches(rowSelector)) {
                                // Make sure it has a title to be considered a valid navigation row
                                const titleEl = node.querySelector(
                                    RowNavigatorPlugin.CONFIG.SELECTORS.TITLE
                                );
                                if (titleEl && titleEl.textContent.trim()) {
                                    shouldScan = true;
                                    break;
                                }
                            }

                            // Check if the node contains a row (e.g., parent container)
                            // But only if it's in the main board, not within existing rows
                            if (
                                node.querySelector &&
                                node.querySelector(rowSelector)
                            ) {
                                // Only scan if this is a major DOM change (board reload)
                                if (
                                    node.matches(".board-content-nPWv1") ||
                                    node.closest(".board-content-nPWv1") ===
                                        null
                                ) {
                                    shouldScan = true;
                                    break;
                                }
                            }
                        }
                    }
                    if (shouldScan) break;
                }

                if (shouldScan) {
                    // Debounce scan
                    if (this.scanTimeout) clearTimeout(this.scanTimeout);
                    this.scanTimeout = setTimeout(() => this.scanRows(), 500);
                }
            });

            this.mutationObserver.observe(document.body, {
                childList: true,
                subtree: true,
            });
        }

        scanRows() {
            if (!this.navContainer) this.createNavContainer();

            const rowElements = Array.from(
                document.querySelectorAll(
                    RowNavigatorPlugin.CONFIG.SELECTORS.ROW
                )
            );

            // If no rows found (e.g. not on home), hide container
            if (rowElements.length === 0) {
                this.navContainer.style.display = "none";
                this.navContainer.style.pointerEvents = "none";
                return;
            } else {
                this.navContainer.style.display = "flex";
                this.navContainer.style.pointerEvents = "auto";
            }

            // 1. Identify new rows and create items
            rowElements.forEach((row, index) => {
                if (this.rows.has(row)) return; // Already tracked

                const titleEl = row.querySelector(
                    RowNavigatorPlugin.CONFIG.SELECTORS.TITLE
                );
                // Fallback title if not found
                const title = titleEl
                    ? titleEl.textContent.trim()
                    : `Row ${index + 1}`;

                const id = `row-${index}-${Date.now()}`; // Unique ID
                row.dataset.rowNavId = id;

                const navItem = this.createNavItem(row, title, id);
                // Don't append yet, we'll re-order later

                this.rows.set(row, { id, title, navItem });
                this.observer.observe(row);
            });

            // 2. Re-order nav items to match DOM order
            // We clear the container and re-append in the correct order
            // This ensures the dots always match the visual row order
            // Using a DocumentFragment for performance
            const fragment = document.createDocumentFragment();

            rowElements.forEach((row) => {
                const data = this.rows.get(row);
                if (data && data.navItem) {
                    fragment.appendChild(data.navItem);
                }
            });

            this.navContainer.innerHTML = ""; // Clear existing
            this.navContainer.appendChild(fragment);

            // 3. Cleanup removed rows
            for (const [row, data] of this.rows.entries()) {
                if (!document.body.contains(row)) {
                    this.observer.unobserve(row);
                    // navItem is already removed from DOM by innerHTML clear, just need to drop reference
                    this.rows.delete(row);
                }
            }

            // Set first row active after initial scan
            if (rowElements.length > 0 && !this.activeRow) {
                this.setFirstRowActive();
            }
        }

        setFirstRowActive() {
            const rowElements = Array.from(
                document.querySelectorAll(
                    RowNavigatorPlugin.CONFIG.SELECTORS.ROW
                )
            );
            if (rowElements.length > 0) {
                const firstRow = rowElements[0];

                // Add classes immediately without delay to prevent infinite scroll issues
                firstRow.classList.add("active", "show");
                this.activeRow = firstRow;

                // Update UI for nav items
                this.navContainer
                    ?.querySelectorAll(".row-navigator-item")
                    .forEach((item) => {
                        item.classList.remove("active");
                    });

                const data = this.rows.get(firstRow);
                if (data && data.navItem) {
                    data.navItem.classList.add("active");
                }

                firstRow.scrollIntoView({
                    behavior: "auto", // Use auto instead of smooth for immediate positioning
                    block: "center",
                });
            }
        }

        initSnapScrolling() {
            this.isScrolling = false;
            this.isProgrammaticScroll = false;
            this.scrollTimeout = null;
            this.labelHideTimeout = null;

            // Intercept wheel events for snap scrolling
            window.addEventListener(
                "wheel",
                (e) => {
                    // Check if scrolling over a horizontal scroll container
                    const target = e.target;
                    const isOverHorizontalScroll = target.closest(
                        ".meta-items-container-qcuUA"
                    );

                    // If over horizontal scroll, let it handle naturally
                    if (isOverHorizontalScroll) {
                        return;
                    }

                    // Only intercept if we have rows
                    const rowElements = Array.from(
                        document.querySelectorAll(
                            RowNavigatorPlugin.CONFIG.SELECTORS.ROW
                        )
                    );
                    if (rowElements.length === 0) return;

                    // Prevent default scroll behavior
                    e.preventDefault();

                    // Show labels when scrolling
                    this.showLabels();

                    // Debounce scroll events
                    if (this.isScrolling) return;

                    const direction = e.deltaY > 0 ? 1 : -1; // 1 for down, -1 for up
                    this.scrollToAdjacentRow(direction);

                    // Set scrolling flag
                    this.isScrolling = true;
                    clearTimeout(this.scrollTimeout);
                    this.scrollTimeout = setTimeout(() => {
                        this.isScrolling = false;
                    }, 800); // Delay before next scroll
                },
                { passive: false }
            );
        }

        showLabels() {
            if (this.navContainer) {
                this.navContainer.classList.add("show-labels");
            }

            // Clear existing timeout
            if (this.labelHideTimeout) {
                clearTimeout(this.labelHideTimeout);
            }

            // Hide labels after 2 seconds of inactivity
            this.labelHideTimeout = setTimeout(() => {
                this.hideLabels();
            }, 5000);
        }

        hideLabels() {
            if (this.navContainer) {
                this.navContainer.classList.remove("show-labels");
            }
        }

        scrollToAdjacentRow(direction) {
            const rowElements = Array.from(
                document.querySelectorAll(
                    RowNavigatorPlugin.CONFIG.SELECTORS.ROW
                )
            );
            if (rowElements.length === 0) return;

            const currentIndex = this.getCurrentRowIndex(rowElements);
            const nextIndex = currentIndex + direction;

            // Clamp to valid range
            if (nextIndex >= 0 && nextIndex < rowElements.length) {
                const targetRow = rowElements[nextIndex];

                // Set flag to prevent IntersectionObserver interference
                this.isProgrammaticScroll = true;
                this.setActiveRow(targetRow);

                targetRow.scrollIntoView({
                    behavior: "smooth",
                    block: "center",
                });

                // Clear flag after scroll animation completes
                setTimeout(() => {
                    this.isProgrammaticScroll = false;
                }, 1000); // Match scroll animation duration
            }
        }

        getCurrentRowIndex(rowElements) {
            if (!this.activeRow) return 0;
            const index = rowElements.indexOf(this.activeRow);
            return index >= 0 ? index : 0;
        }

        setActiveRow(row) {
            if (this.activeRow === row) return;
            this.activeRow = row;

            // Remove "show" class from all rows
            const allRows = document.querySelectorAll(
                RowNavigatorPlugin.CONFIG.SELECTORS.ROW
            );
            allRows.forEach((r) => {
                if (r !== row) {
                    r.classList.remove("show", "active");
                }
            });

            // Add "show" class to active row
            if (row) {
                row.classList.add("active");
                setTimeout(() => {
                    row.classList.add("show");
                }, 100);
            }

            // Update UI
            this.navContainer
                .querySelectorAll(".row-navigator-item")
                .forEach((item) => {
                    item.classList.remove("active");
                });

            const data = this.rows.get(row);
            if (data && data.navItem) {
                data.navItem.classList.add("active");
            }
        }
    }

    // Initialize
    requestIdleCallback(() => {
        new RowNavigatorPlugin();
    });
})();
