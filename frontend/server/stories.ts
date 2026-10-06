import type { AzureConnection, BoardStory, JiraConnection, McpProvider } from '../src/types';

type StoryRequest = {
  provider?: McpProvider;
  jira?: JiraConnection | null;
  azure?: AzureConnection | null;
};

type JiraIssue = {
  id?: string | number;
  key?: string;
  fields?: {
    summary?: string;
    description?: unknown;
    status?: { name?: string } | string;
    issuetype?: { name?: string } | string;
  };
  renderedFields?: {
    description?: string;
  };
};

export function adfToText(node: unknown): string {
  if (typeof node === 'string') return node;
  if (!node || typeof node !== 'object') return '';
  const record = node as {
    type?: string;
    text?: string;
    content?: unknown;
    attrs?: { text?: string; shortName?: string; url?: string; alt?: string };
  };
  if (record.type === 'text') return record.text ?? '';
  if (record.type === 'hardBreak') return '\n';
  if (record.type === 'mention') return record.attrs?.text ? `@${record.attrs.text}` : '';
  if (record.type === 'emoji') return record.attrs?.shortName ?? '';
  if (record.type === 'inlineCard' || record.type === 'blockCard') return record.attrs?.url ?? '';
  if (record.type === 'media') return record.attrs?.alt ?? '';
  const joined = Array.isArray(record.content) ? record.content.map((child) => adfToText(child)).join('') : '';
  if (record.type === 'paragraph' || record.type === 'heading' || record.type === 'codeBlock' || record.type === 'blockquote') {
    return `${joined}\n`;
  }
  if (record.type === 'listItem') return `${joined.trim()}\n`;
  if (record.type === 'tableCell' || record.type === 'tableHeader') return `${joined}\t`;
  if (record.type === 'tableRow' || record.type === 'bulletList' || record.type === 'orderedList') return `${joined}\n`;
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
    const parsed = JSON.parse(body) as {
      message?: string;
      errorMessages?: string[];
      errors?: Record<string, string> | { message?: string }[];
    };
    const fieldErrors = Array.isArray(parsed.errors)
      ? parsed.errors.map((item) => item.message ?? '')
      : Object.values(parsed.errors ?? {});
    const detail = [...(parsed.errorMessages ?? []), ...fieldErrors, parsed.message ?? ''].filter(Boolean).join(' ');
    if (detail) return detail.replace(/\s+/g, ' ').slice(0, 400);
  } catch {
    // The body is not JSON.
  }
  return body.replace(/\s+/g, ' ').slice(0, 400);
}

export class StoryRequestError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
  if (!response.ok) {
    const detail = await readError(response);
    throw new StoryRequestError(`${response.status} ${response.statusText}${detail ? `: ${detail}` : ''}`, response.status);
  }
  return (await response.json()) as T;
}

function namedField(value: { name?: string } | string | undefined): string {
  if (!value) return '';
  return typeof value === 'string' ? value : value.name ?? '';
}

function storyDescription(issue: JiraIssue): string {
  const plain = descriptionText(issue.fields?.description);
  if (plain) return plain;
  return issue.renderedFields?.description ? htmlToText(issue.renderedFields.description) : '';
}

function toJiraStory(issue: JiraIssue): BoardStory {
  const id = issue.id == null ? '' : String(issue.id);
  return {
    id: id || issue.key || '',
    key: issue.key || id || 'JIRA',
    title: issue.fields?.summary || 'Untitled story',
    type: namedField(issue.fields?.issuetype) || 'Story',
    status: namedField(issue.fields?.status),
    description: storyDescription(issue),
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

const STORY_FIELDS = ['summary', 'description', 'status', 'issuetype'];

function projectJql(projectKey: string): string {
  const key = projectKey.trim().replace(/"/g, '');
  return `project = "${key}" ORDER BY updated DESC`;
}

function issueRef(issue: JiraIssue): string {
  if (issue.key) return issue.key;
  if (issue.id == null || issue.id === '') return '';
  return String(issue.id);
}

function hasSummary(issue: JiraIssue): boolean {
  return Boolean(issue.fields?.summary);
}

async function postJql(
  base: string,
  headers: Record<string, string>,
  jql: string,
  fields: string[],
  fieldsByKeys = true,
): Promise<JiraIssue[]> {
  const searched = await requestJson<{ issues?: JiraIssue[] }>(`${base}/rest/api/3/search/jql`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jql,
      maxResults: 20,
      fields,
      ...(fieldsByKeys ? { fieldsByKeys: true } : {}),
    }),
  });
  return searched.issues ?? [];
}

