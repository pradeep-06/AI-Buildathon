import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BoardStory, JiraConnection } from '../src/types';
import { adfToText, htmlToText, StoryRequestError } from './stories';

const MCP_URL = 'https://mcp.atlassian.com/v1/mcp';
const AUTHORIZE_URL = 'https://mcp.atlassian.com/v1/authorize';
const TOKEN_URL = 'https://mcp.atlassian.com/v1/token';
const REGISTER_URL = 'https://mcp.atlassian.com/v1/register';
const COOKIE = 'tgs_jira_oauth';
const CLIENT_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', '.oauth', 'jira-mcp-client.json');

type PendingOauth = {
  state: string;
  verifier: string;
  siteUrl: string;
  projectKey: string;
};

type OauthToken = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
};

type McpClient = { clientId: string; redirectUri: string };

const clients = new Map<string, McpClient>();

function originOf(req: IncomingMessage): string {
  const host = req.headers.host || '127.0.0.1:5173';
  const forwarded = req.headers['x-forwarded-proto'];
  const proto = (Array.isArray(forwarded) ? forwarded[0] : forwarded) || 'http';
  return `${proto}://${host}`;
}

function redirectUri(req: IncomingMessage): string {
  return `${originOf(req)}/api/jira/callback`;
}

function queryOf(req: IncomingMessage): URLSearchParams {
  const raw = req.url || '';
  const query = raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : '';
  return new URLSearchParams(query);
}

function readCookie(req: IncomingMessage): PendingOauth | null {
  const header = req.headers.cookie || '';
  const part = header.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${COOKIE}=`));
  if (!part) return null;
  try {
    return JSON.parse(decodeURIComponent(part.slice(COOKIE.length + 1))) as PendingOauth;
  } catch {
    return null;
  }
}

function writeCookie(res: ServerResponse, pending: PendingOauth | null) {
  const cleared = `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
  if (!pending) {
    res.setHeader('Set-Cookie', cleared);
    return;
  }
  const value = encodeURIComponent(JSON.stringify(pending));
  res.setHeader('Set-Cookie', `${COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`);
}

async function registeredClient(redirect: string): Promise<McpClient> {
  const cached = clients.get(redirect);
  if (cached) return cached;
  try {
    const saved = JSON.parse(await readFile(CLIENT_FILE, 'utf8')) as McpClient;
    if (saved.clientId && saved.redirectUri === redirect) {
      clients.set(redirect, saved);
      return saved;
    }
  } catch {
    // The first sign-in registers a client for this browser address.
  }
  const response = await fetch(REGISTER_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'TGS Automation Studio',
    },
    body: JSON.stringify({
      client_name: 'TGS Automation Studio',
      redirect_uris: [redirect],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new StoryRequestError(`Atlassian did not start the sign-in. ${detail.slice(0, 180)}`);
  }
  const body = (await response.json()) as { client_id?: string };
  if (!body.client_id) throw new StoryRequestError('Atlassian did not return a sign-in client.');
  const client = { clientId: body.client_id, redirectUri: redirect };
  clients.set(redirect, client);
  await mkdir(dirname(CLIENT_FILE), { recursive: true });
  await writeFile(CLIENT_FILE, JSON.stringify(client));
  return client;
}

export function authorizeUrl(clientId: string, redirect: string, pending: PendingOauth): string {
  const challenge = createHash('sha256').update(pending.verifier).digest('base64url');
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirect);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', pending.state);
  url.searchParams.set('resource', MCP_URL);
  return url.toString();
}

export async function startJiraConnect(req: IncomingMessage, res: ServerResponse) {
  const query = queryOf(req);
  let site: URL;
  try {
    site = new URL(query.get('siteUrl')?.trim() || '');
  } catch {
    sendPage(res, 400, 'Enter the Jira site as https://your-team.atlassian.net.');
    return;
  }
  const projectKey = (query.get('projectKey') || '').trim().toUpperCase();
  if (site.protocol !== 'https:') {
    sendPage(res, 400, 'The Jira site URL must start with https://.');
    return;
  }
  if (!/^[A-Z][A-Z0-9_]+$/.test(projectKey)) {
    sendPage(res, 400, 'Project key should look like AVENGERS. It is the code in front of the issue number.');
    return;
  }
  const pending: PendingOauth = {
    state: randomBytes(16).toString('hex'),
    verifier: randomBytes(32).toString('base64url'),
    siteUrl: site.origin,
    projectKey,
  };
  let client: McpClient;
  try {
    client = await registeredClient(redirectUri(req));
  } catch (error) {
    sendPage(res, 400, error instanceof Error ? error.message : 'Atlassian did not start the sign-in.');
    return;
  }
  writeCookie(res, pending);
  res.statusCode = 302;
  res.setHeader('Location', authorizeUrl(client.clientId, client.redirectUri, pending));
  res.end();
}

