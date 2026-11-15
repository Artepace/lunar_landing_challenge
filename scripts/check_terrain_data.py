"""Verify LFS terrain assets before packaging the FastAPI service."""

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def verify_maps(root=ROOT):
    manifest = json.loads((root / 'data/terrain_manifest.json').read_text())
    for name, expected in manifest.items():
        path = root / 'data/raw' / name
        if not path.is_file():
            raise ValueError(f'{name} is missing. Run git lfs pull; enable Git LFS in Vercel Git settings.')
        with path.open('rb') as file:
            if file.read(128).startswith(b'version https://git-lfs.github.com/spec/v1'):
                raise ValueError(f'{name} is a Git LFS pointer. Enable Git LFS in Vercel Git settings and redeploy.')
            if path.stat().st_size != expected['bytes']:
                raise ValueError(f'{name} has the wrong size. Download the complete map again.')
            file.seek(0)
            digest = hashlib.sha256()
            for block in iter(lambda: file.read(1024 * 1024), b''):
                digest.update(block)
        if digest.hexdigest() != expected['sha256']:
            raise ValueError(f'{name} failed SHA-256 verification. Download the original map again.')
        print(f'Verified {name} ({expected["bytes"]:,} bytes)')


if __name__ == '__main__':
    try:
        verify_maps()
    except ValueError as error:
        raise SystemExit(str(error)) from error
