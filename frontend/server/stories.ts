import type { AzureConnection, BoardStory, JiraConnection, McpProvider } from '../src/types';

type StoryRequest = {
  provider?: McpProvider;
  jira?: JiraConnection | null;
  azure?: AzureConnection | null;
};

type JiraIssue = {
  id?: string;
  key?: string;
  fields?: {
    summary?: string;
    description?: unknown;
    status?: { name?: string };
    issuetype?: { name?: string };
  };
};

export function adfToText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const record = node as { type?: string; text?: string; content?: unknown[] };
  if (record.type === 'text') return record.text ?? '';
  const joined = (record.content ?? []).map((child) => adfToText(child)).join('');
  if (record.type === 'paragraph' || record.type === 'heading' || record.type === 'listItem') {
    return `${joined}\n`;
  }
  return joined;
}

export function htmlToText(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function descriptionText(description: unknown): string {
  if (!description) return '';
  if (typeof description === 'string') return description.includes('<') ? htmlToText(description) : description.trim();
  return adfToText(description).trim();
}

function basicAuth(user: string, password: string): string {
  const bytes = new TextEncoder().encode(`${user}:${password}`);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function cleanToken(token: string): string {
  return token.trim().replace(/^(Bearer|Basic)\s+/i, '');
}

function tokenSuffix(token: string): string {
  const value = cleanToken(token);
  return value.length <= 4 ? '••••' : `••••${value.slice(-4)}`;
}

async function readError(response: Response): Promise<string> {
  const body = await response.text();
  try {
    const parsed = JSON.parse(body) as { message?: string; errorMessages?: string[] };
    const detail = parsed.errorMessages?.filter(Boolean).join(' ') || parsed.message;
    if (detail) return detail.slice(0, 220);
  } catch {
    // The body is not JSON.
  }
  return body.replace(/\s+/g, ' ').slice(0, 220);
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
  if (!response.ok) {
    const detail = await readError(response);
    throw new Error(`${response.status} ${response.statusText}${detail ? `: ${detail}` : ''}`);
  }
  return (await response.json()) as T;
}

function toJiraStory(issue: JiraIssue): BoardStory {
  return {
    id: issue.id || issue.key || '',
    key: issue.key || issue.id || 'JIRA',
    title: issue.fields?.summary || 'Untitled story',
    type: issue.fields?.issuetype?.name || 'Story',
    status: issue.fields?.status?.name || '',
    description: descriptionText(issue.fields?.description),
    source: 'jira',
  };
}

async function lookupCloudId(origin: string): Promise<string | null> {
  try {
    const response = await fetch(`${origin}/_edge/tenant_info`, {
      headers: { Accept: 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { cloudId?: string };
    return body.cloudId || null;
  } catch {
    return null;
  }
}

function isRetryable(error: unknown): boolean {
  return error instanceof Error && /^401\b|^403\b|^404\b/.test(error.message);
}

type JiraProject = { key?: string; name?: string };

async function listJiraProjects(base: string, headers: Record<string, string>): Promise<JiraProject[]> {
  const searched = await requestJson<{ values?: JiraProject[] }>(`${base}/rest/api/3/project/search?maxResults=100`, {
    headers,
  });
  return searched.values ?? [];
}

async function searchJiraIssues(base: string, headers: Record<string, string>, projectKey: string): Promise<JiraIssue[]> {
  const jql = `project = ${projectKey} ORDER BY updated DESC`;
  const searched = await requestJson<{ issues?: JiraIssue[] }>(`${base}/rest/api/3/search/jql`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jql,
      maxResults: 20,
      fields: ['summary', 'description', 'status', 'issuetype'],
    }),
  });
  return searched.issues ?? [];
}

export async function fetchJiraStories(connection: JiraConnection): Promise<BoardStory[]> {
  const origin = new URL(connection.siteUrl).origin;
  const email = connection.email.trim();
  const token = cleanToken(connection.token);
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
    throw new Error(
      'The API token field has this site’s cloud id, not an API token. Open id.atlassian.com, create an API token, and paste the value that starts with ATATT.',
    );
  }
  const cloudId = await lookupCloudId(origin);
  const bases = [cloudId ? `https://api.atlassian.com/ex/jira/${cloudId}` : null, origin].filter(
    (base): base is string => Boolean(base),
  );
  const failures: string[] = [];
  const authModes = [
    { name: 'basic', authorization: `Basic ${basicAuth(email, token)}` },
    { name: 'bearer', authorization: `Bearer ${token}` },
  ];

  for (const base of bases) {
    const modes = base.includes('api.atlassian.com') ? authModes : authModes.slice(0, 1);
    let signedIn = false;
    let headers: Record<string, string> = {};
    for (const mode of modes) {
      headers = {
        Authorization: mode.authorization,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      };
      try {
        await requestJson(`${base}/rest/api/3/myself`, { headers });
        signedIn = true;
        break;
      } catch (error) {
        const failure = error instanceof Error ? error : new Error('Jira request failed.');
        if (!isRetryable(failure)) throw failure;
        const where = base.includes('api.atlassian.com') ? 'Atlassian API' : 'site URL';
        failures.push(`${where} ${mode.name}: ${failure.message}`);
      }
    }
    if (!signedIn) continue;
    try {
      let projects: JiraProject[] = [];
      try {
        projects = await listJiraProjects(base, headers);
      } catch (error) {
        if (!isRetryable(error)) throw error;
        const issues = await searchJiraIssues(base, headers, connection.projectKey);
        return issues.map(toJiraStory).filter((story) => story.id || story.key);
      }
      const match = projects.find((project) => project.key?.toUpperCase() === connection.projectKey.toUpperCase());
      if (!match?.key) {
        const visible = projects
          .map((project) => (project.name ? `${project.key} (${project.name})` : project.key))
          .filter((label): label is string => Boolean(label))
          .slice(0, 12);
        throw new Error(
          visible.length
            ? `Jira is connected, but there is no project ${connection.projectKey}. This token can see: ${visible.join(', ')}.`
            : `Jira is connected, but this token cannot see any projects. Add the read:jira-work scope, and open project ${connection.projectKey} once in the browser with this same account.`,
        );
      }
      const issues = await searchJiraIssues(base, headers, match.key);
      return issues.map(toJiraStory).filter((story) => story.id || story.key);
    } catch (error) {
      const failure = error instanceof Error ? error : new Error('Jira request failed.');
      if (!isRetryable(failure)) throw failure;
      failures.push(failure.message);
    }
  }

  throw new Error(
    `Jira rejected the login for ${email} (token ${tokenSuffix(token)}). Open https://id.atlassian.com/manage-profile/profile and confirm that email is the address on the account. Then create a new API token there, choose ${origin}, include read:jira-work, and paste the full ATATT value into MCP. ${failures.join(' ')}`.trim(),
  );
}

function azureBase(orgUrl: string): { origin: string; org: string } {
  const url = new URL(orgUrl);
  if (url.hostname.endsWith('.visualstudio.com')) {
    return { origin: `${url.protocol}//${url.hostname}`, org: url.hostname.split('.')[0] ?? '' };
  }
  const org = url.pathname.split('/').filter(Boolean)[0] ?? '';
  return { origin: `${url.protocol}//${url.hostname}`, org };
}

export async function fetchAzureStories(connection: AzureConnection): Promise<BoardStory[]> {
  const { origin, org } = azureBase(connection.orgUrl);
  if (!org) throw new Error('Organization URL must include the Azure DevOps organization name.');
  const project = encodeURIComponent(connection.project);
  const headers = {
    Authorization: `Basic ${basicAuth('', connection.token)}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  const safeProject = connection.project.replace(/'/g, "''");
  const query = await requestJson<{ workItems?: { id: number }[] }>(
    `${origin}/${encodeURIComponent(org)}/${project}/_apis/wit/wiql?api-version=7.1`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${safeProject}' AND [System.WorkItemType] IN ('User Story', 'Product Backlog Item', 'Bug') ORDER BY [System.ChangedDate] DESC`,
      }),
    },
  );
  const ids = (query.workItems ?? []).slice(0, 20).map((item) => item.id);
  if (ids.length === 0) return [];
  const details = await requestJson<{
    value?: {
      id: number;
      fields?: Record<string, string>;
    }[];
  }>(
    `${origin}/${encodeURIComponent(org)}/${project}/_apis/wit/workitems?ids=${ids.join(',')}&fields=System.Id,System.Title,System.Description,System.State,System.WorkItemType&api-version=7.1`,
    { headers },
  );
  return (details.value ?? []).map((item) => ({
    id: String(item.id),
    key: `#${item.id}`,
    title: item.fields?.['System.Title'] || 'Untitled work item',
    type: item.fields?.['System.WorkItemType'] || 'User Story',
    status: item.fields?.['System.State'] || '',
    description: descriptionText(item.fields?.['System.Description']),
    source: 'azure' as const,
  }));
}

export async function fetchBoardStories(body: StoryRequest): Promise<BoardStory[]> {
  if (body.provider === 'azure') {
    if (!body.azure) throw new Error('Connect Azure in MCP before fetching stories.');
    return fetchAzureStories(body.azure);
  }
  if (!body.jira) throw new Error('Connect Jira in MCP before fetching stories.');
  return fetchJiraStories(body.jira);
}
