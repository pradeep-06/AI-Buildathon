export type ViewId = 'studio' | 'library' | 'agents' | 'practices';

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
