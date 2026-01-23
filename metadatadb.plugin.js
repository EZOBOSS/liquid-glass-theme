/**
 * @name MetadataDB
 * @description High-performance IndexedDB wrapper with in-memory caching
 * @version 2.0.0
 * @author EZOBOSS
 * @dependencies enhanced-titlebar.plugin.js, notifications.plugin.js, upcoming-list.plugin.js
 */

class MetadataDB {
    static CONFIG = {
        DB_NAME: "ETB_MetadataDB",
        DB_VERSION: 1,
        STORE_NAME: "metadata",
        CACHE_TTL_SERIES: 30 * 24 * 60 * 60 * 1000, // 14.24l days for series
        CACHE_TTL_NEW_MOVIE: 30 * 24 * 60 * 60 * 1000, // 14 days for new movies
        MEMORY_CACHE_SIZE: 500, // Max items in memory cache
        BATCH_DELAY: 250, // ms to wait before flushing batch writes
    };

    constructor() {
        this.db = null;
        this.isReady = false;
        this.initPromise = this.init();

        // In-memory LRU cache for hot data
        this.memoryCache = new Map();
        this.cacheAccessOrder = [];

        // Batch write queue for performance
        this.writeQueue = new Map();
        this.writeTimer = null;

        // Pre-calculate current year for TTL checks
        this.currentYear = new Date().getFullYear();

        // Pub/Sub: subscribers per ID (or '*' for all changes)
        this.subscribers = new Map();
    }

    async init() {
        try {
            await new Promise((resolve, reject) => {
                const request = indexedDB.open(
                    MetadataDB.CONFIG.DB_NAME,
                    MetadataDB.CONFIG.DB_VERSION,
                );

                request.onerror = () => {
                    console.error(
                        "[MetadataDB] Failed to open database:",
                        request.error,
                    );
                    reject(request.error);
                };

                request.onsuccess = (event) => {
                    this.db = event.target.result;
                    this.isReady = true;

                    this.db.onerror = (event) => {
                        console.error(
                            "[MetadataDB] Database error:",
                            event.target.error,
                        );
                    };

                    this.db.onversionchange = () => {
                        console.warn(
                            "[MetadataDB] Database version changed, closing connection",
                        );
                        this.db.close();
                        this.isReady = false;
                    };

                    resolve();
                };

                request.onupgradeneeded = (event) => {
                    const db = event.target.result;

                    if (
                        !db.objectStoreNames.contains(
                            MetadataDB.CONFIG.STORE_NAME,
                        )
                    ) {
                        const store = db.createObjectStore(
                            MetadataDB.CONFIG.STORE_NAME,
                            {
                                keyPath: "id",
                            },
                        );

                        store.createIndex("type", "type", { unique: false });
                        store.createIndex("timestamp", "timestamp", {
                            unique: false,
                        });
                    }
                };

                request.onblocked = () => {
                    console.warn(
                        "[MetadataDB] Database upgrade blocked by other tabs",
                    );
                };
            });
        } catch (error) {
            console.error("[MetadataDB] Initialization failed:", error);
            throw error;
        }
    }

    async ensureReady() {
        if (!this.isReady) {
            await this.initPromise;
        }
        if (!this.db) {
            throw new Error("[MetadataDB] Database connection not available");
        }
    }

    _deepFreeze(obj) {
        if (obj && typeof obj === "object" && !Object.isFrozen(obj)) {
            Object.freeze(obj);
            Object.getOwnPropertyNames(obj).forEach((prop) => {
                this._deepFreeze(obj[prop]);
            });
        }
        return obj;
    }

    _updateCache(id, data) {
        const existingIndex = this.cacheAccessOrder.indexOf(id);
        if (existingIndex > -1) {
            this.cacheAccessOrder.splice(existingIndex, 1);
        }

        this.cacheAccessOrder.unshift(id);
        // Deep freeze data before caching to prevent mutations
        if (data) {
            this._deepFreeze(data);
        }
        this.memoryCache.set(id, data);

        if (
            this.cacheAccessOrder.length > MetadataDB.CONFIG.MEMORY_CACHE_SIZE
        ) {
            const evictId = this.cacheAccessOrder.pop();
            this.memoryCache.delete(evictId);
        }
    }