function mergeIssue(base: JiraIssue, detail?: JiraIssue): JiraIssue {
  if (!detail) return base;
  return {
    ...base,
    ...detail,
    key: detail.key || base.key,
    id: detail.id || base.id,
    fields: { ...base.fields, ...detail.fields },
    renderedFields: { ...base.renderedFields, ...detail.renderedFields },
  };
}

function indexIssues(list: JiraIssue[]): Map<string, JiraIssue> {
  const map = new Map<string, JiraIssue>();
  for (const issue of list) {
    if (issue.key) map.set(issue.key, issue);
    if (issue.id != null && issue.id !== '') map.set(String(issue.id), issue);
  }
  return map;
}

async function enrichJiraIssues(base: string, headers: Record<string, string>, issues: JiraIssue[]): Promise<JiraIssue[]> {
  const ids = issues.map(issueRef).filter(Boolean);
  if (ids.length === 0) return issues;
  const failures: string[] = [];
  try {
    const bulk = await requestJson<{ issues?: JiraIssue[]; issueErrors?: { errorMessage?: string }[] }>(
      `${base}/rest/api/3/issue/bulkfetch`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          issueIdsOrKeys: ids,
          fields: STORY_FIELDS,
          fieldsByKeys: true,
        }),
      },
    );
    const byRef = indexIssues(bulk.issues ?? []);
    const merged = issues.map((issue) => mergeIssue(issue, byRef.get(issueRef(issue))));
    for (const item of bulk.issueErrors ?? []) {
      if (item.errorMessage) failures.push(item.errorMessage);
    }
    if (merged.some(hasSummary)) return merged;
  } catch (error) {
    failures.push(error instanceof Error ? error.message : 'Bulk fetch failed.');
  }

  const detailed = await Promise.all(
    issues.map(async (issue) => {
      const id = issueRef(issue);
      if (!id) return issue;
      try {
        const full = await requestJson<JiraIssue>(
          `${base}/rest/api/3/issue/${encodeURIComponent(id)}?fields=${STORY_FIELDS.join(',')}&expand=renderedFields`,
          { headers },
        );
        return mergeIssue(issue, full);
      } catch (error) {
        failures.push(error instanceof Error ? error.message : 'Issue fetch failed.');
        return issue;
      }
    }),
  );
  if (detailed.some(hasSummary) || issues.some(hasSummary)) return detailed.some(hasSummary) ? detailed : issues;
  const reason = [...new Set(failures)].slice(0, 3).join(' ');
  throw new Error(
    reason
      ? `Jira returned the story list, but the story details were rejected. ${reason}`
      : 'Jira returned the story list, but the story details were empty.',
  );
}

function visibleProjects(projects: JiraProject[]): string[] {
  return projects
    .map((project) => (project.name ? `${project.key} (${project.name})` : project.key))
    .filter((label): label is string => Boolean(label))
    .slice(0, 12);
}

