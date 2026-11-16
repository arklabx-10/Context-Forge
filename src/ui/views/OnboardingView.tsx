// Workspace view: onboarding. Extracted from App.tsx; state and handlers come from useWorkspace().
import React from 'react';
import type { Workspace } from '../useWorkspace.js';

export function OnboardingView({ ws }: { readonly ws: Workspace }): React.ReactElement {
  const {
    health,
    onboardPath,
    setOnboardPath,
    onboardName,
    setOnboardName,
    onboardExcludeGlobs,
    setOnboardExcludeGlobs,
    onboardMaxFileSizeKb,
    setOnboardMaxFileSizeKb,
    onboardMaxTotalFiles,
    setOnboardMaxTotalFiles,
    handleOnboardRepo,
  } = ws;

  return (
    <div className="split-layout">
      <div className="panel">
        <h2 className="panel-title">Add / Import Local Repository</h2>
        <p className="panel-subtitle">
          Import any local directory. ContextForge performs read-only structural and adapter analysis without executing project code.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '14px' }}>
          <div>
            <label className="field-label" htmlFor="onboard-path-input">
              Local Repository Directory Path
            </label>
            <input
              id="onboard-path-input"
              className="input mono"
              placeholder="e.g. E:\projects\my-service or /home/dev/repo"
              value={onboardPath}
              onChange={(e) => setOnboardPath(e.target.value)}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="onboard-name-input">
              Display Name (Optional)
            </label>
            <input
              id="onboard-name-input"
              className="input"
              placeholder="Defaults to folder name"
              value={onboardName}
              onChange={(e) => setOnboardName(e.target.value)}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="onboard-exclude-input">
              Additional Exclusion Globs (Comma-separated)
            </label>
            <input
              id="onboard-exclude-input"
              className="input mono"
              placeholder="e.g. legacy/**, *.bak, tmp/**"
              value={onboardExcludeGlobs}
              onChange={(e) => setOnboardExcludeGlobs(e.target.value)}
            />
          </div>
          <div className="form-grid">
            <div>
              <label className="field-label" htmlFor="onboard-max-size">
                Max File Size (KB)
              </label>
              <input
                id="onboard-max-size"
                type="number"
                className="input mono"
                min={16}
                max={10240}
                value={onboardMaxFileSizeKb}
                onChange={(e) =>
                  setOnboardMaxFileSizeKb(Number.parseInt(e.target.value || '1024', 10))
                }
              />
            </div>
            <div>
              <label className="field-label" htmlFor="onboard-max-files">
                Max Total Files
              </label>
              <input
                id="onboard-max-files"
                type="number"
                className="input mono"
                min={50}
                max={100000}
                value={onboardMaxTotalFiles}
                onChange={(e) =>
                  setOnboardMaxTotalFiles(Number.parseInt(e.target.value || '5000', 10))
                }
              />
            </div>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleOnboardRepo()}
          >
            Analyze & Index Repository
          </button>
        </div>

        <div style={{ marginTop: '20px', borderTop: '1px solid var(--border-subtle)', paddingTop: '14px' }}>
          <div className="field-label">Security & Onboarding Invariants</div>
          <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12px', color: 'var(--text-secondary)' }}>
            <li>Zero script, binary, package manager, or migration execution.</li>
            <li>Git hooks disabled via <code>-c core.hooksPath=_contextforge_disabled_hooks_</code>.</li>
            <li><code>.env</code> secrets, private keys, and tokens excluded prior to indexing.</li>
            <li>Symlinks and Windows junctions resolving outside repository root are blocked.</li>
          </ul>
        </div>
      </div>

      <div className="panel">
        <h2 className="panel-title">Quick-Onboard Verified Local Repositories & Fixtures</h2>
        <p className="panel-subtitle">
          Test ContextForge across polyglot monorepos, Rust/C++ FFI, Python, .NET, database-heavy SQL, malformed manifests, or unrecognized custom languages (<code>.qlang</code>).
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '14px' }}>
          {health?.presets.map((preset) => (
            <div
              key={preset.path}
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-strong)',
                borderRadius: '6px',
                padding: '12px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '12px',
              }}
            >
              <div>
                <div style={{ fontWeight: 600 }}>{preset.label}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  {preset.description}
                </div>
                <div className="mono" style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '3px' }}>
                  {preset.path}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleOnboardRepo(preset.path, preset.label.split(' (')[0])}
              >
                Onboard
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