    _getFromCache(id) {
        if (this.memoryCache.has(id)) {
            const existingIndex = this.cacheAccessOrder.indexOf(id);
            if (existingIndex > -1) {
                this.cacheAccessOrder.splice(existingIndex, 1);
                this.cacheAccessOrder.unshift(id);
            }
            // Return reference directly - it is already frozen
            return this.memoryCache.get(id);
        }
        return undefined;
    }

    _removeFromCache(id) {
        const existingIndex = this.cacheAccessOrder.indexOf(id);
        if (existingIndex > -1) {
            this.cacheAccessOrder.splice(existingIndex, 1);
        }
        this.memoryCache.delete(id);
    }

    subscribe(id, callback) {
        if (!this.subscribers.has(id)) {
            this.subscribers.set(id, new Set());
        }
        this.subscribers.get(id).add(callback);

        // Return unsubscribe function
        return () => {
            const subs = this.subscribers.get(id);
            if (subs) {
                subs.delete(callback);
                if (subs.size === 0) {
                    this.subscribers.delete(id);
                }
            }
        };
    }

    _notifySubscribers(id, data, changeType) {
        // Notify specific ID subscribers
        const idSubs = this.subscribers.get(id);
        if (idSubs) {
            for (const callback of idSubs) {
                try {
                    callback(id, data, changeType);
                } catch (err) {
                    console.error(
                        "[MetadataDB] Subscriber callback error:",
                        err,
                    );
                }
            }
        }

        // Notify wildcard subscribers
        const wildcardSubs = this.subscribers.get("*");
        if (wildcardSubs) {
            for (const callback of wildcardSubs) {
                try {
                    callback(id, data, changeType);
                } catch (err) {
                    console.error(
                        "[MetadataDB] Subscriber callback error:",
                        err,
                    );
                }
            }
        }
    }

    _shouldExpire(record) {
        const age = Date.now() - record.timestamp;

        if (record.type === "series") {
            return age > MetadataDB.CONFIG.CACHE_TTL_SERIES;
        }

        if (record.type === "movie") {
            const releaseYear = record.data?.year || record.data?.releaseInfo;
            const movieAge = this.currentYear - parseInt(releaseYear);

            // Only new movies (≤1 year old) expire
            if (movieAge <= 1) {
                return age > MetadataDB.CONFIG.CACHE_TTL_NEW_MOVIE;
            }
        }

        return false;
    }

    _hasDataChanged(existing, incoming) {
        if (!existing || !incoming) {
            console.log("[MetadataDB] One of the objects is missing");
            return true;
        }

        console.log("[MetadataDB] Checking for data changes:", existing.name);

        const check = (field, a, b) => {
            if (a !== b && b !== undefined && b !== null) {
                console.log(`[MetadataDB] Change detected in "${field}":`, {
                    existing: a,
                    incoming: b,
                });
                return true;
            }
            return false;
        };

        if (check("name", existing.name, incoming.name)) return true;
        if (check("type", existing.type, incoming.type)) return true;
        if (check("year", existing.year, incoming.year)) return true;
        if (check("releaseInfo", existing.releaseInfo, incoming.releaseInfo))
            return true;
        if (check("released", existing.released, incoming.released))
            return true;
        if (check("imdbRating", existing.imdbRating, incoming.imdbRating))
            return true;
        if (
            check(
                "trailers",
                existing.trailers?.[0]?.source,
                incoming.trailers?.[0]?.source,
            )
        )
            return true;

        const existingVideos = existing.videos;
        const incomingVideos = incoming.videos;

        if (Array.isArray(existingVideos) && Array.isArray(incomingVideos)) {
            if (existingVideos.length !== incomingVideos.length) {
                console.log("[MetadataDB] Change detected in videos.length:", {
                    existing: existingVideos.length,
                    incoming: incomingVideos.length,
                });
                return true;
            }
        } else if (existingVideos !== incomingVideos) {
            console.log("[MetadataDB] Change detected in videos reference:", {
                existing: existingVideos,
                incoming: incomingVideos,
            });
            return true;
        }

        console.log("[MetadataDB] Data is identical");
        return false;
    }