async function loadJiraStories(base: string, headers: Record<string, string>, connection: JiraConnection): Promise<BoardStory[]> {
  const wanted = connection.projectKey.trim();
  let projects: JiraProject[] = [];
  try {
    projects = await listJiraProjects(base, headers);
  } catch (error) {
    if (!isRetryable(error)) throw error;
  }
  const match = projects.find(
    (project) =>
      project.key?.toUpperCase() === wanted.toUpperCase() || project.name?.trim().toUpperCase() === wanted.toUpperCase(),
  );
  const storiesFrom = async (projectKey: string) => {
    const issues = await searchJiraIssues(base, headers, projectKey);
    return issues.map(toJiraStory).filter((story) => story.id || story.key);
  };
  if (match?.key) return storiesFrom(match.key);
  try {
    return await storiesFrom(wanted);
  } catch (error) {
    const failure = error instanceof Error ? error : new Error('Jira request failed.');
    const visible = visibleProjects(projects);
    if (/^401\b|^403\b|^404\b/.test(failure.message) || failure.message.includes('story details')) throw failure;
    throw new Error(
      visible.length
        ? `Jira is connected, but there is no project ${wanted}. This token can see: ${visible.join(', ')}.`
        : `Jira is connected, but this token cannot see project ${wanted}. ${failure.message}`,
    );
  }
}

async function searchJiraIssues(base: string, headers: Record<string, string>, projectKey: string): Promise<JiraIssue[]> {
  const jql = projectJql(projectKey);
  const attempts: { fields: string[]; fieldsByKeys: boolean }[] = [
    { fields: STORY_FIELDS, fieldsByKeys: true },
    { fields: ['summary', 'status', 'issuetype'], fieldsByKeys: false },
    { fields: ['summary'], fieldsByKeys: false },
  ];
  let lastError: Error | null = null;
  for (const attempt of attempts) {
    try {
      const issues = await postJql(base, headers, jql, attempt.fields, attempt.fieldsByKeys);
      if (issues.length > 0 && issues.some((issue) => !hasSummary(issue))) return enrichJiraIssues(base, headers, issues);
      return issues;
    } catch (error) {
      if (!(error instanceof Error) || !/^400\b/.test(error.message)) throw error;
      lastError = error;
    }
  }
  throw lastError ?? new StoryRequestError('Jira rejected the story search.');
}

function isAuthFailure(error: unknown): boolean {
  return error instanceof Error && /^401\b|^403\b/.test(error.message);
}

export async function fetchJiraStories(connection: JiraConnection): Promise<BoardStory[]> {
  const origin = new URL(connection.siteUrl).origin;
  const email = connection.email.trim();
  const token = cleanToken(connection.token).replace(/\s+/g, '');
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
    throw new StoryRequestError(
      'The API token field has this site’s cloud id, not an API token. Open id.atlassian.com, create an API token, and paste the value that starts with ATATT.',
    );
  }
  const cloudId = await lookupCloudId(origin);
  const bases = [cloudId ? `https://api.atlassian.com/ex/jira/${cloudId}` : null, origin].filter(
    (base): base is string => Boolean(base),
  );
  const failures: string[] = [];
  const headers = {
    Authorization: `Basic ${basicAuth(email, token)}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  for (const base of bases) {
    const where = base.includes('api.atlassian.com') ? 'Atlassian API' : 'site URL';
    if (where === 'site URL') {
      try {
        await requestJson(`${base}/rest/api/3/myself`, { headers });
      } catch (error) {
        const failure = error instanceof Error ? error : new Error('Jira request failed.');
        if (!isAuthFailure(failure) && !isRetryable(failure)) throw failure;
        failures.push(`${where}: ${failure.message}`);
        continue;
      }
    }
    try {
      return await loadJiraStories(base, headers, connection);
    } catch (error) {
      const failure = error instanceof Error ? error : new Error('Jira request failed.');
      if (!isAuthFailure(failure) && !isRetryable(failure)) throw failure;
      failures.push(`${where}: ${failure.message}`);
    }
  }

  const tokenNote = token.startsWith('ATATT')
    ? `The full API token was sent (${tokenSuffix(token)}).`
    : `The saved token does not start with ATATT (${tokenSuffix(token)}).`;
  throw new StoryRequestError(
    `Jira refused ${email} for ${origin}. ${tokenNote} Sign in at https://id.atlassian.com/manage-profile/security/api-tokens as that same email, create a token for this Jira site, and include read:jira-work. ${failures.join(' ')}`.trim(),
    401,
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
