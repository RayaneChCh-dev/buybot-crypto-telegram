class SimpleCache {
    cache: Map<any, any>;
    maxSize: number;
    constructor(maxSize = 1000) {
        this.cache = new Map();
        this.maxSize = maxSize;
    }

    set(key: any, value: any) {
        if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        this.cache.set(key, value);
    }

    has(key: any) {
        return this.cache.has(key);
    }

    get(key: any) {
        return this.cache.get(key);
    }

    delete(key: any) {
        return this.cache.delete(key);
    }

    clear() {
        this.cache.clear();
    }

    size() {
        return this.cache.size;
    }
}

export default SimpleCache;