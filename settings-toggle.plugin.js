(function () {
    const SELECTOR = ".sections-container-EUKAe";
    const TOGGLE_CLASS = "trailer-toggle";
    const LOCAL_KEY = "custom_setting"; // single object for all custom settings
    const INSERT_INDEX = 2; // 3rd child (zero-based)

    const readState = (prop) => {
        try {
            const obj = JSON.parse(localStorage.getItem(LOCAL_KEY) || "{}");
            return prop in obj ? !!obj[prop] : true;
        } catch {
            return true;
        }
    };

    const writeState = (prop, value) => {
        try {
            const obj = JSON.parse(localStorage.getItem(LOCAL_KEY) || "{}");
            obj[prop] = value;
            localStorage.setItem(LOCAL_KEY, JSON.stringify(obj));
        } catch {}
    };

    const buildToggleElement = () => {
        const wrapper = document.createElement("div");
        wrapper.className = "option-container-EGlcv";
        wrapper.innerHTML = `
            <div class="option-name-container-exGMI ${TOGGLE_CLASS}">
                <div class="label-FFamJ">Play trailer on hover</div>
            </div>
            <div class="option-input-container-NPgpT toggle-container-lZfHP button-container-zVLH6">
                <button class="toggle-toOWM" role="switch" aria-checked="false"></button>
            </div>
        `;
        return wrapper;
    };

    const insertToggleInto = (container) => {
        if (!container) return;
        if (container.querySelector(`.${TOGGLE_CLASS}`)) return;

        const targetChild = container.children[INSERT_INDEX];
        if (!targetChild) return;

        const toggle = buildToggleElement();
        const button = toggle.querySelector(".toggle-toOWM");
        const inputContainer = toggle.querySelector(
            ".option-input-container-NPgpT"
        );

        const applyState = (state) => {
            if (state) {
                button.classList.add("checked");
                inputContainer.classList.add("checked");
                button.setAttribute("aria-checked", "true");
            } else {
                button.classList.remove("checked");
                inputContainer.classList.remove("checked");
                button.setAttribute("aria-checked", "false");
            }
        };

        let isEnabled = readState("play_trailer_on_hover");
        applyState(isEnabled);

        button.addEventListener("click", () => {
            isEnabled = !isEnabled;
            writeState("play_trailer_on_hover", isEnabled);
            applyState(isEnabled);

            window.dispatchEvent(
                new CustomEvent("customSettingChanged", {
                    detail: { enabled: isEnabled },
                })
            );
        });

        targetChild.appendChild(toggle);
        console.log(
            "[CustomToggle] Added Stremio-style toggle (play_trailer_on_hover)"
        );
    };

    function waitForContainer(selector, cb, timeout = 8000) {
        const existing = document.querySelector(selector);
        if (existing) return cb(existing);

        const observer = new MutationObserver(() => {
            const found = document.querySelector(selector);
            if (found) {
                observer.disconnect();
                cb(found);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => observer.disconnect(), timeout);
    }

    function ensureTogglePersists(container) {
        const checkAndInsert = () => {
            if (!container.querySelector(`.${TOGGLE_CLASS}`))
                insertToggleInto(container);
        };
        checkAndInsert();

        const observer = new MutationObserver(() => checkAndInsert());
        observer.observe(container, { childList: true, subtree: true });
    }

    function bootstrap() {
        waitForContainer(
            SELECTOR,
            (container) => {
                insertToggleInto(container);
                ensureTogglePersists(container);
            },
            10000
        );
    }

    bootstrap();
    window.addEventListener("hashchange", () => setTimeout(bootstrap, 400));
})();
