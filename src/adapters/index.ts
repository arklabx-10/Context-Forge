import type { RepositoryAnalyzerAdapter } from '../domain/index.js';
import { DotNetAdapter } from './dotnet-adapter.js';
import { GoRustAdapter } from './go-rust-adapter.js';
import { NodeTypeScriptAdapter } from './node-ts-adapter.js';
import { PolyglotBuildAdapter } from './polyglot-build-adapter.js';
import { PythonAdapter } from './python-adapter.js';
import { SqlMigrationAdapter } from './sql-migration-adapter.js';

export {
  DotNetAdapter,
  GoRustAdapter,
  NodeTypeScriptAdapter,
  PolyglotBuildAdapter,
  PythonAdapter,
  SqlMigrationAdapter,
};

export function createDefaultAdapters(): readonly RepositoryAnalyzerAdapter[] {
  return [
    new NodeTypeScriptAdapter(),
    new PythonAdapter(),
    new DotNetAdapter(),
    new GoRustAdapter(),
    new SqlMigrationAdapter(),
    new PolyglotBuildAdapter(),
  ];
}
