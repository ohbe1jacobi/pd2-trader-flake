"""Merge only PD2 Trader's owned rules using KDE's own config serializer."""
import argparse
import pathlib
import subprocess

WINDOWED = 'pd2-trader-hm-windowed'
OVERLAY = 'pd2-trader-hm-overlay'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    parser.add_argument('--kread', required=True)
    parser.add_argument('--kwrite', required=True)
    parser.add_argument('--windowed', required=True, choices=['true', 'false'])
    parser.add_argument('--overlay', required=True, choices=['true', 'false'])
    parser.add_argument('--game-title', default='Diablo II')
    parser.add_argument('--game-class', default='steam_app_default')
    parser.add_argument('--trader-title', default='PD2Trader')
    args = parser.parse_args()
    if not all([args.game_title, args.game_class, args.trader_title]):
        parser.error('Window match strings must not be empty')
    config = pathlib.Path(args.config)

    def read(group, key, default=''):
        return subprocess.check_output([args.kread, '--file', str(config), '--group', group,
                                        '--key', key, '--default', default], text=True).rstrip('\n')

    def write(group, key, value):
        subprocess.run([args.kwrite, '--file', str(config), '--group', group,
                        '--key', key, str(value)], check=True)

    # Do not create a config just because a disabled module was imported.
    active = args.windowed == 'true'
    rules = read('General', 'rules').split(',')
    rules = [rule for rule in rules if rule]
    if not rules:
        rules = [str(i) for i in range(1, int(read('General', 'count', '0')) + 1)]
    if not active and args.overlay == 'false' and not any(
            rule in rules for rule in [WINDOWED, OVERLAY]):
        return
    if config.is_symlink():
        raise SystemExit('Refusing to edit symlinked kwinrulesrc; integrate these rules with its existing declarative owner instead.')
    config.parent.mkdir(parents=True, exist_ok=True)
    if active:
        values = {'Description': 'PD2 Trader: start Diablo II windowed',
                  'Enabled': 'true', 'title': args.game_title, 'titlematch': '1',
                  'wmclass': args.game_class, 'wmclassmatch': '1', 'wmclasscomplete': 'false'}
        for key in ['fullscreen', 'maximizevert', 'maximizehoriz']:
            values[key] = 'false'
            values[key + 'rule'] = '3'
        for key, value in values.items():
            write(WINDOWED, key, value)
    elif WINDOWED in rules:
        write(WINDOWED, 'Enabled', 'false')
        for key in ['fullscreenrule', 'maximizevertrule', 'maximizehorizrule']:
            write(WINDOWED, key, '0')
    overlay = args.overlay == 'true'
    if overlay:
        values = {'Description': 'PD2 Trader: overlay above the game',
                  'Enabled': 'true', 'title': args.trader_title, 'titlematch': '1',
                  'layer': 'osd', 'layerrule': '2',
                  'skiptaskbar': 'true', 'skiptaskbarrule': '2',
                  'skipswitcher': 'true', 'skipswitcherrule': '2'}
        for key, value in values.items():
            write(OVERLAY, key, value)
    elif OVERLAY in rules:
        write(OVERLAY, 'Enabled', 'false')
        for key in ['layerrule', 'skiptaskbarrule', 'skipswitcherrule']:
            write(OVERLAY, key, '0')
    preserved = [rule for rule in rules if rule not in [WINDOWED, OVERLAY]]
    desired = ([WINDOWED] if active else []) + ([OVERLAY] if overlay else []) + preserved
    write('General', 'rules', ','.join(desired))
    write('General', 'count', len(desired))


if __name__ == '__main__':
    main()
