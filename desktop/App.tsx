import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { FormEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import {
  colorizeCommand,
  createLibraryId,
  emptyLibraryDocument,
  limitCommandHistory,
  MAX_HISTORY_COMMANDS,
  migrateLegacyCommands,
  normalizeSavedCommandOrder,
  parseLibraryDocument,
  serializeLibraryDocument,
  sortSavedCommands,
  type LibraryDocument,
} from './library';

type Tab = {
  id: number;
  sessionId: number;
  name: string;
  path: string;
};

type TerminalOutput = {
  sessionId: number;
  data: number[];
};

type TerminalPaneHandle = {
  insert: (value: string) => void;
  focus: () => void;
};

type LibraryFileResult = { path: string; contents: string | null };
type SectionEditor = { sectionId: string | null; name: string; confirmDelete: boolean; commandId?: string };
type CommandEditor = { commandId: string; name: string };
type Toast = { message: string; tone: 'success' | 'error' | 'warning' };
type DropPosition = 'before' | 'after';
type DropTarget<Id> = { id: Id; position: DropPosition };
type PointerDrag<Id> = {
  id: Id;
  pointerId: number;
  startX: number;
  startY: number;
  dragging: boolean;
};
type CommandPointerDrag = PointerDrag<string> & { sectionId: string };

function fileName(path: string) {
  return path.split(/[\\/]/).pop() || 'library';
}

const legacyStorageKey = 'riftdrift.commands.v1';
const activeLibraryPathKey = 'riftdrift.active-library-path.v1';
const lastSectionId = 'last';

function SaveIcon() {
  return <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M2.5 2.5h8l3 3v8h-11zM5 2.5v4h5v-4M5 13v-4h6v4" /></svg>;
}

function PencilIcon() {
  return <svg aria-hidden="true" viewBox="0 0 16 16"><path d="m3 11.8-.5 2 2-.5 7.8-7.8-1.5-1.5zM9.8 5l1.5 1.5M10.8 4l1-1a.8.8 0 0 1 1.2 0l.8.8a.8.8 0 0 1 0 1.2l-1 1" /></svg>;
}

function TrashIcon() {
  return <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M3.5 5h9M6 5V3.5h4V5m1.5 0-.6 8h-6l-.6-8M6.8 7v4M9.2 7v4" /></svg>;
}

function DragHandleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 12 16">
      <circle cx="4" cy="4" r="1" /><circle cx="8" cy="4" r="1" />
      <circle cx="4" cy="8" r="1" /><circle cx="8" cy="8" r="1" />
      <circle cx="4" cy="12" r="1" /><circle cx="8" cy="12" r="1" />
    </svg>
  );
}

function reorderItems<T extends { id: Id }, Id extends string | number>(
  items: T[],
  draggedId: Id,
  targetId: Id,
  position: DropPosition,
) {
  if (draggedId === targetId) return items;
  const draggedIndex = items.findIndex((item) => item.id === draggedId);
  if (draggedIndex < 0) return items;
  const moving = items[draggedIndex];
  const remaining = items.filter((item) => item.id !== draggedId);
  const targetIndex = remaining.findIndex((item) => item.id === targetId);
  const insertionIndex = targetIndex < 0
    ? remaining.length
    : targetIndex + (position === 'after' ? 1 : 0);
  const reordered = [...remaining];
  reordered.splice(insertionIndex, 0, moving);
  return reordered;
}

