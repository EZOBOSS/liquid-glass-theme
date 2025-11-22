// Remove all tooltips dynamically
const removeTitle = (el) => {
    if (el.hasAttribute("title")) el.removeAttribute("title");
    el.querySelectorAll("[title]").forEach((child) =>
        child.removeAttribute("title")
    );
};

// Initial cleanup
removeTitle(document.body);

const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        if (mutation.type === "childList") {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === 1) removeTitle(node);
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

observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["title"],
});
