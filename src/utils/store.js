const STORE_KEY = 'ccdesktop_sessions';
const SETTINGS_KEY = 'ccdesktop_settings';
const DEFAULT_SETTINGS = {
  theme: 'dark',
  fontSize: 14,
  cwd: '',
  workspaces: [],
  workspacePanelCollapsed: false,
  model: '',
  codexModel: '',
  codexReasoningEffort: '',
  permissionMode: 'default',
  provider: 'claude',
  language: 'en',
  autoRunDefaultCount: 5,
  autoRunPrompt: 'Review the current goal and plan, then execute the next step.',
};

export function summarizeMessages(messages = []) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return {
      messageCount: 0,
      lastMessagePreview: '',
      hasAttachments: false,
    };
  }

  const lastAssistant = [...messages].reverse().find((message) => message.role === 'assistant' && message.content);
  const lastUser = [...messages].reverse().find((message) => message.role === 'user' && message.content);
  const previewSource = lastAssistant || lastUser || messages[messages.length - 1] || null;

  return {
    messageCount: messages.length,
    lastMessagePreview: previewSource?.content
      ? previewSource.content.slice(0, 120).replace(/\n/g, ' ')
      : '',
    hasAttachments: messages.some((message) => Array.isArray(message.attachments) && message.attachments.length > 0),
  };
}

export function loadSessions() {
  try {
    const data = localStorage.getItem(STORE_KEY);
    return data ? JSON.parse(data).map(normalizeSession) : [];
  } catch {
    return [];
  }
}

export function saveSessions(sessions) {
  localStorage.setItem(STORE_KEY, JSON.stringify(sessions.map(serializeSession)));
}

export function loadSettings() {
  try {
    const data = localStorage.getItem(SETTINGS_KEY);
    return data ? normalizeSettings(JSON.parse(data)) : normalizeSettings();
  } catch {
    return normalizeSettings();
  }
}

export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(settings)));
}

export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function createSession(cwd = '', provider = 'claude', config = {}) {
  return {
    id: generateId(),
    provider,
    model: typeof config.model === 'string' ? config.model : '',
    reasoningEffort: typeof config.reasoningEffort === 'string' ? config.reasoningEffort : '',
    permissionMode: typeof config.permissionMode === 'string' ? config.permissionMode : 'default',
    providerSessionId: null,
    providerSessionCwd: cwd || '',
    syncWithCli: false,
    externalCliPid: null,
    hasUnread: false,
    title: 'New Chat',
    messages: [],
    messageCount: 0,
    lastMessagePreview: '',
    hasAttachments: false,
    conversationId: null,
    autoRunEnabled: false,
    autoRunRemaining: 0,
    autoRunTotal: 0,
    cwd,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function normalizeSession(session) {
  const providerSessionId = session.providerSessionId || session.ccSessionId || null;
  const messages = providerSessionId ? [] : normalizeMessages(session.messages || []);
  const summary = summarizeMessages(messages);

  return {
    ...session,
    provider: session.provider || 'claude',
    model: typeof session.model === 'string' ? session.model : '',
    reasoningEffort: typeof session.reasoningEffort === 'string' ? session.reasoningEffort : '',
    permissionMode: typeof session.permissionMode === 'string' ? session.permissionMode : 'default',
    providerSessionId,
    providerSessionCwd: session.providerSessionCwd || session.cwd || '',
    messages,
    messageCount: typeof session.messageCount === 'number' ? session.messageCount : summary.messageCount,
    lastMessagePreview: typeof session.lastMessagePreview === 'string' ? session.lastMessagePreview : summary.lastMessagePreview,
    hasAttachments: typeof session.hasAttachments === 'boolean' ? session.hasAttachments : summary.hasAttachments,
    syncWithCli: false,
    externalCliPid: null,
    hasUnread: Boolean(session.hasUnread),
    autoRunEnabled: Boolean(session.autoRunEnabled) && getAutoRunCount(session.autoRunRemaining) > 0,
    autoRunRemaining: getAutoRunCount(session.autoRunRemaining),
    autoRunTotal: getAutoRunCount(session.autoRunTotal),
  };
}

function serializeSession(session) {
  const summary = summarizeMessages(session.messages || []);

  return {
    id: session.id,
    provider: session.provider || 'claude',
    model: typeof session.model === 'string' ? session.model : '',
    reasoningEffort: typeof session.reasoningEffort === 'string' ? session.reasoningEffort : '',
    permissionMode: typeof session.permissionMode === 'string' ? session.permissionMode : 'default',
    providerSessionId: session.providerSessionId || session.ccSessionId || null,
    providerSessionCwd: session.providerSessionCwd || session.cwd || '',
    hasUnread: Boolean(session.hasUnread),
    title: session.title || 'New Chat',
    messageCount: typeof session.messageCount === 'number' ? session.messageCount : summary.messageCount,
    lastMessagePreview: typeof session.lastMessagePreview === 'string' ? session.lastMessagePreview : summary.lastMessagePreview,
    hasAttachments: typeof session.hasAttachments === 'boolean' ? session.hasAttachments : summary.hasAttachments,
    conversationId: session.conversationId || null,
    autoRunEnabled: Boolean(session.autoRunEnabled) && getAutoRunCount(session.autoRunRemaining) > 0,
    autoRunRemaining: getAutoRunCount(session.autoRunRemaining),
    autoRunTotal: getAutoRunCount(session.autoRunTotal),
    cwd: session.cwd || '',
    createdAt: session.createdAt || Date.now(),
    updatedAt: session.updatedAt || session.createdAt || Date.now(),
  };
}

function getAutoRunCount(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, Math.min(parsed, 99));
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages.map((message) => ({
    ...message,
    toolCalls: normalizeToolCalls(message.toolCalls || []),
  }));
}

function normalizeToolCalls(toolCalls) {
  if (!Array.isArray(toolCalls)) {
    return [];
  }

  return toolCalls.map((tool) => ({
    ...tool,
    status: tool.status === 'running' ? 'error' : (tool.status || 'completed'),
  }));
}

function normalizeSettings(settings) {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    cwd: typeof settings?.cwd === 'string' ? settings.cwd : '',
    workspaces: normalizeWorkspaceList(settings?.workspaces),
    workspacePanelCollapsed: Boolean(settings?.workspacePanelCollapsed),
  };
}

function normalizeWorkspaceList(workspaces) {
  if (!Array.isArray(workspaces)) {
    return [];
  }

  const next = [];
  const seen = new Set();

  workspaces.forEach((workspace) => {
    const path = typeof workspace === 'string'
      ? workspace.trim()
      : (typeof workspace?.path === 'string' ? workspace.path.trim() : '');
    if (!path) {
      return;
    }

    const key = path.toLowerCase();
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    next.push(path);
  });

  return next.slice(0, 12);
}
