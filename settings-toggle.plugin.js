/**
 * @name Settings Toggle Plugin
 * @description Adds custom toggles to the settings menu
 * @version 1.0.0
 * @author EZOBOSS
 */

(function () {
    // Shared settings utility
    window.StremioSettings = {
        isEnabled(prop) {
            try {
                const obj = JSON.parse(
                    localStorage.getItem("custom_setting") || "{}",
                );
                return prop in obj ? !!obj[prop] : true;
            } catch {
                return true;
            }
        },
    };

    class SettingsTogglePlugin {
        static CONFIG = {
            SELECTOR: ".sections-container-EUKAe",
            LOCAL_KEY: "custom_setting",
            INSERT_INDEX: 2,
            SETTINGS: [
                {
                    prop: "play_trailer_on_hover",
                    label: "Play trailer on hover",
                    toggleClass: "trailer-toggle",
                },
                {
                    prop: "dynamic_island",
                    label: "Dynamic island",
                    toggleClass: "dynamic-island-toggle",
                },
                {
                    prop: "HoverInfoPanel",
                    label: "Show episode info on hover",
                    toggleClass: "hover-info-toggle",
                },
                // Add more settings here
            ],
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

        readState(prop) {
            return window.StremioSettings.isEnabled(prop);
        }

        writeState(prop, value) {
            try {
                const obj = JSON.parse(
                    localStorage.getItem(
                        SettingsTogglePlugin.CONFIG.LOCAL_KEY,
                    ) || "{}",
                );
                obj[prop] = value;
                localStorage.setItem(
                    SettingsTogglePlugin.CONFIG.LOCAL_KEY,
                    JSON.stringify(obj),
                );
            } catch {}
        }

        buildToggleElement(setting) {
            const wrapper = document.createElement("div");
            wrapper.className = "option-container-EGlcv";
            wrapper.innerHTML = `
                <div class="option-name-container-exGMI ${setting.toggleClass}">
                    <div class="label-FFamJ">${setting.label}</div>
                </div>
                <div class="option-input-container-NPgpT toggle-container-lZfHP button-container-zVLH6">
                    <button class="toggle-toOWM" role="switch" aria-checked="false"></button>
                </div>
            `;
            return wrapper;
        }

        insertTogglesInto(container) {
            if (!container) return;

            const targetChild =
                container.children[SettingsTogglePlugin.CONFIG.INSERT_INDEX];
            if (!targetChild) return;

            SettingsTogglePlugin.CONFIG.SETTINGS.forEach((setting) => {
                if (targetChild.querySelector(`.${setting.toggleClass}`))
                    return;

                const toggle = this.buildToggleElement(setting);
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

                let isEnabled = this.readState(setting.prop);
                applyState(isEnabled);

                button.addEventListener("click", () => {
                    isEnabled = !isEnabled;
                    this.writeState(setting.prop, isEnabled);
                    applyState(isEnabled);

                    window.dispatchEvent(
                        new CustomEvent("customSettingChanged", {
                            detail: {
                                prop: setting.prop,
                                enabled: isEnabled,
                            },
                        }),
                    );
                });

                targetChild.appendChild(toggle);
                console.log(
                    `[SettingsTogglePlugin] Added toggle (${setting.prop})`,
                );
            });
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

        ensureTogglesPersist(container) {
            const checkAndInsert = () => {
                this.insertTogglesInto(container);
            };
            checkAndInsert();

            const observer = new MutationObserver(() => checkAndInsert());
            observer.observe(container, { childList: true, subtree: true });
        }

        bootstrap() {
            this.waitForContainer(
                SettingsTogglePlugin.CONFIG.SELECTOR,
                (container) => {
                    this.insertTogglesInto(container);
                    this.ensureTogglesPersist(container);
                },
            );
        }
    }

    requestIdleCallback(() => {
        new SettingsTogglePlugin();
    });
})();
