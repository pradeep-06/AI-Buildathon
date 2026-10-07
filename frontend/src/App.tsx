import { useEffect, useMemo, useRef, useState } from 'react';
import { applyAgentFiles, loadAgentFiles, saveAgentFiles } from './agents';
import { AgentsView } from './AgentsView';
import { AGENT_STAGES, PRACTICES, SAMPLE_PROMPTS } from './data';
import { formatStory, generateScript } from './lib/generateScript';
import { HighlightedCode } from './lib/highlight';
import { loadConnections, saveConnections } from './mcp';
import { McpView } from './McpView';
import type { BoardStory, GeneratedScript, JiraConnection, McpConnections, McpProvider, ViewId } from './types';

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
  const [view, setView] = useState<ViewId>(() => (sessionStorage.getItem('tgs-open-view') === 'mcp' ? 'mcp' : 'studio'));
  const [scripts, setScripts] = useState<GeneratedScript[]>(() => loadScripts());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState(SAMPLE_PROMPTS[0]);
  const [baseUrl, setBaseUrl] = useState('https://www.saucedemo.com');
  const [browser, setBrowser] = useState('chromium');
  const [level, setLevel] = useState('smoke');
  const [panel, setPanel] = useState<PanelId>('spec');
  const [running, setRunning] = useState(false);
  const [stageIndex, setStageIndex] = useState(-1);
  const [notice, setNotice] = useState(() => {
    const message = sessionStorage.getItem('tgs-mcp-notice') ?? '';
    sessionStorage.removeItem('tgs-mcp-notice');
    sessionStorage.removeItem('tgs-open-view');
    return message;
  });
  const [followUp, setFollowUp] = useState('');
  const [connections, setConnections] = useState<McpConnections>(() => loadConnections());
  const [stories, setStories] = useState<BoardStory[]>([]);
  const [selectedStoryId, setSelectedStoryId] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [storyError, setStoryError] = useState('');
  const [boardSource, setBoardSource] = useState<McpProvider>('jira');
  const [selectedScriptIds, setSelectedScriptIds] = useState<string[]>([]);
  const [agentFiles, setAgentFiles] = useState(() => loadAgentFiles());
  const selectAllRef = useRef<HTMLInputElement>(null);

  const active = scripts.find((script) => script.id === activeId) ?? null;

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scripts));
  }, [scripts]);

  useEffect(() => {
    saveConnections(connections);
  }, [connections]);

  useEffect(() => {
    saveAgentFiles(agentFiles);
  }, [agentFiles]);

  useEffect(() => {
    if (!selectAllRef.current) return;
    selectAllRef.current.indeterminate = selectedScriptIds.length > 0 && selectedScriptIds.length < scripts.length;
  }, [scripts.length, selectedScriptIds, view]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 2400);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const passedCount = active?.checks.filter((check) => check.passed).length ?? 0;
  const canFetch = Boolean(connections.jira || connections.azure);
  const activeSource: McpProvider = connections.jira && connections.azure ? boardSource : connections.azure && !connections.jira ? 'azure' : 'jira';
  const selectedStory = stories.find((story) => story.id === selectedStoryId) ?? null;

  function chooseStory(story: BoardStory) {
    setSelectedStoryId(story.id);
    setPrompt(formatStory(story));
  }

  async function fetchStories() {
    if (!canFetch || fetching) return;
    setFetching(true);
    setStoryError('');
    try {
      const response = await fetch('/api/stories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: activeSource,
          jira: connections.jira,
          azure: connections.azure,
        }),
      });
      const body = (await response.json()) as { stories?: BoardStory[]; error?: string; jira?: JiraConnection };
      if (!response.ok || !body.stories) throw new Error(body.error || 'Could not fetch stories.');
      if (body.jira) setConnections((current) => ({ ...current, jira: body.jira ?? current.jira }));
      setStories(body.stories);
      const first = body.stories[0];
      if (first) chooseStory(first);
      else setSelectedStoryId(null);
      setNotice(body.stories.length ? `Fetched ${body.stories.length} stories.` : 'The board has no stories.');
    } catch (error) {
      setStories([]);
      setSelectedStoryId(null);
      setStoryError(error instanceof Error ? error.message : 'Could not fetch stories.');
    } finally {
      setFetching(false);
    }
  }

  async function runAgents(mode: 'create' | 'update') {
    const source = mode === 'update' ? followUp.trim() : prompt.trim() || (selectedStory ? formatStory(selectedStory) : '');
    if (!source) {
      setNotice('Describe the flow or fetch a story first.');
      return;
    }
    if (mode === 'update' && !active) {
      setNotice('Generate a script before asking for an update.');
      return;
    }

    setRunning(true);
    setView('studio');
    setPanel('spec');
    for (let index = 0; index < stages.length; index += 1) {
      setStageIndex(index);
      await new Promise((resolve) => window.setTimeout(resolve, 420));
    }

    const next = generateScript({
      prompt: source,
      baseUrl,
      browser,
      level,
      previous: mode === 'update' ? active ?? undefined : undefined,
      story: mode === 'create' ? selectedStory ?? undefined : undefined,
    });
    setScripts((current) => {
      const without = current.filter((script) => script.id !== next.id);
      return [next, ...without];
    });
    setActiveId(next.id);
    setStageIndex(stages.length);
    setRunning(false);
    setFollowUp('');
    setNotice(mode === 'update' ? 'Script updated from your follow-up.' : 'Playwright script is ready.');
  }

  function toggleScript(id: string) {
    setSelectedScriptIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  function deleteScripts(ids: string[]) {
    const remove = new Set(ids);
    if (remove.size === 0) return;
    setScripts((current) => current.filter((script) => !remove.has(script.id)));
    setSelectedScriptIds((current) => current.filter((id) => !remove.has(id)));
    setActiveId((current) => (current && remove.has(current) ? null : current));
    setNotice(remove.size === 1 ? 'Script deleted.' : `${remove.size} scripts deleted.`);
  }

  function openScript(script: GeneratedScript) {
    setActiveId(script.id);
    setPrompt(script.prompt);
    setBaseUrl(script.baseUrl);
    setBrowser(script.browser);
    setLevel(script.level);
    setPanel('spec');
    setView('studio');
    setStageIndex(stages.length);
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
  const stages = useMemo(() => applyAgentFiles(AGENT_STAGES, agentFiles), [agentFiles]);
  const stageLabel = useMemo(() => {
    if (running && stageIndex >= 0 && stageIndex < stages.length) return stages[stageIndex].name;
    if (active) return 'Review complete';
    return 'Waiting for a prompt';
  }, [active, running, stageIndex, stages]);

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
            <section className="stories card" aria-label="Board stories">
              <div className="section-head">
                <h2>Board</h2>
                <p>{selectedStory ? `${selectedStory.key} is selected for the script.` : 'Fetched story details show here.'}</p>
              </div>
              {connections.jira && connections.azure && (
                <label className="field">
                  <span>Source</span>
                  <select value={activeSource} onChange={(event) => setBoardSource(event.target.value as McpProvider)}>
                    <option value="jira">Jira</option>
                    <option value="azure">Azure</option>
                  </select>
                </label>
              )}
              {storyError && <p className="form-error">{storyError}</p>}
              {stories.length === 0 && !storyError && (
                <p className="story-empty">Fetch a board to list its stories.</p>
              )}
              <div className="story-list">
                {stories.map((story) => {
                  const selected = story.id === selectedStoryId;
                  return (
                    <article key={story.id} className={selected ? 'story selected' : 'story'}>
                      <button type="button" onClick={() => chooseStory(story)}>
                        <span>{story.key}</span>
                        <strong>{story.title}</strong>
                        <small>{[story.type, story.status].filter(Boolean).join(' · ')}</small>
                      </button>
                      {selected && (
                        <p className="story-detail">{story.description || 'This story has no description.'}</p>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
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
              <div className="form-row">
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
                <button
                  className="btn ghost"
                  type="button"
                  onClick={() => void fetchStories()}
                  disabled={!canFetch || fetching || running}
                  title={canFetch ? 'Fetch stories from the connected board' : 'Connect Jira or Azure in MCP first'}
                >
                  {fetching ? 'Fetching…' : 'Fetch'}
                </button>
                <button className="btn primary" type="button" onClick={() => runAgents('create')} disabled={running}>
                  {running ? 'Agents are writing…' : 'Generate script'}
                </button>
                <button className="btn ghost" type="button" onClick={() => setView('practices')}>
                  Coding practices
                </button>
              </div>
              {!canFetch && <p className="fetch-hint">Connect Jira or Azure in MCP to enable Fetch.</p>}
            </section>

            <section className="pipeline card">
              <div className="section-head">
                <h2>Agent pipeline</h2>
                <p>Four agents share one script. This preview runs them in the browser.</p>
              </div>
              <ol>
                {stages.map((stage, index) => {
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
            <div className="section-head script-head">
              <div>
                <h2>Saved scripts</h2>
                <p>Every generate and update is kept in this browser so you can reopen a flow.</p>
              </div>
              {scripts.length > 0 && (
                <button
                  className="btn ghost danger"
                  type="button"
                  disabled={selectedScriptIds.length === 0}
                  onClick={() => deleteScripts(selectedScriptIds)}
                >
                  Delete selected{selectedScriptIds.length ? ` (${selectedScriptIds.length})` : ''}
                </button>
              )}
            </div>
            {scripts.length === 0 ? (
              <div className="card empty-page">
                <p>No scripts yet.</p>
                <button className="btn primary" type="button" onClick={() => setView('studio')}>
                  Open the studio
                </button>
              </div>
            ) : (
              <div className="card script-table-wrap">
                <table className="script-table">
                  <thead>
                    <tr>
                      <th className="select-col">
                        <input
                          ref={selectAllRef}
                          type="checkbox"
                          checked={scripts.length > 0 && selectedScriptIds.length === scripts.length}
                          aria-label="Select all scripts"
                          onChange={() =>
                            setSelectedScriptIds((current) => (current.length === scripts.length ? [] : scripts.map((script) => script.id)))
                          }
                        />
                      </th>
                      <th>Action</th>
                      <th>Script</th>
                      <th>Prompt</th>
                      <th>Level</th>
                      <th>Browser</th>
                      <th>Updated</th>
                      <th>Checks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scripts.map((script) => {
                      const passed = script.checks.filter((check) => check.passed).length;
                      const selected = selectedScriptIds.includes(script.id);
                      return (
                        <tr key={script.id} className={selected ? 'selected' : ''}>
                          <td className="select-col">
                            <input
                              type="checkbox"
                              checked={selected}
                              aria-label={`Select ${script.title}`}
                              onChange={() => toggleScript(script.id)}
                            />
                          </td>
                          <td>
                            <div className="row-actions">
                              <button
                                className="icon-btn"
                                type="button"
                                aria-label={`Open ${script.title} in studio`}
                                title="Open in studio"
                                onClick={() => openScript(script)}
                              >
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                  <path d="M14 5h5v5h-2V8.4l-6.3 6.3-1.4-1.4L15.6 7H14V5z" />
                                  <path d="M6 7h5v2H8v9h9v-3h2v5H6V7z" />
                                </svg>
                              </button>
                              <button
                                className="icon-btn danger"
                                type="button"
                                aria-label={`Delete ${script.title}`}
                                title="Delete"
                                onClick={() => deleteScripts([script.id])}
                              >
                                <svg viewBox="0 0 24 24" aria-hidden="true">
                                  <path d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 6h2v8h-2V9zm4 0h2v8h-2V9zM7 9h2v8H7V9z" />
                                </svg>
                              </button>
                            </div>
                          </td>
                          <td className="script-title">{script.title}</td>
                          <td className="script-prompt">{script.prompt}</td>
                          <td>{script.level}</td>
                          <td>{script.browser}</td>
                          <td>{new Date(script.updatedAt).toLocaleString()}</td>
                          <td>
                            {passed}/{script.checks.length}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </main>
        )}

        {view === 'agents' && <AgentsView files={agentFiles} onChange={setAgentFiles} onNotice={setNotice} />}

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