async function exchangeToken(redirect: string, body: URLSearchParams): Promise<OauthToken> {
  const client = await registeredClient(redirect);
  body.set('client_id', client.clientId);
  body.set('resource', MCP_URL);
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'TGS Automation Studio',
    },
    body,
  });
  const payload = (await response.json().catch(() => ({}))) as OauthToken & { error_description?: string; error?: string };
  if (!response.ok || !payload.access_token) {
    throw new StoryRequestError(
      `Atlassian did not complete the sign-in. ${payload.error_description || payload.error || response.statusText}`,
      response.status || 400,
    );
  }
  return payload;
}

export async function finishJiraConnect(req: IncomingMessage, res: ServerResponse) {
  const query = queryOf(req);
  const pending = readCookie(req);
  writeCookie(res, null);
  const oauthError = query.get('error_description') || query.get('error');
  if (oauthError) {
    sendPage(res, 400, `Atlassian did not complete the sign-in. ${oauthError}`);
    return;
  }
  if (!pending || pending.state !== query.get('state') || !query.get('code')) {
    sendPage(res, 400, 'The Jira sign-in expired. Go back to MCP and click Connect Jira again.');
    return;
  }
  try {
    const token = await exchangeToken(redirectUri(req), new URLSearchParams({
      grant_type: 'authorization_code',
      code: query.get('code') || '',
      redirect_uri: redirectUri(req),
      code_verifier: pending.verifier,
    }));
    const connection = await connectionFromToken(token, pending.siteUrl, pending.projectKey);
    sendStoredPage(res, connection);
  } catch (error) {
    sendPage(res, error instanceof StoryRequestError ? error.status : 400, error instanceof Error ? error.message : 'Atlassian did not complete the sign-in.');
  }
}

function connectionFromToken(token: OauthToken, siteUrl: string, projectKey: string, previous?: JiraConnection): Promise<JiraConnection> {
  const drafted: JiraConnection = {
    siteUrl,
    email: previous?.email || '',
    projectKey,
    connectedAt: new Date().toISOString(),
    accessToken: token.access_token,
    refreshToken: token.refresh_token || previous?.refreshToken,
    expiresAt: new Date(Date.now() + (token.expires_in || 3600) * 1000).toISOString(),
    cloudId: previous?.cloudId,
  };
  return enrichConnection(drafted);
}

async function enrichConnection(connection: JiraConnection): Promise<JiraConnection> {
  const session = await openMcp(connection.accessToken || '');
  const resources = asResources(await session.tool('getAccessibleAtlassianResources', {}));
  const wanted = new URL(connection.siteUrl).host;
  const match = resources.find((resource) => resource.url.includes(wanted)) || (resources.length === 1 ? resources[0] : undefined);
  if (!match) {
    const visible = resources.map((resource) => resource.url).slice(0, 6).join(', ');
    throw new StoryRequestError(
      visible
        ? `Atlassian signed in, but ${connection.siteUrl} was not in the approved sites. Approved sites: ${visible}.`
        : 'Atlassian signed in, but no Jira site was approved.',
    );
  }
  let email = connection.email;
  try {
    email = findEmail(await session.tool('atlassianUserInfo', {})) || email;
  } catch {
    email = email || 'Atlassian account';
  }
  return {
    ...connection,
    siteUrl: match.url.replace(/\/$/, ''),
    email: email || 'Atlassian account',
    cloudId: match.id,
  };
}

export async function fetchJiraOauthStories(connection: JiraConnection): Promise<{ stories: BoardStory[]; jira: JiraConnection }> {
  let current = connection;
  if (!current.accessToken || !current.refreshToken) {
    throw new StoryRequestError('Connect Jira from the MCP page and finish the Atlassian sign-in.', 401);
  }
  if (current.expiresAt && Date.parse(current.expiresAt) < Date.now() + 60_000) {
    current = await refreshJiraConnection(current);
  }
  try {
    const stories = await loadOauthStories(current);
    return { stories, jira: current };
  } catch (error) {
    if (!(error instanceof StoryRequestError) || error.status !== 401) throw error;
    current = await refreshJiraConnection(current);
    return { stories: await loadOauthStories(current), jira: current };
  }
}

