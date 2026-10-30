#!/usr/bin/env bash
set -euo pipefail
package=${1:?package}
plugins=${2:?plugin path}
sound=${3:?notification MP3}
# Execute the installed shell launcher's environment setup, not its app exec.
# This tests the actual generated wrapper (makeWrapper splits colon lists).
unset GST_PLUGIN_SYSTEM_PATH_1_0
# The source is deliberately extracted from the generated package wrapper.
# shellcheck disable=SC1090
source <(while IFS= read -r line; do
	[[ $line == exec\ * ]] && break
	printf '%s\n' "$line"
done <"$package/bin/pd2-trader")
[[ ${GST_PLUGIN_SYSTEM_PATH_1_0:-} == "$plugins" ]] || {
	echo 'FAIL: launcher lacks GStreamer plugin path'
	exit 1
}
export GST_PLUGIN_PATH_1_0=
export GST_PLUGIN_PATH=
export GST_REGISTRY_1_0="$PWD/media-registry.bin"
gst-inspect-1.0 appsink >appsink.txt
gst-inspect-1.0 autoaudiosink >autoaudiosink.txt
gst-inspect-1.0 fakevideosink >fakevideosink.txt
gst-inspect-1.0 webvttenc >webvttenc.txt
gst-launch-1.0 -q filesrc location="$sound" ! decodebin ! audioconvert ! fakesink
echo 'PASS: packaged media plugins include audio/video sinks and WebVTT, and decode the real notification MP3'
