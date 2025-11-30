/**
 * @name Row Navigator
 * @description Displays a side navigation for rows on the homescreen.
 * @version 1.1.0
 * @author EZOBOSS
 */

(function () {
    class RowNavigatorPlugin {
        static CONFIG = {
            SELECTORS: {
                ROW_CONTAINER: ".board-content-nPWv1",
                ROW: ".meta-row-container-xtlB1",
                TITLE: ".header-container-tR3Ev .title-container-Mkwnq",
                NAV_CONTAINER: "row-navigator-container",
                IGNORE_CONTAINER:
                    ".meta-items-container-qcuUA, .upcoming-groups-container",
            },
            OBSERVER_OPTIONS: {
                root: null,
                rootMargin: "-40% 0px -40% 0px",
                threshold: 0,
            },
        };

        constructor() {
            this.navContainer = null;
            this.rows = new Map();
            this.observer = null;
            this.mutationObserver = null;
            this.activeRow = null;
            this.scanTimeout = null;
            this.enabled = false;
            this.scrollHandler = this.handleScroll.bind(this);

            // Start immediately
            this.init();
        }

        init() {
            // Inject CSS once
            if (!document.querySelector("#row-navigator-css")) {
                const link = document.createElement("link");
                link.id = "row-navigator-css";
                link.rel = "stylesheet";
                link.href = "row-navigator.plugin.css";
                document.head.appendChild(link);
            }

            // Initial check
            this.checkActiveState();

            // Listen for navigation
            window.addEventListener("hashchange", () => {
                this.checkActiveState();
            });
        }

        checkActiveState() {
            if (this.isHomepage()) {
                if (!this.enabled) this.enable();
            } else {
                if (this.enabled) this.disable();
            }
        }

        isHomepage() {
            const hash = window.location.hash;
            return !hash || hash === "#" || hash === "#/";
        }

        enable() {
            if (this.enabled) return;

            // Small delay to ensure DOM is ready after hashchange
            setTimeout(() => {
                if (!this.isHomepage()) return;

                this.createNavContainer();
                this.navContainer.style.display = "flex";

                this.initObservers();
                this.initSnapScrolling();
                this.scanRows();

                this.enabled = true;
            }, 500);
        }

        disable() {
            if (!this.enabled) return;

            if (this.navContainer) {
                this.navContainer.style.display = "none";
            }

            if (this.observer) this.observer.disconnect();
            if (this.mutationObserver) this.mutationObserver.disconnect();

            const rowContainer = document.querySelector(
                RowNavigatorPlugin.CONFIG.SELECTORS.ROW_CONTAINER
            );
            if (rowContainer) {
                rowContainer.removeEventListener("wheel", this.scrollHandler);
            } else {
                document.body.removeEventListener("wheel", this.scrollHandler);
            }

            this.rows.clear();
            this.activeRow = null;
            if (this.scanTimeout) clearTimeout(this.scanTimeout);

            this.enabled = false;
        }

        createNavContainer() {
            if (
                document.getElementById(
                    RowNavigatorPlugin.CONFIG.SELECTORS.NAV_CONTAINER
                )
            ) {
                this.navContainer = document.getElementById(
                    RowNavigatorPlugin.CONFIG.SELECTORS.NAV_CONTAINER
                );
                return;
            }

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
            item.title = title;

            const dot = document.createElement("div");
            dot.className = "row-navigator-dot";

            const label = document.createElement("div");
            label.className = "row-navigator-label";
            label.textContent = title;

            item.appendChild(label);
            item.appendChild(dot);

            item.addEventListener("click", (e) => {
                e.stopPropagation();
                if (row.isConnected) {
                    // Set flag to prevent IntersectionObserver interference
                    this.isProgrammaticScroll = true;
                    this.setActiveRow(row);

                    row.scrollIntoView({ behavior: "smooth", block: "end" });

                    // Reset flag after animation
                    setTimeout(() => {
                        this.isProgrammaticScroll = false;
                    }, 1000);
                } else {
                    this.scanRows();
                }
            });

            return item;
        }

        initObservers() {
            // Intersection Observer
            this.observer = new IntersectionObserver((entries) => {
                if (this.isProgrammaticScroll) return;
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        this.setActiveRow(entry.target);
                    }
                });
            }, RowNavigatorPlugin.CONFIG.OBSERVER_OPTIONS);

            // Mutation Observer
            this.mutationObserver = new MutationObserver((mutations) => {
                let shouldScan = false;
                const rowSelector = RowNavigatorPlugin.CONFIG.SELECTORS.ROW;
                const ignoreSelector =
                    RowNavigatorPlugin.CONFIG.SELECTORS.IGNORE_CONTAINER;

                for (const m of mutations) {
                    // Optimization: Skip if mutation is inside ignore container
                    if (m.target.closest && m.target.closest(ignoreSelector))
                        continue;

                    // If nodes added
                    if (m.addedNodes.length > 0) {
                        for (const node of m.addedNodes) {
                            if (node.nodeType !== 1) continue;

                            // If it's a row
                            if (node.matches(rowSelector)) {
                                shouldScan = true;
                                break;
                            }
                            // If it contains rows (e.g. board reload)
                            if (
                                node.querySelector &&
                                node.querySelector(rowSelector)
                            ) {
                                shouldScan = true;
                                break;
                            }
                        }
                    }
                    // If nodes removed
                    if (m.removedNodes.length > 0) {
                        for (const node of m.removedNodes) {
                            if (node.nodeType !== 1) continue;
                            if (node.matches(rowSelector)) {
                                shouldScan = true;
                                break;
                            }
                        }
                    }

                    if (shouldScan) break;
                }

                if (shouldScan) {
                    if (this.scanTimeout) clearTimeout(this.scanTimeout);
                    this.scanTimeout = setTimeout(() => this.scanRows(), 200);
                }
            });

            this.mutationObserver.observe(document.body, {
                childList: true,
                subtree: true,
            });
        }

        initSnapScrolling() {
            this.isScrolling = false;
            this.isProgrammaticScroll = false;
            this.scrollTimeout = null;
            this.labelHideTimeout = null;

            const container =
                document.querySelector(
                    RowNavigatorPlugin.CONFIG.SELECTORS.ROW_CONTAINER
                ) || document.body;
            container.addEventListener("wheel", this.scrollHandler, {
                passive: false,
            });
        }

        handleScroll(e) {
            const target = e.target;
            // Ignore horizontal scroll areas
            if (
                target.closest(
                    RowNavigatorPlugin.CONFIG.SELECTORS.IGNORE_CONTAINER
                )
            )
                return;

            // Ensure we are actually on the board/rows
            if (
                !target.closest(RowNavigatorPlugin.CONFIG.SELECTORS.ROW) &&
                !target.closest(
                    RowNavigatorPlugin.CONFIG.SELECTORS.ROW_CONTAINER
                )
            )
                return;

            const rowElements = Array.from(
                document.querySelectorAll(
                    RowNavigatorPlugin.CONFIG.SELECTORS.ROW
                )
            );
            if (rowElements.length === 0) return;

            e.preventDefault();
            this.showLabels();

            if (this.isScrolling) return;

            const direction = e.deltaY > 0 ? 1 : -1;
            this.scrollToAdjacentRow(direction, rowElements);

            this.isScrolling = true;
            clearTimeout(this.scrollTimeout);
            this.scrollTimeout = setTimeout(() => {
                this.isScrolling = false;
            }, 800);
        }

        showLabels() {
            if (this.navContainer)
                this.navContainer.classList.add("show-labels");
            if (this.labelHideTimeout) clearTimeout(this.labelHideTimeout);
            this.labelHideTimeout = setTimeout(() => this.hideLabels(), 5000);
        }

        hideLabels() {
            if (this.navContainer)
                this.navContainer.classList.remove("show-labels");
        }

        scrollToAdjacentRow(direction, rowElements) {
            const currentIndex = this.getCurrentRowIndex(rowElements);
            const nextIndex = currentIndex + direction;

            if (nextIndex >= 0 && nextIndex < rowElements.length) {
                const targetRow = rowElements[nextIndex];
                this.isProgrammaticScroll = true;
                this.setActiveRow(targetRow);

                targetRow.scrollIntoView({
                    behavior: "smooth",
                    block: "center",
                });

                setTimeout(() => {
                    this.isProgrammaticScroll = false;
                }, 1000);
            }
        }

        getCurrentRowIndex(rowElements) {
            if (this.activeRow && this.activeRow.isConnected) {
                const index = rowElements.indexOf(this.activeRow);
                if (index !== -1) return index;
            }

            return -1;
        }

        scanRows() {
            if (!this.navContainer) this.createNavContainer();

            const rowElements = Array.from(
                document.querySelectorAll(
                    RowNavigatorPlugin.CONFIG.SELECTORS.ROW
                )
            );

            if (rowElements.length === 0) {
                this.navContainer.style.display = "none";
                return;
            } else {
                this.navContainer.style.display = "flex";
            }

            // 1. Update Map (Create New + Update Existing)
            rowElements.forEach((row, index) => {
                const titleEl = row.querySelector(
                    RowNavigatorPlugin.CONFIG.SELECTORS.TITLE
                );
                const currentTitle = titleEl
                    ? titleEl.textContent.trim()
                    : `Row ${index + 1}`;

                if (this.rows.has(row)) {
                    const data = this.rows.get(row);
                    if (data.title !== currentTitle) {
                        data.title = currentTitle;
                        data.navItem.title = currentTitle;
                        const label = data.navItem.querySelector(
                            ".row-navigator-label"
                        );
                        if (label) label.textContent = currentTitle;
                    }
                } else {
                    const id = `row-${index}-${Date.now()}`;
                    row.dataset.rowNavId = id;
                    const navItem = this.createNavItem(row, currentTitle, id);
                    this.rows.set(row, { id, title: currentTitle, navItem });
                    this.observer.observe(row);
                }
            });

            // 2. Clean up removed rows
            for (const [row, data] of this.rows.entries()) {
                if (!document.body.contains(row)) {
                    this.observer.unobserve(row);
                    this.rows.delete(row);
                }
            }

            // 3. Sync Visual Order
            this.syncNavOrder(rowElements);

            if (rowElements.length > 0 && !this.activeRow) {
                this.setFirstRowActive();
                // Fix: Prevent IntersectionObserver from immediately overriding the first row
                this.isProgrammaticScroll = true;
                setTimeout(() => {
                    this.isProgrammaticScroll = false;
                }, 500);
            }
        }

        syncNavOrder(rowElements) {
            const fragment = document.createDocumentFragment();
            rowElements.forEach((row) => {
                const data = this.rows.get(row);
                if (data && data.navItem) {
                    fragment.appendChild(data.navItem);
                }
            });
            this.navContainer.replaceChildren(fragment);
        }

        setFirstRowActive() {
            const rowElements = Array.from(
                document.querySelectorAll(
                    RowNavigatorPlugin.CONFIG.SELECTORS.ROW
                )
            );
            if (rowElements.length > 0) {
                const visibleRow =
                    rowElements.find((r) => {
                        const rect = r.getBoundingClientRect();
                        return rect.top >= 0 && rect.top < window.innerHeight;
                    }) || rowElements[0];
                this.setActiveRow(visibleRow);
            }
        }

        setActiveRow(row) {
            if (this.activeRow === row) return;
            this.activeRow = row;

            const allRows = document.querySelectorAll(
                RowNavigatorPlugin.CONFIG.SELECTORS.ROW
            );
            allRows.forEach((r) => {
                if (r !== row) r.classList.remove("show", "active");
            });

            if (row) {
                row.classList.add("active");
                setTimeout(() => row.classList.add("show"), 100);
            }

            this.navContainer
                .querySelectorAll(".row-navigator-item")
                .forEach((item) => item.classList.remove("active"));

            const data = this.rows.get(row);
            if (data && data.navItem) {
                data.navItem.classList.add("active");
            }
        }
    }

    requestIdleCallback(() => {
        new RowNavigatorPlugin();
    });
})();