const TerminalPane = forwardRef<TerminalPaneHandle, {
  sessionId: number;
  history: string[];
  onCommand: (value: string) => void;
}>(
function TerminalPane({ sessionId, history, onCommand }, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const commandBuffer = useRef('');
  const bracketedPaste = useRef(false);
  const knownHistory = useRef(history);
  const historyCursor = useRef(-1);
  const historyDraft = useRef('');
  const preferRenderedCommand = useRef(false);
  const renderedCommand = useRef('');

  useEffect(() => {
    knownHistory.current = history;
  }, [history]);

  useImperativeHandle(ref, () => {
    const focus = () => {
      terminalRef.current?.focus();
      hostRef.current?.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')?.focus({ preventScroll: true });
    };
    return {
      insert(value: string) {
        historyCursor.current = -1;
        historyDraft.current = '';
        preferRenderedCommand.current = false;
        renderedCommand.current = '';
        focus();
        const terminal = terminalRef.current;
        if (!terminal) return;
        terminal.paste(value);
        focus();
      },
      focus,
    };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const terminal = new Terminal({
      allowProposedApi: false,
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorWidth: 2,
      fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.45,
      letterSpacing: 0,
      scrollback: 10_000,
      macOptionIsMeta: true,
      theme: {
        background: '#060507',
        foreground: '#d7dce2',
        cursor: '#d891ff',
        cursorAccent: '#060507',
        selectionBackground: '#70379588',
        black: '#070608',
        red: '#ff6b6b',
        green: '#63d98b',
        yellow: '#ffd166',
        blue: '#6ea8fe',
        magenta: '#c084fc',
        cyan: '#5eead4',
        white: '#eee7f2',
        brightBlack: '#69727d',
        brightRed: '#ff9292',
        brightGreen: '#8be6ad',
        brightYellow: '#ffe29a',
        brightBlue: '#9bc2ff',
        brightMagenta: '#d8b4fe',
        brightCyan: '#99f6e4',
        brightWhite: '#ffffff',
      },
    });
    terminalRef.current = terminal;
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);

    const encoder = new TextEncoder();
    let disposed = false;
    let unlisten: UnlistenFn | undefined;

    function resize() {
      if (disposed) return;
      try {
        fit.fit();
        void invoke('resize_terminal', { sessionId, rows: terminal.rows, cols: terminal.cols });
      } catch {
        // The view can briefly report zero dimensions while a window is moving.
      }
    }

    function readRenderedCommand() {
      const buffer = terminal.buffer.active;
      const cursorLine = buffer.baseY + buffer.cursorY;
      let firstLine = cursorLine;

      while (firstLine > 0 && buffer.getLine(firstLine)?.isWrapped) firstLine -= 1;

      let renderedLine = '';
      for (let lineIndex = firstLine; lineIndex <= cursorLine; lineIndex += 1) {
        renderedLine += buffer.getLine(lineIndex)?.translateToString(true) ?? '';
      }

      const prompt = renderedLine.match(/(?:^|\s)[%$#❯➜λ]\s+/u);
      if (!prompt || prompt.index === undefined) return '';
      return renderedLine.slice(prompt.index + prompt[0].length).trim();
    }

    function submitBufferedCommand() {
      const visibleCommand = preferRenderedCommand.current
        ? readRenderedCommand() || renderedCommand.current
        : '';
      const command = (visibleCommand || commandBuffer.current).trim();
      if (command) {
        knownHistory.current = [command, ...knownHistory.current.filter((item) => item !== command)];
        onCommand(command);
      }
      commandBuffer.current = '';
      historyCursor.current = -1;
      historyDraft.current = '';
      preferRenderedCommand.current = false;
      renderedCommand.current = '';
    }

    function navigateHistory(direction: 'older' | 'newer') {
      const items = knownHistory.current;
      if (!items.length) return;

      if (direction === 'older') {
        if (historyCursor.current === -1) historyDraft.current = commandBuffer.current;
        historyCursor.current = Math.min(historyCursor.current + 1, items.length - 1);
      } else if (historyCursor.current >= 0) {
        historyCursor.current -= 1;
      } else {
        return;
      }

      commandBuffer.current = historyCursor.current === -1
        ? historyDraft.current
        : items[historyCursor.current] ?? '';
    }

    function trackInput(data: string) {
      let index = 0;

      while (index < data.length) {
        if (data.startsWith('\u001b[A', index) || data.startsWith('\u001bOA', index)) {
          preferRenderedCommand.current = true;
          renderedCommand.current = '';
          navigateHistory('older');
          index += 3;
          continue;
        }

        if (data.startsWith('\u001b[B', index) || data.startsWith('\u001bOB', index)) {
          preferRenderedCommand.current = true;
          renderedCommand.current = '';
          navigateHistory('newer');
          index += 3;
          continue;
        }

        if (data.startsWith('\u001b[200~', index)) {
          bracketedPaste.current = true;
          index += 6;
          continue;
        }

        if (data.startsWith('\u001b[201~', index)) {
          bracketedPaste.current = false;
          index += 6;
          continue;
        }

        const character = data[index];

        if (character === '\t') {
          preferRenderedCommand.current = true;
          renderedCommand.current = '';
          index += 1;
          continue;
        }

        if (character === '\u0010' || character === '\u000e') {
          preferRenderedCommand.current = true;
          renderedCommand.current = '';
          navigateHistory(character === '\u0010' ? 'older' : 'newer');
          index += 1;
          continue;
        }

        if (character === '\r' || character === '\n') {
          if (bracketedPaste.current) {
            commandBuffer.current += '\n';
          } else {
            submitBufferedCommand();
          }

          if (character === '\r' && data[index + 1] === '\n') index += 1;
          index += 1;
          continue;
        }

        if (character === '\u0003' || character === '\u0015') {
          commandBuffer.current = '';
          historyCursor.current = -1;
          historyDraft.current = '';
          preferRenderedCommand.current = false;
          renderedCommand.current = '';
          index += 1;
          continue;
        }

        if (character === '\u007f' || character === '\b') {
          commandBuffer.current = commandBuffer.current.slice(0, -1);
          index += 1;
          continue;
        }

        if (character === '\u001b') {
          preferRenderedCommand.current = true;
          if (data[index + 1] === '[') {
            index += 2;
            while (index < data.length) {
              const code = data.charCodeAt(index);
              index += 1;
              if (code >= 0x40 && code <= 0x7e) break;
            }
          } else {
            index += 1;
          }
          continue;
        }

        if (character >= ' ') {
          commandBuffer.current += character;
        }
        index += 1;
      }
    }

    function sendInput(data: string) {
      trackInput(data);
      void invoke('write_terminal', { sessionId, data: Array.from(encoder.encode(data)) });
    }

    function handleTerminalKeyDown(event: KeyboardEvent) {
      if (
        event.key === 'ArrowUp'
        || event.key === 'ArrowDown'
        || event.key === 'Tab'
        || event.code === 'ArrowUp'
        || event.code === 'ArrowDown'
        || event.code === 'Tab'
        || event.keyCode === 38
        || event.keyCode === 40
        || event.keyCode === 9
      ) {
        preferRenderedCommand.current = true;
        renderedCommand.current = '';
      }
    }

    host.addEventListener('keydown', handleTerminalKeyDown, true);

    const dataDisposable = terminal.onData((data) => {
      const enterAfterNavigation = preferRenderedCommand.current && /[\r\n]/.test(data);
      if (enterAfterNavigation) {
        window.setTimeout(() => {
          if (!disposed) sendInput(data);
        }, 32);
        return;
      }

      sendInput(data);
    });
    const resizeDisposable = terminal.onResize(({ rows, cols }) => {
      void invoke('resize_terminal', { sessionId, rows, cols });
    });
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    void listen<TerminalOutput>('terminal-output', (event) => {
      if (event.payload.sessionId !== sessionId) return;

      terminal.write(Uint8Array.from(event.payload.data), () => {
        if (!preferRenderedCommand.current) return;
        const command = readRenderedCommand();
        if (command) renderedCommand.current = command;
      });
    }).then((disposeListener) => {
      if (disposed) disposeListener();
      else unlisten = disposeListener;
    });

    void invoke<number[]>('terminal_scrollback', { sessionId }).then((data) => {
      if (!disposed && data.length) terminal.write(Uint8Array.from(data));
      window.requestAnimationFrame(() => {
        resize();
        terminal.focus();
      });
    });

    return () => {
      disposed = true;
      unlisten?.();
      observer.disconnect();
      host.removeEventListener('keydown', handleTerminalKeyDown, true);
      dataDisposable.dispose();
      resizeDisposable.dispose();
      terminalRef.current = null;
      terminal.dispose();
    };
  }, [onCommand, sessionId]);

  return <div className="xterm-host" ref={hostRef} />;
});

export default function App() {
  const url = useMemo(() => new URL(window.location.href), []);
  const isTauriRuntime = '__TAURI_INTERNALS__' in window;
  const detachedSession = Number(url.searchParams.get('session')) || null;
  const detachedName = url.searchParams.get('name') || 'detached';
  const isDetached = Boolean(detachedSession);
  const libraryShortcut = /Macintosh|Mac OS X/.test(navigator.userAgent) ? '⌘L' : 'Ctrl+L';
  const terminalRef = useRef<TerminalPaneHandle>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const draggedTabIdRef = useRef<number | null>(null);
  const draggedSectionIdRef = useRef<string | null>(null);
  const tabDropTargetRef = useRef<DropTarget<number> | null>(null);
  const sectionDropTargetRef = useRef<DropTarget<string> | null>(null);
  const tabPointerDragRef = useRef<PointerDrag<number> | null>(null);
  const sectionPointerDragRef = useRef<PointerDrag<string> | null>(null);
  const commandPointerDragRef = useRef<CommandPointerDrag | null>(null);
  const suppressTabClickRef = useRef(false);
  const suppressSectionClickRef = useRef(false);
  const draggedCommandIdRef = useRef<string | null>(null);
  const commandDropTargetRef = useRef<DropTarget<string> | null>(null);
  const [library, setLibrary] = useState<LibraryDocument>(emptyLibraryDocument);
  const [libraryPath, setLibraryPath] = useState(isTauriRuntime ? '' : 'RiftDrift Library.riftdrift');
  const [libraryReady, setLibraryReady] = useState(!isTauriRuntime);
  const [libraryError, setLibraryError] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({ [lastSectionId]: true });
  const [saveMenuCommandId, setSaveMenuCommandId] = useState<string | null>(null);
  const [sectionEditor, setSectionEditor] = useState<SectionEditor | null>(null);
  const [commandEditor, setCommandEditor] = useState<CommandEditor | null>(null);
  const [draggedSectionId, setDraggedSectionId] = useState<string | null>(null);
  const [sectionDropTarget, setSectionDropTarget] = useState<DropTarget<string> | null>(null);
  const [draggedCommandId, setDraggedCommandId] = useState<string | null>(null);
  const [commandDropTarget, setCommandDropTarget] = useState<DropTarget<string> | null>(null);
  const [tabs, setTabs] = useState<Tab[]>(
    detachedSession ? [{ id: detachedSession, sessionId: detachedSession, name: detachedName, path: '~' }] : [],
  );
  const [draggedTabId, setDraggedTabId] = useState<number | null>(null);
  const [tabDropTarget, setTabDropTarget] = useState<DropTarget<number> | null>(null);
  const [activeTab, setActiveTab] = useState(detachedSession ?? 0);
  const [toast, setToast] = useState<Toast | null>(null);

  const commands = library.history;
  const active = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];
  const sections = useMemo(
    () => [
      ...library.sections.map((section) => ({
        ...section,
        hint: 'Saved',
        editable: true,
        items: sortSavedCommands(library.history.filter((item) => item.sectionId === section.id)),
      })),
      {
        id: lastSectionId,
        name: 'Last',
        hint: 'History',
        editable: false,
        items: library.history.slice(0, MAX_HISTORY_COMMANDS),
      },
    ],
    [library],
  );

  const flash = useCallback((message: string, tone: Toast['tone'] = 'success') => {
    window.clearTimeout(toastTimer.current);
    setToast({ message, tone });
    toastTimer.current = window.setTimeout(() => setToast(null), 2200);
  }, []);

  const loadLibraryAtPath = useCallback(async (requestedPath: string | null, announce = false) => {
    try {
      const result = await invoke<LibraryFileResult>('load_library_file', { path: requestedPath });
      let document: LibraryDocument;
      if (result.contents) {
        document = parseLibraryDocument(result.contents);
      } else {
        const legacy = localStorage.getItem(legacyStorageKey);
        document = legacy ? migrateLegacyCommands(JSON.parse(legacy)) : emptyLibraryDocument();
      }
      setLibrary(document);
      setLibraryPath(result.path);
      setLibraryReady(true);
      setLibraryError('');
      setSaveMenuCommandId(null);
      localStorage.setItem(activeLibraryPathKey, result.path);
      if (announce) flash(`Opened ${fileName(result.path)}`);
    } catch (error) {
      const message = String(error);
      setLibraryError(message);
      flash(`Could not open library: ${message}`, 'error');
    }
  }, [flash]);

  useEffect(() => {
    if (!isTauriRuntime) return;
    let disposed = false;
    let unlisten: UnlistenFn | undefined;

    void listen<string>('library-file-opened', (event) => {
      if (!disposed) void loadLibraryAtPath(event.payload, true);
    }).then((disposeListener) => {
      if (disposed) disposeListener();
      else unlisten = disposeListener;
    });

    void invoke<string | null>('take_opened_library_path').then((openedPath) => {
      if (disposed) return;
      const rememberedPath = localStorage.getItem(activeLibraryPathKey);
      void loadLibraryAtPath(openedPath ?? rememberedPath, Boolean(openedPath));
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [isTauriRuntime, loadLibraryAtPath]);

  useEffect(() => {
    if (!isTauriRuntime || !libraryReady || !libraryPath) return;
    void invoke<string>('save_library_file', {
      path: libraryPath,
      contents: serializeLibraryDocument(library),
    }).then((savedPath) => {
      localStorage.setItem(activeLibraryPathKey, savedPath);
      localStorage.removeItem(legacyStorageKey);
      setLibraryError('');
    }).catch((error) => {
      setLibraryError(String(error));
    });
  }, [isTauriRuntime, library, libraryPath, libraryReady]);

  useEffect(() => {
    if (!saveMenuCommandId) return;
    function closeMenu(event: PointerEvent) {
      if (!(event.target as HTMLElement).closest('.save-control')) setSaveMenuCommandId(null);
    }
    window.addEventListener('pointerdown', closeMenu);
    return () => window.removeEventListener('pointerdown', closeMenu);
  }, [saveMenuCommandId]);

  useEffect(() => {
    if (detachedSession || !isTauriRuntime) return;
    void createTab('riftdrift');
    // The first terminal session should be created only once for this window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTauriRuntime]);

  useEffect(() => {
    if (!isDetached || !detachedSession) return;
    const close = () => void invoke('close_terminal', { sessionId: detachedSession });
    window.addEventListener('beforeunload', close);
    return () => window.removeEventListener('beforeunload', close);
  }, [detachedSession, isDetached]);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setSaveMenuCommandId(null);
        setSectionEditor(null);
        setCommandEditor(null);
        return;
      }
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === 'l') {
        event.preventDefault();
        setSidebarOpen((value) => !value);
      }
      if (event.key.toLowerCase() === 't' && !isDetached) {
        event.preventDefault();
        void createTab();
      }
    }
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  });

  const rememberCommand = useCallback((value: string) => {
    const text = value.trim();
    if (!text) return;
    setLibrary((current) => {
      const history = normalizeSavedCommandOrder(current.history, current.sections);
      const existing = history.find((item) => item.text === text);
      const command = {
        id: existing?.id ?? createLibraryId('command'),
        text,
        sectionId: existing?.sectionId ?? null,
        displayName: existing?.displayName ?? null,
        savedOrder: existing?.savedOrder ?? null,
      };
      return {
        ...current,
        history: limitCommandHistory([command, ...history.filter((item) => item.text !== text)]),
      };
    });
  }, []);

  async function createTab(preferredName?: string) {
    try {
      const sessionId = await invoke<number>('create_terminal', { rows: 28, cols: 100, cwd: null });
      const index = tabs.length + 1;
      const tab = { id: sessionId, sessionId, name: preferredName ?? `shell-${index}`, path: '~' };
      setTabs((items) => [...items, tab]);
      setActiveTab(tab.id);
    } catch (error) {
      flash(`Could not open shell: ${String(error)}`, 'error');
    }
  }

  async function closeTab(id: number) {
    const tab = tabs.find((item) => item.id === id);
    if (!tab) return;
    await invoke('close_terminal', { sessionId: tab.sessionId });
    if (isDetached) {
      await invoke('window_control', { action: 'close' });
      return;
    }
    const index = tabs.findIndex((item) => item.id === id);
    const nextTabs = tabs.filter((item) => item.id !== id);
    setTabs(nextTabs);
    if (activeTab === id && nextTabs.length) setActiveTab(nextTabs[Math.max(0, index - 1)].id);
    if (!nextTabs.length) void createTab('riftdrift');
  }

  async function detachTab(id: number) {
    if (isDetached) return;
    const tab = tabs.find((item) => item.id === id);
    if (!tab) return;
    try {
      await invoke('detach_terminal', { sessionId: tab.sessionId, name: tab.name });
      const nextTabs = tabs.filter((item) => item.id !== id);
      setTabs(nextTabs);
      if (activeTab === id && nextTabs.length) setActiveTab(nextTabs[0].id);
      if (!nextTabs.length) void createTab('riftdrift');
      flash(`${tab.name} detached into a new window`);
    } catch (error) {
      flash(`Could not detach tab: ${String(error)}`, 'error');
    }
  }

  function updateTabDropTarget(target: DropTarget<number> | null) {
    tabDropTargetRef.current = target;
    setTabDropTarget((current) => (
      current?.id === target?.id && current?.position === target?.position ? current : target
    ));
  }

  function trackTabDropTarget(clientX: number, clientY: number) {
    const draggedId = draggedTabIdRef.current;
    if (draggedId === null || (clientX === 0 && clientY === 0)) return;
    const target = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('[data-tab-id]');
    if (!target) {
      updateTabDropTarget(null);
      return;
    }
    const targetId = Number(target.dataset.tabId);
    if (!Number.isFinite(targetId) || targetId === draggedId) {
      updateTabDropTarget(null);
      return;
    }
    const bounds = target.getBoundingClientRect();
    updateTabDropTarget({
      id: targetId,
      position: clientX < bounds.left + bounds.width / 2 ? 'before' : 'after',
    });
  }

  function resetTabPointerDrag() {
    tabPointerDragRef.current = null;
    draggedTabIdRef.current = null;
    tabDropTargetRef.current = null;
    setDraggedTabId(null);
    setTabDropTarget(null);
  }

  function handleTabPointerDown(event: ReactPointerEvent<HTMLElement>, tabId: number) {
    if (isDetached || event.button !== 0) return;
    if ((event.target as HTMLElement).closest('.tab-close')) return;
    tabPointerDragRef.current = {
      id: tabId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleTabPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const drag = tabPointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.dragging) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return;
      drag.dragging = true;
      draggedTabIdRef.current = drag.id;
      tabDropTargetRef.current = null;
      setDraggedTabId(drag.id);
      setTabDropTarget(null);
    }
    trackTabDropTarget(event.clientX, event.clientY);
  }

  function handleTabPointerUp(event: ReactPointerEvent<HTMLElement>) {
    const drag = tabPointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!drag.dragging) {
      tabPointerDragRef.current = null;
      return;
    }

    event.preventDefault();
    suppressTabClickRef.current = true;
    window.setTimeout(() => { suppressTabClickRef.current = false; }, 0);
    trackTabDropTarget(event.clientX, event.clientY);
    const target = tabDropTargetRef.current;

    const endedInsideWindow = event.clientX >= 0
      && event.clientY >= 0
      && event.clientX <= window.innerWidth
      && event.clientY <= window.innerHeight;
    resetTabPointerDrag();

    if (target && target.id !== drag.id) {
      setTabs((current) => reorderItems(current, drag.id, target.id, target.position));
    } else if (!endedInsideWindow) {
      void detachTab(drag.id);
    }
  }

  function handleTabPointerCancel(event: ReactPointerEvent<HTMLElement>) {
    const drag = tabPointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    resetTabPointerDrag();
  }

  async function openPortableLibrary() {
    if (!isTauriRuntime) {
      flash('File controls are available in the native app', 'warning');
      return;
    }
    try {
      if (libraryReady && libraryPath) {
        await invoke('save_library_file', {
          path: libraryPath,
          contents: serializeLibraryDocument(library),
        });
      }
      const path = await invoke<string | null>('pick_library_file');
      if (path) await loadLibraryAtPath(path, true);
    } catch (error) {
      flash(`Could not open library: ${String(error)}`, 'error');
    }
  }

  async function savePortableLibraryAs() {
    if (!isTauriRuntime) {
      flash('File controls are available in the native app', 'warning');
      return;
    }
    try {
      const selectedPath = await invoke<string | null>('pick_library_save_path');
      if (!selectedPath) return;
      const path = selectedPath.toLocaleLowerCase().endsWith('.riftdrift')
        ? selectedPath
        : `${selectedPath}.riftdrift`;
      const savedPath = await invoke<string>('save_library_file', {
        path,
        contents: serializeLibraryDocument(library),
      });
      setLibraryPath(savedPath);
      setLibraryReady(true);
      setLibraryError('');
      localStorage.setItem(activeLibraryPathKey, savedPath);
      flash(`Saved ${fileName(savedPath)}`);
    } catch (error) {
      flash(`Could not save library: ${String(error)}`, 'error');
    }
  }

  function openNewSection(commandId?: string) {
    setSaveMenuCommandId(null);
    setSectionEditor({ sectionId: null, name: '', confirmDelete: false, commandId });
  }

  function updateSectionDropTarget(target: DropTarget<string> | null) {
    sectionDropTargetRef.current = target;
    setSectionDropTarget((current) => (
      current?.id === target?.id && current?.position === target?.position ? current : target
    ));
  }

  function trackSectionDropTarget(clientX: number, clientY: number) {
    const draggedId = draggedSectionIdRef.current;
    if (!draggedId || (clientX === 0 && clientY === 0)) return;
    const target = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('[data-section-id]');
    if (!target) {
      updateSectionDropTarget(null);
      return;
    }
    const targetId = target.dataset.sectionId;
    if (!targetId || targetId === draggedId) {
      updateSectionDropTarget(null);
      return;
    }
    const bounds = target.getBoundingClientRect();
    updateSectionDropTarget({
      id: targetId,
      position: targetId === lastSectionId || clientY < bounds.top + bounds.height / 2
        ? 'before'
        : 'after',
    });
  }

  function resetSectionPointerDrag() {
    sectionPointerDragRef.current = null;
    draggedSectionIdRef.current = null;
    sectionDropTargetRef.current = null;
    setDraggedSectionId(null);
    setSectionDropTarget(null);
  }

  function handleSectionPointerDown(event: ReactPointerEvent<HTMLButtonElement>, sectionId: string) {
    if (event.button !== 0) return;
    sectionPointerDragRef.current = {
      id: sectionId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleSectionPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = sectionPointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.dragging) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return;
      drag.dragging = true;
      draggedSectionIdRef.current = drag.id;
      sectionDropTargetRef.current = null;
      setDraggedSectionId(drag.id);
      setSectionDropTarget(null);
    }
    trackSectionDropTarget(event.clientX, event.clientY);
  }

  function handleSectionPointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = sectionPointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!drag.dragging) {
      sectionPointerDragRef.current = null;
      return;
    }

    event.preventDefault();
    suppressSectionClickRef.current = true;
    window.setTimeout(() => { suppressSectionClickRef.current = false; }, 0);
    trackSectionDropTarget(event.clientX, event.clientY);
    const target = sectionDropTargetRef.current;
    const endedInsideWindow = event.clientX > 0
      && event.clientY > 0
      && event.clientX < window.innerWidth
      && event.clientY < window.innerHeight;
    resetSectionPointerDrag();

    if (endedInsideWindow && target && target.id !== drag.id) {
      setLibrary((current) => ({
        ...current,
        sections: reorderItems(current.sections, drag.id, target.id, target.position),
      }));
    }
  }

  function handleSectionPointerCancel(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = sectionPointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    resetSectionPointerDrag();
  }

  function updateCommandDropTarget(target: DropTarget<string> | null) {
    commandDropTargetRef.current = target;
    setCommandDropTarget((current) => (
      current?.id === target?.id && current?.position === target?.position ? current : target
    ));
  }

  function trackCommandDropTarget(clientX: number, clientY: number, sectionId: string) {
    const draggedId = draggedCommandIdRef.current;
    if (!draggedId || (clientX === 0 && clientY === 0)) return;
    const target = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('[data-saved-command-id]');
    const targetId = target?.dataset.savedCommandId;
    if (!target || !targetId || target.dataset.commandSectionId !== sectionId || targetId === draggedId) {
      updateCommandDropTarget(null);
      return;
    }
    const bounds = target.getBoundingClientRect();
    updateCommandDropTarget({
      id: targetId,
      position: clientY < bounds.top + bounds.height / 2 ? 'before' : 'after',
    });
  }

  function resetCommandPointerDrag() {
    commandPointerDragRef.current = null;
    draggedCommandIdRef.current = null;
    commandDropTargetRef.current = null;
    setDraggedCommandId(null);
    setCommandDropTarget(null);
  }

  function handleCommandPointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
    commandId: string,
    sectionId: string,
  ) {
    if (event.button !== 0) return;
    event.stopPropagation();
    commandPointerDragRef.current = {
      id: commandId,
      sectionId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleCommandPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = commandPointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.dragging) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return;
      drag.dragging = true;
      draggedCommandIdRef.current = drag.id;
      commandDropTargetRef.current = null;
      setDraggedCommandId(drag.id);
      setCommandDropTarget(null);
      setSaveMenuCommandId(null);
    }
    trackCommandDropTarget(event.clientX, event.clientY, drag.sectionId);
  }

  function handleCommandPointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = commandPointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!drag.dragging) {
      commandPointerDragRef.current = null;
      return;
    }

    event.preventDefault();
    trackCommandDropTarget(event.clientX, event.clientY, drag.sectionId);
    const target = commandDropTargetRef.current;
    resetCommandPointerDrag();

    if (!target || target.id === drag.id) return;
    setLibrary((current) => {
      const commands = sortSavedCommands(current.history.filter((command) => (
        command.sectionId === drag.sectionId
      )));
      const reordered = reorderItems(commands, drag.id, target.id, target.position);
      const savedOrder = new Map(reordered.map((command, index) => [command.id, index]));
      return {
        ...current,
        history: current.history.map((command) => (
          command.sectionId === drag.sectionId
            ? { ...command, savedOrder: savedOrder.get(command.id) ?? command.savedOrder }
            : command
        )),
      };
    });
  }

  function handleCommandPointerCancel(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = commandPointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    resetCommandPointerDrag();
  }

  function submitSection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sectionEditor) return;
    const name = sectionEditor.name.trim();
    if (!name) return;
    const duplicate = library.sections.some((section) => (
      section.id !== sectionEditor.sectionId && section.name.toLocaleLowerCase() === name.toLocaleLowerCase()
    ));
    if (duplicate) {
      flash('A section with this name already exists', 'warning');
      return;
    }

    if (sectionEditor.sectionId) {
      setLibrary((current) => ({
        ...current,
        sections: current.sections.map((section) => (
          section.id === sectionEditor.sectionId ? { ...section, name } : section
        )),
      }));
      flash(`Renamed section to ${name}`);
    } else {
      const id = createLibraryId('section');
      setLibrary((current) => {
        const sections = [...current.sections, { id, name }];
        const history = sectionEditor.commandId
          ? current.history.map((command) => (
            command.id === sectionEditor.commandId ? { ...command, sectionId: id, savedOrder: 0 } : command
          ))
          : current.history;
        return {
          ...current,
          sections,
          history: normalizeSavedCommandOrder(history, sections),
        };
      });
      setOpenSections((current) => ({ ...current, [id]: true }));
      flash(`Created ${name}`);
    }
    setSectionEditor(null);
  }

  function deleteSection(sectionId: string) {
    const section = library.sections.find((item) => item.id === sectionId);
    setLibrary((current) => {
      const sections = current.sections.filter((item) => item.id !== sectionId);
      const history = limitCommandHistory(current.history.map((command) => (
        command.sectionId === sectionId
          ? { ...command, sectionId: null, displayName: null, savedOrder: null }
          : command
      )));
      return { ...current, sections, history: normalizeSavedCommandOrder(history, sections) };
    });
    setOpenSections((current) => {
      const next = { ...current };
      delete next[sectionId];
      return next;
    });
    setSectionEditor(null);
    flash(`${section?.name ?? 'Section'} deleted; history was kept`);
  }

  function saveCommandToSection(commandId: string, sectionId: string) {
    setLibrary((current) => {
      const command = current.history.find((item) => item.id === commandId);
      if (!command || command.sectionId === sectionId) return current;
      const history = current.history.map((item) => (
        item.id === commandId
          ? { ...item, sectionId, savedOrder: Number.MAX_SAFE_INTEGER }
          : item
      ));
      return {
        ...current,
        history: normalizeSavedCommandOrder(history, current.sections),
      };
    });
    setSaveMenuCommandId(null);
    const section = library.sections.find((item) => item.id === sectionId);
    flash(`Saved to ${section?.name ?? 'section'}`);
  }

  function removeCommandFromSection(commandId: string) {
    setLibrary((current) => {
      const history = limitCommandHistory(current.history.map((command) => (
        command.id === commandId
          ? { ...command, sectionId: null, displayName: null, savedOrder: null }
          : command
      )));
      return {
        ...current,
        history: normalizeSavedCommandOrder(history, current.sections),
      };
    });
    flash('Removed from section; kept in Last');
  }

  function submitCommandRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!commandEditor) return;
    const name = commandEditor.name.trim();
    if (!name) return;
    setLibrary((current) => ({
      ...current,
      history: current.history.map((command) => (
        command.id === commandEditor.commandId ? { ...command, displayName: name } : command
      )),
    }));
    setCommandEditor(null);
    flash(`Command renamed to ${name}`);
  }

  function chooseCommand(command: string) {
    const terminal = terminalRef.current;
    if (!terminal) {
      flash('Terminal is not ready yet', 'warning');
      return;
    }
    terminal.insert(command);
    window.requestAnimationFrame(() => terminalRef.current?.focus());
    flash('Command inserted into terminal');
  }

  function startWindowDrag(event: ReactMouseEvent<HTMLElement>) {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, input, textarea, select, a, [role="button"], [role="tab"]')) return;
    event.preventDefault();
    void invoke('window_control', { action: 'drag' });
  }

  return (
    <main className="desktop desktop-native">
      <section className="app-shell" aria-label="RiftDrift terminal application">
        <header className="titlebar window-drag-area" onMouseDown={startWindowDrag}>
          <div className="traffic-lights native-traffic-space" aria-hidden="true" />
          <div className="brand" aria-label="RiftDrift">
            <span className="brand-mark">R</span>
            <span>RIFTDRIFT</span>
            <span className="brand-status">NATIVE</span>
          </div>
          <div className="title-actions">
            <span className="connection"><i /> shell</span>
            <button
              className={`library-trigger ${sidebarOpen ? 'active' : ''}`}
              onClick={() => setSidebarOpen((value) => !value)}
              aria-label="Toggle command libraries"
              aria-expanded={sidebarOpen}
            >
              <span className="library-lines"><i /><i /><i /></span>
              <span className="library-label">Library</span>
              <kbd>{libraryShortcut}</kbd>
            </button>
          </div>
        </header>

        <div className="tabbar window-drag-area" onMouseDown={startWindowDrag}>
          <div className="tabs" role="tablist" aria-label="Terminal tabs">
            {tabs.map((tab) => (
              <div
                key={tab.id}
                data-tab-id={tab.id}
                className={`tab ${activeTab === tab.id ? 'active' : ''} ${draggedTabId === tab.id ? 'dragging' : ''} ${tabDropTarget?.id === tab.id ? `drop-${tabDropTarget.position}` : ''}`}
                onClick={() => {
                  if (suppressTabClickRef.current) {
                    suppressTabClickRef.current = false;
                    return;
                  }
                  setActiveTab(tab.id);
                }}
                onDoubleClick={() => void detachTab(tab.id)}
                onPointerDown={(event) => handleTabPointerDown(event, tab.id)}
                onPointerMove={handleTabPointerMove}
                onPointerUp={handleTabPointerUp}
                onPointerCancel={handleTabPointerCancel}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  setActiveTab(tab.id);
                }}
                role="tab"
                tabIndex={activeTab === tab.id ? 0 : -1}
                aria-selected={activeTab === tab.id}
                aria-grabbed={draggedTabId === tab.id}
                title={isDetached ? tab.name : 'Drag to reorder; drag outside the window or double-click to detach'}
              >
                <span className="tab-terminal">›_</span>
                <span>{tab.name}</span>
                <button
                  type="button"
                  className="tab-close"
                  aria-label={`Close ${tab.name}`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    void closeTab(tab.id);
                  }}
                >×</button>
              </div>
            ))}
          </div>
          {!isDetached && <button className="new-tab" onClick={() => void createTab()} aria-label="New terminal tab">+</button>}
          <span className="drag-hint">{isDetached ? 'DETACHED SESSION' : 'DRAG TO REORDER · OUT TO DETACH'}</span>
        </div>

        <div className={`workspace ${sidebarOpen ? 'sidebar-visible' : ''}`}>
          <section className="terminal" aria-label="Terminal">
            <div className="terminal-meta">
              <div><span className="meta-label">SESSION</span><span className="meta-value">{active?.name ?? 'starting…'}</span></div>
              <div className="terminal-path">{active?.path ?? '~'}</div>
              <div className="session-live"><i /> LIVE PTY</div>
            </div>

            <div className="terminal-body terminal-native">
              {active ? (
                <TerminalPane
                  ref={terminalRef}
                  sessionId={active.sessionId}
                  history={commands.map((command) => command.text)}
                  onCommand={rememberCommand}
                />
              ) : (
                <div className="terminal-loading">
                  {isTauriRuntime ? 'Starting shell…' : 'Native PTY starts with npm run dev.'}
                </div>
              )}
            </div>
          </section>

          <aside className="command-panel" aria-label="Command libraries">
            <div className="library-toolbar">
              <div className="library-heading">
                <span>Library</span>
                <small className={libraryError ? 'file-error' : ''} title={libraryError || libraryPath}>
                  {libraryError
                    ? 'File unavailable'
                    : libraryReady
                      ? fileName(libraryPath)
                      : 'Loading file…'}
                </small>
              </div>
              <div className="library-file-actions">
                <button onClick={() => void openPortableLibrary()} title="Open a portable .riftdrift file">Open</button>
                <button onClick={() => void savePortableLibraryAs()} title="Save a portable copy">Save as</button>
              </div>
              <button className="new-section-button" onClick={() => openNewSection()}>
                <span>+</span> New section
              </button>
            </div>
            <div className="sections">
              {sections.map((section) => (
                <section
                  data-section-id={section.id}
                  className={`library-section ${section.id === lastSectionId ? 'section-last' : 'section-user'} ${openSections[section.id] ? 'open' : ''} ${draggedSectionId === section.id ? 'dragging' : ''} ${sectionDropTarget?.id === section.id ? `drop-${sectionDropTarget.position}` : ''}`}
                  key={section.id}
                >
                  <div className="section-header">
                    <button
                      className="section-toggle"
                      data-reorderable={section.editable || undefined}
                      onPointerDown={section.editable
                        ? (event) => handleSectionPointerDown(event, section.id)
                        : undefined}
                      onPointerMove={section.editable ? handleSectionPointerMove : undefined}
                      onPointerUp={section.editable ? handleSectionPointerUp : undefined}
                      onPointerCancel={section.editable ? handleSectionPointerCancel : undefined}
                      onClick={() => {
                        if (suppressSectionClickRef.current) {
                          suppressSectionClickRef.current = false;
                          return;
                        }
                        setOpenSections((current) => ({
                          ...current,
                          [section.id]: !current[section.id],
                        }));
                      }}
                      aria-expanded={Boolean(openSections[section.id])}
                      aria-grabbed={section.editable ? draggedSectionId === section.id : undefined}
                      title={section.editable ? 'Drag to reorder section' : undefined}
                    >
                      <span className={`chevron ${openSections[section.id] ? 'open' : ''}`}>›</span>
                      <span className="section-labels">
                        <span className="section-title">{section.name}</span>
                        <span className="section-hint">{section.hint}</span>
                      </span>
                      <span className="section-count">{String(section.items.length).padStart(2, '0')}</span>
                    </button>
                    {section.editable && (
                      <button
                        className="section-edit"
                        onClick={() => setSectionEditor({
                          sectionId: section.id,
                          name: section.name,
                          confirmDelete: false,
                        })}
                        aria-label={`Rename or delete ${section.name}`}
                        title="Rename or delete section"
                      ><PencilIcon /></button>
                    )}
                  </div>
                  {openSections[section.id] && (
                    <div className="command-list">
                      {section.items.length ? section.items.map((command) => (
                        <article
                          className={`command-card ${section.editable ? 'reorderable' : ''} ${section.editable && draggedCommandId === command.id ? 'dragging' : ''} ${section.editable && commandDropTarget?.id === command.id ? `drop-${commandDropTarget.position}` : ''}`}
                          data-saved-command-id={section.editable ? command.id : undefined}
                          data-command-section-id={section.editable ? section.id : undefined}
                          key={`${section.id}-${command.id}`}
                        >
                          {section.editable && (
                            <button
                              className="command-drag-handle"
                              onPointerDown={(event) => handleCommandPointerDown(event, command.id, section.id)}
                              onPointerMove={handleCommandPointerMove}
                              onPointerUp={handleCommandPointerUp}
                              onPointerCancel={handleCommandPointerCancel}
                              aria-label="Reorder command"
                              title="Drag to reorder command"
                            ><DragHandleIcon /></button>
                          )}
                          <div className="save-control">
                            <button
                              className={`command-save ${command.sectionId ? 'active' : ''}`}
                              onClick={() => setSaveMenuCommandId((current) => current === command.id ? null : command.id)}
                              aria-label={command.sectionId ? 'Move saved command to another section' : 'Save command to a section'}
                              aria-expanded={saveMenuCommandId === command.id}
                              title={command.sectionId ? 'Change section' : 'Save to section'}
                            ><SaveIcon /></button>
                            {saveMenuCommandId === command.id && (
                              <div className="section-menu" role="menu">
                                <div className="section-menu-title">Save to section</div>
                                {library.sections.map((item) => (
                                  <button
                                    className={command.sectionId === item.id ? 'selected' : ''}
                                    onClick={() => saveCommandToSection(command.id, item.id)}
                                    role="menuitem"
                                    key={item.id}
                                  >
                                    <span>{command.sectionId === item.id ? '✓' : ''}</span>{item.name}
                                  </button>
                                ))}
                                <button className="create-from-menu" onClick={() => openNewSection(command.id)} role="menuitem">
                                  <span>+</span>{library.sections.length ? 'New section…' : 'Create your first section…'}
                                </button>
                              </div>
                            )}
                          </div>
                          <button
                            className="command-text"
                            onClick={() => chooseCommand(command.text)}
                            title={command.text}
                          >
                            <code className={section.id !== lastSectionId && command.displayName ? 'command-name' : undefined}>
                              {section.id !== lastSectionId && command.displayName
                                ? command.displayName
                                : colorizeCommand(command.text)}
                            </code>
                          </button>
                          {command.sectionId && (
                            <div className="command-row-actions">
                              <button
                                className="command-rename"
                                onClick={() => setCommandEditor({
                                  commandId: command.id,
                                  name: command.displayName ?? '',
                                })}
                                aria-label="Rename command"
                                title="Rename command"
                              ><PencilIcon /></button>
                              <button
                                className="command-delete"
                                onClick={() => removeCommandFromSection(command.id)}
                                aria-label="Remove command from section"
                                title="Remove from section (keeps it in Last)"
                              ><TrashIcon /></button>
                            </div>
                          )}
                        </article>
                      )) : (
                        <p className="empty-state">
                          {section.id === lastSectionId ? 'Run a command and it will appear here.' : 'No commands saved here yet.'}
                        </p>
                      )}
                    </div>
                  )}
                </section>
              ))}
            </div>
          </aside>
        </div>

        <footer className="statusbar">
          <span><i className="status-dot" /> {tabs.length} {tabs.length === 1 ? 'PROCESS' : 'PROCESSES'}</span>
          <span className="status-spacer" /><span>UTF-8</span><span>TRUECOLOR</span><span className="branch">LOCAL · ARM64</span>
        </footer>
        {toast && (
          <div className={`toast ${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'}>
            <span>{toast.tone === 'error' ? '!' : toast.tone === 'warning' ? '▲' : '✓'}</span>{toast.message}
          </div>
        )}
        {sectionEditor && (
          <div className="modal-backdrop" onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSectionEditor(null);
          }}>
            <form
              className="section-modal"
              onSubmit={sectionEditor.confirmDelete ? (event) => {
                event.preventDefault();
                if (sectionEditor.sectionId) deleteSection(sectionEditor.sectionId);
              } : submitSection}
            >
              {sectionEditor.confirmDelete ? (
                <>
                  <div className="modal-icon danger"><TrashIcon /></div>
                  <h2>Delete “{sectionEditor.name}”?</h2>
                  <p>All commands saved in this section will be removed from it. Their entries in Last history will be kept.</p>
                  <div className="modal-actions">
                    <button type="button" onClick={() => setSectionEditor((current) => (
                      current ? { ...current, confirmDelete: false } : null
                    ))}>Cancel</button>
                    <button className="danger-button" type="submit">Delete section</button>
                  </div>
                </>
              ) : (
                <>
                  <h2>{sectionEditor.sectionId ? 'Edit section' : 'New section'}</h2>
                  <label htmlFor="section-name">Section name</label>
                  <input
                    id="section-name"
                    value={sectionEditor.name}
                    onChange={(event) => setSectionEditor((current) => (
                      current ? { ...current, name: event.target.value } : null
                    ))}
                    maxLength={80}
                    autoFocus
                    required
                  />
                  <div className="modal-actions">
                    {sectionEditor.sectionId && (
                      <button
                        className="delete-section-button"
                        type="button"
                        onClick={() => setSectionEditor((current) => (
                          current ? { ...current, confirmDelete: true } : null
                        ))}
                      >Delete</button>
                    )}
                    <span />
                    <button type="button" onClick={() => setSectionEditor(null)}>Cancel</button>
                    <button className="primary-button" type="submit">OK</button>
                  </div>
                </>
              )}
            </form>
          </div>
        )}
        {commandEditor && (
          <div className="modal-backdrop" onMouseDown={(event) => {
            if (event.target === event.currentTarget) setCommandEditor(null);
          }}>
            <form className="section-modal" onSubmit={submitCommandRename}>
              <h2>Rename command</h2>
              <label htmlFor="command-name">Command name</label>
              <input
                id="command-name"
                value={commandEditor.name}
                onChange={(event) => setCommandEditor((current) => (
                  current ? { ...current, name: event.target.value } : null
                ))}
                maxLength={120}
                autoFocus
                required
              />
              <p>The full command will remain visible when you hover over its name.</p>
              <div className="modal-actions">
                <span />
                <button type="button" onClick={() => setCommandEditor(null)}>Cancel</button>
                <button className="primary-button" type="submit">OK</button>
              </div>
            </form>
          </div>
        )}
      </section>
    </main>
  );
}
