/**
 * Zarr Data Loader
 * Handles loading and caching of Zarr data from the repository
 */

export class ZarrLoader {
    constructor(zarrPath) {
        this.zarrPath = zarrPath;
        this.metadata = null;
        this.zarrStore = null;
        this.cache = new Map();
    }

    /**
     * Initialize the loader by fetching metadata
     */
    async initialize() {
        console.log('Initializing Zarr loader...');

        try {
            // Fetch metadata (try multiple paths for flexibility)
            const metadataPaths = ['data/metadata.json', '../data/metadata.json'];

            let response = null;
            for (const path of metadataPaths) {
                try {
                    response = await fetch(path);
                    if (response.ok) {
                        console.log(`Metadata found at: ${path}`);
                        break;
                    }
                } catch (e) {
                    console.log(`Trying next path after error: ${e.message}`);
                }
            }

            if (!response || !response.ok) {
                throw new Error(`Failed to fetch metadata from any path`);
            }

            this.metadata = await response.json();
            console.log('Metadata loaded:', this.metadata);

            return this.metadata;
        } catch (error) {
            console.error('Error loading metadata:', error);
            throw error;
        }
    }

    /**
     * Get metadata
     */
    getMetadata() {
        return this.metadata;
    }

    /**
     * Load a specific variable for given coordinates
     * @param {string} variable - Variable name
     * @param {number} timeIndex - Time index
     * @param {number} levelIndex - Pressure level index
     * @returns {Promise<{data: Array, shape: Array, coords: Object}>}
     */
    async loadVariable(variable, timeIndex, levelIndex) {
        const cacheKey = `${variable}_${timeIndex}_${levelIndex}`;

        // Check cache
        if (this.cache.has(cacheKey)) {
            console.log(`Using cached data for ${cacheKey}`);
            return this.cache.get(cacheKey);
        }

        console.log(`Loading ${variable} at time=${timeIndex}, level=${levelIndex}`);

        try {
            // For now, we'll use fetch to load the Zarr data
            // In a real implementation, you would use zarr.js library
            // This is a placeholder that loads pre-rendered GeoJSON or similar

            // Construct path to the specific chunk
            const variablePath = `${this.zarrPath}/${variable}`;

            // Since we're in a static environment, we'll need to
            // have pre-generated JSON files for each time/level combination
            // Alternative: Load entire array and slice (for smaller datasets)

            const result = await this.loadVariableData(variable, timeIndex, levelIndex);

            // Cache the result
            this.cache.set(cacheKey, result);

            // Limit cache size
            if (this.cache.size > 50) {
                const firstKey = this.cache.keys().next().value;
                this.cache.delete(firstKey);
            }

            return result;

        } catch (error) {
            console.error(`Error loading ${variable}:`, error);
            throw error;
        }
    }

    /**
     * Load variable data (implementation depends on how data is stored)
     * For GitHub Pages, we might need to pre-generate JSON files
     */
    async loadVariableData(variable, timeIndex, levelIndex) {
        // Try loading via zarr.js (if available)
        if (typeof zarr !== 'undefined') {
            return await this.loadViaZarrJS(variable, timeIndex, levelIndex);
        }

        throw new Error('Real NOAA data not available - zarr.js library required');
    }

    /**
     * Load data using zarr.js library
     */
    async loadViaZarrJS(variable, timeIndex, levelIndex) {
        try {
            // Open Zarr store if not already open
            if (!this.zarrStore) {
                const { HTTPStore, openGroup } = zarr;
                const store = new HTTPStore(this.zarrPath);
                this.zarrStore = await openGroup(store, '', 'r');
            }

            // Get the array
            const array = await this.zarrStore.getItem(variable);

            // Get metadata to determine slice indices
            const varMeta = this.metadata.variables[variable];
            const dims = varMeta.dims;

            // Build selection based on dimensions
            let selection = [];
            for (let dim of dims) {
                if (dim === 'time') {
                    selection.push(timeIndex);
                } else if (dim === 'level') {
                    selection.push(levelIndex);
                } else {
                    selection.push(null); // Select all for lat/lon
                }
            }

            // Get the data
            const data = await array.get(selection);

            // Extract coordinate arrays
            const latArray = await this.zarrStore.getItem('lat');
            const lonArray = await this.zarrStore.getItem('lon');

            const lat = await latArray.get();
            const lon = await lonArray.get();

            return {
                data: data,
                lat: Array.from(lat),
                lon: Array.from(lon),
                shape: data.shape,
                coords: {
                    lat: Array.from(lat),
                    lon: Array.from(lon)
                }
            };

        } catch (error) {
            console.error('Error loading via zarr.js:', error);
            throw error;
        }
    }


    /**
     * Clear cache
     */
    clearCache() {
        this.cache.clear();
    }
}

export default ZarrLoader;
