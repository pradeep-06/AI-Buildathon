import { useRef, useState } from 'react';
import { acceptsFile, extensionFor, parseAgentFile } from './agents';
import type { AgentFile, AgentFileKind } from './types';

const TABS: { id: AgentFileKind; label: string; hint: string }[] = [
  { id: 'rule', label: 'Rules', hint: '.mdc files the agents must follow' },
  { id: 'skill', label: 'Skills', hint: '.md files that show an agent how to work' },
  { id: 'command', label: 'Commands', hint: '.md files that start an agent task' },
];

export function AgentsView({
  files,
  onChange,
  onNotice,
}: {
  files: AgentFile[];
  onChange: (files: AgentFile[]) => void;
  onNotice: (message: string) => void;
}) {
  const [tab, setTab] = useState<AgentFileKind>('rule');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [error, setError] = useState('');
  const uploadRef = useRef<HTMLInputElement>(null);
  const visible = files.filter((file) => file.kind === tab);
  const active = TABS.find((item) => item.id === tab) ?? TABS[0];

  function startEdit(file: AgentFile) {
    setEditingId(file.id);
    setDraftName(file.name);
    setDraftBody(file.body);
    setError('');
  }

  function saveEdit() {
    const name = draftName.trim();
    const body = draftBody.trim();
    if (!name || !body) {
      setError('Name and file contents are both required.');
      return;
    }
    onChange(files.map((file) => (file.id === editingId ? { ...file, name, body, updatedAt: new Date().toISOString() } : file)));
    setEditingId(null);
    onNotice(`${name} saved.`);
  }

  async function onUpload(list: FileList | null) {
    const file = list?.[0];
    if (!file) return;
    if (!acceptsFile(tab, file.name)) {
      setError(`${active.label} accept ${extensionFor(tab)} files.`);
      return;
    }
    const raw = await file.text();
    if (!raw.trim()) {
      setError('That file is empty.');
      return;
    }
    const parsed = parseAgentFile(file.name, raw);
    const next: AgentFile = {
      id: `upload-${Date.now()}`,
      kind: tab,
      name: parsed.name,
      fileName: file.name,
      body: parsed.body,
      updatedAt: new Date().toISOString(),
    };
    onChange([next, ...files]);
    setError('');
    setEditingId(null);
    onNotice(`${file.name} added to ${active.label}.`);
    if (uploadRef.current) uploadRef.current.value = '';
  }

  return (
    <main className="page">
      <div className="section-head script-head">
        <div>
          <h2>Agents</h2>
          <p>Rules, skills, and commands configure the studio agents. Edit a file here, or upload a .md or .mdc file.</p>
        </div>
        <div>
          <input
            ref={uploadRef}
            className="file-input"
            type="file"
            accept={tab === 'rule' ? '.md,.mdc,text/markdown' : '.md,text/markdown'}
            aria-label={`Upload a ${active.label} file`}
            onChange={(event) => void onUpload(event.target.files)}
          />
          <button className="btn primary" type="button" onClick={() => uploadRef.current?.click()}>
            Upload {extensionFor(tab)}
          </button>
        </div>
      </div>

      <div className="provider-switch three" role="tablist" aria-label="Agent configuration">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={tab === item.id ? 'provider active' : 'provider'}
            onClick={() => {
              setTab(item.id);
              setEditingId(null);
              setError('');
            }}
          >
            <strong>{item.label}</strong>
            <span>{files.filter((file) => file.kind === item.id).length} files</span>
          </button>
        ))}
      </div>

      <p className="fetch-hint">{active.hint}</p>
      {error && <p className="form-error">{error}</p>}

      <div className="agent-grid">
        {visible.map((file) => (
          <article key={file.id} className="card agent-card">
            <p className="eyebrow">{file.fileName}</p>
            <h3>{file.name}</h3>
            <p>{file.body.replace(/^---[\s\S]*?---\s*/, '').trim()}</p>
            {editingId === file.id ? (
              <div className="agent-editor">
                <label className="field">
                  <span>Name</span>
                  <input value={draftName} onChange={(event) => setDraftName(event.target.value)} />
                </label>
                <label className="field">
                  <span>Contents</span>
                  <textarea value={draftBody} onChange={(event) => setDraftBody(event.target.value)} rows={8} />
                </label>
                <div className="actions">
                  <button className="btn primary" type="button" onClick={saveEdit}>
                    Save
                  </button>
                  <button className="btn ghost" type="button" onClick={() => setEditingId(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button className="btn ghost" type="button" onClick={() => startEdit(file)}>
                Edit
              </button>
            )}
          </article>
        ))}
      </div>
      {visible.length === 0 && <div className="card empty-page">No {active.label.toLowerCase()} yet. Upload a file to add one.</div>}
    </main>
  );
}
