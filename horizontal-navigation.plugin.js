/**
 * @name Horizontal Navigation
 * @description Moves your vertical navigation bar to a horizontal position.
 * @version 1.1.0
 * @author Fxy (Optimized)
 */

const cachedNavbars = new WeakMap();
let isUpdatePending = false;

function moveNavbar(verticalNavbar, targetParent) {
    if (!verticalNavbar || !targetParent) return;
    // Only move if not already in the correct parent
    if (verticalNavbar.parentElement !== targetParent) {
        // Use a fragment or just move it directly.
        // Toggling visibility might cause flicker, but let's keep it if it was for smooth transition.
        // However, for performance, direct append is faster.
        targetParent.appendChild(verticalNavbar);
    }
}

function processLinks(container) {
    // Only query for links that haven't been processed yet
    const links = container.querySelectorAll("a:not(.h-nav-processed)");
    links.forEach((link) => {
        // We no longer remove the SVG, as we want to show it by default
        // const svg = link.querySelector("svg");
        // if (svg) svg.remove();

        const label = link.querySelector("div");
        if (label) label.className = "nav-label";

        link.classList.add("h-nav-processed");
    });
}

function fixAllNavbars() {
    isUpdatePending = false;

    const verticalNavbars = document.querySelectorAll(
        '[class*="vertical-nav-bar"]'
    );
    if (verticalNavbars.length === 0) return;

    verticalNavbars.forEach((vNav) => {
        // Cache the original parent if we haven't seen this navbar before
        let originalParent = cachedNavbars.get(vNav);
        if (!originalParent) {
            originalParent = vNav.parentElement;
            if (originalParent) {
                cachedNavbars.set(vNav, originalParent);
            }
        }

        // Find the target horizontal navbar container
        // We use the original logic: look for a common ancestor div and then find the horizontal nav
        // This ensures we find the *correct* horizontal nav for this specific vertical nav (e.g. on different pages)
        let hNav = vNav
            .closest("div")
            ?.querySelector('[class*="horizontal-nav-bar"]');

        // Fallback: If we are already inside the horizontal nav, the above lookup might fail
        // (if vNav.closest('div') returns hNav, querySelector won't find hNav inside itself).
        // So we explicitly check if the parent is the horizontal nav.
        if (
            !hNav &&
            vNav.parentElement &&
            vNav.parentElement.matches('[class*="horizontal-nav-bar"]')
        ) {
            hNav = vNav.parentElement;
        }

        // Check visibility/existence
        const horizontalVisible = hNav && hNav.offsetParent !== null;
        const originalVisible =
            originalParent && originalParent.offsetParent !== null;

        if (horizontalVisible) {
            moveNavbar(vNav, hNav);
            processLinks(hNav);
        } else if (!horizontalVisible && originalVisible && originalParent) {
            moveNavbar(vNav, originalParent);
        }
    });
}

function scheduleUpdate() {
    if (!isUpdatePending) {
        isUpdatePending = true;
        requestAnimationFrame(fixAllNavbars);
    }
}

// Observer to handle dynamic content changes
let debounceTimer;
const observer = new MutationObserver((mutations) => {
    // Filter out mutations that are likely irrelevant (e.g., changes to attributes that don't affect layout)
    // For now, we'll just debounce the update
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(scheduleUpdate, 50);
});

// Start observing
// Removed 'attributes: true' to reduce noise, unless strictly necessary for visibility toggles
observer.observe(document.body, {
    childList: true,
    subtree: true,
});

// Initial call
scheduleUpdate();
