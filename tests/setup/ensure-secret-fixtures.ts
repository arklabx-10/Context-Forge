// Vitest setup file: runs before every test file.
//
// The malformed-and-inaccessible fixture needs a real `.env` file so tests can prove
// secrets are excluded from indexing and context packs. `.env` is gitignored, so a
// fresh checkout (e.g. CI) does not have it. Create a dummy one here so every test
// file sees it regardless of execution order.
import fs from 'node:fs';
import path from 'node:path';

const dummyEnvPath = path.resolve(process.cwd(), 'tests/fixtures/malformed-and-inaccessible/.env');

if (!fs.existsSync(dummyEnvPath)) {
  fs.writeFileSync(
    dummyEnvPath,
    'SUPER_SECRET_API_TOKEN=sk_live_do_not_index_or_export_999999\nDATABASE_PASSWORD=top_secret_password\n',
    'utf8',
  );
}
