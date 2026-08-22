'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';

type Command = {
  id: number;
  text: string;
  time: string;
  starred: boolean;
  saved: boolean;
};

type Tab = {
  id: number;
  name: string;
  path: string;
};

const initialCommands: Command[] = [
  {
    id: 1,
    text: 'git status --short && git log --oneline --decorate -8',
    time: 'now',
    starred: true,
    saved: true,
  },
  {
    id: 2,
    text: 'npm run build',
    time: '2m',
    starred: true,
    saved: true,
  },
  {
    id: 3,
    text: 'docker compose up --build --remove-orphans',
    time: '8m',
    starred: false,
    saved: true,
  },
  {
    id: 4,
    text: 'find . -type f -name "*.tsx" -not -path "*/node_modules/*" | xargs wc -l | sort -nr | head -20',
    time: '14m',
    starred: false,
    saved: false,
  },
  {
    id: 5,
    text: 'git pull --rebase origin main',
    time: '31m',
    starred: false,
    saved: true,
  },
];

const terminalHistory = [
  { prompt: 'git status --short', output: [' M app/page.tsx', ' M app/globals.css'] },
  { prompt: 'npm run build', output: ['✓ compiled in 842ms', '✓ 8 routes rendered'] },
  { prompt: 'git branch --show-current', output: ['feature/command-library'] },
];

