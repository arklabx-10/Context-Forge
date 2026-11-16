// Workspace view: context_builder. Extracted from App.tsx; state and handlers come from useWorkspace().
import React from 'react';
import type {
  CodingAssistantTarget,
  DevelopmentTaskType,
  RepositorySnapshot,
} from '../../domain/index.js';
import type { Workspace } from '../useWorkspace.js';

export function ContextBuilderView({
  ws,
  snapshot,
}: {
  readonly ws: Workspace;
  readonly snapshot: RepositorySnapshot;
}): React.ReactElement {
  const {
    setStatusNotice,
    taskType,
    setTaskType,
    taskTitle,
    setTaskTitle,
    taskDescription,
    setTaskDescription,
    targetSubProjectId,
    setTargetSubProjectId,
    seedFiles,
    setSeedFiles,
    excludedPackFiles,
    setExcludedPackFiles,
    assistantTarget,
    setAssistantTarget,
    customTemplateInstruction,
    setCustomTemplateInstruction,
    maxTotalChars,
    setMaxTotalChars,
    maxFilesCount,
    setMaxFilesCount,
    maxCharsPerFile,
    setMaxCharsPerFile,
    maxPackFileSizeKb,
    setMaxPackFileSizeKb,
    staleFilePolicy,
    setStaleFilePolicy,
    includeTests,
    setIncludeTests,
    generatedPack,
    exportFormatTab,
    setExportFormatTab,
    openSourceReference,
    handleGenerateContextPack,
    toggleSeedFile,
    toggleExcludedPackFile,
  } = ws;

  return (
    <div className="split-layout">
      <div className="panel">
        <h2 className="panel-title">Deterministic Context Pack Builder</h2>
        <p className="panel-subtitle">
          Assemble a budget-constrained, prompt-injection-fenced context pack for any AI coding assistant.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '14px' }}>
          <div>
            <label className="field-label" htmlFor="cf-development-task-type">Development Task Type</label>
            <select
              id="cf-development-task-type"
              className="select"
              value={taskType}
              onChange={(e) => setTaskType(e.target.value as DevelopmentTaskType)}
            >
              <option value="implement_feature">Implement Feature</option>
              <option value="fix_bug">Fix Bug</option>
              <option value="understand_module">Understand Unfamiliar Module</option>
              <option value="refactor">Refactor Module</option>
              <option value="write_tests">Write Automated Tests</option>
              <option value="database_change">Database Schema / Migration Change</option>
              <option value="review_changes">Review Code Changes</option>
              <option value="security_audit">Security Audit</option>
            </select>
          </div>

          <div>
            <label className="field-label" htmlFor="cf-task-title">Task Title</label>
            <input
              id="cf-task-title"
              className="input"
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
            />
          </div>

          <div>
            <label className="field-label" htmlFor="cf-task-description-specific-constraints">Task Description & Specific Constraints</label>
            <textarea
              id="cf-task-description-specific-constraints"
              className="textarea"
              rows={3}
              value={taskDescription}
              onChange={(e) => setTaskDescription(e.target.value)}
            />
          </div>

          <div>
            <label className="field-label" htmlFor="cf-scope-to-sub-project-optional">Scope to Sub-Project (Optional)</label>
            <select
              id="cf-scope-to-sub-project-optional"
              className="select"
              value={targetSubProjectId}
              onChange={(e) => setTargetSubProjectId(e.target.value)}
            >
              <option value="">All Sub-Projects (Auto-rank)</option>
              {snapshot.subProjects.map((sp) => (
                <option key={sp.id} value={sp.id}>
                  {sp.name} ({sp.rootPath || '/'})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="field-label" htmlFor="cf-target-coding-assistant-profile">Target Coding Assistant Profile</label>
            <select
              id="cf-target-coding-assistant-profile"
              className="select"
              value={assistantTarget}
              onChange={(e) => setAssistantTarget(e.target.value as CodingAssistantTarget)}
            >
              <option value="universal">Universal Multi-Assistant Standard</option>
              <option value="claude_code">Claude Code</option>
              <option value="cursor">Cursor Composer / Agent</option>
              <option value="github_copilot">GitHub Copilot</option>
              <option value="codex_aider">Codex / Aider CLI</option>
            </select>
          </div>

          <div>
            <label className="field-label" htmlFor="cf-custom-agent-template-instructions-optio">
              Custom Agent Template Instructions (Optional)
            </label>
            <input
              id="cf-custom-agent-template-instructions-optio"
              className="input"
              placeholder="e.g. Prefer minimal diffs and preserve existing public signatures"
              value={customTemplateInstruction}
              onChange={(e) => setCustomTemplateInstruction(e.target.value)}
            />
          </div>

          <div className="form-grid">
            <div>
              <label className="field-label" htmlFor="cf-max-context-budget-chars">Max Context Budget (Chars)</label>
              <input
              id="cf-max-context-budget-chars"
                type="number"
                className="input mono"
                min={2000}
                max={200000}
                step={2000}
                value={maxTotalChars}
                onChange={(e) =>
                  setMaxTotalChars(Number.parseInt(e.target.value || '28000', 10))
                }
              />
            </div>
            <div>
              <label className="field-label" htmlFor="cf-max-included-files">Max Included Files</label>
              <input
              id="cf-max-included-files"
                type="number"
                className="input mono"
                min={1}
                max={50}
                value={maxFilesCount}
                onChange={(e) =>
                  setMaxFilesCount(Number.parseInt(e.target.value || '10', 10))
                }
              />
            </div>
          </div>

          <div className="form-grid">
            <div>
              <label className="field-label" htmlFor="cf-max-chars-per-file-excerpt">Max Chars Per File Excerpt</label>
              <input
              id="cf-max-chars-per-file-excerpt"
                type="number"
                className="input mono"
                min={500}
                max={50000}
                step={500}
                value={maxCharsPerFile}
                onChange={(e) =>
                  setMaxCharsPerFile(Number.parseInt(e.target.value || '6000', 10))
                }
              />
            </div>
            <div>
              <label className="field-label" htmlFor="cf-max-source-file-size-kb">Max Source File Size (KB)</label>
              <input
              id="cf-max-source-file-size-kb"
                type="number"
                className="input mono"
                min={4}
                max={10240}
                value={maxPackFileSizeKb}
                onChange={(e) =>
                  setMaxPackFileSizeKb(Number.parseInt(e.target.value || '512', 10))
                }
              />
            </div>
          </div>

          <div>
            <label className="field-label" htmlFor="cf-stale-file-policy">Stale File Policy</label>
            <select
              id="cf-stale-file-policy"
              className="select"
              value={staleFilePolicy}
              onChange={(e) => setStaleFilePolicy(e.target.value as 'flag' | 'reject')}
            >
              <option value="flag">
                Flag Stale Files (Warn if modified on disk since snapshot)
              </option>
              <option value="reject">
                Reject Stale Files (Omit files modified/deleted since snapshot)
              </option>
            </select>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
            <input
              type="checkbox"
              checked={includeTests}
              onChange={(e) => setIncludeTests(e.target.checked)}
            />
            Include relevant test files in context pack
          </label>

          <div>
            <div className="field-label">Selected Seed Files ({seedFiles.length})</div>
            {seedFiles.length === 0 ? (
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                No explicit seed files selected (will rank by task keywords & role). You can check seed files in File & Module Explorer.
              </div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {seedFiles.map((sf) => (
                  <button
                    key={sf}
                    type="button"
                    className="source-ref-pill"
                    onClick={() => toggleSeedFile(sf)}
                  >
                    {sf} ✕
                  </button>
                ))}
              </div>
            )}
          </div>

          {excludedPackFiles.length > 0 && (
            <div>
              <div className="field-label">
                User-Excluded Pack Files ({excludedPackFiles.length})
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {excludedPackFiles.map((ef) => (
                  <button
                    key={ef}
                    type="button"
                    className="source-ref-pill"
                    onClick={() => toggleExcludedPackFile(ef)}
                  >
                    {ef} (Restore) ✕
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleGenerateContextPack()}
          >
            Assemble Deterministic Context Pack
          </button>
        </div>
      </div>

      <div className="panel">
        {generatedPack ? (
          <>
            <div className="panel-header">
              <div>
                <h3 className="panel-title">
                  Assembled Pack: {generatedPack.pack.usedChars.toLocaleString()} /{' '}
                  {generatedPack.pack.budget.maxTotalChars.toLocaleString()} chars (~
                  {generatedPack.pack.estimatedTokens.toLocaleString()} tokens)
                </h3>
                <p className="panel-subtitle">
                  {generatedPack.pack.includedItems.length} files included ·{' '}
                  {generatedPack.pack.omittedItems.length} files omitted
                </p>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className={`btn ${exportFormatTab === 'markdown' ? 'btn-primary' : ''}`}
                  onClick={() => setExportFormatTab('markdown')}
                >
                  Markdown
                </button>
                <button
                  type="button"
                  className={`btn ${exportFormatTab === 'plaintext' ? 'btn-primary' : ''}`}
                  onClick={() => setExportFormatTab('plaintext')}
                >
                  Plain Text
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    const text =
                      exportFormatTab === 'markdown'
                        ? generatedPack.markdownExport
                        : generatedPack.plainTextExport;
                    void navigator.clipboard?.writeText(text);
                    setStatusNotice(`Copied ${exportFormatTab} context pack to clipboard.`);
                  }}
                >
                  Copy Export
                </button>
              </div>
            </div>

            {generatedPack.pack.injectionAlerts.length > 0 && (
              <div className="alert-banner alert-danger">
                <strong>
                  Prompt Injection Warnings ({generatedPack.pack.injectionAlerts.length}):
                </strong>
                {generatedPack.pack.injectionAlerts.map((a, i) => (
                  <div key={i} className="mono" style={{ fontSize: '12px' }}>
                    [{a.severity.toUpperCase()}] {a.patternId} in {a.sourceRef.relativePath}:
                    {a.sourceRef.startLine} — {a.description}
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginBottom: '12px' }}>
              <div className="field-label">
                Proposed Context Pack Files — Why Each File Was Selected (Revision:{' '}
                <code>{generatedPack.pack.sourceRevision ?? generatedPack.pack.snapshotId}</code>)
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Rank & Source Location</th>
                    <th>Role</th>
                    <th>Score</th>
                    <th>Why Selected (Rule & Evidence)</th>
                    <th>Edit Pack</th>
                  </tr>
                </thead>
                <tbody>
                  {generatedPack.pack.includedItems.map((item, idx) => (
                    <tr key={item.relativePath}>
                      <td className="mono">
                        <button
                          type="button"
                          className="source-ref-pill"
                          onClick={() => void openSourceReference(item.sourceRef)}
                        >
                          #{idx + 1} {item.relativePath}:{item.startLine}-{item.endLine}
                        </button>
                        {item.isStaleComparedToDisk && (
                          <span
                            className="badge badge-danger"
                            style={{ marginLeft: '6px' }}
                            title={item.stalenessWarning}
                          >
                            STALE
                          </span>
                        )}
                      </td>
                      <td className="mono" style={{ fontSize: '11px' }}>
                        {item.role}
                      </td>
                      <td className="mono">
                        <strong>{item.relevanceScore}</strong>
                      </td>
                      <td style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                        {item.scoreBreakdown
                          .map((b) => `${b.ruleId} (+${b.points}): ${b.reason}`)
                          .join(' · ')}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-danger"
                          style={{ padding: '2px 8px', fontSize: '11px' }}
                          onClick={() => {
                            const nextExcl = excludedPackFiles.includes(item.relativePath)
                              ? excludedPackFiles
                              : [...excludedPackFiles, item.relativePath];
                            const nextSeeds = seedFiles.filter(
                              (s) => s !== item.relativePath
                            );
                            setExcludedPackFiles(nextExcl);
                            setSeedFiles(nextSeeds);
                            void handleGenerateContextPack({
                              seedFilePaths: nextSeeds,
                              excludedFilePaths: nextExcl,
                            });
                          }}
                        >
                          Exclude
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="field-label">
              Exported Context Pack ({exportFormatTab.toUpperCase()})
            </div>
            <pre className="code-viewer">
              {exportFormatTab === 'markdown'
                ? generatedPack.markdownExport
                : generatedPack.plainTextExport}
            </pre>
          </>
        ) : (
          <div>
            <h3 className="panel-title">Context Pack Preview & Score Breakdown</h3>
            <p className="panel-subtitle">
              Configure your task and click "Assemble Deterministic Context Pack" to inspect the deterministic file scoring rules and export Markdown or Plain Text.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
