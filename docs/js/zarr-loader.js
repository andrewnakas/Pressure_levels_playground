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
            // Fetch metadata
            const metadataPath = '../data/metadata.json';
            const response = await fetch(metadataPath);

            if (!response.ok) {
                throw new Error(`Failed to fetch metadata: ${response.statusText}`);
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
        // Option 1: Load pre-generated GeoJSON
        try {
            const jsonPath = `../data/geojson/${variable}_t${timeIndex}_l${levelIndex}.json`;
            const response = await fetch(jsonPath);

            if (response.ok) {
                const data = await response.json();
                return {
                    data: data.values,
                    lat: data.lat,
                    lon: data.lon,
                    shape: [data.lat.length, data.lon.length],
                    coords: {
                        lat: data.lat,
                        lon: data.lon
                    }
                };
            }
        } catch (error) {
            console.log('Pre-generated JSON not found, trying direct Zarr access...');
        }

        // Option 2: Try loading via zarr.js (if available)
        if (typeof zarr !== 'undefined') {
            return await this.loadViaZarrJS(variable, timeIndex, levelIndex);
        }

        throw new Error('No data loading method available');
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
     * Generate sample data for testing when actual Zarr data is not available
     */
    generateSampleData(variable, timeIndex, levelIndex) {
        console.log('Generating sample data for testing...');

        // Create synthetic pressure field
        const latCount = 181; // -90 to 90, every 1 degree
        const lonCount = 361; // -180 to 180, every 1 degree

        const lat = Array.from({length: latCount}, (_, i) => 90 - i);
        const lon = Array.from({length: lonCount}, (_, i) => -180 + i);

        const data = new Float32Array(latCount * lonCount);

        // Generate synthetic pressure pattern
        const levelValue = this.metadata?.levels?.[levelIndex] || 500;

        for (let i = 0; i < latCount; i++) {
            for (let j = 0; j < lonCount; j++) {
                const latRad = (lat[i] * Math.PI) / 180;
                const lonRad = (lon[j] * Math.PI) / 180;

                // Create wave pattern based on pressure level
                const base = levelValue;
                const variation = base * 0.1;

                const value = base +
                    variation * Math.sin(3 * latRad) * Math.cos(2 * lonRad) +
                    variation * 0.5 * Math.sin(lonRad + timeIndex * 0.2);

                data[i * lonCount + j] = value;
            }
        }

        return {
            data: data,
            lat: lat,
            lon: lon,
            shape: [latCount, lonCount],
            coords: { lat, lon }
        };
    }

    /**
     * Clear cache
     */
    clearCache() {
        this.cache.clear();
    }
}

export default ZarrLoader;
