/*
 * @name MetadataDB
 * @description MetadataDB helper class
 * @version 1.1.0
 * @author EZOBOSS
 * Scripts depending on this class:
 * - enhanced-titlebar.plugin.js
 * - notifications.plugin.js
 * - upcoming-list.plugin.js
 */

// MetadataDB helper class
class MetadataDB {
    static CONFIG = {
        DB_NAME: "ETB_MetadataDB",
        DB_VERSION: 1,
        STORE_NAME: "metadata",
        CACHE_TTL_SERIES: 30 * 24 * 60 * 60 * 1000, // 30 days for series (new seasons)
    };
    constructor() {
        this.db = null;
        this.initPromise = this.init();
    }

    init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(
                MetadataDB.CONFIG.DB_NAME,
                MetadataDB.CONFIG.DB_VERSION
            );

            request.onerror = () => {
                console.error("[MetadataDB] DB Open Error", request.error);
                reject(request.error);
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (
                    !db.objectStoreNames.contains(MetadataDB.CONFIG.STORE_NAME)
                ) {
                    db.createObjectStore(MetadataDB.CONFIG.STORE_NAME, {
                        keyPath: "id",
                    });
                }
            };
        });
    }
    async getAll() {
        await this.initPromise;
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(
                [MetadataDB.CONFIG.STORE_NAME],
                "readonly"
            );
            const store = transaction.objectStore(MetadataDB.CONFIG.STORE_NAME);
            const request = store.getAll();

            request.onsuccess = () => {
                const record = request.result;

                resolve(record);
            };

            request.onerror = () => reject(request.error);
        });
    }

    async get(id) {
        await this.initPromise;
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(
                [MetadataDB.CONFIG.STORE_NAME],
                "readonly"
            );
            const store = transaction.objectStore(MetadataDB.CONFIG.STORE_NAME);
            const request = store.get(id);

            request.onsuccess = () => {
                const record = request.result;
                if (!record) {
                    resolve(null);
                    return;
                }

                // Check TTL based on content type and age
                // Old movies (>1 year): never expire (cached forever)
                // New movies (≤1 year): expire after 30 days to update ratings
                // Series: expire after 30 days to catch new seasons
                let shouldExpire = false;

                if (record.type === "series") {
                    // Series always expire after TTL
                    shouldExpire =
                        Date.now() - record.timestamp >
                        MetadataDB.CONFIG.CACHE_TTL_SERIES;
                } else if (record.type === "movie") {
                    // Check if movie is new (released within last year)
                    const currentYear = new Date().getFullYear();
                    const releaseYear =
                        record.data?.year || record.data?.releaseInfo;
                    const movieAge = currentYear - parseInt(releaseYear);

                    // Only apply expiration to movies released in the last year
                    if (movieAge <= 1) {
                        shouldExpire =
                            Date.now() - record.timestamp >
                            MetadataDB.CONFIG.CACHE_TTL_SERIES;
                    }
                    // Old movies never expire (shouldExpire remains false)
                }

                if (shouldExpire) {
                    this.delete(id); // Fire and forget delete
                    resolve(null);
                } else {
                    resolve(record.data);
                }
            };

            request.onerror = () => reject(request.error);
        });
    }

    async put(id, data, type) {
        await this.initPromise;
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(
                [MetadataDB.CONFIG.STORE_NAME],
                "readwrite"
            );
            const store = transaction.objectStore(MetadataDB.CONFIG.STORE_NAME);
            const request = store.put({
                id,
                data,
                type, // Store type to determine expiration logic
                timestamp: Date.now(),
            });

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async delete(id) {
        await this.initPromise;
        const transaction = this.db.transaction(
            [MetadataDB.CONFIG.STORE_NAME],
            "readwrite"
        );
        const store = transaction.objectStore(MetadataDB.CONFIG.STORE_NAME);
        store.delete(id);
    }
}

window.MetadataDB = new MetadataDB();
