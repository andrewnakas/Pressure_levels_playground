/**
 * Visualization Module
 * Handles contour generation and map rendering
 */

/**
 * Color scale generator
 */
export class ColorScale {
    constructor(min, max, colorScheme = 'viridis') {
        this.min = min;
        this.max = max;
        this.colorScheme = colorScheme;
        this.colors = this.generateColorScale(colorScheme);
    }

    generateColorScale(scheme) {
        const schemes = {
            'viridis': [
                '#440154', '#482777', '#3f4a8a', '#31678e',
                '#26838f', '#1f9d8a', '#6cce5a', '#b6de2b', '#fee825'
            ],
            'temperature': [
                '#0000ff', '#0080ff', '#00ffff', '#00ff00',
                '#ffff00', '#ff8000', '#ff0000'
            ],
            'pressure': [
                '#313695', '#4575b4', '#74add1', '#abd9e9',
                '#e0f3f8', '#ffffbf', '#fee090', '#fdae61',
                '#f46d43', '#d73027', '#a50026'
            ]
        };

        return schemes[scheme] || schemes['pressure'];
    }

    getColor(value) {
        if (value < this.min) return this.colors[0];
        if (value > this.max) return this.colors[this.colors.length - 1];

        const normalized = (value - this.min) / (this.max - this.min);
        const index = Math.floor(normalized * (this.colors.length - 1));

        return this.colors[Math.min(index, this.colors.length - 1)];
    }

    getColorRGB(value) {
        const hex = this.getColor(value);
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return [r, g, b];
    }

    drawScale(canvas) {
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;

        const gradient = ctx.createLinearGradient(0, 0, width, 0);

        for (let i = 0; i < this.colors.length; i++) {
            gradient.addColorStop(i / (this.colors.length - 1), this.colors[i]);
        }

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
    }
}

/**
 * Contour generator using D3
 */
export class ContourGenerator {
    constructor(data, coords, options = {}) {
        this.data = data;
        this.lat = coords.lat;
        this.lon = coords.lon;
        this.options = {
            interval: options.interval || 4,
            smooth: options.smooth !== false,
            ...options
        };
    }

    /**
     * Generate contour lines using D3
     */
    generateContours() {
        const { lat, lon, data } = this;
        const width = lon.length;
        const height = lat.length;

        // Determine contour thresholds
        const min = Math.min(...data);
        const max = Math.max(...data);
        const interval = this.options.interval;

        const startValue = Math.ceil(min / interval) * interval;
        const endValue = Math.floor(max / interval) * interval;

        const thresholds = [];
        for (let v = startValue; v <= endValue; v += interval) {
            thresholds.push(v);
        }

        console.log(`Generating contours: min=${min.toFixed(2)}, max=${max.toFixed(2)}, thresholds=${thresholds.length}`);

        // Use D3 contours
        const contours = d3.contours()
            .size([width, height])
            .thresholds(thresholds);

        const contourData = contours(data);

        // Convert to GeoJSON with proper coordinates
        const features = contourData.map(contour => {
            const coordinates = contour.coordinates.map(polygon =>
                polygon.map(ring =>
                    ring.map(point => {
                        // Map grid coordinates to lat/lon
                        const x = point[0];
                        const y = point[1];

                        const lonValue = lon[Math.floor(x)] || lon[lon.length - 1];
                        const latValue = lat[Math.floor(y)] || lat[lat.length - 1];

                        return [lonValue, latValue];
                    })
                )
            );

            return {
                type: 'Feature',
                properties: {
                    value: contour.value
                },
                geometry: {
                    type: 'MultiPolygon',
                    coordinates: coordinates
                }
            };
        });

        return {
            type: 'FeatureCollection',
            features: features
        };
    }

    /**
     * Generate filled contours (polygons)
     */
    generateFilledContours(colorScale) {
        const { lat, lon, data } = this;
        const width = lon.length;
        const height = lat.length;

        // Determine contour thresholds for filled areas
        const min = Math.min(...data);
        const max = Math.max(...data);
        const interval = this.options.interval;

        const startValue = Math.floor(min / interval) * interval;
        const endValue = Math.ceil(max / interval) * interval;

        const thresholds = [];
        for (let v = startValue; v <= endValue; v += interval) {
            thresholds.push(v);
        }

        // Generate contours
        const contours = d3.contours()
            .size([width, height])
            .thresholds(thresholds);

        const contourData = contours(data);

        // Convert to GeoJSON with colors
        const features = contourData.map(contour => {
            const coordinates = contour.coordinates.map(polygon =>
                polygon.map(ring =>
                    ring.map(point => {
                        const x = point[0];
                        const y = point[1];

                        const lonValue = lon[Math.floor(x)] || lon[lon.length - 1];
                        const latValue = lat[Math.floor(y)] || lat[lat.length - 1];

                        return [lonValue, latValue];
                    })
                )
            );

            return {
                type: 'Feature',
                properties: {
                    value: contour.value,
                    fill: colorScale.getColor(contour.value)
                },
                geometry: {
                    type: 'MultiPolygon',
                    coordinates: coordinates
                }
            };
        });

        return {
            type: 'FeatureCollection',
            features: features
        };
    }
}

/**
 * Map visualization manager
 */
export class MapVisualizer {
    constructor(map, options = {}) {
        this.map = map;
        this.options = options;
        this.layers = {
            contours: null,
            fills: null
        };
    }

    /**
     * Render contours to the map
     */
    renderContours(contourGeoJSON, colorScale, showFills = true, showLines = true) {
        // Remove existing layers
        this.clearLayers();

        if (showFills) {
            // Add filled contours
            this.layers.fills = L.geoJSON(contourGeoJSON, {
                style: (feature) => ({
                    fillColor: feature.properties.fill,
                    fillOpacity: 0.4,
                    color: 'transparent',
                    weight: 0
                }),
                onEachFeature: (feature, layer) => {
                    layer.bindPopup(
                        `<strong>Value:</strong> ${feature.properties.value.toFixed(2)}`
                    );
                }
            }).addTo(this.map);
        }

        if (showLines) {
            // Add contour lines
            this.layers.contours = L.geoJSON(contourGeoJSON, {
                style: (feature) => ({
                    color: '#333',
                    weight: 1,
                    opacity: 0.6,
                    fillOpacity: 0
                }),
                onEachFeature: (feature, layer) => {
                    layer.bindPopup(
                        `<strong>Value:</strong> ${feature.properties.value.toFixed(2)}`
                    );
                }
            }).addTo(this.map);
        }
    }

    /**
     * Clear all visualization layers
     */
    clearLayers() {
        Object.values(this.layers).forEach(layer => {
            if (layer) {
                this.map.removeLayer(layer);
            }
        });
        this.layers = {
            contours: null,
            fills: null
        };
    }

    /**
     * Update visibility of layers
     */
    updateVisibility(showFills, showLines) {
        if (this.layers.fills) {
            if (showFills) {
                this.map.addLayer(this.layers.fills);
            } else {
                this.map.removeLayer(this.layers.fills);
            }
        }

        if (this.layers.contours) {
            if (showLines) {
                this.map.addLayer(this.layers.contours);
            } else {
                this.map.removeLayer(this.layers.contours);
            }
        }
    }
}

export default {
    ColorScale,
    ContourGenerator,
    MapVisualizer
};
