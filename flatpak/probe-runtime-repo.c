#include <flatpak.h>
#include <stdio.h>

/* Read the bundle itself; no installation, network access or remote changes. */
int main(int argc, char **argv)
{
    if (argc != 3) {
        fprintf(stderr, "Usage: %s BUNDLE EXPECTED_RUNTIME_REPO\n", argv[0]);
        return 2;
    }

    g_autoptr(GFile) file = g_file_new_for_path(argv[1]);
    g_autoptr(GError) error = NULL;
    g_autoptr(FlatpakBundleRef) bundle = flatpak_bundle_ref_new(file, &error);
    if (bundle == NULL) {
        fprintf(stderr, "Cannot read Flatpak bundle: %s\n", error->message);
        return 1;
    }

    const char *actual = flatpak_bundle_ref_get_runtime_repo_url(bundle);
    if (g_strcmp0(actual, argv[2]) != 0) {
        fprintf(stderr, "Runtime repository mismatch: expected %s, found %s\n",
                argv[2], actual != NULL ? actual : "(missing)");
        return 1;
    }

    printf("PASS: bundle runtime repository is %s\n", actual);
    return 0;
}
