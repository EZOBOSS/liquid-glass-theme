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
        CACHE_TTL_SERIES: 30 * 24 * 60 * 60 * 1000, // 30 days for series
        CACHE_TTL_NEW_MOVIE: 30 * 24 * 60 * 60 * 1000, // 30 days for new movies
        MEMORY_CACHE_SIZE: 500, // Max items in memory cache
        BATCH_DELAY: 50, // ms to wait before flushing batch writes
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
    }

    async init() {
        try {
            await new Promise((resolve, reject) => {
                const request = indexedDB.open(
                    MetadataDB.CONFIG.DB_NAME,
                    MetadataDB.CONFIG.DB_VERSION
                );

                request.onerror = () => {
                    console.error(
                        "[MetadataDB] Failed to open database:",
                        request.error
                    );
                    reject(request.error);
                };

                request.onsuccess = (event) => {
                    this.db = event.target.result;
                    this.isReady = true;

                    // Handle database errors and connection loss
                    this.db.onerror = (event) => {
                        console.error(
                            "[MetadataDB] Database error:",
                            event.target.error
                        );
                    };

                    this.db.onversionchange = () => {
                        console.warn(
                            "[MetadataDB] Database version changed, closing connection"
                        );
                        this.db.close();
                        this.isReady = false;
                    };

                    resolve();
                };

                request.onupgradeneeded = (event) => {
                    const db = event.target.result;

                    // Create object store with index for efficient queries
                    if (
                        !db.objectStoreNames.contains(
                            MetadataDB.CONFIG.STORE_NAME
                        )
                    ) {
                        const store = db.createObjectStore(
                            MetadataDB.CONFIG.STORE_NAME,
                            {
                                keyPath: "id",
                            }
                        );

                        // Add indices for common queries
                        store.createIndex("type", "type", { unique: false });
                        store.createIndex("timestamp", "timestamp", {
                            unique: false,
                        });
                    }
                };

                request.onblocked = () => {
                    console.warn(
                        "[MetadataDB] Database upgrade blocked by other tabs"
                    );
                };
            });
        } catch (error) {
            console.error("[MetadataDB] Initialization failed:", error);
            throw error;
        }
    }

    /**
     * Check if database is ready for operations
     */
    async ensureReady() {
        if (!this.isReady) {
            await this.initPromise;
        }
        if (!this.db) {
            throw new Error("[MetadataDB] Database connection not available");
        }
    }

    /**
     * Manage in-memory LRU cache
     */
    _updateCache(id, data) {
        // Remove old entry if exists
        const existingIndex = this.cacheAccessOrder.indexOf(id);
        if (existingIndex > -1) {
            this.cacheAccessOrder.splice(existingIndex, 1);
        }

        // Add to front (most recently used)
        this.cacheAccessOrder.unshift(id);
        this.memoryCache.set(id, data);

        // Evict oldest if cache is full
        if (
            this.cacheAccessOrder.length > MetadataDB.CONFIG.MEMORY_CACHE_SIZE
        ) {
            const evictId = this.cacheAccessOrder.pop();
            this.memoryCache.delete(evictId);
        }
    }

    _getFromCache(id) {
        if (this.memoryCache.has(id)) {
            // Move to front (most recently used)
            const existingIndex = this.cacheAccessOrder.indexOf(id);
            if (existingIndex > -1) {
                this.cacheAccessOrder.splice(existingIndex, 1);
                this.cacheAccessOrder.unshift(id);
            }
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

    /**
     * Check if a record should expire based on type and age
     */
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

        return false; // Old movies never expire
    }

    _hasDataChanged(existing, incoming) {
        if (!existing || !incoming) return true;

        // Quick checks on key fields that would indicate changes
        if (existing.name !== incoming.name) return true;
        if (existing.type !== incoming.type) return true;
        if (existing.year !== incoming.year) return true;
        if (existing.releaseInfo !== incoming.releaseInfo) return true;
        if (existing.imdbRating !== incoming.imdbRating) return true;

        // Check videos array length
        const existingVideos = existing.videos;
        const incomingVideos = incoming.videos;
        if (Array.isArray(existingVideos) && Array.isArray(incomingVideos)) {
            if (existingVideos.length !== incomingVideos.length) return true;
        } else if (existingVideos !== incomingVideos) {
            return true;
        }

        // If we got here, data is likely identical
        return false;
    }

    _mergeVideosArray(existingVideos, incomingVideos) {
        if (!Array.isArray(existingVideos) || !Array.isArray(incomingVideos)) {
            return incomingVideos;
        }

        const existingMap = new Map();
        for (const video of existingVideos) {
            const key = video.id || `${video.season}:${video.episode}`;
            existingMap.set(key, video);
        }

        const userFields = ["watched"];

        return incomingVideos.map((newVideo) => {
            const key = newVideo.id || `${newVideo.season}:${newVideo.episode}`;
            const existingVideo = existingMap.get(key);

            if (!existingVideo) return newVideo;

            const preserve = {};
            let hasUserData = false;

            for (const field of userFields) {
                if (existingVideo[field] !== undefined) {
                    preserve[field] = existingVideo[field];
                    hasUserData = true;
                }
            }

            return hasUserData ? { ...newVideo, ...preserve } : newVideo;
        });
    }

    async get(id) {
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
                    "readonly"
                );

                transaction.onerror = () => {
                    console.error(
                        "[MetadataDB] Transaction error:",
                        transaction.error
                    );
                    reject(transaction.error);
                };

                const store = transaction.objectStore(
                    MetadataDB.CONFIG.STORE_NAME
                );
                const request = store.get(id);

                request.onsuccess = () => {
                    const record = request.result;

                    if (!record) {
                        this._updateCache(id, null);
                        resolve(null);
                        return;
                    }

                    // Check expiration
                    if (this._shouldExpire(record)) {
                        // Don't delete expired records to preserve user data (like watch state)
                        // Just remove from memory cache so we don't serve stale data
                        this._removeFromCache(id);
                        resolve(null);
                    } else {
                        this._updateCache(id, record.data);
                        resolve(record.data);
                    }
                };

                request.onerror = () => {
                    console.error(
                        "[MetadataDB] Get request error:",
                        request.error
                    );
                    reject(request.error);
                };
            });
        } catch (error) {
            console.error(`[MetadataDB] Failed to get record ${id}:`, error);
            return null; // Graceful degradation
        }
    }

    /**
     * Get all records (with optional filtering)
     */
    async getAll(filter = null) {
        try {
            await this.ensureReady();

            return await new Promise((resolve, reject) => {
                const transaction = this.db.transaction(
                    [MetadataDB.CONFIG.STORE_NAME],
                    "readonly"
                );

                transaction.onerror = () => {
                    console.error(
                        "[MetadataDB] Transaction error:",
                        transaction.error
                    );
                    reject(transaction.error);
                };

                const store = transaction.objectStore(
                    MetadataDB.CONFIG.STORE_NAME
                );
                const request = store.getAll();

                request.onsuccess = () => {
                    let records = request.result;

                    // Apply filter if provided
                    if (filter && typeof filter === "function") {
                        records = records.filter(filter);
                    }

                    resolve(records);
                };

                request.onerror = () => {
                    console.error(
                        "[MetadataDB] GetAll request error:",
                        request.error
                    );
                    reject(request.error);
                };
            });
        } catch (error) {
            console.error("[MetadataDB] Failed to get all records:", error);
            return []; // Graceful degradation
        }
    }

    /**
     * Get multiple records by IDs (batch operation)
     */
    async getMany(ids) {
        try {
            await this.ensureReady();

            const results = new Map();
            const uncachedIds = [];

            // Check memory cache first
            for (const id of ids) {
                const cached = this._getFromCache(id);
                if (cached !== undefined) {
                    results.set(id, cached);
                } else {
                    uncachedIds.push(id);
                }
            }

            // Fetch uncached items in a single transaction
            if (uncachedIds.length > 0) {
                await new Promise((resolve, reject) => {
                    const transaction = this.db.transaction(
                        [MetadataDB.CONFIG.STORE_NAME],
                        "readonly"
                    );

                    transaction.oncomplete = () => resolve();
                    transaction.onerror = () => reject(transaction.error);

                    const store = transaction.objectStore(
                        MetadataDB.CONFIG.STORE_NAME
                    );

                    for (const id of uncachedIds) {
                        const request = store.get(id);
                        request.onsuccess = () => {
                            const record = request.result;

                            if (!record || this._shouldExpire(record)) {
                                results.set(id, null);
                                this._updateCache(id, null);
                            } else {
                                results.set(id, record.data);
                                this._updateCache(id, record.data);
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

    /**
     * Put a single record with batching for performance
     */
    async put(id, data, type) {
        try {
            // Update memory cache immediately
            this._updateCache(id, data);

            // Add to batch queue
            this.writeQueue.set(id, { id, data, type, timestamp: Date.now() });

            // Schedule flush
            if (!this.writeTimer) {
                this.writeTimer = setTimeout(() => {
                    this._flushWrites().catch((err) =>
                        console.error("[MetadataDB] Batch write failed:", err)
                    );
                }, MetadataDB.CONFIG.BATCH_DELAY);
            }
        } catch (error) {
            console.error(
                `[MetadataDB] Failed to queue write for ${id}:`,
                error
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
                    "readwrite"
                );

                transaction.oncomplete = () => resolve();
                transaction.onerror = () => {
                    console.error(
                        "[MetadataDB] Batch transaction error:",
                        transaction.error
                    );
                    reject(transaction.error);
                };

                const store = transaction.objectStore(
                    MetadataDB.CONFIG.STORE_NAME
                );

                for (const record of writes) {
                    // Read-modify-write to preserve existing fields
                    const getReq = store.get(record.id);
                    getReq.onsuccess = () => {
                        const existing = getReq.result;

                        if (existing && existing.data) {
                            // Fast path: Data is identical, keep existing data (timestamp still updates)
                            if (
                                !this._hasDataChanged(
                                    existing.data,
                                    record.data
                                )
                            ) {
                                record.data = existing.data;
                            } else {
                                // Slow path: Data has changed, merge carefully
                                const mergedData = {
                                    ...existing.data,
                                    ...record.data,
                                };

                                // Special handling for videos array to preserve user fields
                                if (
                                    Array.isArray(existing.data.videos) &&
                                    Array.isArray(record.data.videos)
                                ) {
                                    mergedData.videos = this._mergeVideosArray(
                                        existing.data.videos,
                                        record.data.videos
                                    );
                                }

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
     */
    async putImmediate(id, data, type) {
        try {
            await this.ensureReady();

            const record = { id, data, type, timestamp: Date.now() };

            await new Promise((resolve, reject) => {
                const transaction = this.db.transaction(
                    [MetadataDB.CONFIG.STORE_NAME],
                    "readwrite"
                );

                transaction.oncomplete = () => {
                    this._updateCache(id, data);
                    resolve();
                };

                transaction.onerror = () => {
                    console.error(
                        "[MetadataDB] Transaction error:",
                        transaction.error
                    );
                    reject(transaction.error);
                };

                const store = transaction.objectStore(
                    MetadataDB.CONFIG.STORE_NAME
                );

                // Read-modify-write
                const getReq = store.get(id);

                getReq.onsuccess = () => {
                    const existing = getReq.result;

                    if (existing && existing.data) {
                        // Fast path: Data is identical, keep existing data (timestamp still updates)
                        if (!this._hasDataChanged(existing.data, record.data)) {
                            record.data = existing.data;
                        } else {
                            // Slow path: Data has changed, merge carefully
                            const mergedData = {
                                ...existing.data,
                                ...record.data,
                            };

                            // Special handling for videos array to preserve user fields
                            if (
                                Array.isArray(existing.data.videos) &&
                                Array.isArray(record.data.videos)
                            ) {
                                mergedData.videos = this._mergeVideosArray(
                                    existing.data.videos,
                                    record.data.videos
                                );
                            }

                            record.data = mergedData;
                        }
                    }

                    const putReq = store.put(record);
                    putReq.onerror = () => {
                        console.error(
                            "[MetadataDB] Put request error:",
                            putReq.error
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
                    "readwrite"
                );

                transaction.oncomplete = () => resolve();
                transaction.onerror = () => {
                    console.error(
                        "[MetadataDB] Transaction error:",
                        transaction.error
                    );
                    reject(transaction.error);
                };

                const store = transaction.objectStore(
                    MetadataDB.CONFIG.STORE_NAME
                );
                store.delete(id);
            });
        } catch (error) {
            console.error(`[MetadataDB] Failed to delete record ${id}:`, error);
        }
    }

    /**
     * Clear all records
     */
    async clear() {
        try {
            // Clear memory cache
            this.memoryCache.clear();
            this.cacheAccessOrder = [];
            this.writeQueue.clear();

            await this.ensureReady();

            await new Promise((resolve, reject) => {
                const transaction = this.db.transaction(
                    [MetadataDB.CONFIG.STORE_NAME],
                    "readwrite"
                );

                transaction.oncomplete = () => resolve();
                transaction.onerror = () => reject(transaction.error);

                const store = transaction.objectStore(
                    MetadataDB.CONFIG.STORE_NAME
                );
                store.clear();
            });
        } catch (error) {
            console.error("[MetadataDB] Failed to clear database:", error);
            throw error;
        }
    }

    /**
     * Cleanup expired records (maintenance operation)
     */
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
                        "readwrite"
                    );

                    transaction.oncomplete = () => {
                        console.log(
                            `[MetadataDB] Cleaned up ${toDelete.length} expired records`
                        );
                        resolve();
                    };
                    transaction.onerror = () => reject(transaction.error);

                    const store = transaction.objectStore(
                        MetadataDB.CONFIG.STORE_NAME
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

    /**
     * Get database statistics
     */
    async getStats() {
        try {
            const allRecords = await this.getAll();
            const stats = {
                total: allRecords.length,
                byType: {},
                memoryCacheSize: this.memoryCache.size,
                pendingWrites: this.writeQueue.size,
            };

            for (const record of allRecords) {
                stats.byType[record.type] =
                    (stats.byType[record.type] || 0) + 1;
            }

            return stats;
        } catch (error) {
            console.error("[MetadataDB] Failed to get stats:", error);
            return null;
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
            console.error("[MetadataDB] Failed to flush on unload:", err)
        );
    }
});