async function refreshJiraConnection(connection: JiraConnection): Promise<JiraConnection> {
  if (!connection.refreshToken) throw new StoryRequestError('The Jira sign-in expired. Connect again from MCP.', 401);
  const saved = await readSavedClient();
  if (!saved) throw new StoryRequestError('The Jira sign-in expired. Connect again from MCP.', 401);
  const token = await exchangeToken(saved.redirectUri, new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: connection.refreshToken,
  }));
  return connectionFromToken(token, connection.siteUrl, connection.projectKey, connection);
}

async function readSavedClient(): Promise<McpClient | null> {
  try {
    const saved = JSON.parse(await readFile(CLIENT_FILE, 'utf8')) as McpClient;
    return saved.clientId && saved.redirectUri ? saved : null;
  } catch {
    return null;
  }
}

async function loadOauthStories(connection: JiraConnection): Promise<BoardStory[]> {
  const session = await openMcp(connection.accessToken || '');
  const cloudId = connection.cloudId || connection.siteUrl;
  const jql = `project = "${connection.projectKey.replace(/"/g, '')}" ORDER BY updated DESC`;
  const searched = await session.tool('searchJiraIssuesUsingJql', {
    cloudId,
    jql,
    maxResults: 20,
    fields: ['summary', 'description', 'status', 'issuetype'],
  });
  const stories = storiesFromMcp(searched).slice(0, 20);
  const thin = stories.filter((story) => !story.description);
  if (thin.length === 0) return stories;
  const detailed = await Promise.all(stories.map(async (story) => {
    if (story.description) return story;
    try {
      const issue = await session.tool('getJiraIssue', {
        cloudId,
        issueIdOrKey: story.key,
        fields: ['summary', 'description', 'status', 'issuetype'],
      });
      return storiesFromMcp(issue)[0] || story;
    } catch {
      return story;
    }
  }));
  return detailed;
}

type Rpc = { result?: unknown; error?: { message?: string; code?: number } };

class McpSession {
  private sessionId = '';
  private nextId = 1;
  private readonly token: string;

  constructor(token: string) {
    this.token = token;
  }

  async init() {
    await this.post('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'TGS Automation Studio', version: '0.1.0' },
    });
    await this.post('notifications/initialized', {}, true);
  }

  async tool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await this.post('tools/call', { name, arguments: args });
    return unwrapTool(result);
  }

  private async post(method: string, params: unknown, notification = false): Promise<unknown> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      'MCP-Protocol-Version': '2025-03-26',
      'User-Agent': 'TGS Automation Studio',
    };
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
    const response = await fetch(MCP_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(notification
        ? { jsonrpc: '2.0', method, params }
        : { jsonrpc: '2.0', id: this.nextId++, method, params }),
    });
    const sessionId = response.headers.get('mcp-session-id');
    if (sessionId) this.sessionId = sessionId;
    if (notification) {
      await response.text();
      return null;
    }
    const rpc = await readRpc(response);
    if (rpc.error) {
      const status = response.status === 401 || rpc.error.code === 401 ? 401 : 400;
      throw new StoryRequestError(rpc.error.message || 'Jira MCP request failed.', status);
    }
    return rpc.result;
  }
}

async function openMcp(token: string): Promise<McpSession> {
  const session = new McpSession(token);
  await session.init();
  return session;
}

async function readRpc(response: Response): Promise<Rpc> {
  const text = await response.text();
  if (response.status === 401) throw new StoryRequestError('Jira sign-in was refused. Connect again from MCP.', 401);
  const payload = text.includes('data:')
    ? text.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).filter(Boolean).at(-1) || ''
    : text;
  if (!response.ok) throw new StoryRequestError(payload.slice(0, 240) || response.statusText, response.status);
  try {
    return JSON.parse(payload) as Rpc;
  } catch {
    throw new StoryRequestError('Jira returned a response Studio could not read.');
  }
}