export default function Home() {
  const [commands, setCommands] = useState(initialCommands);
  const [input, setInput] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    Starred: true,
    Library: true,
    Last: true,
  });
  const [tabs, setTabs] = useState<Tab[]>([
    { id: 1, name: 'riftdrift', path: '~/Projects/riftdrift' },
    { id: 2, name: 'api-server', path: '~/Projects/riftdrift/api' },
  ]);
  const [activeTab, setActiveTab] = useState(1);
  const [ranCommands, setRanCommands] = useState<{ prompt: string; output: string[] }[]>([]);
  const [toast, setToast] = useState('');

  const sections = useMemo(
    () => [
      { name: 'Starred', hint: 'Priority', items: commands.filter((item) => item.starred) },
      { name: 'Library', hint: 'Saved', items: commands.filter((item) => item.saved) },
      { name: 'Last', hint: 'History', items: commands },
    ],
    [commands],
  );

  const active = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === 'l') {
        event.preventDefault();
        setSidebarOpen((value) => !value);
      }
      if (event.key.toLowerCase() === 't') {
        event.preventDefault();
        addTab();
      }
    }

    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  });

  function toggleCommand(id: number, key: 'starred' | 'saved') {
    setCommands((items) =>
      items.map((item) => (item.id === id ? { ...item, [key]: !item[key] } : item)),
    );
  }

  function chooseCommand(command: string) {
    setInput(command);
    setToast('Command added to prompt');
    window.setTimeout(() => setToast(''), 1800);
  }

  function runCommand(event: FormEvent) {
    event.preventDefault();
    const value = input.trim();
    if (!value) return;

    const output = value.includes('git status')
      ? ['On branch feature/command-library', 'nothing to commit, working tree clean']
      : value.includes('npm')
        ? ['✓ command completed successfully in 1.2s']
        : [`zsh: completed “${value.slice(0, 42)}${value.length > 42 ? '…' : ''}”`];

    setRanCommands((items) => [...items, { prompt: value, output }]);
    setCommands((items) => [
      { id: Date.now(), text: value, time: 'now', starred: false, saved: false },
      ...items.map((item) => (item.time === 'now' ? { ...item, time: '1m' } : item)),
    ]);
    setInput('');
  }

  function addTab() {
    const id = Date.now();
    setTabs((items) => [...items, { id, name: `shell-${items.length + 1}`, path: '~' }]);
    setActiveTab(id);
  }

  function closeTab(id: number) {
    if (tabs.length === 1) return;
    const index = tabs.findIndex((tab) => tab.id === id);
    const nextTabs = tabs.filter((tab) => tab.id !== id);
    setTabs(nextTabs);
    if (activeTab === id) setActiveTab(nextTabs[Math.max(0, index - 1)].id);
  }

  function detachTab(id: number) {
    const tab = tabs.find((item) => item.id === id);
    if (!tab) return;
    const detached = window.open(
      `${window.location.pathname}?detached=${encodeURIComponent(tab.name)}`,
      `riftdrift-${tab.id}`,
      'popup=yes,width=980,height=700',
    );
    setToast(detached ? `${tab.name} detached into a new window` : 'Allow pop-ups to detach this tab');
    window.setTimeout(() => setToast(''), 2200);
  }

  return (
    <main className="desktop">
      <section className="app-shell" aria-label="RiftDrift terminal application">
        <header className="titlebar">
          <div className="traffic-lights" aria-label="Window controls">
            <button className="traffic red" aria-label="Close window" />
            <button className="traffic amber" aria-label="Minimize window" />
            <button className="traffic green" aria-label="Maximize window" />
          </div>
          <div className="brand" aria-label="RiftDrift">
            <span className="brand-mark">R</span>
            <span>RIFTDRIFT</span>
            <span className="brand-status">LOCAL</span>
          </div>
          <div className="title-actions">
            <span className="connection"><i /> zsh</span>
            <button
              className={`library-trigger ${sidebarOpen ? 'active' : ''}`}
              onClick={() => setSidebarOpen((value) => !value)}
              aria-label="Toggle command libraries"
              aria-expanded={sidebarOpen}
            >
              <span className="library-lines"><i /><i /><i /></span>
              <span className="library-label">Library</span>
              <kbd>⌘L</kbd>
            </button>
          </div>
        </header>

        <div className="tabbar">
          <div className="tabs" role="tablist" aria-label="Terminal tabs">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                className={`tab ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
                onDoubleClick={() => detachTab(tab.id)}
                draggable
                onDragEnd={() => detachTab(tab.id)}
                role="tab"
                aria-selected={activeTab === tab.id}
                title="Drag out or double-click to detach"
              >
                <span className="tab-terminal">›_</span>
                <span>{tab.name}</span>
                <span
                  className="tab-close"
                  role="button"
                  aria-label={`Close ${tab.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    closeTab(tab.id);
                  }}
                >
                  ×
                </span>
              </button>
            ))}
          </div>
          <button className="new-tab" onClick={addTab} aria-label="New terminal tab">+</button>
          <span className="drag-hint">DRAG TAB TO DETACH</span>
        </div>

        <div className={`workspace ${sidebarOpen ? 'sidebar-visible' : ''}`}>
          <section className="terminal" aria-label="Terminal">
            <div className="terminal-meta">
              <div>
                <span className="meta-label">SESSION</span>
                <span className="meta-value">{active?.name}</span>
              </div>
              <div className="terminal-path">{active?.path}</div>
              <div className="session-live"><i /> LIVE</div>
            </div>

            <div className="terminal-body">
              <div className="welcome">
                <div className="ascii-logo" aria-hidden="true">RD</div>
                <div>
                  <p>RiftDrift shell</p>
                  <span>Session restored · zsh · arm64</span>
                </div>
              </div>

              <div className="history">
                {[...terminalHistory, ...ranCommands].map((entry, index) => (
                  <div className="history-entry" key={`${entry.prompt}-${index}`}>
                    <div className="history-command">
                      <span className="prompt-path">riftdrift</span>
                      <span className="prompt-branch">git:(main)</span>
                      <span className="prompt-char">❯</span>
                      <span>{entry.prompt}</span>
                    </div>
                    {entry.output.map((line) => (
                      <div className={line.startsWith('✓') ? 'output success' : 'output'} key={line}>{line}</div>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            <form className="commandline" onSubmit={runCommand}>
              <span className="command-symbol">❯</span>
              <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Type a command…"
                autoComplete="off"
                spellCheck={false}
                aria-label="Terminal command"
              />
              <div className="command-actions">
                <span className="autocomplete">⌥↵ <i>complete</i></span>
                <button type="submit">RUN <kbd>↵</kbd></button>
              </div>
            </form>
          </section>

          <aside className="command-panel" aria-label="Command libraries">
            <div className="panel-header">
              <div>
                <span className="eyebrow">COMMANDS</span>
                <h1>Your drift.</h1>
              </div>
              <button className="panel-close" onClick={() => setSidebarOpen(false)} aria-label="Close command library">×</button>
            </div>
            <div className="panel-rule" />
            <div className="sections">
              {sections.map((section) => (
                <section className="library-section" key={section.name}>
                  <button
                    className="section-toggle"
                    onClick={() =>
                      setOpenSections((current) => ({ ...current, [section.name]: !current[section.name] }))
                    }
                    aria-expanded={openSections[section.name]}
                  >
                    <span className={`chevron ${openSections[section.name] ? 'open' : ''}`}>›</span>
                    <span className="section-title">{section.name}</span>
                    <span className="section-hint">{section.hint}</span>
                    <span className="section-count">{String(section.items.length).padStart(2, '0')}</span>
                  </button>
                  {openSections[section.name] && (
                    <div className="command-list">
                      {section.items.length ? section.items.map((command) => (
                        <article className="command-card" key={`${section.name}-${command.id}`}>
                          <div className="command-toggles">
                            <button
                              className={command.starred ? 'marked' : ''}
                              onClick={() => toggleCommand(command.id, 'starred')}
                              aria-label={command.starred ? 'Remove from Starred' : 'Add to Starred'}
                              title={command.starred ? 'Remove from Starred' : 'Add to Starred'}
                            >
                              {command.starred ? '★' : '☆'}
                            </button>
                            <button
                              className={command.saved ? 'marked' : ''}
                              onClick={() => toggleCommand(command.id, 'saved')}
                              aria-label={command.saved ? 'Remove from Library' : 'Add to Library'}
                              title={command.saved ? 'Remove from Library' : 'Add to Library'}
                            >
                              {command.saved ? '▣' : '▢'}
                            </button>
                          </div>
                          <button className="command-text" onClick={() => chooseCommand(command.text)} title={command.text}>
                            <code>{command.text}</code>
                            <span>{command.time}</span>
                          </button>
                        </article>
                      )) : <p className="empty-state">No commands here yet.</p>}
                    </div>
                  )}
                </section>
              ))}
            </div>
            <footer className="panel-footer">
              <span><i /> SYNCED LOCALLY</span>
              <span>⌘K · SEARCH</span>
            </footer>
          </aside>
        </div>

        <footer className="statusbar">
          <span><i className="status-dot" /> 1 PROCESS</span>
          <span className="status-spacer" />
          <span>UTF-8</span>
          <span>80 × 24</span>
          <span className="branch">⌘ feature/command-library</span>
        </footer>

        {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
      </section>
    </main>
  );
}
