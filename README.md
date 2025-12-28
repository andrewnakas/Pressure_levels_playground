# NOAA Pressure Levels Playground

An automated pipeline for fetching, processing, and visualizing NOAA atmospheric pressure level data using GitHub Actions and GitHub Pages.

## Overview

This project provides:

- **Automated Data Fetching**: GitHub Actions workflow that downloads NOAA GFS pressure level data every 6 hours
- **Zarr Conversion**: Converts GRIB2 data to cloud-optimized Zarr format for efficient web access
- **Interactive Visualization**: Web-based viewer with pressure contours, time animation, and multiple variables
- **Public Domain Data**: All data sourced from NOAA's Global Forecast System (GFS)

## Features

### Data Pipeline

- Fetches GFS 0.25° global forecast data from NOAA (via AWS S3 or NOMADS)
- Processes multiple pressure levels: 1000, 925, 850, 700, 500, 300, 250, 200 hPa
- Converts GRIB2 format to Zarr with optimized chunking for web visualization
- Includes variables: geopotential height, temperature, wind components, relative humidity

### Visualization

- Interactive Leaflet map with OpenStreetMap base layer
- Pressure contour visualization using D3.js
- Time series animation (24-hour forecast)
- Multiple pressure levels and variables
- Customizable contour intervals and color scales
- Responsive design for desktop and mobile

## Architecture

```
┌─────────────────┐
│ GitHub Actions  │
│  (Every 6 hrs)  │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  1. Fetch GFS GRIB2 Data            │
│     - AWS S3 or NOMADS              │
│     - Pressure levels               │
│     - Forecast hours 000-024        │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  2. Convert to Zarr                 │
│     - xarray + cfgrib               │
│     - Optimized chunking            │
│     - Compression (zstd)            │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  3. Generate Metadata               │
│     - Coordinates, dimensions       │
│     - Time ranges, levels           │
│     - Variable statistics           │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  4. Commit & Deploy                 │
│     - Push to repository            │
│     - GitHub Pages auto-deploy      │
└─────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  GitHub Pages Visualization         │
│  - Leaflet.js map                   │
│  - D3.js contours                   │
│  - Zarr.js data loading             │
└─────────────────────────────────────┘
```

## Project Structure

```
Pressure_levels_playground/
├── .github/
│   └── workflows/
│       └── fetch-noaa-data.yml      # GitHub Actions workflow
├── scripts/
│   ├── fetch_gfs_data.py            # Download GFS GRIB2 files
│   ├── convert_to_zarr.py           # Convert GRIB2 to Zarr
│   └── generate_metadata.py         # Generate metadata JSON
├── docs/                             # GitHub Pages site
│   ├── index.html                   # Main HTML page
│   ├── css/
│   │   └── style.css                # Styling
│   └── js/
│       ├── app.js                   # Main application logic
│       ├── zarr-loader.js           # Zarr data loading
│       └── visualization.js         # Contour generation & rendering
├── data/
│   ├── pressure_data.zarr/          # Zarr dataset (generated)
│   └── metadata.json                # Data metadata (generated)
├── requirements.txt                  # Python dependencies
├── .gitignore
└── README.md
```

## Setup

### Prerequisites

- Python 3.11+
- Git
- GitHub account with Actions and Pages enabled

### Installation

1. **Clone the repository**:

```bash
git clone https://github.com/andrewnakas/Pressure_levels_playground.git
cd Pressure_levels_playground
```

2. **Install Python dependencies**:

```bash
pip install -r requirements.txt
```

3. **Install system dependencies** (for GRIB2 reading):

On Ubuntu/Debian:
```bash
sudo apt-get install libeccodes-dev libeccodes-tools
```

On macOS:
```bash
brew install eccodes
```

### GitHub Pages Configuration

1. Go to repository **Settings** → **Pages**
2. Set **Source** to "GitHub Actions"
3. The site will be deployed automatically on each push

### GitHub Actions Configuration

The workflow runs automatically:
- Every 6 hours (aligned with GFS cycles: 00, 06, 12, 18 UTC)
- Can be triggered manually via "Actions" tab → "Run workflow"

## Usage

### Manual Data Fetch

To manually fetch and process data:

