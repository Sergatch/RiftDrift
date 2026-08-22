import type { ReactNode } from 'react';

export type LibrarySection = {
  id: string;
  name: string;
};

export type LibraryCommand = {
  id: string;
  text: string;
  sectionId: string | null;
  displayName: string | null;
  savedOrder: number | null;
};

export type LibraryDocument = {
  version: 2;
  sections: LibrarySection[];
  history: LibraryCommand[];
};

export const MAX_HISTORY_COMMANDS = 999;

export function limitCommandHistory(history: LibraryCommand[]) {
  return history.filter((command, index) => index < MAX_HISTORY_COMMANDS || command.sectionId !== null);
}

type LegacyCommand = {
  id?: string | number;
  text?: string;
  starred?: boolean;
  saved?: boolean;
};

export const emptyLibraryDocument = (): LibraryDocument => ({
  version: 2,
  sections: [],
  history: [],
});

export function createLibraryId(prefix: 'section' | 'command') {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ? `${prefix}-${uuid}` : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function sortSavedCommands(commands: LibraryCommand[]) {
  return [...commands].sort((left, right) => {
    const leftOrder = left.savedOrder ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = right.savedOrder ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder;
  });
}

export function normalizeSavedCommandOrder(history: LibraryCommand[], sections: LibrarySection[]) {
  const normalizedOrder = new Map<string, number>();
  for (const section of sections) {
    sortSavedCommands(history.filter((command) => command.sectionId === section.id))
      .forEach((command, index) => normalizedOrder.set(command.id, index));
  }
  return history.map((command) => ({
    ...command,
    savedOrder: command.sectionId ? normalizedOrder.get(command.id) ?? null : null,
  }));
}

export function parseLibraryDocument(contents: string): LibraryDocument {
  const candidate = JSON.parse(contents) as Partial<LibraryDocument>;
  if (candidate.version !== 2 || !Array.isArray(candidate.sections) || !Array.isArray(candidate.history)) {
    throw new Error('This is not a supported RiftDrift library file.');
  }

  const usedSectionIds = new Set<string>();
  const usedNames = new Set<string>();
  const sections = candidate.sections.flatMap((item) => {
    if (!item || typeof item.name !== 'string') return [];
    const name = item.name.trim();
    const id = typeof item.id === 'string' && item.id ? item.id : createLibraryId('section');
    const normalizedName = name.toLocaleLowerCase();
    if (!name || usedSectionIds.has(id) || usedNames.has(normalizedName)) return [];
    usedSectionIds.add(id);
    usedNames.add(normalizedName);
    return [{ id, name }];
  });

  const usedCommandIds = new Set<string>();
  const seenCommands = new Set<string>();
  const history = candidate.history.flatMap((item) => {
    if (!item || typeof item.text !== 'string') return [];
    const text = item.text.trim();
    if (!text || seenCommands.has(text)) return [];
    seenCommands.add(text);
    let id = typeof item.id === 'string' && item.id ? item.id : createLibraryId('command');
    if (usedCommandIds.has(id)) id = createLibraryId('command');
    usedCommandIds.add(id);
    return [{
      id,
      text,
      sectionId: typeof item.sectionId === 'string' && usedSectionIds.has(item.sectionId)
        ? item.sectionId
        : null,
      displayName: typeof item.displayName === 'string' && item.displayName.trim()
        ? item.displayName.trim()
        : null,
      savedOrder: typeof item.savedOrder === 'number' && Number.isFinite(item.savedOrder) && item.savedOrder >= 0
        ? item.savedOrder
        : null,
    }];
  });

  return { version: 2, sections, history: limitCommandHistory(normalizeSavedCommandOrder(history, sections)) };
}

export function migrateLegacyCommands(value: unknown): LibraryDocument {
  if (!Array.isArray(value)) return emptyLibraryDocument();
  const commands = value.filter((item): item is LegacyCommand => Boolean(item && typeof item === 'object'));
  const hasStarred = commands.some((item) => item.starred && typeof item.text === 'string');
  const hasFavorite = commands.some((item) => !item.starred && item.saved && typeof item.text === 'string');
  const sections: LibrarySection[] = [];
  const starredId = hasStarred ? createLibraryId('section') : null;
  const favoriteId = hasFavorite ? createLibraryId('section') : null;
  if (starredId) sections.push({ id: starredId, name: 'Starred' });
  if (favoriteId) sections.push({ id: favoriteId, name: 'Favorite' });

  const seen = new Set<string>();
  const history = commands.flatMap((item) => {
    if (typeof item.text !== 'string') return [];
    const text = item.text.trim();
    if (!text || seen.has(text)) return [];
    seen.add(text);
    return [{
      id: item.id === undefined ? createLibraryId('command') : `legacy-${item.id}`,
      text,
      sectionId: item.starred ? starredId : item.saved ? favoriteId : null,
      displayName: null,
      savedOrder: null,
    }];
  });

  return { version: 2, sections, history: limitCommandHistory(normalizeSavedCommandOrder(history, sections)) };
}

export function serializeLibraryDocument(document: LibraryDocument) {
  return JSON.stringify(document, null, 2);
}

function tokenClass(token: string, commandExpected: boolean) {
  if (/^(['"]).*\1$/.test(token)) return 'syntax-string';
  if (/^https?:\/\//i.test(token) || /^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?$/.test(token)) return 'syntax-address';
  if (/^(?:~|\.{0,2}\/|\/)/.test(token) || (/\//.test(token) && !token.startsWith('-'))) return 'syntax-path';
  if (/^--?[\w-]+/.test(token)) return 'syntax-option';
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) return 'syntax-variable';
  if (commandExpected) return 'syntax-command';
  return '';
}

export function colorizeCommand(text: string): ReactNode[] {
  const tokens = text.match(/(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|https?:\/\/[^\s|;&<>]+|&&|\|\||[|;<>]|\s+|[^\s|;&<>]+)/g) ?? [text];
  let commandExpected = true;

  return tokens.map((token, index) => {
    if (/^\s+$/.test(token)) return token;
    if (/^(?:&&|\|\||\||;|>|<)$/.test(token)) {
      commandExpected = /^(?:&&|\|\||\||;)$/.test(token);
      return <span className="syntax-operator" key={`${index}-${token}`}>{token}</span>;
    }
    const className = tokenClass(token, commandExpected);
    if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) commandExpected = false;
    return <span className={className || undefined} key={`${index}-${token}`}>{token}</span>;
  });
}
