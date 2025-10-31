/**
 * @name Enhanced Title Bar
 * @description Enhances the title bar with additional information.
 * @version 1.0.0
 * @author Fxy
 */

const CONFIG = {
    apiBase: "https://v3-cinemeta.strem.io/meta",
    timeout: 5000,
    updateInterval: 2000,
};

const metadataCache = new Map();

function injectStyles() {
    if (document.getElementById("enhanced-title-bar-styles")) return;

    const style = document.createElement("style");
    style.id = "enhanced-title-bar-styles";
    style.textContent = `
        .enhanced-title-bar {
            position: relative !important;
            padding: 5px 4px !important;
            padding-right: 10px !important;
            overflow: hidden !important;
            max-width: 400px !important;
            transform: translateZ(0) !important;
        }
            
        .enhanced-title {
            font-size: 16px !important;
            font-weight: 600 !important;
            color: #ffffff !important;
            margin-bottom: 3px !important;
            line-height: 1.3 !important;
        }
        
        .enhanced-metadata {
            display: flex !important;
            align-items: center !important;
            gap: 8px !important;
            flex-wrap: wrap !important;
            font-size: 12px !important;
            color: #999 !important;
        }
        
        .enhanced-metadata-item {
            display: inline-flex !important;
            align-items: center !important;
            gap: 4px !important;
        }
        
        .enhanced-separator {
            color: #666 !important;
            margin: 0 4px !important;
        }
            
        .enhanced-loading {
            background: linear-gradient(90deg, #333 25%, #444 50%, #333 75%) !important;
            background-size: 200% 100% !important;
            animation: enhanced-loading 1.5s infinite !important;
            border-radius: 3px !important;
            height: 12px !important;
            width: 60px !important;
            display: inline-block !important;
        }
        
        @keyframes enhanced-loading {
            0% { background-position: 200% 0; }
            100% { background-position: -200% 0; }
        }
    `;
    document.head.appendChild(style);
}

