// Workspace view: explorer. Extracted from App.tsx; state and handlers come from useWorkspace().
import React from 'react';
import type { RepositorySnapshot } from '../../domain/index.js';
import type { Workspace } from '../useWorkspace.js';
import { CertaintyBadge, DEFAULT_FILE_WINDOW_LINES } from '../workspace-shared.js';

export function ExplorerView({
  ws,
  snapshot,
}: {
  readonly ws: Workspace;
  readonly snapshot: RepositorySnapshot;
}): React.ReactElement {
  const {
    setActiveView,
    selectedFilePath,
    setSelectedFilePath,
    selectedFileHighlightLine,
    fileContentData,
    setFileContentData,
    explorerPathQuery,
    setExplorerPathQuery,
    explorerRoleFilter,
    setExplorerRoleFilter,
    explorerSubProjectFilter,
    setExplorerSubProjectFilter,
    explorerLanguageFilter,
    setExplorerLanguageFilter,
    explorerStatusFilter,
    setExplorerStatusFilter,
    setExplorerPage,
    explorerPageSize,
    setExplorerPageSize,
    setSymbolPage,
    seedFiles,
    setNewKnowRefPath,
    loadFileWindow,
    openSourceReference,
    toggleSeedFile,
    languageBreakdown,
    filteredExplorerFiles,
    paginatedExplorerFiles,
    selectedFileSymbols,
    paginatedSymbols,
  } = ws;

  return (
    <>
      <div className="split-layout">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2 className="panel-title">
                File & Module Explorer ({filteredExplorerFiles.length} of{' '}
                {snapshot.files.length})
              </h2>
              <p className="panel-subtitle">
                Paginated inventory with multi-signal language badges and windowed file loading.
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '12px' }}>
            <input
              className="input mono"
              aria-label="Filter files by path"
              placeholder="Filter by file path or module name..."
              value={explorerPathQuery}
              onChange={(e) => {
                setExplorerPathQuery(e.target.value);
                setExplorerPage(1);
              }}
            />
            <div className="form-grid">
              <div>
                <label className="field-label" htmlFor="explorer-subproject-select">
                  Sub-Project
                </label>
                <select
                  id="explorer-subproject-select"
                  className="select"
                  value={explorerSubProjectFilter}
                  onChange={(e) => {
                    setExplorerSubProjectFilter(e.target.value);
                    setExplorerPage(1);
                  }}
                >
                  <option value="ALL">All Sub-Projects ({snapshot.subProjects.length})</option>
                  {snapshot.subProjects.map((sp) => (
                    <option key={sp.id} value={sp.id}>
                      {sp.name} ({sp.rootPath || '/'})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="explorer-role-select">
                  File Role
                </label>
                <select
                  id="explorer-role-select"
                  className="select"
                  value={explorerRoleFilter}
                  onChange={(e) => {
                    setExplorerRoleFilter(e.target.value);
                    setExplorerPage(1);
                  }}
                >
                  <option value="ALL">All Roles</option>
                  <option value="source">source</option>
                  <option value="manifest">manifest</option>
                  <option value="lockfile">lockfile</option>
                  <option value="api_spec">api_spec</option>
                  <option value="test">test</option>
                  <option value="database_script">database_script</option>
                  <option value="config_template">config_template</option>
                  <option value="documentation">documentation</option>
                  <option value="build_config">build_config</option>
                </select>
              </div>
            </div>
            <div className="form-grid">
              <div>
                <label className="field-label" htmlFor="explorer-lang-select">
                  Detected Language
                </label>
                <select
                  id="explorer-lang-select"
                  className="select"
                  value={explorerLanguageFilter}
                  onChange={(e) => {
                    setExplorerLanguageFilter(e.target.value);
                    setExplorerPage(1);
                  }}
                >
                  <option value="ALL">All Languages</option>
                  {languageBreakdown.map((l) => (
                    <option key={l.language} value={l.language}>
                      {l.language} ({l.fileCount})
                    </option>
                  ))}
                  <option value="Unrecognized">Unrecognized / None</option>
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="explorer-status-select">
                  Index Status
                </label>
                <select
                  id="explorer-status-select"
                  className="select"
                  value={explorerStatusFilter}
                  onChange={(e) => {
                    setExplorerStatusFilter(
                      e.target.value as 'ALL' | 'INDEXED' | 'EXCLUDED'
                    );
                    setExplorerPage(1);
                  }}
                >
                  <option value="ALL">All Discovered Files</option>
                  <option value="INDEXED">Indexed Only</option>
                  <option value="EXCLUDED">Excluded / Blocked Only</option>
                </select>
              </div>
            </div>
          </div>

          <table className="data-table">
            <thead>
              <tr>
                <th>Path & Detection Signals</th>
                <th>Role</th>
                <th>Seed</th>
              </tr>
            </thead>
            <tbody>
              {paginatedExplorerFiles.pageItems.map((file) => (
                <tr key={file.relativePath}>
                  <td>
                    {file.isIndexed ? (
                      <div>
                        <button
                          type="button"
                          className="source-ref-pill"
                          onClick={() =>
                            void openSourceReference({
                              repoId: snapshot.repoId,
                              relativePath: file.relativePath,
                              fileSha256: file.sha256,
                              startLine: 1,
                              endLine: Math.min(file.lineCount ?? 1, DEFAULT_FILE_WINDOW_LINES),
                              capturedAtIso: snapshot.analyzedAtIso,
                            })
                          }
                        >
                          {file.relativePath}
                        </button>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                          {file.detectedLanguage ?? 'Unrecognized'}{' '}
                          {file.languageDetectionSignals &&
                            file.languageDetectionSignals.length > 0 && (
                              <span className="mono">
                                [{file.languageDetectionSignals.join('+ ')}]
                              </span>
                            )}
                        </div>
                      </div>
                    ) : (
                      <span className="mono" style={{ color: 'var(--text-muted)' }}>
                        {file.relativePath}{' '}
                        <span className="badge badge-danger">{file.exclusionReason}</span>
                      </span>
                    )}
                  </td>
                  <td className="mono" style={{ fontSize: '11px' }}>
                    {file.role}
                  </td>
                  <td>
                    {file.isIndexed && (
                      <input
                        type="checkbox"
                        aria-label={`Select ${file.relativePath} as context seed`}
                        checked={seedFiles.includes(file.relativePath)}
                        onChange={() => toggleSeedFile(file.relativePath)}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination Controls */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: '12px',
              fontSize: '12px',
            }}
          >
            <span className="mono">
              Page {paginatedExplorerFiles.currentPage} of{' '}
              {paginatedExplorerFiles.totalPages} ({paginatedExplorerFiles.totalItems} files)
            </span>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <select
                aria-label="Files per page"
                className="select"
                style={{ width: '90px', padding: '4px 6px' }}
                value={explorerPageSize}
                onChange={(e) => {
                  setExplorerPageSize(Number.parseInt(e.target.value, 10));
                  setExplorerPage(1);
                }}
              >
                <option value={25}>25 / pg</option>
                <option value={50}>50 / pg</option>
                <option value={100}>100 / pg</option>
              </select>
              <button
                type="button"
                className="btn"
                disabled={paginatedExplorerFiles.currentPage <= 1}
                onClick={() => setExplorerPage((p) => Math.max(1, p - 1))}
              >
                Prev
              </button>
              <button
                type="button"
                className="btn"
                disabled={
                  paginatedExplorerFiles.currentPage >= paginatedExplorerFiles.totalPages
                }
                onClick={() =>
                  setExplorerPage((p) =>
                    Math.min(paginatedExplorerFiles.totalPages, p + 1)
                  )
                }
              >
                Next
              </button>
            </div>
          </div>
        </div>

        <div className="panel">
          {fileContentData ? (
            <>
              <div className="panel-header">
                <div>
                  <h3 className="panel-title mono">{fileContentData.relativePath}</h3>
                  <p className="panel-subtitle mono">
                    Showing lines {fileContentData.sliceStartLine}–{fileContentData.sliceEndLine} of{' '}
                    {fileContentData.lineCount} · SHA-256: {fileContentData.sha256.slice(0, 16)}...
                    {selectedFileHighlightLine
                      ? ` · Highlighted Line ${selectedFileHighlightLine}`
                      : ''}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {fileContentData.hasMoreBefore && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() =>
                        void loadFileWindow(
                          snapshot.repoId,
                          fileContentData.relativePath,
                          Math.max(1, fileContentData.sliceStartLine - DEFAULT_FILE_WINDOW_LINES),
                          fileContentData.sliceStartLine - 1,
                          selectedFileHighlightLine
                        )
                      }
                    >
                      ↑ Prev {DEFAULT_FILE_WINDOW_LINES} Lines
                    </button>
                  )}
                  {fileContentData.hasMoreAfter && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() =>
                        void loadFileWindow(
                          snapshot.repoId,
                          fileContentData.relativePath,
                          fileContentData.sliceEndLine + 1,
                          Math.min(
                            fileContentData.lineCount,
                            fileContentData.sliceEndLine + DEFAULT_FILE_WINDOW_LINES
                          ),
                          selectedFileHighlightLine
                        )
                      }
                    >
                      ↓ Next {DEFAULT_FILE_WINDOW_LINES} Lines
                    </button>
                  )}
                  {(fileContentData.hasMoreBefore || fileContentData.hasMoreAfter) && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() =>
                        void loadFileWindow(
                          snapshot.repoId,
                          fileContentData.relativePath,
                          1,
                          fileContentData.lineCount,
                          selectedFileHighlightLine
                        )
                      }
                    >
                      Load Full File
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn"
                    onClick={() => toggleSeedFile(fileContentData.relativePath)}
                  >
                    {seedFiles.includes(fileContentData.relativePath)
                      ? '✓ In Context Seeds'
                      : '+ Add to Context Seeds'}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setNewKnowRefPath(fileContentData.relativePath);
                      setActiveView('knowledge');
                    }}
                  >
                    Anchor ADR/Note
                  </button>
                </div>
              </div>
              <div className="code-viewer">
                {fileContentData.content.split('\n').map((line, i) => {
                  const lineNo = fileContentData.sliceStartLine + i;
                  const isHighlighted = selectedFileHighlightLine === lineNo;
                  return (
                    <div
                      key={lineNo}
                      style={{
                        background: isHighlighted
                          ? 'rgba(56, 189, 248, 0.2)'
                          : 'transparent',
                        padding: '0 4px',
                      }}
                    >
                      <span
                        style={{
                          color: 'var(--text-muted)',
                          userSelect: 'none',
                          display: 'inline-block',
                          width: '46px',
                        }}
                      >
                        {lineNo}
                      </span>
                      <span>{line}</span>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div>
              <h3 className="panel-title">Windowed File & Provenance Inspector</h3>
              <p className="panel-subtitle">
                Select any indexed file on the left to load a bounded line window with LF-normalized source code, line numbers, and SHA-256 fingerprint without loading entire large files into browser memory.
              </p>
            </div>
          )}

          {/* Module Symbols Inspector */}
          <div style={{ marginTop: '20px', borderTop: '1px solid var(--border-subtle)', paddingTop: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h4 className="panel-title" style={{ fontSize: '14px' }}>
                Extracted Module Symbols (
                {selectedFilePath
                  ? `${selectedFileSymbols.length} in ${selectedFilePath}`
                  : `${selectedFileSymbols.length} across repository`}
                )
              </h4>
              {selectedFilePath && (
                <button
                  type="button"
                  className="btn"
                  style={{ padding: '2px 8px', fontSize: '11px' }}
                  onClick={() => {
                    setSelectedFilePath('');
                    setFileContentData(null);
                    setSymbolPage(1);
                  }}
                >
                  Show All Repo Symbols
                </button>
              )}
            </div>
            <table className="data-table" style={{ marginTop: '8px' }}>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Kind</th>
                  <th>Source Location</th>
                  <th>Certainty</th>
                </tr>
              </thead>
              <tbody>
                {paginatedSymbols.pageItems.map((sym, idx) => (
                  <tr key={`${sym.sourceRef.relativePath}:${sym.name}:${idx}`}>
                    <td className="mono">
                      <strong>{sym.name}</strong>
                    </td>
                    <td className="mono" style={{ fontSize: '11px' }}>
                      {sym.kind}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="source-ref-pill"
                        onClick={() => void openSourceReference(sym.sourceRef)}
                      >
                        {sym.sourceRef.relativePath}:{sym.sourceRef.startLine ?? 1}
                      </button>
                    </td>
                    <td>
                      <CertaintyBadge level={sym.certainty} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {paginatedSymbols.totalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px', fontSize: '12px' }}>
                <span className="mono">
                  Symbol Page {paginatedSymbols.currentPage} / {paginatedSymbols.totalPages}
                </span>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    type="button"
                    className="btn"
                    disabled={paginatedSymbols.currentPage <= 1}
                    onClick={() => setSymbolPage((p) => Math.max(1, p - 1))}
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={paginatedSymbols.currentPage >= paginatedSymbols.totalPages}
                    onClick={() =>
                      setSymbolPage((p) => Math.min(paginatedSymbols.totalPages, p + 1))
                    }
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
