import type { AzureConnection, JiraConnection, McpConnections } from './types';

export const MCP_STORAGE_KEY = 'tgs-mcp-connections-v1';

export const EMPTY_CONNECTIONS: McpConnections = { jira: null, azure: null };

export function loadConnections(): McpConnections {
  try {
    const raw = localStorage.getItem(MCP_STORAGE_KEY);
    if (!raw) return EMPTY_CONNECTIONS;
    const parsed = JSON.parse(raw) as Partial<McpConnections>;
    return {
      jira: parsed.jira ?? null,
      azure: parsed.azure ?? null,
    };
  } catch {
    return EMPTY_CONNECTIONS;
  }
}

export function saveConnections(connections: McpConnections) {
  localStorage.setItem(MCP_STORAGE_KEY, JSON.stringify(connections));
}

export function maskSecret(value: string): string {
  if (value.length <= 4) return '••••';
  return `••••${value.slice(-4)}`;
}

export function validateJira(input: Omit<JiraConnection, 'connectedAt'>): string | null {
  let site: URL;
  try {
    site = new URL(input.siteUrl.trim());
  } catch {
    return 'Enter a full Jira site URL, including https://.';
  }
  if (site.protocol !== 'https:') return 'Jira site URL must start with https://.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) return 'Enter the Atlassian account email.';
  if (input.token.trim().length < 8) return 'Enter the Jira API token.';
  if (!/^[A-Z][A-Z0-9_]+$/.test(input.projectKey.trim())) {
    return 'Project key should look like QA or BUILD.';
  }
  return null;
}

export function validateAzure(input: Omit<AzureConnection, 'connectedAt'>): string | null {
  let org: URL;
  try {
    org = new URL(input.orgUrl.trim());
  } catch {
    return 'Enter the Azure DevOps organization URL, including https://.';
  }
  if (org.protocol !== 'https:') return 'Organization URL must start with https://.';
  if (!input.project.trim()) return 'Enter the Azure DevOps project name.';
  if (input.token.trim().length < 8) return 'Enter the personal access token.';
  return null;
}
