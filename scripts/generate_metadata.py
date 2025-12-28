#!/usr/bin/env python3
"""
Generate metadata JSON file for the web visualization.
Extracts information from Zarr store for use in browser.
"""

import json
import logging
from pathlib import Path
from datetime import datetime
import xarray as xr
import numpy as np

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def generate_metadata(zarr_path: Path, output_path: Path):
    """
    Generate metadata JSON from Zarr store.

    Args:
        zarr_path: Path to Zarr store
        output_path: Path to output JSON file
    """
    logger.info(f"Reading Zarr store: {zarr_path}")

    # Open Zarr store
    ds = xr.open_zarr(zarr_path, consolidated=True)

    # Extract metadata
    metadata = {
        'created': datetime.utcnow().isoformat() + 'Z',
        'source': 'NOAA GFS 0.25 degree',
        'dimensions': {},
        'variables': {},
        'bounds': {},
        'attributes': {}
    }

    # Dimensions
    for dim_name, dim_size in ds.dims.items():
        metadata['dimensions'][dim_name] = int(dim_size)

    # Coordinate arrays (for browser access)
    if 'time' in ds.coords:
        times = ds.time.values
        # Convert to ISO strings
        time_strings = [np.datetime_as_string(t, unit='s') for t in times]
        metadata['time'] = time_strings
        metadata['time_range'] = {
            'start': time_strings[0],
            'end': time_strings[-1],
            'count': len(time_strings)
        }

    if 'level' in ds.coords:
        levels = ds.level.values.tolist()
        metadata['levels'] = levels
        metadata['level_range'] = {
            'min': min(levels),
            'max': max(levels),
            'count': len(levels)
        }

    if 'lat' in ds.coords:
        lats = ds.lat.values
        metadata['lat_range'] = {
            'min': float(lats.min()),
            'max': float(lats.max()),
            'count': len(lats)
        }

    if 'lon' in ds.coords:
        lons = ds.lon.values
        metadata['lon_range'] = {
            'min': float(lons.min()),
            'max': float(lons.max()),
            'count': len(lons)
        }

    # Geographic bounds
    if 'lat' in ds.coords and 'lon' in ds.coords:
        metadata['bounds'] = {
            'north': float(ds.lat.max()),
            'south': float(ds.lat.min()),
            'east': float(ds.lon.max()),
            'west': float(ds.lon.min())
        }

    # Variables
    for var_name in ds.data_vars:
        var = ds[var_name]

        var_meta = {
            'shape': list(var.shape),
            'dims': list(var.dims),
            'dtype': str(var.dtype),
        }

        # Add attributes
        if hasattr(var, 'attrs'):
            var_meta['attrs'] = {
                k: str(v) for k, v in var.attrs.items()
            }

        # Add statistics for visualization
        try:
            var_meta['stats'] = {
                'min': float(var.min().values),
                'max': float(var.max().values),
                'mean': float(var.mean().values)
            }
        except Exception as e:
            logger.warning(f"Could not compute stats for {var_name}: {e}")

        metadata['variables'][var_name] = var_meta

    # Global attributes
    if hasattr(ds, 'attrs'):
        metadata['attributes'] = {
            k: str(v) for k, v in ds.attrs.items()
        }

    # Read cycle info
    cycle_info_file = Path('data/cycle_info.txt')
    if cycle_info_file.exists():
        with open(cycle_info_file, 'r') as f:
            lines = f.readlines()
            if lines:
                cycle_str = lines[0].strip()
                cycle_dt = datetime.strptime(cycle_str, '%Y%m%d%H')
                metadata['forecast_cycle'] = cycle_dt.isoformat() + 'Z'

    # Write metadata
    logger.info(f"Writing metadata to {output_path}")
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, 'w') as f:
        json.dump(metadata, f, indent=2)

    logger.info("Metadata generation complete!")
    logger.info(f"Variables: {list(metadata['variables'].keys())}")
    logger.info(f"Dimensions: {metadata['dimensions']}")

    ds.close()


def main():
    """Main execution function."""

    zarr_path = Path('data/pressure_data.zarr')
    output_path = Path('data/metadata.json')

    if not zarr_path.exists():
        logger.error(f"Zarr store not found: {zarr_path}")
        import sys
        sys.exit(1)

    generate_metadata(zarr_path, output_path)


if __name__ == '__main__':
    main()
