/**
 * @name Tooltips Remover Plugin
 * @description Removes tooltips from the interface
 * @version 1.0.0
 * @author EZOBOSS
 */

(function () {
    class TooltipsRemoverPlugin {
        constructor() {
            this.init();
        }

        init() {
            // Initial cleanup
            requestIdleCallback(() => {
                this.removeTitles(document.body);
            });

            this.initObserver();
        }

        removeTitles(el) {
            if (!el) return;
            if (el.hasAttribute("title")) el.removeAttribute("title");
            const childrenWithTitles = el.querySelectorAll("[title]");
            childrenWithTitles.forEach((child) =>
                child.removeAttribute("title"),
            );
        }

        initObserver() {
            this.observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    if (mutation.type === "childList") {
                        mutation.addedNodes.forEach((node) => {
                            if (node.nodeType === 1) this.removeTitles(node);
                        });
                    } else if (
                        mutation.type === "attributes" &&
                        mutation.attributeName === "title"
                    ) {
                        if (mutation.target.hasAttribute("title")) {
                            mutation.target.removeAttribute("title");
                        }
                    }
                });
            });

            this.observer.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ["title"],
            });
        }
    }

    requestIdleCallback(() => {
        new TooltipsRemoverPlugin();
    });
})();
