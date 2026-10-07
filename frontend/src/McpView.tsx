import { useState } from 'react';
import { maskSecret, validateAzure, validateJira } from './mcp';
import type { AzureConnection, McpConnections, McpProvider } from './types';

type JiraDraft = { siteUrl: string; projectKey: string };
type AzureDraft = Omit<AzureConnection, 'connectedAt'>;

const EMPTY_JIRA: JiraDraft = { siteUrl: '', projectKey: '' };
const EMPTY_AZURE: AzureDraft = { orgUrl: '', project: '', token: '' };

export function McpView({
  connections,
  onChange,
  onNotice,
}: {
  connections: McpConnections;
  onChange: (next: McpConnections) => void;
  onNotice: (message: string) => void;
}) {
  const [provider, setProvider] = useState<McpProvider>('jira');
  const [jira, setJira] = useState<JiraDraft>({
    siteUrl: connections.jira?.siteUrl ?? '',
    projectKey: connections.jira?.projectKey ?? '',
  });
  const [azure, setAzure] = useState<AzureDraft>(connections.azure ?? EMPTY_AZURE);
  const [error, setError] = useState('');

  function selectProvider(next: McpProvider) {
    setProvider(next);
    setError('');
  }

  function connectJira() {
    const draft = {
      siteUrl: jira.siteUrl.trim(),
      projectKey: jira.projectKey.trim().toUpperCase(),
    };
    const problem = validateJira(draft);
    if (problem) {
      setError(problem);
      return;
    }
    const params = new URLSearchParams({ siteUrl: draft.siteUrl, projectKey: draft.projectKey });
    window.location.assign(`/api/jira/connect?${params.toString()}`);
  }

  function connectAzure() {
    const draft = {
      orgUrl: azure.orgUrl.trim(),
      project: azure.project.trim(),
      token: azure.token.trim(),
    };
    const problem = validateAzure(draft);
    if (problem) {
      setError(problem);
      return;
    }
    onChange({
      ...connections,
      azure: { ...draft, connectedAt: new Date().toISOString() },
    });
    setAzure(draft);
    setError('');
    onNotice('Azure MCP connection saved.');
  }

  function disconnect(target: McpProvider) {
    onChange({ ...connections, [target]: null });
    if (target === 'jira') setJira(EMPTY_JIRA);
    else setAzure(EMPTY_AZURE);
    setError('');
    onNotice(target === 'jira' ? 'Jira disconnected.' : 'Azure disconnected.');
  }

  const jiraLive = connections.jira;
  const azureLive = connections.azure;

  return (
    <main className="page">
      <div className="section-head">
        <h2>MCP connections</h2>
        <p>Connect Jira or Azure DevOps so the studio can read work items and turn them into Playwright scripts.</p>
      </div>

      <div className="provider-switch" role="tablist" aria-label="MCP providers">
        <button
          type="button"
          role="tab"
          aria-selected={provider === 'jira'}
          className={provider === 'jira' ? 'provider active' : 'provider'}
          onClick={() => selectProvider('jira')}
        >
          <strong>Jira</strong>
          <span>{jiraLive ? `Connected · ${jiraLive.projectKey}` : 'Not connected'}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={provider === 'azure'}
          className={provider === 'azure' ? 'provider active' : 'provider'}
          onClick={() => selectProvider('azure')}
        >
          <strong>Azure</strong>
          <span>{azureLive ? `Connected · ${azureLive.project}` : 'Not connected'}</span>
        </button>
      </div>

      {provider === 'jira' ? (
        <section className="card mcp-form">
          <div className="section-head">
            <h2>Jira</h2>
            <p>
              Enter the Jira site and project key, then click Connect Jira. Atlassian opens so you can sign in and
              approve Automation Studio. The sign-in is saved in this browser for the next fetch.
            </p>
          </div>
          <div className="form-row">
            <label className="field">
              <span>Jira site URL</span>
              <input
                value={jira.siteUrl}
                onChange={(event) => setJira({ ...jira, siteUrl: event.target.value })}
                placeholder="https://your-team.atlassian.net"
                autoComplete="off"
              />
            </label>
            <label className="field">
              <span>Project key</span>
              <input
                value={jira.projectKey}
                onChange={(event) => setJira({ ...jira, projectKey: event.target.value.toUpperCase() })}
                placeholder="AVENGERS"
                autoComplete="off"
              />
            </label>
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="actions">
            <button className="btn primary" type="button" onClick={connectJira}>
              {jiraLive?.accessToken ? 'Reconnect Jira' : 'Connect Jira'}
            </button>
            {jiraLive && (
              <button className="btn ghost" type="button" onClick={() => disconnect('jira')}>
                Disconnect
              </button>
            )}
          </div>
          {jiraLive && (
            <dl className="connection-summary">
              <div>
                <dt>Status</dt>
                <dd>{jiraLive.accessToken ? 'Signed in with Atlassian' : 'Saved API token. Connect again to sign in.'}</dd>
              </div>
              <div>
                <dt>Site</dt>
                <dd>{jiraLive.siteUrl}</dd>
              </div>
              <div>
                <dt>Account</dt>
                <dd>{jiraLive.email || 'Available after sign-in'}</dd>
              </div>
              <div>
                <dt>Project</dt>
                <dd>{jiraLive.projectKey}</dd>
              </div>
            </dl>
          )}
        </section>
      ) : (
        <section className="card mcp-form">
          <div className="section-head">
            <h2>Azure</h2>
            <p>Use an Azure DevOps personal access token with Work Items read access.</p>
          </div>
          <div className="form-row">
            <label className="field">
              <span>Organization URL</span>
              <input
                value={azure.orgUrl}
                onChange={(event) => setAzure({ ...azure, orgUrl: event.target.value })}
                placeholder="https://dev.azure.com/your-org"
                autoComplete="off"
              />
            </label>
            <label className="field">
              <span>Project</span>
              <input
                value={azure.project}
                onChange={(event) => setAzure({ ...azure, project: event.target.value })}
                placeholder="Quality Engineering"
                autoComplete="off"
              />
            </label>
          </div>
          <label className="field">
            <span>Personal access token</span>
            <input
              type="password"
              value={azure.token}
              onChange={(event) => setAzure({ ...azure, token: event.target.value })}
              placeholder="Azure DevOps PAT"
              autoComplete="new-password"
            />
          </label>
          {error && <p className="form-error">{error}</p>}
          <div className="actions">
            <button className="btn primary" type="button" onClick={connectAzure}>
              {azureLive ? 'Update Azure connection' : 'Connect Azure'}
            </button>
            {azureLive && (
              <button className="btn ghost" type="button" onClick={() => disconnect('azure')}>
                Disconnect
              </button>
            )}
          </div>
          {azureLive && (
            <dl className="connection-summary">
              <div>
                <dt>Status</dt>
                <dd>Saved for the Azure MCP server</dd>
              </div>
              <div>
                <dt>Organization</dt>
                <dd>{azureLive.orgUrl}</dd>
              </div>
              <div>
                <dt>Project</dt>
                <dd>{azureLive.project}</dd>
              </div>
              <div>
                <dt>Token</dt>
                <dd>{maskSecret(azureLive.token)}</dd>
              </div>
            </dl>
          )}
        </section>
      )}
    </main>
  );
}
