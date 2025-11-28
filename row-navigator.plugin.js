/**
 * @name Row Navigator
 * @description Displays a side navigation for rows on the homescreen.
 * @version 1.0.3
 * @author EZOBOSS
 */

(function () {
    class RowNavigatorPlugin {
        static CONFIG = {
            SELECTORS: {
                ROW: ".meta-row-container-xtlB1",
                TITLE: ".header-container-tR3Ev .title-container-Mkwnq",
                NAV_CONTAINER: "row-navigator-container",
                IGNORE_CONTAINER: ".meta-items-container-qcuUA",
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
            this.scanTimeout = null; // Store timeout reference

            setTimeout(() => this.init(), 2000);
        }

        init() {
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
                // Check connection before scrolling (fix for dead clicks)
                if (row.isConnected) {
                    row.scrollIntoView({ behavior: "smooth", block: "center" });
                } else {
                    // Fallback: If row was replaced, try to find by current index
                    this.scanRows();
                }
            });

            return item;
        }

        initObservers() {
            this.observer = new IntersectionObserver((entries) => {
                if (this.isProgrammaticScroll) return;
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        this.setActiveRow(entry.target);
                    }
                });
            }, RowNavigatorPlugin.CONFIG.OBSERVER_OPTIONS);

            this.mutationObserver = new MutationObserver((mutations) => {
                let structureChanged = false;
                const rowSelector = RowNavigatorPlugin.CONFIG.SELECTORS.ROW;
                const ignoreSelector =
                    RowNavigatorPlugin.CONFIG.SELECTORS.IGNORE_CONTAINER;

                for (const m of mutations) {
                    // 1. Ignore if mutation happens strictly INSIDE the infinite scroll container
                    if (m.target.closest && m.target.closest(ignoreSelector))
                        continue;

                    // 2. Ignore if the mutation target IS the infinite scroll container
                    if (m.target.matches && m.target.matches(ignoreSelector))
                        continue;

                    for (const node of m.addedNodes) {
                        if (node.nodeType !== 1) continue;

                        // 3. Ignore if the added node is part of the infinite scroll list
                        if (node.closest(ignoreSelector)) continue;

                        // 4. Only trigger if a ROW or a major container is added
                        if (
                            node.matches(rowSelector) ||
                            node.querySelector?.(rowSelector)
                        ) {
                            structureChanged = true;
                            break;
                        }
                    }
                    if (structureChanged) break;
                }

                if (structureChanged) {
                    // Debounce is CRITICAL here to prevent layout thrashing
                    // and broken ordering during rapid infinite scroll updates.
                    if (this.scanTimeout) clearTimeout(this.scanTimeout);
                    this.scanTimeout = setTimeout(() => this.scanRows(), 200);
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
            console.log("rowElements", rowElements, rowElements.length);

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
                    // UPDATE EXISTING: Fixes "Order bug" when frameworks recycle rows
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
                    // CREATE NEW
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

        initSnapScrolling() {
            this.isScrolling = false;
            this.isProgrammaticScroll = false;
            this.scrollTimeout = null;
            this.labelHideTimeout = null;

            window.addEventListener(
                "wheel",
                (e) => {
                    const target = e.target;
                    // Ignore horizontal scroll areas
                    if (target.closest(".meta-items-container-qcuUA")) return;

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
                },
                { passive: false }
            );
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

            // Fallback: Find closest row to center
            const center = window.innerHeight / 2;
            let closestRow = null;
            let minDistance = Infinity;

            rowElements.forEach((row) => {
                const rect = row.getBoundingClientRect();
                const dist = Math.abs(rect.top + rect.height / 2 - center);
                if (dist < minDistance) {
                    minDistance = dist;
                    closestRow = row;
                }
            });

            if (closestRow) {
                this.setActiveRow(closestRow);
                return rowElements.indexOf(closestRow);
            }
            return 0;
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
