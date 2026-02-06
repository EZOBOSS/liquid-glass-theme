(function () {
    class SettingsTogglePlugin {
        static CONFIG = {
            SELECTOR: ".sections-container-EUKAe",
            TOGGLE_CLASS: "trailer-toggle",
            LOCAL_KEY: "custom_setting",
            INSERT_INDEX: 2,
            SETTING_PROP: "play_trailer_on_hover",
        };

        constructor() {
            this.init();
        }

        init() {
            this.bootstrap();
            window.addEventListener("hashchange", () =>
                setTimeout(() => this.bootstrap(), 400),
            );
        }

        readState() {
            try {
                const obj = JSON.parse(
                    localStorage.getItem(
                        SettingsTogglePlugin.CONFIG.LOCAL_KEY,
                    ) || "{}",
                );
                return SettingsTogglePlugin.CONFIG.SETTING_PROP in obj
                    ? !!obj[SettingsTogglePlugin.CONFIG.SETTING_PROP]
                    : true;
            } catch {
                return true;
            }
        }

        writeState(value) {
            try {
                const obj = JSON.parse(
                    localStorage.getItem(
                        SettingsTogglePlugin.CONFIG.LOCAL_KEY,
                    ) || "{}",
                );
                obj[SettingsTogglePlugin.CONFIG.SETTING_PROP] = value;
                localStorage.setItem(
                    SettingsTogglePlugin.CONFIG.LOCAL_KEY,
                    JSON.stringify(obj),
                );
            } catch {}
        }

        buildToggleElement() {
            const wrapper = document.createElement("div");
            wrapper.className = "option-container-EGlcv";
            wrapper.innerHTML = `
                <div class="option-name-container-exGMI ${SettingsTogglePlugin.CONFIG.TOGGLE_CLASS}">
                    <div class="label-FFamJ">Play trailer on hover</div>
                </div>
                <div class="option-input-container-NPgpT toggle-container-lZfHP button-container-zVLH6">
                    <button class="toggle-toOWM" role="switch" aria-checked="false"></button>
                </div>
            `;
            return wrapper;
        }

        insertToggleInto(container) {
            if (!container) return;
            if (
                container.querySelector(
                    `.${SettingsTogglePlugin.CONFIG.TOGGLE_CLASS}`,
                )
            )
                return;

            const targetChild =
                container.children[SettingsTogglePlugin.CONFIG.INSERT_INDEX];
            if (!targetChild) return;

            const toggle = this.buildToggleElement();
            const button = toggle.querySelector(".toggle-toOWM");
            const inputContainer = toggle.querySelector(
                ".option-input-container-NPgpT",
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

            let isEnabled = this.readState();
            applyState(isEnabled);

            button.addEventListener("click", () => {
                isEnabled = !isEnabled;
                this.writeState(isEnabled);
                applyState(isEnabled);

                window.dispatchEvent(
                    new CustomEvent("customSettingChanged", {
                        detail: { enabled: isEnabled },
                    }),
                );
            });

            targetChild.appendChild(toggle);
            console.log(
                `[SettingsTogglePlugin] Added toggle (${SettingsTogglePlugin.CONFIG.SETTING_PROP})`,
            );
        }

        waitForContainer(selector, cb, timeout = 10000) {
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

        ensureTogglePersists(container) {
            const checkAndInsert = () => {
                if (
                    !container.querySelector(
                        `.${SettingsTogglePlugin.CONFIG.TOGGLE_CLASS}`,
                    )
                ) {
                    this.insertToggleInto(container);
                }
            };
            checkAndInsert();

            const observer = new MutationObserver(() => checkAndInsert());
            observer.observe(container, { childList: true, subtree: true });
        }

        bootstrap() {
            this.waitForContainer(
                SettingsTogglePlugin.CONFIG.SELECTOR,
                (container) => {
                    this.insertToggleInto(container);
                    this.ensureTogglePersists(container);
                },
            );
        }
    }

    requestIdleCallback(() => {
        new SettingsTogglePlugin();
    });
})();
