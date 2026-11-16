import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createDefaultAdapters } from '../src/adapters/index.js';
import { analyzeRepository } from '../src/infrastructure/scanning/repository-analyzer.js';
import { detectFileLanguageWithSignals } from '../src/infrastructure/scanning/tier0-scanner.js';

const FIXTURES_ROOT = path.resolve(process.cwd(), 'tests/fixtures');

describe('Stabilization regressions', () => {
  it('classifies well-known non-source files instead of reporting them as unrecognized languages', () => {
    const cases: readonly (readonly [string, string])[] = [
      ['services/api/requirements.txt', 'Pip Requirements'],
      ['requirements-dev.txt', 'Pip Requirements'],
      ['constraints.txt', 'Pip Requirements'],
      ['services/api/.env.example', 'Dotenv Template'],
      ['.env.template', 'Dotenv Template'],
      ['.env.sample', 'Dotenv Template'],
      ['NOTES.txt', 'Plain Text'],
    ];
    for (const [relativePath, expected] of cases) {
      const result = detectFileLanguageWithSignals(relativePath, 'some content\n');
      assert.equal(result.language, expected, `language for ${relativePath}`);
      assert.equal(result.certainty, 'verified', `certainty for ${relativePath}`);
    }
  });

  it('keeps truly unknown extensions flagged as unrecognized', () => {
    const result = detectFileLanguageWithSignals('src/main.qlang', 'proc main()\n');
    assert.equal(result.language, 'Unrecognized (.qlang)');
    assert.equal(result.certainty, 'unknown');
  });

  it('does not downgrade a Python sub-project to unknown because of requirements.txt or .env.example', async () => {
    const { snapshot } = await analyzeRepository({
      repoId: 'fixture-polyglot-regression',
      rootPath: path.join(FIXTURES_ROOT, 'polyglot-monorepo'),
      adapters: createDefaultAdapters(),
    });

    const pricing = snapshot.subProjects.find((sp) => sp.rootPath === 'services/python-pricing');
    assert.ok(pricing, 'Expected services/python-pricing sub-project');
    const languageNames = pricing.languages.map((l) => l.value);
    assert.ok(languageNames.includes('Python'), 'Python should be detected');
    assert.ok(
      !languageNames.some((name) => name.startsWith('Unrecognized') || name === 'Pip Requirements' || name === 'Dotenv Template'),
      `Non-source files should not appear as sub-project languages: ${languageNames.join(', ')}`,
    );
    assert.ok(
      !snapshot.unknownsAndLimitations.some((u) => u.includes('requirements.txt') || u.includes('.env.example')),
      'No unrecognized-language warnings for requirements.txt or .env.example',
    );
  });
});
