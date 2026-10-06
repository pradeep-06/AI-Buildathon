import { useState } from 'react';
import { maskSecret, validateAzure, validateJira } from './mcp';
import type { AzureConnection, JiraConnection, McpConnections, McpProvider } from './types';

type JiraDraft = Omit<JiraConnection, 'connectedAt'>;
type AzureDraft = Omit<AzureConnection, 'connectedAt'>;

const EMPTY_JIRA: JiraDraft = { siteUrl: '', email: '', token: '', projectKey: '' };
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
  const [jira, setJira] = useState<JiraDraft>(connections.jira ?? EMPTY_JIRA);
  const [azure, setAzure] = useState<AzureDraft>(connections.azure ?? EMPTY_AZURE);
  const [error, setError] = useState('');

  function selectProvider(next: McpProvider) {
    setProvider(next);
    setError('');
  }

  function connectJira() {
    const draft = {
      siteUrl: jira.siteUrl.trim(),
      email: jira.email.trim(),
      token: jira.token.trim(),
      projectKey: jira.projectKey.trim().toUpperCase(),
    };
    const problem = validateJira(draft);
    if (problem) {
      setError(problem);
      return;
    }
    onChange({
      ...connections,
      jira: { ...draft, connectedAt: new Date().toISOString() },
    });
    setJira(draft);
    setError('');
    onNotice('Jira MCP connection saved.');
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
              Use the Atlassian account email and an API token from id.atlassian.com. The site URL is
              https://your-team.atlassian.net. A scoped token needs the read:jira-work scope.
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
                placeholder="QA"
                autoComplete="off"
              />
            </label>
          </div>
          <div className="form-row">
            <label className="field">
              <span>Email</span>
              <input
                type="email"
                value={jira.email}
                onChange={(event) => setJira({ ...jira, email: event.target.value })}
                placeholder="you@teksystems.com"
                autoComplete="off"
              />
            </label>
            <label className="field">
              <span>API token</span>
              <input
                type="password"
                value={jira.token}
                onChange={(event) => setJira({ ...jira, token: event.target.value })}
                placeholder="Atlassian API token"
                autoComplete="new-password"
              />
            </label>
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="actions">
            <button className="btn primary" type="button" onClick={connectJira}>
              {jiraLive ? 'Update Jira connection' : 'Connect Jira'}
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
                <dd>Saved for the Jira MCP server</dd>
              </div>
              <div>
                <dt>Site</dt>
                <dd>{jiraLive.siteUrl}</dd>
              </div>
              <div>
                <dt>Account</dt>
                <dd>{jiraLive.email}</dd>
              </div>
              <div>
                <dt>Token</dt>
                <dd>{maskSecret(jiraLive.token)}</dd>
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
