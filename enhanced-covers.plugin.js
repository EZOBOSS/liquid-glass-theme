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
                if (node.nodeType === 1) {
                    if (
                        node.tagName === "IMG" &&
                        node.className.includes("poster-image-layer")
                    ) {
                        replaceSingleCover(node);
                    }

                    const newPosters = node.querySelectorAll(
                        '[class*="poster-image-layer"] img'
                    );
                    newPosters.forEach(replaceSingleCover);
                }
            });
        }
    }
}

document
    .querySelectorAll('[class*="poster-image-layer"] img')
    .forEach(replaceSingleCover);

const observer = new MutationObserver(processNewNodes);
observer.observe(document.body, {
    childList: true,
    subtree: true,
});
