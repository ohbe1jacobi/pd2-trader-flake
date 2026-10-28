"""Merge managed Trader settings before launch, preserving mutable user settings."""
import argparse
import json
import os
import pathlib
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    parser.add_argument('--diablo2-directory')
    parser.add_argument('--auto-update-enabled', choices=['true', 'false'])
    args = parser.parse_args()
    managed = {}
    if args.diablo2_directory is not None:
        if args.diablo2_directory.startswith('~/'):
            args.diablo2_directory = str(pathlib.Path.home() / args.diablo2_directory[2:])
        if not os.path.isabs(args.diablo2_directory):
            parser.error('diablo2Directory must be an absolute runtime path or start with ~/')
        managed['diablo2Directory'] = args.diablo2_directory
    if args.auto_update_enabled is not None:
        managed['autoUpdateEnabled'] = args.auto_update_enabled == 'true'
    if not managed:
        return
    config = pathlib.Path(args.config)
    if config.is_symlink():
        raise SystemExit('Refusing to replace symlinked Trader settings; keep this mutable file outside declarative file management.')
    try:
        current = json.loads(config.read_text()) if config.exists() else {}
    except (ValueError, OSError):
        raise SystemExit('Cannot read valid Trader settings JSON; existing file was not modified.') from None
    if not isinstance(current, dict):
        raise SystemExit('Trader settings must be a JSON object; existing file was not modified.')
    if all(key in current and current[key] == value for key, value in managed.items()):
        return
    current.update(managed)
    config.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Same-directory atomic replacement; mkstemp is private even under a loose umask.
    fd, temporary = tempfile.mkstemp(prefix='.settings-', suffix='.json', dir=config.parent)
    try:
        with os.fdopen(fd, 'w') as output:
            json.dump(current, output, ensure_ascii=False, indent=2)
            output.write('\n')
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, config)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


if __name__ == '__main__':
    main()
