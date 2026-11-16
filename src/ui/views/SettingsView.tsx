// Workspace view: settings. Extracted from App.tsx; state and handlers come from useWorkspace().
import React from 'react';
import type { AiProviderConfig } from '../../domain/index.js';
import { apiClient } from '../api-client.js';
import type { Workspace } from '../useWorkspace.js';

export function SettingsView({ ws }: { readonly ws: Workspace }): React.ReactElement {
  const {
    health,
    activeRepoId,
    snapshot,
    setErrorBanner,
    setStatusNotice,
    settingsRepoName,
    setSettingsRepoName,
    settingsExcludeGlobs,
    setSettingsExcludeGlobs,
    settingsMaxFileSizeKb,
    setSettingsMaxFileSizeKb,
    settingsMaxTotalFiles,
    setSettingsMaxTotalFiles,
    settingsMaxDepth,
    setSettingsMaxDepth,
    taskTitle,
    generatedPack,
    aiConfig,
    setAiConfig,
    privacyStatus,
    consentPreview,
    setConsentPreview,
    aiResponseText,
    setAiResponseText,
    loadWorkspaceData,
    handleSaveProjectSettings,
  } = ws;

  return (
    <>
      {activeRepoId && snapshot && (
        <div className="panel">
          <h2 className="panel-title">
            Project Settings & Configurable Exclusions ({snapshot.repoName})
          </h2>
          <p className="panel-subtitle">
            Configure repository-specific ignore globs and scan resource limits. Saving automatically re-scans the repository to update the inventory.
          </p>
          <form
            onSubmit={(e) => void handleSaveProjectSettings(e)}
            style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '14px' }}
          >
            <div className="form-grid">
              <div>
                <label className="field-label" htmlFor="settings-repo-name">
                  Project Display Name
                </label>
                <input
                  id="settings-repo-name"
                  className="input"
                  value={settingsRepoName}
                  onChange={(e) => setSettingsRepoName(e.target.value)}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="settings-exclude-globs">
                  Custom Exclusion Globs (Comma-separated)
                </label>
                <input
                  id="settings-exclude-globs"
                  className="input mono"
                  placeholder="e.g. docs/**, *.snap, fixtures/**"
                  value={settingsExcludeGlobs}
                  onChange={(e) => setSettingsExcludeGlobs(e.target.value)}
                />
              </div>
            </div>

            <div className="form-grid">
              <div>
                <label className="field-label" htmlFor="settings-max-file-kb">
                  Max File Size (KB)
                </label>
                <input
                  id="settings-max-file-kb"
                  type="number"
                  className="input mono"
                  min={16}
                  max={20480}
                  value={settingsMaxFileSizeKb}
                  onChange={(e) =>
                    setSettingsMaxFileSizeKb(Number.parseInt(e.target.value || '1024', 10))
                  }
                />
              </div>
              <div>
                <label className="field-label" htmlFor="settings-max-files">
                  Max Total Files
                </label>
                <input
                  id="settings-max-files"
                  type="number"
                  className="input mono"
                  min={10}
                  max={100000}
                  value={settingsMaxTotalFiles}
                  onChange={(e) =>
                    setSettingsMaxTotalFiles(Number.parseInt(e.target.value || '5000', 10))
                  }
                />
              </div>
              <div>
                <label className="field-label" htmlFor="settings-max-depth">
                  Max Directory Depth
                </label>
                <input
                  id="settings-max-depth"
                  type="number"
                  className="input mono"
                  min={1}
                  max={100}
                  value={settingsMaxDepth}
                  onChange={(e) =>
                    setSettingsMaxDepth(Number.parseInt(e.target.value || '25', 10))
                  }
                />
              </div>
            </div>

            <div>
              <button type="submit" className="btn btn-primary">
                Save Project Settings & Re-Scan Repository
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="split-layout">
        <div className="panel">
          <h2 className="panel-title">AI Provider Independence & Outbound Consent</h2>
          <p className="panel-subtitle">
            ContextForge defaults to 100% local deterministic analysis. External AI calls require explicit per-payload user consent.
          </p>

          {aiConfig && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '14px' }}>
              <div>
                <label className="field-label" htmlFor="cf-active-provider-adapter">Active Provider Adapter</label>
                <select
              id="cf-active-provider-adapter"
                  className="select"
                  value={aiConfig.activeProviderId}
                  onChange={(e) =>
                    setAiConfig({
                      ...aiConfig,
                      activeProviderId:
                        e.target.value as AiProviderConfig['activeProviderId'],
                    })
                  }
                >
                  <option value="noop_deterministic">
                    NoOpDeterministicProvider (Local-Only, Zero Network)
                  </option>
                  <option value="openai_compatible">OpenAI-Compatible API Adapter</option>
                  <option value="anthropic_compatible">
                    Anthropic Messages API Adapter
                  </option>
                  <option value="local_ollama">Local Ollama Adapter</option>
                </select>
              </div>

              <div>
                <label className="field-label" htmlFor="cf-provider-endpoint-url">Provider Endpoint URL</label>
                <input
              id="cf-provider-endpoint-url"
                  className="input mono"
                  value={aiConfig.endpointUrl}
                  onChange={(e) =>
                    setAiConfig({ ...aiConfig, endpointUrl: e.target.value })
                  }
                />
              </div>

              <div>
                <label className="field-label" htmlFor="cf-model-identifier">Model Identifier</label>
                <input
              id="cf-model-identifier"
                  className="input mono"
                  value={aiConfig.modelName}
                  onChange={(e) => setAiConfig({ ...aiConfig, modelName: e.target.value })}
                />
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={async () => {
                    const res = await apiClient.saveAiConfig(aiConfig);
                    setAiConfig(res.config);
                    setStatusNotice('Saved AI provider configuration.');
                  }}
                >
                  Save Provider Config
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={async () => {
                    const res = await apiClient.previewOutboundConsent({
                      systemInstruction: 'Summarize architecture.',
                      taskPrompt: taskTitle,
                      untrustedContextPackText:
                        generatedPack?.markdownExport ??
                        '<untrusted_repository_content>Sample preview payload</untrusted_repository_content>',
                      disclosedFilePaths:
                        generatedPack?.pack.includedItems.map((i) => i.relativePath) ?? [],
                    });
                    setConsentPreview(res.preview);
                  }}
                >
                  Inspect Outbound Consent Gate Preview
                </button>
              </div>

              {consentPreview && (
                <div
                  style={{
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--accent-primary)',
                    borderRadius: '6px',
                    padding: '12px',
                  }}
                >
                  <strong>Explicit Outbound Data Consent Gate</strong>
                  <div className="mono" style={{ fontSize: '11px', marginTop: '4px' }}>
                    Target Provider: {consentPreview.providerId} (
                    {consentPreview.endpointUrl})
                  </div>
                  <div className="mono" style={{ fontSize: '11px' }}>
                    Payload SHA-256: {consentPreview.payloadSha256}
                  </div>
                  <div className="mono" style={{ fontSize: '11px' }}>
                    Disclosed Files ({consentPreview.disclosedFilePaths.length}):{' '}
                    {consentPreview.disclosedFilePaths.join(', ') || 'none'}
                  </div>
                  <div className="mono" style={{ fontSize: '11px' }}>
                    Size: {consentPreview.totalCharacters} chars (~
                    {consentPreview.estimatedTokens} tokens)
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ marginTop: '8px' }}
                    onClick={async () => {
                      try {
                        const res = await apiClient.executeAiWithConsent({
                          request: {
                            systemInstruction: 'Summarize architecture.',
                            taskPrompt: taskTitle,
                            untrustedContextPackText:
                              generatedPack?.markdownExport ??
                              '<untrusted_repository_content>Sample preview payload</untrusted_repository_content>',
                            disclosedFilePaths: consentPreview.disclosedFilePaths,
                          },
                          consentToken: {
                            consentId: consentPreview.consentId,
                            approvedAtIso: new Date().toISOString(),
                            providerId: consentPreview.providerId,
                            payloadSha256: consentPreview.payloadSha256,
                            disclosedFilePaths: consentPreview.disclosedFilePaths,
                            estimatedBytes: consentPreview.totalCharacters,
                          },
                        });
                        setAiResponseText(res.response.generatedText);
                      } catch (err) {
                        setErrorBanner(
                          err instanceof Error ? err.message : 'AI invocation failed'
                        );
                      }
                    }}
                  >
                    Approve Consent Token & Run Provider
                  </button>
                  {aiResponseText && (
                    <pre className="code-viewer" style={{ marginTop: '8px' }}>
                      {aiResponseText}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="panel">
          <h2 className="panel-title">Privacy & Indexed Data Controls</h2>
          <p className="panel-subtitle">
            Inspect everything stored in the local SQLite database and delete indexed data at any time.
          </p>
          {privacyStatus && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '14px' }}>
              <div className="stat-grid">
                <div className="stat-card">
                  <div className="stat-label">Repositories Indexed</div>
                  <div className="stat-value">
                    {privacyStatus.totalRepositoriesIndexed}
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Indexed Files</div>
                  <div className="stat-value">{privacyStatus.totalFilesIndexed}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Secrets Blocked</div>
                  <div className="stat-value">
                    {privacyStatus.totalSecretsExcludedAllTime}
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Outbound AI Calls</div>
                  <div className="stat-value">
                    {privacyStatus.outboundAiRequestsCount}
                  </div>
                </div>
              </div>
              <div className="mono" style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                SQLite Store: {privacyStatus.databaseFilePath} (
                {privacyStatus.databaseSizeBytes.toLocaleString()} bytes)
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                {activeRepoId && (
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={async () => {
                      await apiClient.deleteRepository(activeRepoId);
                      setStatusNotice('Deleted active repository index data.');
                      await loadWorkspaceData('');
                    }}
                  >
                    Delete Active Repository Index
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={async () => {
                    await apiClient.purgeAllData();
                    setStatusNotice(
                      'Purged all indexed repositories, snapshots, and knowledge from SQLite.'
                    );
                    await loadWorkspaceData('');
                  }}
                >
                  Purge All Indexed Data
                </button>
              </div>
            </div>
          )}

          {health && (
            <div style={{ marginTop: '18px', borderTop: '1px solid var(--border-subtle)', paddingTop: '14px' }}>
              <div className="field-label">
                Registered Language & Manifest Adapters ({health.adapters.length})
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Adapter</th>
                    <th>Capabilities</th>
                  </tr>
                </thead>
                <tbody>
                  {health.adapters.map((a) => (
                    <tr key={a.adapterId}>
                      <td>
                        <strong>{a.displayName}</strong>
                        <div className="mono" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          {a.adapterId} v{a.version}
                        </div>
                      </td>
                      <td style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                        {a.description}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
