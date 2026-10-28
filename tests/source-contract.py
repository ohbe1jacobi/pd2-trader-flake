"""Prove source-contract.sh rejects bad wrappers and unresolved dependencies."""
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile

contract = pathlib.Path(sys.argv[1]).resolve()
with tempfile.TemporaryDirectory(prefix='pd2-source-contract-') as tmp:
    state = pathlib.Path(tmp)
    tools = state / 'tools'
    tools.mkdir()
    package = state / 'package'
    (package / 'bin').mkdir(parents=True)
    (package / 'bin/.pd2-trader-wrapped').touch()
    bash = shutil.which('bash')
    assert bash is not None
    for name, body in {
        'readelf': "printf 'ELF64\\n'\n",
        'ldd': "printf '/nix/store/fixture/libwebkit2gtk-4.1.so\\n/nix/store/fixture/libgtk-3.so\\n'\n"
               "if [ \"${PD2_TEST_MISSING_DEP:-0}\" = 1 ]; then printf 'fixture => not found\\n'; fi\n",
    }.items():
        tool = tools / name
        tool.write_text(f'#!{bash}\n{body}')
        tool.chmod(0o700)
    wrapper = package / 'bin/pd2-trader'
    valid = 'export GDK_BACKEND=x11\n'
    wrapper.write_text(valid)
    env = dict(os.environ, PATH=str(tools) + os.pathsep + os.environ['PATH'])

    def run(expected, **extra):
        result = subprocess.run([bash, str(contract), str(package)], cwd=state,
                                env=dict(env, **extra), capture_output=True, text=True)
        assert (result.returncode == 0) == expected, result.stdout + result.stderr

    run(True)
    wrapper.write_text(valid + 'export LD_PRELOAD=/fixture.so\n')
    run(False)
    wrapper.write_text(valid)
    run(False, PD2_TEST_MISSING_DEP='1')

print('PASS: source contract rejects library overrides and unresolved dependencies')