async function getMetadata(id, type) {
    const cacheKey = `${type}-${id}`;

    if (metadataCache.has(cacheKey)) {
        return metadataCache.get(cacheKey);
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CONFIG.timeout);

        const response = await fetch(`${CONFIG.apiBase}/${type}/${id}.json`, {
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        const meta = data.meta;

        if (!meta) return null;

        const metadata = {
            title: meta.name || meta.title,
            year: meta.year ? meta.year.toString() : null,
            rating: meta.imdbRating ? meta.imdbRating.toString() : null,
            genres: Array.isArray(meta.genre)
                ? meta.genre
                : Array.isArray(meta.genres)
                ? meta.genres
                : [],
            runtime: meta.runtime || null,
            type: meta.type || type,
            poster: meta.poster,
            background: meta.background,
            description: meta.description || null,
            logo: meta.logo,
            // ✅ Trailer extraction with YouTube support
            trailer: (() => {
                let url = null;

                // 1️⃣ Get raw trailer URL or ID
                if (meta.trailer) url = meta.trailer;
                else if (
                    Array.isArray(meta.trailers) &&
                    meta.trailers.length > 0
                )
                    url = meta.trailers[0].source || meta.trailers[0].url;
                else if (Array.isArray(meta.videos) && meta.videos.length > 0)
                    url = meta.videos[0].url;

                if (!url) return null;

                // 2️⃣ Handle YouTube ID (short ID without slashes)
                if (!url.includes("/") && !url.includes("youtube.com")) {
                    return `https://www.youtube.com/embed/${url}?autoplay=1&mute=0&loop=1&playlist=${url}`;
                }

                // 3️⃣ Handle full YouTube URLs
                try {
                    const ytUrl = new URL(url);
                    let id = null;

                    if (ytUrl.hostname.includes("youtube.com")) {
                        id = ytUrl.searchParams.get("v");
                    } else if (ytUrl.hostname.includes("youtu.be")) {
                        id = ytUrl.pathname.slice(1);
                    }

                    if (id) {
                        return `https://www.youtube.com/embed/${id}?autoplay=1&mute=0&loop=1&playlist=${id}`;
                    }
                } catch {
                    // Invalid URL, return original as fallback
                    return url;
                }

                // 4️⃣ Fallback to raw URL
                return url;
            })(),
        };

        metadataCache.set(cacheKey, metadata);
        return metadata;
    } catch (error) {
        console.log(`Failed to fetch ${id}:`, error);
        return null;
    }
}

function extractMediaInfo(titleText, element) {
    // Look for an <a> tag with href containing tt
    const findHref = (el) => {
        // Case 1: element itself is an <a> with IMDb ID
        if (el.tagName === "A" && el.href && el.href.includes("tt")) {
            const match = el.href.match(/tt\d{7,}/);
            if (match) {
                const typeMatch = el.href.match(/\/(movie|series)\//i);
                const type = typeMatch ? typeMatch[1].toLowerCase() : "movie";
                return { id: match[0], type };
            }
        }

        // Case 2: element contains one or more <a> links
        const links = el.querySelectorAll("a[href*='tt']");
        for (let a of links) {
            const match = a.href.match(/tt\d{7,}/);
            if (match) {
                const typeMatch = a.href.match(/\/(movie|series)\//i);
                const type = typeMatch ? typeMatch[1].toLowerCase() : "movie";
                return { id: match[0], type };
            }
        }

        return null;
    };

    // Try element first, then parent
    const result = findHref(element.parentElement);

    if (result) {
        return result;
    }

    console.log("No IMDb ID found, using fallback");
    return { id: "tt0000000", type: "movie" };
}

function createMetadataElements(metadata) {
    const elements = [];

    if (metadata.rating) {
        const rating = document.createElement("span");
        rating.className = "enhanced-metadata-item enhanced-rating";
        rating.textContent = `★ ${metadata.rating}`;
        elements.push(rating);
    }

    if (metadata.year) {
        const year = document.createElement("span");
        year.className = "enhanced-metadata-item";
        year.textContent = metadata.year;
        elements.push(year);
    }

    if (metadata.genres && metadata.genres.length > 0) {
        const genres = document.createElement("span");
        genres.className = "enhanced-metadata-item";
        genres.textContent = metadata.genres.slice(0, 3).join(", ");
        elements.push(genres);
    }
    if (metadata.description) {
        const description = document.createElement("span");
        description.className = "enhanced-metadata-item enhanced-description";
        description.textContent = metadata.description;
        elements.push(description);
    }

    if (metadata.trailer) {
        const trailer = document.createElement("a");
        trailer.className = "enhanced-metadata-item enhanced-trailer";
        trailer.href = metadata.trailer;
        trailer.target = "_blank";
        trailer.rel = "noopener noreferrer";
        trailer.textContent = "";
        elements.push(trailer);
    }

    return elements;
}

async function enhanceTitleBar(titleBarElement) {
    if (titleBarElement.classList.contains("enhanced-title-bar")) return;

    const titleElement =
        titleBarElement.querySelector(".title-label-VnEAc") ||
        titleBarElement.querySelector('[class*="title-label"]') ||
        titleBarElement.querySelector('[class*="title"]');

    if (!titleElement) return;

    const originalTitle = titleElement.textContent.trim();
    if (!originalTitle || originalTitle.length < 1) return;

    titleBarElement.classList.add("enhanced-title-bar");
    titleBarElement.dataset.originalHtml = titleBarElement.innerHTML;
    titleBarElement.innerHTML = "";

    const mediaInfo = extractMediaInfo(originalTitle, titleBarElement);

    // Create title container (image or text)
    const titleContainer = document.createElement("div");
    titleContainer.className = "enhanced-title";
    titleBarElement.appendChild(titleContainer);

    const metadataContainer = document.createElement("div");
    metadataContainer.className = "enhanced-metadata";

    const loading = document.createElement("div");
    loading.className = "enhanced-loading";
    metadataContainer.appendChild(loading);

    titleBarElement.appendChild(metadataContainer);

    try {
        const metadata = await getMetadata(mediaInfo.id, mediaInfo.type);

        if (metadata) {
            // Use logo if exists, else fallback to title text
            if (metadata.logo && metadata.logo.length > 0) {
                const logoImg = document.createElement("img");
                logoImg.src = metadata.logo;
                logoImg.alt = metadata.title || originalTitle;
                logoImg.style.width = "75%"; // adjust size as needed
                logoImg.style.height = "65px";
                logoImg.style.objectFit = "contain";
                titleContainer.appendChild(logoImg);
            } else {
                titleContainer.textContent = metadata.title || originalTitle;
            }

            // Build metadata elements
            metadataContainer.innerHTML = "";
            const elements = createMetadataElements(metadata);
            elements.forEach((element, index) => {
                metadataContainer.appendChild(element);
                if (index < elements.length - 2) {
                    const separator = document.createElement("span");
                    separator.className = "enhanced-separator";
                    separator.textContent = "•";
                    metadataContainer.appendChild(separator);
                }
            });
        } else {
            metadataContainer.innerHTML = "";
            const fallback = document.createElement("span");
            fallback.className = "enhanced-metadata-item";
            fallback.textContent = originalTitle;
            fallback.style.color = "#ffffffff";
            metadataContainer.appendChild(fallback);
        }
    } catch (error) {
        metadataContainer.innerHTML = "";
        const errorText = document.createElement("span");
        errorText.className = "enhanced-metadata-item";
        errorText.textContent = "Loading failed";
        errorText.style.color = "#666";
        metadataContainer.appendChild(errorText);
    }
}

function enhanceAllTitleBars() {
    const selectors = [
        ".title-bar-container-1Ba0x",
        /*".meta-item-QFHCh", */
        '[class*="title-bar-container"]',
        '[class*="titleBarContainer"]',
        '[class*="title-container"]',
        '[class*="media-title"]',
    ];

    selectors.forEach((selector) => {
        const elements = document.querySelectorAll(selector);
        elements.forEach((element) => {
            enhanceTitleBar(element).catch(() => {});
        });
    });
}

function init() {
    injectStyles();
    enhanceAllTitleBars();

    setInterval(() => {
        enhanceAllTitleBars();
    }, CONFIG.updateInterval);

    if (typeof MutationObserver !== "undefined") {
        const observer = new MutationObserver((mutations) => {
            let shouldCheck = false;
            mutations.forEach((mutation) => {
                if (
                    mutation.type === "childList" &&
                    mutation.addedNodes.length > 0
                ) {
                    shouldCheck = true;
                }
            });

            if (shouldCheck) {
                setTimeout(enhanceAllTitleBars, 100);
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}

setTimeout(init, 100);
