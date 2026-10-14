#!/usr/bin/env python3
"""Guarded rollback: plans by default, refuses to overwrite later changes."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', required=True, type=Path, help='Private install manifest path from the implementation plan')
    parser.add_argument('--execute', action='store_true')
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text())
    config, backup = Path(manifest['config']), Path(manifest['backup'])
    if digest(config) not in (manifest['afterConfigHash'], manifest['beforeConfigHash']) or digest(backup) != manifest['beforeConfigHash']:
        raise ValueError('Config or backup changed; inspect and remove only upgrade entries manually')
    changed = [name for name, sha in manifest['newFiles'].items() if Path(name).is_symlink() or (Path(name).exists() and digest(Path(name)) != sha)]
    if changed:
        raise ValueError('Installed files were edited; preserve them and review rollback manually: ' + ', '.join(changed))
    print(json.dumps({'mode': 'execute' if args.execute else 'plan', 'restoreConfig': True,
                      'removeUnchangedInstalledFiles': len(manifest['newFiles']),
                      'preserveUnlistedFiles': True, 'reloadVSCode': False}))
    if not args.execute:
        return
    fd, temp = tempfile.mkstemp(prefix='.kilo-restore-', dir=str(config.parent))
    try:
        os.fchmod(fd, config.stat().st_mode & 0o777)
        with os.fdopen(fd, 'wb') as out:
            out.write(backup.read_bytes())
            out.flush()
            os.fsync(out.fileno())
        os.replace(temp, config)
        for name in manifest['newFiles']:
            path = Path(name)
            if path.is_file():
                path.unlink()
        print('Restored configuration; removed only unchanged files from this installation. Unlisted records and backups remain.')
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


if __name__ == '__main__':
    main()
