import { useEffect, useMemo, useState } from 'react';
import { AGENT_STAGES, PRACTICES, SAMPLE_PROMPTS } from './data';
import { generateScript } from './lib/generateScript';
import { HighlightedCode } from './lib/highlight';
import { loadConnections, saveConnections } from './mcp';
import { McpView } from './McpView';
import type { GeneratedScript, McpConnections, ViewId } from './types';

type PanelId = 'spec' | 'page' | 'config' | 'review';

const STORAGE_KEY = 'tgs-automation-studio-v1';

const NAV: { id: ViewId; label: string; hint: string }[] = [
  { id: 'studio', label: 'Studio', hint: 'Prompt to script' },
  { id: 'library', label: 'Scripts', hint: 'Saved flows' },
  { id: 'agents', label: 'Agents', hint: 'Who writes the code' },
  { id: 'practices', label: 'Practices', hint: 'Playwright + TS' },
  { id: 'mcp', label: 'MCP', hint: 'Jira · Azure' },
];

function loadScripts(): GeneratedScript[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as GeneratedScript[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function fileBody(script: GeneratedScript, file: Exclude<PanelId, 'review'>): string {
  if (file === 'page') return script.pageObject;
  if (file === 'config') return script.config;
  return script.spec;
}

function fileName(file: Exclude<PanelId, 'review'>): string {
  if (file === 'page') return 'flow.page.ts';
  if (file === 'config') return 'playwright.config.ts';
  return 'flow.spec.ts';
}

export function App() {
  const [view, setView] = useState<ViewId>('studio');
  const [scripts, setScripts] = useState<GeneratedScript[]>(() => loadScripts());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState(SAMPLE_PROMPTS[0]);
  const [baseUrl, setBaseUrl] = useState('https://www.saucedemo.com');
  const [browser, setBrowser] = useState('chromium');
  const [level, setLevel] = useState('smoke');
  const [panel, setPanel] = useState<PanelId>('spec');
  const [running, setRunning] = useState(false);
  const [stageIndex, setStageIndex] = useState(-1);
  const [notice, setNotice] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [connections, setConnections] = useState<McpConnections>(() => loadConnections());

  const active = scripts.find((script) => script.id === activeId) ?? null;

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scripts));
  }, [scripts]);

  useEffect(() => {
    saveConnections(connections);
  }, [connections]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 2400);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const passedCount = active?.checks.filter((check) => check.passed).length ?? 0;

  async function runAgents(mode: 'create' | 'update') {
    const source = mode === 'update' ? followUp.trim() : prompt.trim();
    if (!source) {
      setNotice('Describe the flow first.');
      return;
    }
    if (mode === 'update' && !active) {
      setNotice('Generate a script before asking for an update.');
      return;
    }

    setRunning(true);
    setView('studio');
    setPanel('spec');
    for (let index = 0; index < AGENT_STAGES.length; index += 1) {
      setStageIndex(index);
      await new Promise((resolve) => window.setTimeout(resolve, 420));
    }

    const next = generateScript({
      prompt: source,
      baseUrl,
      browser,
      level,
      previous: mode === 'update' ? active ?? undefined : undefined,
    });
    setScripts((current) => {
      const without = current.filter((script) => script.id !== next.id);
      return [next, ...without];
    });
    setActiveId(next.id);
    setStageIndex(AGENT_STAGES.length);
    setRunning(false);
    setFollowUp('');
    setNotice(mode === 'update' ? 'Script updated from your follow-up.' : 'Playwright script is ready.');
  }

  function openScript(script: GeneratedScript) {
    setActiveId(script.id);
    setPrompt(script.prompt);
    setBaseUrl(script.baseUrl);
    setBrowser(script.browser);
    setLevel(script.level);
    setPanel('spec');
    setView('studio');
    setStageIndex(AGENT_STAGES.length);
  }

  const codePanel: Exclude<PanelId, 'review'> = panel === 'review' ? 'spec' : panel;

  async function copyActive() {
    if (!active) return;
    await navigator.clipboard.writeText(fileBody(active, codePanel));
    setNotice(`Copied ${fileName(codePanel)}.`);
  }

  function downloadActive() {
    if (!active) return;
    const blob = new Blob([fileBody(active, codePanel)], { type: 'text/typescript' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName(codePanel);
    link.click();
    URL.revokeObjectURL(url);
    setNotice(`Downloaded ${fileName(codePanel)}.`);
  }

  const libraryCount = scripts.length;
  const stageLabel = useMemo(() => {
    if (running && stageIndex >= 0 && stageIndex < AGENT_STAGES.length) return AGENT_STAGES[stageIndex].name;
    if (active) return 'Review complete';
    return 'Waiting for a prompt';
  }, [active, running, stageIndex]);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="mark" aria-hidden="true">
            <span />
          </span>
          <div>
            <strong>TGS</strong>
            <small>Global Services</small>
          </div>
        </div>
        <p className="brand-kicker">Automation Studio</p>
        <nav aria-label="Primary">
          {NAV.map((item) => (
            <button
              key={item.id}
              className={view === item.id ? 'nav-item active' : 'nav-item'}
              onClick={() => setView(item.id)}
              type="button"
            >
              <span>{item.label}</span>
              <small>{item.hint}</small>
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <p>Buildathon preview</p>
          <p>Playwright · TypeScript</p>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">TEKsystems Global Services</p>
            <h1>Write automation from a prompt</h1>
          </div>
          <div className="top-meta">
            <span className="pill">{libraryCount} saved</span>
            <span className="pill accent">{stageLabel}</span>
          </div>
        </header>

        {view === 'studio' && (
          <main className="studio">
            <section className="composer card">
              <div className="section-head">
                <h2>Describe the test</h2>
                <p>No editor required. Say what a person should do, and the agents draft the script.</p>
              </div>
              <label className="field">
                <span>Prompt</span>
                <textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  rows={6}
                  placeholder="Open the app, sign in, and verify the landing page."
                />
              </label>
              <div className="prompt-chips">
                {SAMPLE_PROMPTS.map((sample) => (
                  <button key={sample} type="button" className="chip" onClick={() => setPrompt(sample)}>
                    {sample.slice(0, 42)}…
                  </button>
                ))}
              </div>
              <div className="form-row">
                <label className="field">
                  <span>Base URL</span>
                  <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
                </label>
                <label className="field">
                  <span>Browser</span>
                  <select value={browser} onChange={(event) => setBrowser(event.target.value)}>
                    <option value="chromium">Chromium</option>
                    <option value="firefox">Firefox</option>
                    <option value="webkit">WebKit</option>
                  </select>
                </label>
                <label className="field">
                  <span>Level</span>
                  <select value={level} onChange={(event) => setLevel(event.target.value)}>
                    <option value="smoke">Smoke</option>
                    <option value="regression">Regression</option>
                    <option value="e2e">End to end</option>
                  </select>
                </label>
              </div>
              <div className="actions">
                <button className="btn primary" type="button" onClick={() => runAgents('create')} disabled={running}>
                  {running ? 'Agents are writing…' : 'Generate script'}
                </button>
                <button className="btn ghost" type="button" onClick={() => setView('practices')}>
                  Coding practices
                </button>
              </div>
            </section>

            <section className="pipeline card">
              <div className="section-head">
                <h2>Agent pipeline</h2>
                <p>Four agents share one script. This preview runs them in the browser.</p>
              </div>
              <ol>
                {AGENT_STAGES.map((stage, index) => {
                  const done = stageIndex > index;
                  const current = running && stageIndex === index;
                  return (
                    <li key={stage.id} className={done ? 'done' : current ? 'current' : ''}>
                      <span className="stage-index">{done ? '✓' : index + 1}</span>
                      <div>
                        <strong>{stage.name}</strong>
                        <p>{stage.detail}</p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>

            <section className="editor card">
              <div className="editor-bar">
                <div className="tabs" role="tablist">
                  {(
                    [
                      ['spec', 'flow.spec.ts'],
                      ['page', 'flow.page.ts'],
                      ['config', 'playwright.config.ts'],
                      ['review', 'Review'],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      role="tab"
                      aria-selected={panel === id}
                      className={panel === id ? 'tab active' : 'tab'}
                      type="button"
                      onClick={() => setPanel(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="actions tight">
                  <button className="btn ghost" type="button" onClick={copyActive} disabled={!active}>
                    Copy
                  </button>
                  <button className="btn ghost" type="button" onClick={downloadActive} disabled={!active}>
                    Download
                  </button>
                </div>
              </div>

              {panel === 'review' ? (
                <div className="review-only">
                  <p>The review agent reads the spec and the page object after each generate or update.</p>
                </div>
              ) : active ? (
                <HighlightedCode code={fileBody(active, panel)} />
              ) : (
                <div className="empty-code">
                  <p>Your Playwright TypeScript lands here.</p>
                  <p>Generate a script to see the spec, page object, and config together.</p>
                </div>
              )}

              <div className="review" id="review-panel">
                <div className="section-head">
                  <h2>Review</h2>
                  <p>
                    {active
                      ? `${passedCount} of ${active.checks.length} practices passed.`
                      : 'The review agent scores the script after it is written.'}
                  </p>
                </div>
                <ul className="checks">
                  {(active?.checks ?? []).map((check) => (
                    <li key={check.id} className={check.passed ? 'pass' : 'fail'}>
                      <strong>{check.passed ? 'Pass' : 'Look again'}</strong>
                      <span>{check.label}</span>
                      <small>{check.detail}</small>
                    </li>
                  ))}
                </ul>
              </div>

              <form
                className="follow-up"
                onSubmit={(event) => {
                  event.preventDefault();
                  void runAgents('update');
                }}
              >
                <label className="field">
                  <span>Update this script</span>
                  <input
                    value={followUp}
                    onChange={(event) => setFollowUp(event.target.value)}
                    placeholder='Example: also verify the cart badge shows 1'
                  />
                </label>
                <button className="btn primary" type="submit" disabled={running || !active}>
                  Update script
                </button>
              </form>
            </section>
          </main>
        )}

        {view === 'library' && (
          <main className="page">
            <div className="section-head">
              <h2>Saved scripts</h2>
              <p>Every generate and update is kept in this browser so you can reopen a flow.</p>
            </div>
            {scripts.length === 0 ? (
              <div className="card empty-page">
                <p>No scripts yet.</p>
                <button className="btn primary" type="button" onClick={() => setView('studio')}>
                  Open the studio
                </button>
              </div>
            ) : (
              <div className="script-grid">
                {scripts.map((script) => (
                  <article key={script.id} className="card script-card">
                    <p className="eyebrow">{script.level} · {script.browser}</p>
                    <h3>{script.title}</h3>
                    <p>{script.prompt}</p>
                    <div className="card-meta">
                      <span>{new Date(script.updatedAt).toLocaleString()}</span>
                      <span>
                        {script.checks.filter((check) => check.passed).length}/{script.checks.length} checks
                      </span>
                    </div>
                    <button className="btn primary" type="button" onClick={() => openScript(script)}>
                      Open in studio
                    </button>
                  </article>
                ))}
              </div>
            )}
          </main>
        )}

        {view === 'agents' && (
          <main className="page">
            <div className="section-head">
              <h2>The agents</h2>
              <p>
                The studio is the front door. Next, these same roles can run on a backend and write files into the
                repo. Today they show the contract: prompt in, typed Playwright out.
              </p>
            </div>
            <div className="agent-grid">
              {AGENT_STAGES.map((stage, index) => (
                <article key={stage.id} className="card agent-card">
                  <span className="stage-index light">{index + 1}</span>
                  <h3>{stage.name}</h3>
                  <p className="role">{stage.role}</p>
                  <p>{stage.detail}</p>
                </article>
              ))}
            </div>
            <section className="card callout">
              <h3>What the backend will own</h3>
              <ul>
                <li>Persist prompts and script versions for the team, not only this browser.</li>
                <li>Call the agents with the repo’s page objects so updates extend existing files.</li>
                <li>Run the generated spec and return the Playwright trace when it fails.</li>
              </ul>
            </section>
          </main>
        )}

        {view === 'practices' && (
          <main className="page">
            <div className="section-head">
              <h2>Playwright with TypeScript</h2>
              <p>These are the rules the spec agent follows and the review agent checks.</p>
            </div>
            <div className="practice-grid">
              {PRACTICES.map((practice) => (
                <article key={practice.title} className="card practice-card">
                  <h3>{practice.title}</h3>
                  <p>{practice.body}</p>
                </article>
              ))}
            </div>
            <section className="card snippet">
              <h3>Shape of a generated test</h3>
              <HighlightedCode
                code={`test('user can sign in', async ({ page }) => {
  const flow = new FlowPage(page);
  await test.step('Sign in', async () => {
    await flow.signIn(process.env.TEST_USER!, process.env.TEST_PASSWORD!);
  });
  await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();
});`}
              />
            </section>
          </main>
        )}

        {view === 'mcp' && (
          <McpView connections={connections} onChange={setConnections} onNotice={setNotice} />
        )}

        {notice && (
          <div className="toast" role="status">
            {notice}
          </div>
        )}
      </div>
    </div>
  );
}