    async fetchFromApi(id, type = "movie") {
        try {
            const response = await fetch(
                `https://v3-cinemeta.strem.io/meta/${type}/${id}.json`,
            );
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            return data.meta || null;
        } catch (error) {
            console.error(
                `[MetadataDB] Error fetching ${type} ${id} from API:`,
                error,
            );
            return null;
        }
    }

    async get(id, type = "movie") {
        try {
            // Check memory cache first
            const cached = this._getFromCache(id);
            if (cached !== undefined) {
                return cached;
            }

            await this.ensureReady();

            return await new Promise((resolve, reject) => {
                const transaction = this.db.transaction(
                    [MetadataDB.CONFIG.STORE_NAME],
                    "readonly",
                );

                transaction.onerror = () => {
                    console.error(
                        "[MetadataDB] Transaction error:",
                        transaction.error,
                    );
                    reject(transaction.error);
                };

                const store = transaction.objectStore(
                    MetadataDB.CONFIG.STORE_NAME,
                );
                const request = store.get(id);

                request.onsuccess = async () => {
                    const record = request.result;

                    if (!record) {
                        // Not in DB, fetch from API
                        const data = await this.fetchFromApi(id, type);
                        if (data) {
                            // Persist to DB and update cache
                            this.put(id, data, type);
                            resolve(data);
                        } else {
                            // Cache the failure in memory to prevent repeated API calls
                            this._updateCache(id, null);
                            resolve(null);
                        }
                        return;
                    }

                    // Check expiration
                    if (this._shouldExpire(record)) {
                        // Don't delete expired records to preserve user data (like watch state)
                        // Just remove from memory cache so we don't serve stale data
                        this._removeFromCache(id);
                        resolve(null);
                    } else {
                        // Freeze and cache
                        // _updateCache handles the deep freezing
                        this._updateCache(id, record.data);
                        resolve(record.data);
                    }
                };

                request.onerror = () => {
                    console.error(
                        "[MetadataDB] Get request error:",
                        request.error,
                    );
                    reject(request.error);
                };
            });
        } catch (error) {
            console.error(`[MetadataDB] Failed to get record ${id}:`, error);
            return null; // Graceful degradation
        }
    }

    async getAll(filter = null) {
        try {
            await this.ensureReady();

            return await new Promise((resolve, reject) => {
                const transaction = this.db.transaction(
                    [MetadataDB.CONFIG.STORE_NAME],
                    "readonly",
                );

                transaction.onerror = () => {
                    console.error(
                        "[MetadataDB] Transaction error:",
                        transaction.error,
                    );
                    reject(transaction.error);
                };

                const store = transaction.objectStore(
                    MetadataDB.CONFIG.STORE_NAME,
                );
                const request = store.getAll();

                request.onsuccess = () => {
                    let records = request.result;

                    // Apply filter if provided
                    if (filter && typeof filter === "function") {
                        records = records.filter(filter);
                    }

                    // Clone (if needed by consumer) but better to freeze here too?
                    // For getAll, we'll just freeze them all to match the 'immutable' contract
                    if (records) {
                        records.forEach((r) => {
                            if (r && r.data) this._deepFreeze(r.data);
                        });
                    }
                    resolve(records);
                };

                request.onerror = () => {
                    console.error(
                        "[MetadataDB] GetAll request error:",
                        request.error,
                    );
                    reject(request.error);
                };
            });
        } catch (error) {
            console.error("[MetadataDB] Failed to get all records:", error);
            return [];
        }
    }

