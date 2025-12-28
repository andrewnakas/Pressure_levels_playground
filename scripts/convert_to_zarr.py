#!/usr/bin/env python3
"""
Convert GRIB2 files to Zarr format with optimized chunking for web visualization.
Processes NOAA GFS pressure level data.
"""

import os
import sys
import logging
from pathlib import Path
from typing import Dict, Any, List
import xarray as xr
import zarr
from numcodecs import Blosc
import dask
import numpy as np

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def get_encoding(ds: xr.Dataset, chunks: Dict[str, int]) -> Dict[str, Any]:
    """
    Generate encoding dictionary for Zarr output.

    Args:
        ds: Input xarray Dataset
        chunks: Chunk sizes for each dimension

    Returns:
        Encoding dictionary for to_zarr()
    """
    compressor = Blosc(
        cname='zstd',
        clevel=5,
        shuffle=Blosc.SHUFFLE
    )

    encoding = {}
    for var in ds.data_vars:
        var_dims = ds[var].dims
        var_chunks = {}

        for dim in var_dims:
            if dim in chunks:
                var_chunks[dim] = chunks[dim]
            else:
                # Use full dimension if not specified
                var_chunks[dim] = ds.dims[dim]

        encoding[var] = {
            'compressor': compressor,
            'chunks': [var_chunks[dim] for dim in var_dims]
        }

    return encoding


def standardize_coordinates(ds: xr.Dataset) -> xr.Dataset:
    """
    Standardize dimension and coordinate names from GRIB2.

    Args:
        ds: Input dataset

    Returns:
        Dataset with standardized coordinates
    """
    rename_map = {}

    # Common renames for GRIB2 data
    if 'isobaricInhPa' in ds.coords:
        rename_map['isobaricInhPa'] = 'level'
    if 'latitude' in ds.coords:
        rename_map['latitude'] = 'lat'
    if 'longitude' in ds.coords:
        rename_map['longitude'] = 'lon'
    if 'valid_time' in ds.coords:
        rename_map['valid_time'] = 'time'
    elif 'time' in ds.coords and 'step' in ds.coords:
        # Convert to valid_time
        ds['valid_time'] = ds.time + ds.step
        ds = ds.swap_dims({'time': 'valid_time'})
        ds = ds.drop_vars(['time', 'step'], errors='ignore')
        rename_map['valid_time'] = 'time'

    if rename_map:
        ds = ds.rename(rename_map)
        logger.info(f"Renamed coordinates: {rename_map}")

    # Add metadata
    if 'level' in ds.coords:
        ds.level.attrs.update({
            'units': 'hPa',
            'long_name': 'Pressure Level',
            'positive': 'down',
            'standard_name': 'air_pressure'
        })

    if 'lat' in ds.coords:
        ds.lat.attrs.update({
            'units': 'degrees_north',
            'long_name': 'Latitude',
            'standard_name': 'latitude'
        })

    if 'lon' in ds.coords:
        ds.lon.attrs.update({
            'units': 'degrees_east',
            'long_name': 'Longitude',
            'standard_name': 'longitude'
        })

    return ds


def standardize_variables(ds: xr.Dataset) -> xr.Dataset:
    """
    Standardize variable names and add metadata.

    Args:
        ds: Input dataset

    Returns:
        Dataset with standardized variables
    """
    # Variable name mapping (GRIB2 short names to standard names)
    var_rename = {}
    if 'gh' in ds.data_vars:
        var_rename['gh'] = 'height'
    elif 'z' in ds.data_vars:
        var_rename['z'] = 'height'

    if 't' in ds.data_vars:
        var_rename['t'] = 'temperature'

    if 'u' in ds.data_vars:
        var_rename['u'] = 'u_wind'

    if 'v' in ds.data_vars:
        var_rename['v'] = 'v_wind'

    if 'r' in ds.data_vars:
        var_rename['r'] = 'relative_humidity'

    if 'w' in ds.data_vars:
        var_rename['w'] = 'vertical_velocity'

    if var_rename:
        ds = ds.rename(var_rename)
        logger.info(f"Renamed variables: {var_rename}")

    # Add variable metadata
    if 'height' in ds.data_vars:
        ds.height.attrs.update({
            'units': 'm',
            'long_name': 'Geopotential Height',
            'standard_name': 'geopotential_height'
        })

    if 'temperature' in ds.data_vars:
        ds.temperature.attrs.update({
            'units': 'K',
            'long_name': 'Air Temperature',
            'standard_name': 'air_temperature'
        })

    if 'u_wind' in ds.data_vars:
        ds.u_wind.attrs.update({
            'units': 'm/s',
            'long_name': 'U-Component of Wind',
            'standard_name': 'eastward_wind'
        })

    if 'v_wind' in ds.data_vars:
        ds.v_wind.attrs.update({
            'units': 'm/s',
            'long_name': 'V-Component of Wind',
            'standard_name': 'northward_wind'
        })

    if 'relative_humidity' in ds.data_vars:
        ds.relative_humidity.attrs.update({
            'units': '%',
            'long_name': 'Relative Humidity',
            'standard_name': 'relative_humidity'
        })

    return ds


