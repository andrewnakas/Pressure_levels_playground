/**
 * Main Application
 * Coordinates the data loading and visualization
 */

import { ZarrLoader } from './zarr-loader.js';
import { ColorScale, ContourGenerator, MapVisualizer } from './visualization.js';

class PressureVisualizationApp {
    constructor() {
        this.zarrLoader = null;
        this.map = null;
        this.mapVisualizer = null;
        this.colorScale = null;

        this.state = {
            currentVariable: null,
            currentTime: 0,
            currentLevel: 0,
            showContours: true,
            showFills: true,
            showLabels: false,
            contourInterval: 4,
            isPlaying: false,
            playInterval: null
        };

        this.metadata = null;
    }

    /**
     * Initialize the application
     */
    async initialize() {
        console.log('Initializing application...');

        try {
            // Show loading overlay
            this.showLoading(true);

            // Initialize Zarr loader
            this.zarrLoader = new ZarrLoader('../data/pressure_data.zarr');
            this.metadata = await this.zarrLoader.initialize();

            // Initialize map
            this.initializeMap();

            // Initialize UI
            this.initializeUI();

            // Load initial data
            await this.loadAndVisualize();

            // Hide loading overlay
            this.showLoading(false);

            console.log('Application initialized successfully');

        } catch (error) {
            console.error('Initialization error:', error);
            this.showError('Failed to initialize application. Using sample data for demonstration.');

            // Try to continue with sample data
            this.useSampleData();
        }
    }

