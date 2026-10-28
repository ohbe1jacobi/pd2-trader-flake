"""Set only Trader's D2 directory before launch, preserving mutable user settings."""
import argparse
import json
import os
import pathlib
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    parser.add_argument('--diablo2-directory', required=True)
    args = parser.parse_args()
    if args.diablo2_directory.startswith('~/'):
        args.diablo2_directory = str(pathlib.Path.home() / args.diablo2_directory[2:])
    if not os.path.isabs(args.diablo2_directory):
        parser.error('diablo2Directory must be an absolute runtime path or start with ~/')
    config = pathlib.Path(args.config)
    if config.is_symlink():
        raise SystemExit('Refusing to replace symlinked Trader settings; keep this mutable file outside declarative file management.')
    try:
        current = json.loads(config.read_text()) if config.exists() else {}
    except (ValueError, OSError):
        raise SystemExit('Cannot read valid Trader settings JSON; existing file was not modified.') from None
    if not isinstance(current, dict):
        raise SystemExit('Trader settings must be a JSON object; existing file was not modified.')
    if current.get('diablo2Directory') == args.diablo2_directory:
        return
    current['diablo2Directory'] = args.diablo2_directory
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