def load_grib2_files(grib_dir: Path) -> xr.Dataset:
    """
    Load multiple GRIB2 files and combine into single dataset.

    Args:
        grib_dir: Directory containing GRIB2 files

    Returns:
        Combined xarray Dataset
    """
    grib_files = sorted(grib_dir.glob('*.grib2'))

    if not grib_files:
        logger.error(f"No GRIB2 files found in {grib_dir}")
        sys.exit(1)

    logger.info(f"Found {len(grib_files)} GRIB2 files")

    # Load all files
    datasets = []
    for grib_file in grib_files:
        logger.info(f"Reading {grib_file.name}...")

        try:
            # Load with cfgrib, filtering for isobaric levels
            ds = xr.open_dataset(
                grib_file,
                engine='cfgrib',
                backend_kwargs={
                    'filter_by_keys': {
                        'typeOfLevel': 'isobaricInhPa'
                    },
                    'indexpath': ''
                }
            )
            datasets.append(ds)

        except Exception as e:
            logger.error(f"Failed to read {grib_file.name}: {e}")
            logger.info("Trying without filter...")

            try:
                ds = xr.open_dataset(
                    grib_file,
                    engine='cfgrib',
                    backend_kwargs={'indexpath': ''}
                )
                datasets.append(ds)
            except Exception as e2:
                logger.error(f"Failed again: {e2}")
                continue

    if not datasets:
        logger.error("Failed to load any GRIB2 files")
        sys.exit(1)

    # Combine along time dimension
    logger.info("Combining datasets...")
    combined = xr.concat(datasets, dim='time')

    # Sort by time
    combined = combined.sortby('time')

    logger.info(f"Combined dataset dimensions: {dict(combined.dims)}")
    logger.info(f"Variables: {list(combined.data_vars)}")

    return combined


def convert_to_zarr(
    grib_dir: Path,
    output_zarr: Path,
    chunks: Dict[str, int] = None
) -> None:
    """
    Convert GRIB2 files to Zarr format.

    Args:
        grib_dir: Directory containing GRIB2 files
        output_zarr: Path to output Zarr store
        chunks: Chunk sizes (default optimized for web visualization)
    """
    if chunks is None:
        # Optimized chunking for web visualization
        # - time: 1 (load one time step at a time)
        # - level: -1 (all pressure levels together for vertical profiles)
        # - lat/lon: 150 (balance between chunk size and number of chunks)
        chunks = {
            'time': 1,
            'level': -1,
            'lat': 150,
            'lon': 150
        }

    logger.info(f"Loading GRIB2 files from {grib_dir}")

    # Load all GRIB2 files
    ds = load_grib2_files(grib_dir)

    # Standardize coordinates
    ds = standardize_coordinates(ds)

    # Standardize variables
    ds = standardize_variables(ds)

    logger.info(f"Final dataset dimensions: {dict(ds.dims)}")
    logger.info(f"Final variables: {list(ds.data_vars)}")

    # Check actual dimension names and adjust chunks
    actual_chunks = {}
    for dim_name, chunk_size in chunks.items():
        if dim_name in ds.dims:
            actual_chunks[dim_name] = chunk_size
        else:
            logger.warning(f"Dimension '{dim_name}' not found in dataset")

    logger.info(f"Chunk configuration: {actual_chunks}")

    # Get encoding with compression
    encoding = get_encoding(ds, actual_chunks)

    logger.info(f"Writing to Zarr: {output_zarr}")

    # Remove existing zarr store if present
    if output_zarr.exists():
        import shutil
        shutil.rmtree(output_zarr)

    # Write to Zarr
    ds.to_zarr(
        output_zarr,
        mode='w',
        encoding=encoding,
        consolidated=True
    )

    # Log statistics
    zarr_store = zarr.open(str(output_zarr), mode='r')

    total_size = sum(
        f.stat().st_size
        for f in output_zarr.rglob('*')
        if f.is_file()
    )

    logger.info(f"Conversion complete!")
    logger.info(f"Total Zarr size: {total_size / 1024 / 1024:.2f} MB")
    logger.info(f"Zarr store location: {output_zarr}")

    # Print structure
    logger.info("\nZarr structure:")
    for var in ds.data_vars:
        if var in zarr_store:
            arr = zarr_store[var]
            logger.info(f"  {var}: shape={arr.shape}, chunks={arr.chunks}, dtype={arr.dtype}")

    ds.close()


def main():
    """Main execution function."""

    # Configure Dask for limited memory (GitHub Actions constraint)
    max_memory = os.getenv('MAX_MEMORY', '4GB')
    dask.config.set({
        'distributed.worker.memory.target': 0.7,
        'distributed.worker.memory.spill': 0.8,
    })

    logger.info(f"Max memory: {max_memory}")

    # Paths
    grib_dir = Path('data/grib2')
    output_zarr = Path('data/pressure_data.zarr')

    if not grib_dir.exists():
        logger.error(f"GRIB2 directory not found: {grib_dir}")
        sys.exit(1)

    # Convert to Zarr
    convert_to_zarr(grib_dir, output_zarr)

    logger.info("Zarr conversion complete!")


if __name__ == '__main__':
    main()