    async getMany(ids) {
        try {
            await this.ensureReady();

            const results = new Map();
            const uncachedIds = [];

            for (const id of ids) {
                const cached = this._getFromCache(id);
                if (cached !== undefined) {
                    results.set(id, cached);
                } else {
                    uncachedIds.push(id);
                }
            }

            if (uncachedIds.length > 0) {
                await new Promise((resolve, reject) => {
                    const transaction = this.db.transaction(
                        [MetadataDB.CONFIG.STORE_NAME],
                        "readonly",
                    );

                    transaction.oncomplete = () => resolve();
                    transaction.onerror = () => reject(transaction.error);

                    const store = transaction.objectStore(
                        MetadataDB.CONFIG.STORE_NAME,
                    );

                    for (const id of uncachedIds) {
                        const request = store.get(id);
                        request.onsuccess = () => {
                            const record = request.result;

                            if (!record || this._shouldExpire(record)) {
                                results.set(id, null);
                                this._updateCache(id, null);
                            } else {
                                // _updateCache handles the deep freezing
                                this._updateCache(id, record.data);
                                results.set(id, record.data);
                            }
                        };
                    }
                });
            }

            return results;
        } catch (error) {
            console.error("[MetadataDB] Failed to get many records:", error);
            return new Map(); // Graceful degradation
        }
    }

    async put(id, data, type) {
        try {
            // Clone data to prevent external mutations from affecting cache/queue
            // AND freeze our copy so it matches the read-only contract
            const clonedData = structuredClone(data);
            this._updateCache(id, clonedData); // This will freeze it

            this.writeQueue.set(id, {
                id,
                data: clonedData,
                type,
                timestamp: Date.now(),
            });

            if (!this.writeTimer) {
                this.writeTimer = setTimeout(() => {
                    this._flushWrites().catch((err) =>
                        console.error("[MetadataDB] Batch write failed:", err),
                    );
                }, MetadataDB.CONFIG.BATCH_DELAY);
            }

            // Notify subscribers immediately (cache is already updated)
            this._notifySubscribers(id, clonedData, "put");
        } catch (error) {
            console.error(
                `[MetadataDB] Failed to queue write for ${id}:`,
                error,
            );
        }
    }

    async _flushWrites() {
        if (this.writeQueue.size === 0) {
            this.writeTimer = null;
            return;
        }

        const writes = Array.from(this.writeQueue.values());
        this.writeQueue.clear();
        this.writeTimer = null;

        try {
            await this.ensureReady();

            await new Promise((resolve, reject) => {
                const transaction = this.db.transaction(
                    [MetadataDB.CONFIG.STORE_NAME],
                    "readwrite",
                );

                transaction.oncomplete = () => resolve();
                transaction.onerror = () => {
                    console.error(
                        "[MetadataDB] Batch transaction error:",
                        transaction.error,
                    );
                    reject(transaction.error);
                };

                const store = transaction.objectStore(
                    MetadataDB.CONFIG.STORE_NAME,
                );

                for (const record of writes) {
                    // Read-modify-write to preserve existing fields
                    const getReq = store.get(record.id);
                    getReq.onsuccess = () => {
                        const existing = getReq.result;

                        if (existing && existing.data) {
                            if (
                                !this._hasDataChanged(
                                    existing.data,
                                    record.data,
                                )
                            ) {
                                // Fast path: Data is identical, keep existing data (timestamp still updates)
                                record.data = existing.data;
                            } else {
                                // Slow path: Data has changed, merge carefully
                                const mergedData = {
                                    ...existing.data,
                                    ...record.data,
                                };

                                record.data = mergedData;
                            }
                        }

                        store.put(record);
                    };
                }
            });
        } catch (error) {
            console.error("[MetadataDB] Failed to flush writes:", error);
            // Re-queue failed writes
            for (const record of writes) {
                this.writeQueue.set(record.id, record);
            }
            throw error;
        }
    }

