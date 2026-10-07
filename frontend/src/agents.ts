import type { AgentFile, AgentFileKind, AgentStage } from './types';

export const AGENT_FILE_KEY = 'tgs-agent-files-v1';

const NOW = '2026-10-07T00:00:00.000Z';

export const DEFAULT_AGENT_FILES: AgentFile[] = [
  {
    id: 'rule-intent',
    kind: 'rule',
    name: 'Intent agent',
    fileName: 'intent.mdc',
    agentId: 'intent',
    updatedAt: NOW,
    body: `---
description: Turn a plain-language prompt into a test flow
alwaysApply: true
---
# Intent agent
Read the prompt and list pages, actions, data, and the outcome to assert.
Do not invent steps the prompt did not ask for.
`,
  },
  {
    id: 'rule-locator',
    kind: 'rule',
    name: 'Locator agent',
    fileName: 'locator.mdc',
    agentId: 'locator',
    updatedAt: NOW,
    body: `---
description: Choose locators a user would recognize
alwaysApply: true
---
# Locator agent
Prefer getByRole, getByLabel, and getByTestId.
Do not use a fixed sleep to wait for the screen.
`,
  },
  {
    id: 'rule-spec',
    kind: 'rule',
    name: 'Spec agent',
    fileName: 'spec.mdc',
    agentId: 'spec',
    updatedAt: NOW,
    body: `---
description: Write the Playwright TypeScript spec and page object
alwaysApply: true
---
# Spec agent
Build a thin page object and a spec with test.step, typed locators, and web-first expects.
Keep secrets in the environment.
`,
  },
  {
    id: 'rule-review',
    kind: 'rule',
    name: 'Review agent',
    fileName: 'review.mdc',
    agentId: 'review',
    updatedAt: NOW,
    body: `---
description: Review the generated script before it is saved
alwaysApply: true
---
# Review agent
Fail the review when the script has a fixed sleep, no assertion, an untyped boundary, or a secret written into the file.
`,
  },
  {
    id: 'skill-flow',
    kind: 'skill',
    name: 'Flow from a prompt',
    fileName: 'flow-from-prompt.md',
    agentId: 'intent',
    updatedAt: NOW,
    body: `# Flow from a prompt
Split the prompt into open, act, and assert steps.
Keep the step order the same as the sentence the user wrote.
`,
  },
  {
    id: 'skill-locators',
    kind: 'skill',
    name: 'User-facing locators',
    fileName: 'user-facing-locators.md',
    agentId: 'locator',
    updatedAt: NOW,
    body: `# User-facing locators
Use the accessible name on buttons, links, and headings.
Agree a data-testid only when that name is unstable.
`,
  },
  {
    id: 'skill-page',
    kind: 'skill',
    name: 'Thin page objects',
    fileName: 'thin-page-objects.md',
    agentId: 'spec',
    updatedAt: NOW,
    body: `# Thin page objects
One class per screen. Locators are readonly fields. Actions are methods.
Assertions stay in the spec.
`,
  },
  {
    id: 'command-generate',
    kind: 'command',
    name: 'Generate script',
    fileName: 'generate-script.md',
    agentId: 'spec',
    updatedAt: NOW,
    body: `# Generate script
Run the intent, locator, spec, and review agents on the current prompt.
Save the spec, page object, and Playwright config.
`,
  },
  {
    id: 'command-update',
    kind: 'command',
    name: 'Update script',
    fileName: 'update-script.md',
    agentId: 'spec',
    updatedAt: NOW,
    body: `# Update script
Apply the follow-up to the saved script without dropping the checks that already passed.
`,
  },
  {
    id: 'command-fetch',
    kind: 'command',
    name: 'Fetch board',
    fileName: 'fetch-board.md',
    agentId: 'intent',
    updatedAt: NOW,
    body: `# Fetch board
Load the connected Jira or Azure stories and use the selected story as the prompt.
`,
  },
];

export function loadAgentFiles(): AgentFile[] {
  try {
    const raw = localStorage.getItem(AGENT_FILE_KEY);
    if (!raw) return DEFAULT_AGENT_FILES;
    const parsed = JSON.parse(raw) as AgentFile[];
    if (!Array.isArray(parsed) || parsed.some((file) => !file.id || !file.kind || !file.body)) return DEFAULT_AGENT_FILES;
    return parsed;
  } catch {
    return DEFAULT_AGENT_FILES;
  }
}

export function saveAgentFiles(files: AgentFile[]) {
  localStorage.setItem(AGENT_FILE_KEY, JSON.stringify(files));
}

export function summaryOf(body: string): string {
  const cleaned = body
    .replace(/^---[\s\S]*?---\s*/, '')
    .split(/\r?\n/)
    .map((item) => item.replace(/^#+\s*/, '').trim())
    .find((item) => item.length > 0);
  return (cleaned || '').slice(0, 180);
}

export function applyAgentFiles(stages: AgentStage[], files: AgentFile[]): AgentStage[] {
  return stages.map((stage) => {
    const rule = files.find((file) => file.kind === 'rule' && file.agentId === stage.id);
    if (!rule) return stage;
    const detail = summaryOf(rule.body);
    return { ...stage, name: rule.name || stage.name, detail: detail || stage.detail };
  });
}

export function parseAgentFile(fileName: string, raw: string): { name: string; body: string } {
  const front = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  let name = fileName.replace(/\.(md|mdc)$/i, '').replace(/[-_]+/g, ' ').trim();
  if (front) {
    const named = front[1].match(/^(?:name|description):\s*(.+)$/m);
    if (named?.[1]) name = named[1].trim().replace(/^["']|["']$/g, '');
  }
  return { name: name || 'Uploaded file', body: raw.trim() };
}

export function extensionFor(kind: AgentFileKind): string {
  return kind === 'rule' ? '.md or .mdc' : '.md';
}

export function acceptsFile(kind: AgentFileKind, fileName: string): boolean {
  const lower = fileName.toLowerCase();
  if (kind === 'rule') return lower.endsWith('.md') || lower.endsWith('.mdc');
  return lower.endsWith('.md');
}
