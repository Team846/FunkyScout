## Development
Run the following commands inside this directory:

```bash
# First,
pnpm install

pnpm dev:desktop
pnpm dev:mobile
```

### Windows

### Mac

### Linux

#### Building
```bash
NO_STRIP=true pnpm build:desktop
```
The `NO_STRIP` is required for linux builds. The command may fail from failing to fetch the appimagetool runtime file, and you can confirm this with the `--verbose` flag.

If this fails, download a [runtime file](https://github.com/AppImage/type2-runtime/releases), and pass in its path to the `LDAI_RUNTIME_FILE` environment variable.