    /**
     * Force immediate write (bypass batching)
     * @param {boolean} bypassChangeCheck - Skip the _hasDataChanged check and force save
     * @param {boolean} preserveTimestamp - Keep existing timestamp instead of updating it
     */
    async putImmediate(
        id,
        data,
        type,
        bypassChangeCheck = false,
        preserveTimestamp = false,
    ) {
        try {
            await this.ensureReady();

            const record = { id, data, type, timestamp: Date.now() };

            await new Promise((resolve, reject) => {
                const transaction = this.db.transaction(
                    [MetadataDB.CONFIG.STORE_NAME],
                    "readwrite",
                );

                transaction.oncomplete = () => {
                    this._updateCache(id, record.data);
                    this._notifySubscribers(id, record.data, "put");
                    resolve();
                };

                transaction.onerror = () => {
                    console.error(
                        "[MetadataDB] Transaction error:",
                        transaction.error,
                    );
                    reject(transaction.error);
                };

                const store = transaction.objectStore(
                    MetadataDB.CONFIG.STORE_NAME,
                );

                // Read-modify-write
                const getReq = store.get(id);

                getReq.onsuccess = () => {
                    const existing = getReq.result;

                    if (existing && existing.data) {
                        // Preserve existing timestamp if requested (e.g., for watch state updates)
                        if (preserveTimestamp && existing.timestamp) {
                            record.timestamp = existing.timestamp;
                        }

                        // Check if we should bypass change detection
                        if (bypassChangeCheck) {
                            // Force save: use incoming data as-is
                            // No merging needed since caller explicitly modified the data
                        } else if (
                            !this._hasDataChanged(existing.data, record.data)
                        ) {
                            // Fast path: Data is identical, keep existing data (timestamp still updates)
                            record.data = existing.data;
                        } else {
                            // Slow path: Data has changed, merge carefully
                            const mergedData = {
                                ...existing.data,
                                ...record.data,
                            };

                            record.data = mergedData;
                        }
                    }

                    const putReq = store.put(record);
                    putReq.onerror = () => {
                        console.error(
                            "[MetadataDB] Put request error:",
                            putReq.error,
                        );
                        reject(putReq.error);
                    };
                };

                getReq.onerror = () => {
                    // Fallback to direct put if get fails
                    const putReq = store.put(record);
                    putReq.onerror = () => reject(putReq.error);
                };
            });
        } catch (error) {
            console.error(`[MetadataDB] Failed to put record ${id}:`, error);
            throw error;
        }
    }

    /**
     * Delete a single record
     */
    async delete(id) {
        try {
            this._removeFromCache(id);
            await this.ensureReady();

            await new Promise((resolve, reject) => {
                const transaction = this.db.transaction(
                    [MetadataDB.CONFIG.STORE_NAME],
                    "readwrite",
                );

                transaction.oncomplete = () => {
                    this._notifySubscribers(id, null, "delete");
                    resolve();
                };
                transaction.onerror = () => {
                    console.error(
                        "[MetadataDB] Transaction error:",
                        transaction.error,
                    );
                    reject(transaction.error);
                };

                const store = transaction.objectStore(
                    MetadataDB.CONFIG.STORE_NAME,
                );
                store.delete(id);
            });
        } catch (error) {
            console.error(`[MetadataDB] Failed to delete record ${id}:`, error);
        }
    }

    async cleanupExpired() {
        try {
            await this.ensureReady();

            const allRecords = await this.getAll();
            const toDelete = [];

            for (const record of allRecords) {
                if (this._shouldExpire(record)) {
                    toDelete.push(record.id);
                }
            }

            if (toDelete.length > 0) {
                await new Promise((resolve, reject) => {
                    const transaction = this.db.transaction(
                        [MetadataDB.CONFIG.STORE_NAME],
                        "readwrite",
                    );

                    transaction.oncomplete = () => {
                        console.log(
                            `[MetadataDB] Cleaned up ${toDelete.length} expired records`,
                        );
                        resolve();
                    };
                    transaction.onerror = () => reject(transaction.error);

                    const store = transaction.objectStore(
                        MetadataDB.CONFIG.STORE_NAME,
                    );
                    for (const id of toDelete) {
                        store.delete(id);
                        this._removeFromCache(id);
                    }
                });
            }
        } catch (error) {
            console.error("[MetadataDB] Cleanup failed:", error);
        }
    }
}

// Create and expose global singleton instance
window.MetadataDB = new MetadataDB();

// Check if MetadataDB is initialized
requestIdleCallback(() => {
    if (window.MetadataDB && window.MetadataDB instanceof MetadataDB) {
        console.log("[MetadataDB] initialized");
    }
});

// Cleanup on page unload
window.addEventListener("beforeunload", () => {
    if (window.MetadataDB?.writeTimer) {
        window.MetadataDB._flushWrites().catch((err) =>
            console.error("[MetadataDB] Failed to flush on unload:", err),
        );
    }
    window.MetadataDB.cleanupExpired().catch((err) =>
        console.error("[MetadataDB] Failed to cleanup on unload:", err),
    );
});