```bash
# Fetch GFS data
python scripts/fetch_gfs_data.py

# Convert to Zarr
python scripts/convert_to_zarr.py

# Generate metadata
python scripts/generate_metadata.py
```

### Environment Variables

Configure the workflow with these environment variables:

- `FORECAST_CYCLE`: Forecast cycle (format: YYYYMMDDHH or "latest")
- `PRESSURE_LEVELS`: Comma-separated levels in hPa (default: "1000,925,850,700,500,300,250,200")

### Viewing the Visualization

After deployment, visit:
```
https://andrewnakas.github.io/Pressure_levels_playground/
```

## Data Sources

### NOAA Global Forecast System (GFS)

- **Provider**: NOAA/NCEP
- **Resolution**: 0.25° (~25 km at equator)
- **Update Frequency**: 4 times daily (00, 06, 12, 18 UTC)
- **Forecast Range**: 384 hours (16 days)
- **Format**: GRIB2
- **Access**: AWS S3 Open Data (s3://noaa-gfs-bdp-pds) or NOMADS

### Variables

| Variable | Description | Units |
|----------|-------------|-------|
| height | Geopotential Height | meters |
| temperature | Air Temperature | Kelvin |
| u_wind | Eastward Wind Component | m/s |
| v_wind | Northward Wind Component | m/s |
| relative_humidity | Relative Humidity | % |
| vertical_velocity | Vertical Velocity | Pa/s |

### Pressure Levels

Standard atmospheric pressure levels (hPa):
- 1000 (near surface)
- 925 (low-level moisture/wind)
- 850 (low-level temperature)
- 700 (mid-level moisture)
- 500 (mid-level height)
- 300 (upper-level jet)
- 250 (jet stream core)
- 200 (upper divergence)

## Technical Details

### Zarr Chunking Strategy

Optimized for web visualization:
- **Time**: 1 (single time step per chunk)
- **Level**: -1 (all pressure levels together for vertical profiles)
- **Lat/Lon**: 150×150 (balance between chunk size and number of chunks)

### Compression

- **Codec**: Blosc with Zstandard (zstd)
- **Level**: 5
- **Shuffle**: Enabled
- **Typical compression ratio**: 5-10:1

### Browser Compatibility

- Modern browsers with ES6 module support
- WebGL for potential future enhancements
- Tested on Chrome, Firefox, Safari, Edge

## Performance

- **GitHub Actions Runtime**: ~5-15 minutes per update
- **Data Size**: ~50-200 MB per forecast cycle (compressed)
- **Page Load Time**: <5 seconds (initial load)
- **Visualization Update**: <2 seconds (time step change)

## Contributing

Contributions welcome! Areas for improvement:

- Additional meteorological variables
- 3D visualization of atmospheric layers
- Wind barb/vector overlays
- Integration with other forecast models (HRRR, RAP)
- Cross-section visualizations
- Vertical profile plots

## License

This project is released into the public domain. Data is sourced from NOAA, which is in the public domain.

## Acknowledgments

- **NOAA/NCEP**: For providing public access to GFS forecast data
- **AWS Open Data**: For hosting NOAA data on S3
- **Pangeo Community**: For zarr and xarray development
- **Leaflet.js, D3.js**: For visualization libraries

## References

- [NOAA GFS Documentation](https://www.nco.ncep.noaa.gov/pmb/products/gfs/)
- [NOMADS Data Server](https://nomads.ncep.noaa.gov/)
- [AWS Open Data Registry - GFS](https://registry.opendata.aws/noaa-gfs-bdp-pds/)
- [Zarr Format Specification](https://zarr.readthedocs.io/)
- [Xarray Documentation](https://xarray.dev/)
- [cfgrib Documentation](https://github.com/ecmwf/cfgrib)

## Support

For issues or questions:
- Open an issue on [GitHub](https://github.com/andrewnakas/Pressure_levels_playground/issues)
- Check the [NOAA Product Documentation](https://www.nco.ncep.noaa.gov/pmb/products/gfs/)

---

**Live Demo**: [https://andrewnakas.github.io/Pressure_levels_playground/](https://andrewnakas.github.io/Pressure_levels_playground/)

**Last Updated**: 2025-12-28
