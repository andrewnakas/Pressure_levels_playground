#!/usr/bin/env python3
"""
Fetch NOAA GFS pressure level data from AWS S3 or NOMADS.
Downloads GRIB2 files for specified forecast cycle and pressure levels.
"""

import os
import sys
import logging
from datetime import datetime, timedelta
from pathlib import Path
import requests
import s3fs

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def get_latest_gfs_cycle():
    """
    Determine the latest available GFS forecast cycle.
    GFS runs at 00, 06, 12, 18 UTC with ~3-4 hour delay.
    """
    now = datetime.utcnow()
    # Account for processing delay
    check_time = now - timedelta(hours=4)

    cycle_hour = (check_time.hour // 6) * 6
    cycle_date = check_time.replace(hour=cycle_hour, minute=0, second=0, microsecond=0)

    return cycle_date


def fetch_gfs_from_nomads(cycle_date, pressure_levels, output_dir):
    """
    Fetch GFS data from NOAA NOMADS using GRIB filter.

    Args:
        cycle_date: datetime object for forecast cycle
        pressure_levels: list of pressure levels in hPa
        output_dir: directory to save GRIB2 files
    """
    logger.info(f"Fetching GFS data from NOMADS for cycle {cycle_date}")

    # NOMADS GRIB filter URL
    base_url = "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl"

    date_str = cycle_date.strftime("%Y%m%d")
    cycle_str = cycle_date.strftime("%H")

    # Variables to fetch (pressure level data)
    variables = [
        'HGT',   # Geopotential height
        'TMP',   # Temperature
        'UGRD',  # U-wind component
        'VGRD',  # V-wind component
        'RH',    # Relative humidity
        'VVEL',  # Vertical velocity
    ]

    # Fetch forecast hours 000-024 (first day)
    forecast_hours = [f"{h:03d}" for h in range(0, 25, 3)]

    output_dir.mkdir(parents=True, exist_ok=True)

    for fhour in forecast_hours:
        output_file = output_dir / f"gfs_pressure_{date_str}_{cycle_str}z_f{fhour}.grib2"

        if output_file.exists():
            logger.info(f"File already exists: {output_file.name}")
            continue

        # Build GRIB filter URL
        params = {
            'file': f'gfs.t{cycle_str}z.pgrb2.0p25.f{fhour}',
            'dir': f'/gfs.{date_str}/{cycle_str}/atmos',
        }

        # Add level selections
        for level in pressure_levels:
            params[f'lev_{level}_mb'] = 'on'

        # Add variable selections
        for var in variables:
            params[f'var_{var}'] = 'on'

        # Add regional subset (optional - global for now)
        # params['subregion'] = ''
        # params['leftlon'] = '-180'
        # params['rightlon'] = '180'
        # params['toplat'] = '90'
        # params['bottomlat'] = '-90'

        logger.info(f"Downloading forecast hour {fhour}...")

        try:
            response = requests.get(base_url, params=params, timeout=300)
            response.raise_for_status()

            with open(output_file, 'wb') as f:
                f.write(response.content)

            logger.info(f"Saved: {output_file.name} ({len(response.content) / 1024 / 1024:.2f} MB)")

        except requests.exceptions.RequestException as e:
            logger.error(f"Failed to download forecast hour {fhour}: {e}")
            continue

    logger.info("NOMADS download complete")


def fetch_gfs_from_aws(cycle_date, pressure_levels, output_dir):
    """
    Fetch GFS data from AWS S3 Open Data.

    Args:
        cycle_date: datetime object for forecast cycle
        pressure_levels: list of pressure levels in hPa
        output_dir: directory to save GRIB2 files
    """
    logger.info(f"Fetching GFS data from AWS S3 for cycle {cycle_date}")

    # AWS S3 bucket
    bucket = 'noaa-gfs-bdp-pds'

    date_str = cycle_date.strftime("%Y%m%d")
    cycle_str = cycle_date.strftime("%H")

    # Initialize S3 filesystem (anonymous access)
    s3 = s3fs.S3FileSystem(anon=True)

    # GFS path pattern
    prefix = f'{bucket}/gfs.{date_str}/{cycle_str}/atmos'

    logger.info(f"Listing files in s3://{prefix}/")

    try:
        # List available files
        files = s3.ls(prefix)
        pressure_files = [f for f in files if 'pgrb2.0p25.f' in f and not f.endswith('.idx')]

        # Filter for forecast hours 000-024
        forecast_hours = range(0, 25, 3)
        selected_files = []

        for fhour in forecast_hours:
            pattern = f'pgrb2.0p25.f{fhour:03d}'
            matching = [f for f in pressure_files if pattern in f]
            if matching:
                selected_files.append(matching[0])

        logger.info(f"Found {len(selected_files)} files to download")

        output_dir.mkdir(parents=True, exist_ok=True)

        for s3_path in selected_files:
            filename = Path(s3_path).name
            output_file = output_dir / filename

            if output_file.exists():
                logger.info(f"File already exists: {filename}")
                continue

            logger.info(f"Downloading {filename}...")

            try:
                with s3.open(s3_path, 'rb') as s3_file:
                    with open(output_file, 'wb') as local_file:
                        # Download in chunks
                        chunk_size = 10 * 1024 * 1024  # 10 MB
                        while True:
                            chunk = s3_file.read(chunk_size)
                            if not chunk:
                                break
                            local_file.write(chunk)

                file_size = output_file.stat().st_size
                logger.info(f"Saved: {filename} ({file_size / 1024 / 1024:.2f} MB)")

            except Exception as e:
                logger.error(f"Failed to download {filename}: {e}")
                if output_file.exists():
                    output_file.unlink()
                continue

        logger.info("AWS S3 download complete")

    except Exception as e:
        logger.error(f"AWS S3 error: {e}")
        logger.info("Falling back to NOMADS...")
        fetch_gfs_from_nomads(cycle_date, pressure_levels, output_dir)


def main():
    """Main execution function."""

    # Get configuration from environment or use defaults
    forecast_cycle_input = os.getenv('FORECAST_CYCLE', 'latest')
    pressure_levels_input = os.getenv('PRESSURE_LEVELS', '1000,925,850,700,500,300,250,200')

    # Parse pressure levels
    pressure_levels = [int(level.strip()) for level in pressure_levels_input.split(',')]
    logger.info(f"Pressure levels: {pressure_levels}")

    # Determine forecast cycle
    if forecast_cycle_input == 'latest':
        cycle_date = get_latest_gfs_cycle()
    else:
        # Parse specific cycle (format: YYYYMMDDHH)
        try:
            cycle_date = datetime.strptime(forecast_cycle_input, "%Y%m%d%H")
        except ValueError:
            logger.error(f"Invalid forecast cycle format: {forecast_cycle_input}")
            logger.error("Use 'latest' or format YYYYMMDDHH (e.g., 2025122800)")
            sys.exit(1)

    logger.info(f"Forecast cycle: {cycle_date.strftime('%Y-%m-%d %H:00 UTC')}")

    # Output directory
    output_dir = Path('data/grib2')

    # Fetch data (try AWS first, fallback to NOMADS)
    try:
        fetch_gfs_from_aws(cycle_date, pressure_levels, output_dir)
    except Exception as e:
        logger.error(f"AWS fetch failed: {e}")
        logger.info("Falling back to NOMADS...")
        fetch_gfs_from_nomads(cycle_date, pressure_levels, output_dir)

    # Save cycle info for next step
    info_file = Path('data/cycle_info.txt')
    info_file.parent.mkdir(parents=True, exist_ok=True)
    with open(info_file, 'w') as f:
        f.write(f"{cycle_date.strftime('%Y%m%d%H')}\n")
        f.write(f"{','.join(map(str, pressure_levels))}\n")

    logger.info("Data fetch complete!")


if __name__ == '__main__':
    main()
