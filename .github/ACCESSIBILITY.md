# Accessibility

[README](../README.md) · [Contributing](CONTRIBUTING.md)

## Scope

This repository provides independent Nix packaging, modules, and Flatpak
distribution for PD2 Trader. Our accessibility work focuses on this repository's
documentation, installation instructions, and packaging choices.

The [upstream PD2 Trader project](https://github.com/errolgr/pd2-trade) maintains
the application itself, including its user interface and most assistive-technology
support. Changes to those features generally need to be made upstream. Packaging
choices can also affect accessibility, and barriers introduced by this repository
belong here.

## Documentation approach

Documentation is maintained as Markdown on GitHub. We aim to keep it text-first,
with clear headings, descriptive links, and copyable commands. Instructions should
not depend on screenshots, color, or visual formatting alone. Informative images,
if added, should have text alternatives. Contributions should preserve or improve
these practices.

These practices are not a claim of WCAG conformance. We have not completed a
comprehensive accessibility evaluation or verified compatibility with specific
screen readers or other assistive technologies.

## Reporting accessibility barriers

[Open an issue in this repository](https://github.com/ohbe1jacobi/pd2-trader-flake/issues/new/choose)
for barriers involving our documentation, installation instructions, or packaging.
Describe what you were trying to do and what prevented you from doing it. A minimal
reproduction is not required, and unknown environment details are fine.

Software versions, assistive-technology details, screenshots, and recordings are
optional. You do not need to disclose a disability or medical information. Never
include credentials, saved login data, or other private information.

If the issue form is a barrier, you can
[open a blank issue](https://github.com/ohbe1jacobi/pd2-trader-flake/issues/new).
For barriers within the application itself, please
[report them upstream](https://github.com/errolgr/pd2-trade/issues). If you are
unsure where the problem originates, you are welcome to report it here so we can
help identify the appropriate project.

## Maintenance and limitations

The repository maintainers handle reports and maintain this statement on a
best-effort basis. We aim to clarify whether a reported barrier belongs in this
repository or upstream and discuss possible fixes or workarounds. There is no
guaranteed response or fix timeline.

Fixes to upstream application behavior depend on the upstream maintainers. We
cannot guarantee an upstream resolution or timeline. Support for a platform or a
successful application build does not establish accessibility on that platform.
