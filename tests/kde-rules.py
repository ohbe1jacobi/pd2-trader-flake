"""Exercise the real KDE KConfig tools, never the desktop user's config."""
import configparser
import pathlib
import subprocess
import sys
import tempfile

helper, kread, kwrite = sys.argv[1:]
with tempfile.TemporaryDirectory() as tmp:
    config = pathlib.Path(tmp) / "kwinrulesrc"
    original = '[General]\nrules=existing\ncount=1\n\n[existing]\nDescription=Leave me alone\ntitle=Other App\ntitlematch=1\n'
    config.write_text(original)

    def run(windowed, overlay, extra=()):
        subprocess.run([sys.executable, helper, '--config', str(config),
                        '--kread', kread, '--kwrite', kwrite,
                        '--windowed', str(windowed).lower(),
                        '--overlay', str(overlay).lower(), *extra], check=True)
        parsed = configparser.ConfigParser(interpolation=None)
        parsed.optionxform = str
        parsed.read(config)
        return parsed

    result = run(True, False)
    rule = result['pd2-trader-hm-windowed']
    assert rule['title'] == 'Diablo II'
    assert rule['wmclass'] == 'steam_app_default'
    assert rule['titlematch'] == rule['wmclassmatch'] == '1'
    for key in ['fullscreen', 'maximizevert', 'maximizehoriz']:
        assert rule[key] == 'false'
        assert rule[key + 'rule'] == '3'  # Apply Initially, NOT Force
    assert dict(result['existing']) == {'Description': 'Leave me alone', 'title': 'Other App', 'titlematch': '1'}
    assert result['General']['rules'].split(',') == ['pd2-trader-hm-windowed', 'existing']
    first = config.read_bytes()
    run(True, False)
    assert config.read_bytes() == first, 'Repeated application must be idempotent'
    print('PASS: narrow Apply Initially rule; unrelated rules preserved; idempotent')
    result = run(True, True)
    overlay = result['pd2-trader-hm-overlay']
    assert overlay['title'] == 'PD2Trader' and overlay['titlematch'] == '1'
    assert overlay['layer'] == 'osd' and overlay['layerrule'] == '2'
    for key in ['skiptaskbar', 'skipswitcher']:
        assert overlay[key] == 'true' and overlay[key + 'rule'] == '2'
    assert 'type' not in overlay, 'Layer must not be confused with window type'
    result = run(False, True)
    assert result['General']['rules'].split(',') == ['pd2-trader-hm-overlay', 'existing']
    assert result['pd2-trader-hm-windowed']['Enabled'] == 'false'
    result = run(False, False)
    assert result['General']['rules'] == 'existing'
    assert result['General']['count'] == '1'
    assert result['pd2-trader-hm-overlay']['layerrule'] == '0'
    assert result['existing']['title'] == 'Other App'
    config.write_text('[General]\ncount=1\n\n[1]\ntitle=Legacy\n')
    result = run(True, True)
    assert result['General']['rules'].split(',')[-1] == '1'
    assert result['1']['title'] == 'Legacy'
    config.unlink()
    run(False, False)
    assert not config.exists(), 'Disabled import must not create kwinrulesrc'
    target = pathlib.Path(tmp) / 'declarative-config'
    target.write_text(original)
    config.symlink_to(target)
    refused = subprocess.run([sys.executable, helper, '--config', str(config), '--kread', kread,
                              '--kwrite', kwrite, '--windowed', 'true', '--overlay', 'true'],
                             capture_output=True, text=True)
    assert refused.returncode != 0 and 'symlink' in refused.stderr
    assert target.read_text() == original
    config.unlink()
    customized = run(True, True, ['--game-title', 'Custom Diablo II', '--game-class', 'custom-wine-class',
                                  '--trader-title', 'Custom Trader'])
    assert customized['pd2-trader-hm-windowed']['title'] == 'Custom Diablo II'
    assert customized['pd2-trader-hm-windowed']['wmclass'] == 'custom-wine-class'
    assert customized['pd2-trader-hm-overlay']['title'] == 'Custom Trader'
    assert customized['pd2-trader-hm-windowed']['wmclassmatch'] == '1'
    before = config.read_bytes()
    refused = subprocess.run([sys.executable, helper, '--config', str(config), '--kread', kread,
                              '--kwrite', kwrite, '--windowed', 'true', '--overlay', 'true',
                              '--game-title', ''], capture_output=True, text=True)
    assert refused.returncode != 0 and config.read_bytes() == before
    print('PASS: overlay layer, independent toggles, cleanup, legacy rules, disabled no-op, symlink safety')
