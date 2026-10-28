#include <dlfcn.h>
#include <stdio.h>
int main(void) {
    void *handle = dlopen("libayatana-appindicator3.so.1", RTLD_NOW | RTLD_LOCAL);
    if (!handle) { fprintf(stderr, "FAIL: tray dlopen: %s\n", dlerror()); return 1; }
    if (!dlsym(handle, "app_indicator_new")) { fprintf(stderr, "FAIL: tray symbol missing\n"); return 1; }
    dlclose(handle);
    puts("PASS: tray library loads by soname using executable RPATH, no LD_LIBRARY_PATH");
    return 0;
}
