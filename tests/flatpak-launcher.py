"""Exercise the actual Flatpak launcher against disposable profiles and a fake app."""
import json
import os
import pathlib
import stat
import subprocess
import sys
import tempfile

launcher = sys.argv[1]
with tempfile.TemporaryDirectory() as tmp:
    root = pathlib.Path(tmp)
    home = root / 'home'
    config = root / 'private config'
    home.mkdir()
    settings = config / 'com.pd2-trader.app' / 'settings.json'
    directory = '/fixture/Wine prefix/drive_c/Program Files (x86)/Diablo II'
    env = dict(os.environ, HOME=str(home), XDG_CONFIG_HOME=str(config))
    env.pop('PD2_TRADER_D2_DIR', None)

    def run(value=None, **overrides):
        launch_env = dict(env, **overrides)
        if value is not None:
            launch_env['PD2_TRADER_D2_DIR'] = value
        return subprocess.run([launcher, '--fixture', 'two words', ''], env=launch_env,
                              capture_output=True)

    def launched(result):
        assert result.returncode == 17, result.stderr.decode()
        assert result.stdout == b'--fixture\0two words\0\0', result.stdout

    launched(run())
    launched(run(''))
    assert not settings.exists(), 'Unset/empty override must not create settings'
    launched(run(directory))
    assert settings.exists(), 'Configured D2 directory was not merged before launch'
    assert json.loads(settings.read_text()) == {'diablo2Directory': directory}
    assert stat.S_IMODE(settings.stat().st_mode) == 0o600
    original = {'diablo2Directory': '/old', 'pd2Token': 'synthetic-fixture',
                'autoUpdateEnabled': False, 'nested': {'keep': [1, 2]}}
    settings.write_text(json.dumps(original))
    launched(run(directory))
    expected = dict(original, diablo2Directory=directory)
    assert json.loads(settings.read_text()) == expected
    before = (settings.read_bytes(), settings.stat().st_mtime_ns)
    launched(run(directory))
    launched(run())
    launched(run(''))
    assert (settings.read_bytes(), settings.stat().st_mtime_ns) == before
    for value in ['relative/Diablo II', '~other/Games']:
        result = run(value)
        assert result.returncode not in (0, 17) and not result.stdout
        assert settings.read_bytes() == before[0]
    for invalid in ['{broken', '[]', 'null']:
        settings.write_text(invalid)
        result = run(directory)
        assert result.returncode not in (0, 17) and not result.stdout
        assert settings.read_text() == invalid
    settings.unlink()
    target = root / 'untouched.json'
    target.write_text(json.dumps(original))
    settings.symlink_to(target)
    result = run(directory)
    assert result.returncode not in (0, 17) and not result.stdout
    assert json.loads(target.read_text()) == original
    settings.unlink()
    # Values are data, never shell expressions. Also cover HOME/XDG fallback.
    literal = '/fixture/$(touch SHOULD_NOT_EXIST)/Diablo II'
    launched(run(literal))
    assert json.loads(settings.read_text())['diablo2Directory'] == literal
    assert not pathlib.Path('SHOULD_NOT_EXIST').exists()
    launched(run('~/Games/Diablo II', XDG_CONFIG_HOME=''))
    fallback = home / '.config/com.pd2-trader.app/settings.json'
    assert json.loads(fallback.read_text()) == {'diablo2Directory': str(home / 'Games/Diablo II')}
    print('PASS: environment directory merged before launch; arguments and exit status preserved')
    print('PASS: optional override, preservation, idempotence, path validation, invalid/symlink safety and HOME fallback')