function unwrapTool(result: unknown): unknown {
  if (!result || typeof result !== 'object') return result;
  const record = result as { isError?: boolean; structuredContent?: unknown; content?: { type?: string; text?: string }[] };
  const text = (record.content || []).map((item) => item.text || '').filter(Boolean).join('\n');
  if (record.isError) throw new StoryRequestError(text || 'Jira could not load the stories.');
  if (record.structuredContent !== undefined) return record.structuredContent;
  if (!text) return result;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

type Resource = { id: string; url: string };

function asResources(value: unknown): Resource[] {
  const found: Resource[] = [];
  walk(value);
  return found;

  function walk(node: unknown) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const record = node as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id : typeof record.cloudId === 'string' ? record.cloudId : '';
    const url = typeof record.url === 'string' ? record.url : typeof record.siteUrl === 'string' ? record.siteUrl : '';
    if (id && url.includes('atlassian.net')) found.push({ id, url });
    Object.values(record).forEach(walk);
  }
}

function findEmail(value: unknown): string {
  const emails: string[] = [];
  walk(value);
  return emails[0] || '';

  function walk(node: unknown) {
    if (typeof node === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(node)) emails.push(node);
    else if (node && typeof node === 'object') Object.values(node as Record<string, unknown>).forEach(walk);
  }
}

function textValue(value: unknown): string {
  if (typeof value === 'string') return value.includes('<') ? htmlToText(value) : value.trim();
  if (!value || typeof value !== 'object') return '';
  const record = value as { name?: unknown };
  if (typeof record.name === 'string') return record.name;
  return adfToText(value).trim();
}

export function storiesFromMcp(value: unknown): BoardStory[] {
  if (typeof value === 'string') return storiesFromText(value);
  const found: BoardStory[] = [];
  const seen = new Set<string>();
  const visited = new Set<unknown>();
  walk(value);
  return found;

  function walk(node: unknown) {
    if (!node || typeof node !== 'object' || visited.has(node)) return;
    visited.add(node);
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const record = node as Record<string, unknown>;
    const story = asStory(record);
    if (story && !seen.has(story.key)) {
      seen.add(story.key);
      found.push(story);
    }
    Object.values(record).forEach(walk);
  }
}

function storiesFromText(value: string): BoardStory[] {
  return value.split('\n').flatMap((line) => {
    const match = line.match(/\b([A-Z][A-Z0-9_]+-\d+)\b\s*[:\-|]?\s*(.*)$/);
    if (!match) return [];
    const title = match[2].trim();
    if (title.length < 3) return [];
    return [{
      id: match[1],
      key: match[1],
      title,
      type: 'Story',
      status: '',
      description: '',
      source: 'jira' as const,
    }];
  });
}

function asStory(record: Record<string, unknown>): BoardStory | null {
  const fields = record.fields && typeof record.fields === 'object' ? record.fields as Record<string, unknown> : {};
  const key = textValue(record.key) || textValue(fields.key);
  if (!/^[A-Z][A-Z0-9_]+-\d+$/.test(key)) return null;
  const title = textValue(fields.summary) || textValue(record.summary) || textValue(record.title) || 'Untitled story';
  if (title === 'Untitled story' && !record.fields && !record.id) return null;
  const id = textValue(record.id) || key;
  return {
    id,
    key,
    title,
    type: textValue(fields.issuetype) || textValue(fields.issueType) || textValue(record.issuetype) || textValue(record.issueType) || 'Story',
    status: textValue(fields.status) || textValue(record.status),
    description: textValue(fields.description) || textValue(record.description),
    source: 'jira',
  };
}

function sendPage(res: ServerResponse, status: number, message: string) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><title>Jira sign-in</title><p>${escapeHtml(message)}</p><p><a href="/">Back to Automation Studio</a></p>`);
}

function sendStoredPage(res: ServerResponse, connection: JiraConnection) {
  const payload = JSON.stringify(connection).replace(/</g, '\\u003c');
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(`<!doctype html><title>Jira connected</title><p>Saving the Jira sign-in in this browser.</p>
<script id="jira-connection" type="application/json">${payload}</script>
<script>
const jira = JSON.parse(document.getElementById('jira-connection').textContent);
const key = 'tgs-mcp-connections-v1';
const current = JSON.parse(localStorage.getItem(key) || '{"jira":null,"azure":null}');
current.jira = jira;
localStorage.setItem(key, JSON.stringify(current));
sessionStorage.setItem('tgs-open-view', 'mcp');
sessionStorage.setItem('tgs-mcp-notice', 'Jira sign-in saved in this browser.');
location.replace('/');
</script>`);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] || char);
}