    /**
     * Initialize the Leaflet map
     */
    initializeMap() {
        console.log('Initializing map...');

        this.map = L.map('map', {
            center: [30, 0],
            zoom: 2,
            minZoom: 1,
            maxZoom: 8
        });

        // Add base map layer
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            opacity: 0.7
        }).addTo(this.map);

        // Initialize map visualizer
        this.mapVisualizer = new MapVisualizer(this.map);

        console.log('Map initialized');
    }

    /**
     * Initialize UI controls
     */
    initializeUI() {
        console.log('Initializing UI...');

        // Populate data info
        if (this.metadata) {
            document.getElementById('data-source').textContent = this.metadata.source || 'NOAA GFS';
            document.getElementById('forecast-cycle').textContent =
                this.metadata.forecast_cycle ? new Date(this.metadata.forecast_cycle).toUTCString() : 'N/A';
            document.getElementById('last-updated').textContent =
                this.metadata.created ? new Date(this.metadata.created).toUTCString() : 'N/A';

            // Populate level select
            if (this.metadata.levels) {
                const levelSelect = document.getElementById('level-select');
                levelSelect.innerHTML = '';

                this.metadata.levels.forEach((level, index) => {
                    const option = document.createElement('option');
                    option.value = index;
                    option.textContent = `${level} hPa`;
                    levelSelect.appendChild(option);
                });

                // Select 500 hPa by default if available
                const defaultIndex = this.metadata.levels.indexOf(500);
                if (defaultIndex >= 0) {
                    levelSelect.value = defaultIndex;
                    this.state.currentLevel = defaultIndex;
                }
            }

            // Populate variable select
            if (this.metadata.variables) {
                const variableSelect = document.getElementById('variable-select');
                variableSelect.innerHTML = '';

                Object.keys(this.metadata.variables).forEach(varName => {
                    const option = document.createElement('option');
                    option.value = varName;
                    option.textContent = this.getVariableLabel(varName);
                    variableSelect.appendChild(option);
                });

                // Select first variable by default
                const firstVar = Object.keys(this.metadata.variables)[0];
                variableSelect.value = firstVar;
                this.state.currentVariable = firstVar;
            }

            // Setup time slider
            if (this.metadata.time_range) {
                const timeSlider = document.getElementById('time-slider');
                timeSlider.max = this.metadata.time_range.count - 1;
                timeSlider.value = 0;
                this.updateTimeDisplay();
            }
        }

        // Setup event listeners
        this.setupEventListeners();

        console.log('UI initialized');
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Variable change
        document.getElementById('variable-select').addEventListener('change', (e) => {
            this.state.currentVariable = e.target.value;
            this.loadAndVisualize();
        });

        // Level change
        document.getElementById('level-select').addEventListener('change', (e) => {
            this.state.currentLevel = parseInt(e.target.value);
            this.loadAndVisualize();
        });

        // Time slider
        document.getElementById('time-slider').addEventListener('input', (e) => {
            this.state.currentTime = parseInt(e.target.value);
            this.updateTimeDisplay();
            this.loadAndVisualize();
        });

        // Visualization options
        document.getElementById('show-contours').addEventListener('change', (e) => {
            this.state.showContours = e.target.checked;
            this.mapVisualizer.updateVisibility(this.state.showFills, this.state.showContours);
        });

        document.getElementById('show-fills').addEventListener('change', (e) => {
            this.state.showFills = e.target.checked;
            this.mapVisualizer.updateVisibility(this.state.showFills, this.state.showContours);
        });

        document.getElementById('contour-interval').addEventListener('change', (e) => {
            this.state.contourInterval = parseFloat(e.target.value);
            this.loadAndVisualize();
        });

        // Play/pause buttons
        document.getElementById('play-button').addEventListener('click', () => {
            this.startAnimation();
        });

        document.getElementById('stop-button').addEventListener('click', () => {
            this.stopAnimation();
        });
    }

    /**
     * Load data and visualize
     */
    async loadAndVisualize() {
        try {
            this.showLoading(true);

            console.log(`Loading: variable=${this.state.currentVariable}, time=${this.state.currentTime}, level=${this.state.currentLevel}`);

            // Load data
            let dataResult;
            try {
                dataResult = await this.zarrLoader.loadVariable(
                    this.state.currentVariable,
                    this.state.currentTime,
                    this.state.currentLevel
                );
            } catch (error) {
                console.warn('Failed to load real data, using sample data:', error);
                dataResult = this.zarrLoader.generateSampleData(
                    this.state.currentVariable,
                    this.state.currentTime,
                    this.state.currentLevel
                );
            }

            // Generate color scale
            const min = Math.min(...dataResult.data);
            const max = Math.max(...dataResult.data);

            this.colorScale = new ColorScale(min, max, 'pressure');

            // Draw color scale
            const colorScaleCanvas = document.getElementById('color-scale');
            this.colorScale.drawScale(colorScaleCanvas);

            // Update color scale labels
            document.getElementById('color-scale-labels').innerHTML = `
                <span>${min.toFixed(1)}</span>
                <span>${((min + max) / 2).toFixed(1)}</span>
                <span>${max.toFixed(1)}</span>
            `;

            // Generate contours
            const contourGen = new ContourGenerator(
                dataResult.data,
                dataResult.coords,
                { interval: this.state.contourInterval }
            );

            const contourGeoJSON = contourGen.generateFilledContours(this.colorScale);

            // Render to map
            this.mapVisualizer.renderContours(
                contourGeoJSON,
                this.colorScale,
                this.state.showFills,
                this.state.showContours
            );

            this.showLoading(false);

        } catch (error) {
            console.error('Error in loadAndVisualize:', error);
            this.showLoading(false);
            this.showError('Failed to visualize data: ' + error.message);
        }
    }

    /**
     * Start animation
     */
    startAnimation() {
        if (this.state.isPlaying) return;

        this.state.isPlaying = true;
        document.getElementById('play-button').disabled = true;
        document.getElementById('stop-button').disabled = false;

        const timeSlider = document.getElementById('time-slider');
        const maxTime = parseInt(timeSlider.max);

        this.state.playInterval = setInterval(() => {
            this.state.currentTime++;

            if (this.state.currentTime > maxTime) {
                this.state.currentTime = 0;
            }

            timeSlider.value = this.state.currentTime;
            this.updateTimeDisplay();
            this.loadAndVisualize();

        }, 1000); // 1 second per frame
    }

    /**
     * Stop animation
     */
    stopAnimation() {
        if (!this.state.isPlaying) return;

        this.state.isPlaying = false;
        document.getElementById('play-button').disabled = false;
        document.getElementById('stop-button').disabled = true;

        if (this.state.playInterval) {
            clearInterval(this.state.playInterval);
            this.state.playInterval = null;
        }
    }

    /**
     * Update time display
     */
    updateTimeDisplay() {
        if (this.metadata && this.metadata.time) {
            const timeString = this.metadata.time[this.state.currentTime];
            const date = new Date(timeString);
            document.getElementById('time-display').textContent = date.toUTCString();
        } else {
            document.getElementById('time-display').textContent = `Hour ${this.state.currentTime * 3}`;
        }
    }

    /**
     * Get human-readable variable label
     */
    getVariableLabel(varName) {
        const labels = {
            'height': 'Geopotential Height',
            'temperature': 'Temperature',
            'u_wind': 'U-Wind Component',
            'v_wind': 'V-Wind Component',
            'relative_humidity': 'Relative Humidity',
            'vertical_velocity': 'Vertical Velocity'
        };

        return labels[varName] || varName;
    }

    /**
     * Show/hide loading overlay
     */
    showLoading(show) {
        const overlay = document.getElementById('loading-overlay');
        if (show) {
            overlay.classList.remove('hidden');
        } else {
            overlay.classList.add('hidden');
        }
    }

    /**
     * Show error message
     */
    showError(message) {
        alert(message);
    }

    /**
     * Use sample data for demonstration
     */
    useSampleData() {
        this.metadata = {
            source: 'Sample Data (Demo)',
            created: new Date().toISOString(),
            forecast_cycle: new Date().toISOString(),
            levels: [1000, 925, 850, 700, 500, 300, 250, 200],
            time: Array.from({length: 9}, (_, i) => {
                const date = new Date();
                date.setHours(date.getHours() + i * 3);
                return date.toISOString();
            }),
            time_range: {
                count: 9
            },
            variables: {
                'pressure': {
                    attrs: {
                        long_name: 'Pressure',
                        units: 'hPa'
                    }
                }
            }
        };

        this.state.currentVariable = 'pressure';

        this.initializeMap();
        this.initializeUI();
        this.loadAndVisualize();
        this.showLoading(false);
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const app = new PressureVisualizationApp();
    app.initialize();

    // Make app available globally for debugging
    window.app = app;
});
