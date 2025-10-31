(function () {
    console.log("[AppleTVWheelSmoothCtrl] WebMod loaded");

    function initWheelScroll(track) {
        if (!track || track.dataset.wheelScrollInitialized === "true") return;
        track.dataset.wheelScrollInitialized = "true";

        // state
        track.dataset.percentage = "0";
        let targetPct = 0;
        let animationFrame;

        const applyTransform = () => {
            const currentPct = parseFloat(track.dataset.percentage || "0");
            const diff = targetPct - currentPct;
            const step = diff * 0.01; // smooth factor
            if (Math.abs(diff) < 0.01) {
                track.dataset.percentage = targetPct;
                cancelAnimationFrame(animationFrame);
                return;
            }
            const newPct = currentPct + step;
            track.dataset.percentage = newPct;
            track.style.transform = `translate(${newPct}%, 0)`;

            // parallax images
            const imgs = track.getElementsByTagName("img");
            for (const img of imgs) {
                img.style.objectPosition = `${50 + newPct * 0.5}% center`;
            }

            animationFrame = requestAnimationFrame(applyTransform);
        };

        const handleWheel = (e) => {
            if (!e.ctrlKey) return; // only scroll horizontally if Ctrl is pressed
            e.preventDefault();

            const delta = e.deltaY || e.deltaX || 0;
            const speedFactor = 0.15; // adjust sensitivity
            targetPct = Math.max(
                Math.min(targetPct - delta * speedFactor, 0),
                -100
            );
            cancelAnimationFrame(animationFrame);
            animationFrame = requestAnimationFrame(applyTransform);
        };

        track.addEventListener("wheel", handleWheel, { passive: false });

        track.style.cursor = "grab";
        track.style.touchAction = "pan-y"; // allow vertical scroll normally
    }

    function findAndInitTracks() {
        const candidateSelectors = [
            '[id*="meta-items-container"]',
            '[class*="meta-items"]',
            '[class*="poster-layer"]',
            '[class*="poster-image-layer"]',
            '[class*="list"]',
            '[class*="carousel"]',
        ];
        const seen = new Set();

        candidateSelectors.forEach((sel) => {
            document.querySelectorAll(sel).forEach((el) => {
                if (!el || seen.has(el)) return;
                const imgCount = el.querySelectorAll("img").length;
                const posterLike = el.querySelectorAll(
                    '[class*="poster"], [class*="image"], img'
                ).length;
                if (imgCount >= 3 || posterLike >= 3) {
                    initWheelScroll(el);
                    seen.add(el);
                }
            });
        });

        document
            .querySelectorAll('[class*="poster-image-layer"]')
            .forEach((p) => {
                const parent = p.parentElement;
                if (parent && !seen.has(parent)) {
                    const posterLike = parent.querySelectorAll(
                        '[class*="poster"], [class*="image"], img'
                    ).length;
                    if (posterLike >= 3) {
                        initWheelScroll(parent);
                        seen.add(parent);
                    }
                }
            });
    }

    setInterval(() => {
        try {
            findAndInitTracks();
        } catch (err) {
            console.error("[AppleTVWheelSmoothCtrl] error:", err);
        }
    }, 500);

    console.log("[AppleTVWheelSmoothCtrl] interval started");
})();
