/**
 * @name EnhancedCovers-Optimized
 * @description Widens the cover images in the library using MutationObserver.
 * @version 1.1.0
 * @author Fxy, EZOBOSS
 */

function replaceSingleCover(img) {
    // Only replace if the source path includes "/poster/small/"
    if (img.src.includes("/poster/small/")) {
        img.src = img.src.replace("/poster/small/", "/background/large/");
    }
}

function processNewNodes(mutations) {
    for (const mutation of mutations) {
        if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
            mutation.addedNodes.forEach((node) => {
                // We are only interested in Element nodes
                if (node.nodeType === 1) {
                    // 1. Check if the added node itself is a poster image
                    if (
                        node.tagName === "IMG" &&
                        node.className.includes("poster-image-layer")
                    ) {
                        replaceSingleCover(node);
                    }

                    // 2. Search for poster images within the newly added subtree
                    const newPosters = node.querySelectorAll(
                        '[class*="poster-image-layer"] img'
                    );
                    newPosters.forEach(replaceSingleCover);
                }
            });
        }
    }
}

// 1. Initial run to catch existing posters
document
    .querySelectorAll('[class*="poster-image-layer"] img')
    .forEach(replaceSingleCover);

// 2. Set up the observer
const observer = new MutationObserver(processNewNodes);

// Start observing the body for changes in the DOM tree
observer.observe(document.body, {
    childList: true, // Watch for nodes being added or removed
    subtree: true, // Watch all descendants of the body
});
