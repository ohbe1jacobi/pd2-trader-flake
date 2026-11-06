{
  runCommandCC,
  pkg-config,
  flatpak,
}:
runCommandCC "flatpak-runtime-repo-probe"
  {
    nativeBuildInputs = [ pkg-config ];
    buildInputs = [ flatpak ];
  }
  ''
    mkdir -p "$out/bin"
    $CC -Wall -Wextra -Werror ${./probe-runtime-repo.c} \
      $(pkg-config --cflags --libs flatpak) -o "$out/bin/probe-runtime-repo"
  ''
