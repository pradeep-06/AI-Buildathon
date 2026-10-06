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

export async function fetchJiraStories(connection: JiraConnection): Promise<BoardStory[]> {
  const site = connection.siteUrl.replace(/\/$/, '');
  const headers = {
    Authorization: `Basic ${basicAuth(connection.email, connection.token)}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  let issues: JiraIssue[] = [];

  try {
    const boards = await requestJson<{ values?: { id: number }[] }>(
      `${site}/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(connection.projectKey)}&maxResults=1`,
      { headers },
    );
    const boardId = boards.values?.[0]?.id;
    if (boardId) {
      const page = await requestJson<{ issues?: JiraIssue[] }>(
        `${site}/rest/agile/1.0/board/${boardId}/issue?maxResults=20&fields=summary,description,status,issuetype`,
        { headers },
      );
      issues = page.issues ?? [];
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/^401\b|^403\b/.test(message)) throw new Error(`Jira rejected the connection. ${message}`);
  }

  if (issues.length === 0) {
    const searched = await requestJson<{ issues?: JiraIssue[] }>(`${site}/rest/api/3/search/jql`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jql: `project = ${connection.projectKey} ORDER BY updated DESC`,
        maxResults: 20,
        fields: ['summary', 'description', 'status', 'issuetype'],
      }),
    });
    issues = searched.issues ?? [];
  }

  return issues.map(toJiraStory).filter((story) => story.id || story.key);
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
