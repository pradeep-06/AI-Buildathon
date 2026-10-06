export type ViewId = 'studio' | 'library' | 'agents' | 'practices' | 'mcp';

export type McpProvider = 'jira' | 'azure';

export type JiraConnection = {
  siteUrl: string;
  email: string;
  token: string;
  projectKey: string;
  connectedAt: string;
};

export type AzureConnection = {
  orgUrl: string;
  project: string;
  token: string;
  connectedAt: string;
};

export type McpConnections = {
  jira: JiraConnection | null;
  azure: AzureConnection | null;
};

export type ScriptFile = 'spec' | 'page' | 'config';

export type ReviewCheck = {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
};

export type GeneratedScript = {
  id: string;
  title: string;
  prompt: string;
  baseUrl: string;
  browser: string;
  level: string;
  spec: string;
  pageObject: string;
  config: string;
  checks: ReviewCheck[];
  createdAt: string;
  updatedAt: string;
};

export type AgentStage = {
  id: string;
  name: string;
  role: string;
  detail: string;
};
