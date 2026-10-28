"""Run the settings merger against isolated files, never a real Trader profile."""
import json
import pathlib
import stat
import subprocess
import sys
import tempfile

helper = sys.argv[1]
with tempfile.TemporaryDirectory() as tmp:
    settings = pathlib.Path(tmp) / 'com.pd2-trader.app' / 'settings.json'
    directory = '/home/test/Games/Wine prefix/drive_c/Program Files (x86)/Diablo II'

    def run(path=directory):
        return subprocess.run([sys.executable, helper, '--config', str(settings),
                               '--diablo2-directory', path], capture_output=True, text=True)

    result = run()
    assert result.returncode == 0, result.stderr
    assert json.loads(settings.read_text()) == {'diablo2Directory': directory}
    assert stat.S_IMODE(settings.stat().st_mode) == 0o600
    original = {'pd2Token': 'fixture-not-a-real-secret', 'hotkeyKey': 'q',
                'nested': {'array': [1, 'two']}, 'diablo2Directory': '/old'}
    settings.write_text(json.dumps(original))
    result = run()
    assert result.returncode == 0, result.stderr
    expected = dict(original, diablo2Directory=directory)
    assert json.loads(settings.read_text()) == expected
    before = (settings.read_bytes(), settings.stat().st_mtime_ns)
    assert run().returncode == 0
    assert (settings.read_bytes(), settings.stat().st_mtime_ns) == before
    # Expand only the current user's leading ~/ at runtime; never evaluate shell text.
    import os
    home = pathlib.Path(tmp) / 'synthetic home'
    home.mkdir()
    tilde_path = '~/Games/project-diablo-2/drive_c/Program Files (x86)/Diablo II'
    result = subprocess.run([sys.executable, helper, '--config', str(settings),
                             '--diablo2-directory', tilde_path], env=dict(os.environ, HOME=str(home)),
                            capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert json.loads(settings.read_text()) == dict(original, diablo2Directory=str(home / tilde_path[2:]))
    assert run('~another-user/Games/Diablo II').returncode != 0
    for invalid in ['{broken', '[]', 'null', '42']:
        settings.write_text(invalid)
        assert run().returncode != 0
        assert settings.read_text() == invalid
    settings.write_text(json.dumps(expected))
    assert run('relative/Diablo II').returncode != 0
    assert json.loads(settings.read_text()) == expected
    settings.unlink()
    target = pathlib.Path(tmp) / 'declarative.json'
    target.write_text(json.dumps(original))
    settings.symlink_to(target)
    assert run().returncode != 0
    assert json.loads(target.read_text()) == original
    print('PASS: D2 path creation, JSON merge, token preservation, private permissions, idempotence, invalid/symlink safety')
