// Copies non-TS runtime assets into dist/main so they resolve at runtime:
//  - SQL migrations (src/main/db/migrations -> dist/main/db/migrations)
//  - Plugin runtime harness (src/main/plugins/*.cjs -> dist/main/plugins)
const { mkdirSync, cpSync, existsSync, readdirSync } = require('fs');
const { join } = require('path');

const migrationsSrc = join(__dirname, '..', 'src', 'main', 'db', 'migrations');
const migrationsDest = join(__dirname, '..', 'dist', 'main', 'db', 'migrations');

if (!existsSync(migrationsSrc)) {
  console.error(`[copy-runtime-assets] migrations source not found: ${migrationsSrc}`);
  process.exit(1);
}
mkdirSync(migrationsDest, { recursive: true });
cpSync(migrationsSrc, migrationsDest, { recursive: true });
const migrations = readdirSync(migrationsDest).filter(f => f.endsWith('.sql'));
console.log(`[copy-runtime-assets] ${migrations.length} migration(s) -> dist/main/db/migrations`);

const pluginsSrc = join(__dirname, '..', 'src', 'main', 'plugins');
const pluginsDest = join(__dirname, '..', 'dist', 'main', 'plugins');
if (existsSync(pluginsSrc)) {
  mkdirSync(pluginsDest, { recursive: true });
  for (const f of readdirSync(pluginsSrc)) {
    if (f.endsWith('.cjs')) {
      cpSync(join(pluginsSrc, f), join(pluginsDest, f));
      console.log(`[copy-runtime-assets] ${f} -> dist/main/plugins`);
    }
  }
}