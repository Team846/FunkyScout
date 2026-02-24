## Development

You will need to create a .env.local file (like the example given) with the supabase url and keys given by the lead

You must have Node.js and pnpm installed, and for desktop development, you will
additionally need to install Rust (through rustup). The local database on
desktop uses sea-orm, so if development with the database is needed, then run:

```
cargo install sea-orm-cli@^2.0.0-rc
```

Run the following commands inside this directory:

```bash
# First,
pnpm install

# To run either app

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

The `NO_STRIP` is required for linux builds. The command may fail from failing
to fetch the appimagetool runtime file, and you can confirm this with the
`--verbose` flag.

If this fails, download a
[runtime file](https://github.com/AppImage/type2-runtime/releases), and pass in
its path to the `LDAI_RUNTIME_FILE` environment variable.

to filter: 2>&1 | grep -vE '(sqlx|sea_orm)'
to open: xattr -cr /Applications/funkyscout.app