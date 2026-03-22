import React, { useState, useEffect, useCallback, useRef } from 'react';
import { FolderOpen, Copy, Check, ExternalLink, RotateCw } from 'lucide-react';
import TitleBar from './components/TitleBar';
import Sidebar from './components/Sidebar';
import ChatView from './components/ChatView';
import InputArea from './components/InputArea';
import SettingsPanel from './components/Settings';
import HistoryPanel from './components/HistoryPanel';
import WorkspacePanel from './components/WorkspacePanel';
import { useAgent } from './hooks/useAgent';
import { useTheme } from './hooks/useTheme';
import { loadSessions, saveSessions, createSession, summarizeMessages } from './utils/store';
import { createI18n, I18nProvider, localizeSessionTitle, useI18n } from './i18n';

const PROVIDER_LABELS = {
  claude: 'Claude Code',
  codex: 'Codex',
};

const CLI_SYNC_INTERVAL_MS = 4000;
const AUTO_RUN_IDLE_MS = 3000;
const DEFAULT_AUTO_RUN_PROMPT = 'Review the current goal and plan, then execute the next step.';

export default function App() {
  const { settings, toggleTheme, updateSettings } = useTheme();
  const i18n = createI18n(settings.language);
  const { tx } = i18n;
  const {
    sendMessage,
    abort,
    isStreaming,
    streamingText,
    streamingToolCalls,
    thinkingText,
    progressInfo,
    contextUsage,
    turnTimer,
    setViewingSession,
    cleanupSession,
  } = useAgent();

  const [sessions, setSessions] = useState(() => {
    const saved = loadSessions();
    if (saved.length > 0) {
      return saved;
    }

    const initialProvider = settings.provider || 'claude';
    return [createSession(settings.cwd, initialProvider, {
      model: initialProvider === 'claude' ? (settings.model || '') : (settings.codexModel || ''),
      reasoningEffort: initialProvider === 'codex' ? (settings.codexReasoningEffort || '') : '',
      permissionMode: normalizePermissionModeForProvider(initialProvider, settings.permissionMode || 'default'),
    })];
  });
  const [activeSessionId, setActiveSessionId] = useState(sessions[0]?.id);
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [workspaceHighlightsBySession, setWorkspaceHighlightsBySession] = useState(() => ({}));
  const [workspaceRefreshBySession, setWorkspaceRefreshBySession] = useState(() => ({}));
  const [providerAvailability, setProviderAvailability] = useState({
    claude: { checked: false, installed: true },
    codex: { checked: false, installed: true },
  });
  const [copiedInstallCommand, setCopiedInstallCommand] = useState(null);
  const [cliLaunchStatus, setCliLaunchStatus] = useState(null);
  const [isActiveSessionLoading, setIsActiveSessionLoading] = useState(false);
  const activeSessionIdRef = useRef(activeSessionId);
  const sessionsRef = useRef(sessions);
  const autoRunTimeoutsRef = useRef(new Map());
  const runningSessionIdsRef = useRef(new Set());
  const autoRunConfigRef = useRef({
    prompt: DEFAULT_AUTO_RUN_PROMPT,
    defaultCount: 5,
  });
  const sendSessionMessageRef = useRef(null);
  const scheduleAutoRunSessionsRef = useRef(() => {});

  const activeSession = sessions.find((session) => session.id === activeSessionId);
  const activeProvider = activeSession?.provider || settings.provider || 'claude';
  const activeProviderStatus = providerAvailability[activeProvider] || { checked: false, installed: true };
  const shouldHydrateActiveSession = Boolean(activeSession?.providerSessionId) && (activeSession?.messages?.length || 0) === 0;
  const defaultAutoRunCount = getConfiguredAutoRunCount(settings.autoRunDefaultCount);
  const autoRunPrompt = getConfiguredAutoRunPrompt(settings.autoRunPrompt);
  const activeAutoRunTotal = getStoredAutoRunCount(activeSession?.autoRunTotal) || defaultAutoRunCount;
  const activeAutoRunRemaining = getStoredAutoRunCount(activeSession?.autoRunRemaining);
  const activeWorkspacePath = activeSession?.cwd || activeSession?.providerSessionCwd || settings.cwd || '';
  const activeWorkspaceHighlights = buildWorkspaceHighlights(
    workspaceHighlightsBySession[activeSession?.id] || {},
    activeWorkspacePath,
    activeSession?.id === activeSessionId ? streamingToolCalls : []
  );
  const activeWorkspaceRefreshToken = workspaceRefreshBySession[activeSession?.id] || 0;

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    autoRunConfigRef.current = {
      prompt: autoRunPrompt,
      defaultCount: defaultAutoRunCount,
    };
  }, [autoRunPrompt, defaultAutoRunCount]);

  const getSessionModel = useCallback((session) => {
    if (!session) {
      return '';
    }

    return session.model || (session.provider === 'claude' ? (settings.model || '') : (settings.codexModel || ''));
  }, [settings.codexModel, settings.model]);

  const getSessionReasoningEffort = useCallback((session) => {
    if (!session || session.provider !== 'codex') {
      return '';
    }

    return session.reasoningEffort || settings.codexReasoningEffort || '';
  }, [settings.codexReasoningEffort]);

  const getSessionPermissionMode = useCallback((session) => {
    const provider = session?.provider || 'claude';
    return normalizePermissionModeForProvider(provider, session?.permissionMode || settings.permissionMode || 'default');
  }, [settings.permissionMode]);

  const createConfiguredSession = useCallback((cwd, provider = 'claude', overrides = {}) => {
    const normalizedProvider = provider === 'codex' ? 'codex' : 'claude';
    const providerActiveSession = activeSession?.provider === normalizedProvider ? activeSession : null;
    const fallbackModel = providerActiveSession
      ? getSessionModel(providerActiveSession)
      : (normalizedProvider === 'claude' ? (settings.model || '') : (settings.codexModel || ''));
    const fallbackReasoningEffort = providerActiveSession
      ? getSessionReasoningEffort(providerActiveSession)
      : (normalizedProvider === 'codex' ? (settings.codexReasoningEffort || '') : '');
    const fallbackPermissionMode = providerActiveSession
      ? getSessionPermissionMode(providerActiveSession)
      : normalizePermissionModeForProvider(normalizedProvider, settings.permissionMode || 'default');

    return createSession(cwd, normalizedProvider, {
      model: overrides.model ?? fallbackModel,
      reasoningEffort: normalizedProvider === 'codex'
        ? (overrides.reasoningEffort ?? fallbackReasoningEffort)
        : '',
      permissionMode: normalizePermissionModeForProvider(
        normalizedProvider,
        overrides.permissionMode ?? fallbackPermissionMode
      ),
    });
  }, [
    activeSession,
    getSessionModel,
    getSessionPermissionMode,
    getSessionReasoningEffort,
    settings.codexModel,
    settings.codexReasoningEffort,
    settings.model,
    settings.permissionMode,
  ]);

  const rememberWorkspace = useCallback((path) => {
    const normalizedPath = normalizeWorkspacePath(path);
    if (!normalizedPath) {
      return;
    }

    const nextWorkspaces = mergeWorkspacePaths(settings.workspaces, [normalizedPath]);
    if (hasSameWorkspacePaths(nextWorkspaces, settings.workspaces)) {
      return;
    }

    updateSettings({ workspaces: nextWorkspaces });
  }, [settings.workspaces, updateSettings]);

  const rememberWorkspaceHighlights = useCallback((sessionId, workspacePath, toolCalls = []) => {
    if (!sessionId || !Array.isArray(toolCalls) || toolCalls.length === 0) {
      return false;
    }

    const nextHighlights = buildWorkspaceHighlightMap(toolCalls, workspacePath);
    if (Object.keys(nextHighlights).length === 0) {
      return false;
    }

    setWorkspaceHighlightsBySession((prev) => {
      const currentHighlights = prev[sessionId] || {};
      const mergedHighlights = mergeWorkspaceHighlightMaps(currentHighlights, nextHighlights);

      if (areSameWorkspaceHighlightMaps(currentHighlights, mergedHighlights)) {
        return prev;
      }

      return {
        ...prev,
        [sessionId]: mergedHighlights,
      };
    });
    return true;
  }, []);

  const clearWorkspaceHighlights = useCallback((sessionId = null) => {
    if (!sessionId) {
      setWorkspaceHighlightsBySession({});
      return;
    }

    setWorkspaceHighlightsBySession((prev) => {
      if (!prev[sessionId]) {
        return prev;
      }

      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
  }, []);

  const bumpWorkspaceRefresh = useCallback((sessionId) => {
    if (!sessionId) {
      return;
    }

    setWorkspaceRefreshBySession((prev) => ({
      ...prev,
      [sessionId]: (prev[sessionId] || 0) + 1,
    }));
  }, []);

  const clearAutoRunTimer = useCallback((sessionId = null) => {
    if (!sessionId) {
      for (const timeoutId of autoRunTimeoutsRef.current.values()) {
        window.clearTimeout(timeoutId);
      }
      autoRunTimeoutsRef.current.clear();
      return;
    }

    const timeoutId = autoRunTimeoutsRef.current.get(sessionId);
    if (timeoutId) {
      window.clearTimeout(timeoutId);
      autoRunTimeoutsRef.current.delete(sessionId);
    }
  }, []);

  useEffect(() => () => {
    clearAutoRunTimer();
  }, [clearAutoRunTimer]);

  const syncSessionFromCli = useCallback(async (sessionToSync, options = {}) => {
    if (!sessionToSync?.providerSessionId) {
      return false;
    }

    const captureHighlights = options.captureHighlights === true;

    try {
      const result = await window.agent?.loadSession(sessionToSync.provider, sessionToSync.providerSessionId);
      if (!result?.success) {
        return false;
      }

      const syncedMessages = normalizeHistoryMessages(result.messages || []);
      const currentSession = sessionsRef.current.find((session) => session.id === sessionToSync.id) || sessionToSync;
      const newToolCalls = captureHighlights
        ? extractNewAssistantToolCalls(currentSession.messages || [], syncedMessages)
        : [];
      const latestTimestamp = getLatestMessageTimestamp(syncedMessages);

      let changed = false;
      setSessions((prev) => prev.map((current) => {
        if (current.id !== sessionToSync.id) {
          return current;
        }

        const sameConversation = hasSameConversation(current.messages || [], syncedMessages);
        const previousCount = getSessionMessageCount(current);
        const nextUpdatedAt = latestTimestamp
          ? Math.max(current.updatedAt || 0, latestTimestamp)
          : current.updatedAt;
        const nextSession = mergeSessionMessages(
          current,
          sameConversation ? (current.messages || []) : syncedMessages,
          {
            providerSessionCwd: current.providerSessionCwd || current.cwd || settings.cwd || '',
            hasUnread: current.id === activeSessionIdRef.current ? false : (current.hasUnread || !sameConversation || syncedMessages.length > previousCount),
            updatedAt: nextUpdatedAt || current.updatedAt || Date.now(),
          }
        );

        if (
          sameConversation &&
          current.messageCount === nextSession.messageCount &&
          current.lastMessagePreview === nextSession.lastMessagePreview &&
          current.hasAttachments === nextSession.hasAttachments &&
          current.providerSessionCwd === nextSession.providerSessionCwd &&
          current.hasUnread === nextSession.hasUnread &&
          current.updatedAt === nextSession.updatedAt
        ) {
          return current;
        }

        changed = true;
        return nextSession;
      }));

      if (newToolCalls.length > 0) {
        const shouldRefreshWorkspace = rememberWorkspaceHighlights(
          sessionToSync.id,
          currentSession.cwd || currentSession.providerSessionCwd || settings.cwd || '',
          newToolCalls
        );
        if (shouldRefreshWorkspace) {
          bumpWorkspaceRefresh(sessionToSync.id);
        }
      }

      return changed;
    } catch {
      return false;
    }
  }, [bumpWorkspaceRefresh, rememberWorkspaceHighlights, settings.cwd]);

  useEffect(() => {
    let cancelled = false;

    async function hydrateActiveSession() {
      if (!activeSession || !shouldHydrateActiveSession) {
        setIsActiveSessionLoading(false);
        return;
      }

      setIsActiveSessionLoading(true);
      try {
        await syncSessionFromCli(activeSession);
      } finally {
        if (!cancelled) {
          setIsActiveSessionLoading(false);
        }
      }
    }

    hydrateActiveSession();
    return () => {
      cancelled = true;
    };
  }, [activeSession, shouldHydrateActiveSession, syncSessionFromCli]);

  useEffect(() => {
    if (!cliLaunchStatus) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setCliLaunchStatus(null);
    }, cliLaunchStatus.type === 'error' ? 5000 : 2500);

    return () => window.clearTimeout(timeoutId);
  }, [cliLaunchStatus]);

  useEffect(() => {
    if (activeSessionId) {
      setViewingSession(activeSessionId);
      setSessions((prev) => prev.map((session) => (
        session.id === activeSessionId && session.hasUnread
          ? { ...session, hasUnread: false }
          : session
      )));
    }
  }, [activeSessionId, setViewingSession]);

  useEffect(() => {
    saveSessions(sessions);
  }, [sessions]);

  useEffect(() => {
    if (!window.agent?.onCliExit) {
      return undefined;
    }

    const unsubscribe = window.agent.onCliExit(async (event) => {
      if (!event?.sessionId) {
        return;
      }

      const session = sessions.find((current) => current.id === event.sessionId);
      if (!session) {
        return;
      }

      await syncSessionFromCli(session, { captureHighlights: true });

      setSessions((prev) => prev.map((current) => (
        current.id === event.sessionId
          ? {
              ...current,
              syncWithCli: false,
              externalCliPid: null,
              hasUnread: current.id === activeSessionIdRef.current ? false : current.hasUnread,
              updatedAt: Date.now(),
            }
          : current
      )));

      setCliLaunchStatus({
        type: 'success',
        message: tx('CLI closed, final sync complete', 'CLI 已关闭，最终同步完成'),
      });
    });

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [sessions, syncSessionFromCli, tx]);

  useEffect(() => {
    if (!activeSession?.syncWithCli || !activeSession.providerSessionId) {
      return undefined;
    }

    let cancelled = false;

    async function syncActiveCliSession() {
      if (cancelled || isStreaming) {
        return;
      }
      await syncSessionFromCli(activeSession, { captureHighlights: true });
    }

    syncActiveCliSession();
    const intervalId = window.setInterval(syncActiveCliSession, CLI_SYNC_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeSession, isStreaming, syncSessionFromCli]);

  useEffect(() => {
    let cancelled = false;

    async function checkActiveProvider() {
      if (!activeProvider) {
        return;
      }

      const installed = await ensureProviderReady(activeProvider);
      if (cancelled) {
        return;
      }

      setProviderAvailability((prev) => ({
        ...prev,
        [activeProvider]: {
          checked: true,
          installed,
        },
      }));
    }

    checkActiveProvider();
    return () => {
      cancelled = true;
    };
  }, [activeProvider, activeSessionId]);

  const updateSession = useCallback((sessionId, updates) => {
    setSessions((prev) => prev.map((session) => (
      session.id === sessionId
        ? { ...session, ...updates, updatedAt: Date.now() }
        : session
    )));
  }, []);

  const updateActiveSessionConfig = useCallback((updates) => {
    if (!activeSession) {
      return;
    }

    const normalizedUpdates = { ...updates };
    if (Object.prototype.hasOwnProperty.call(normalizedUpdates, 'permissionMode')) {
      normalizedUpdates.permissionMode = normalizePermissionModeForProvider(
        activeSession.provider,
        normalizedUpdates.permissionMode
      );
    }
    if (activeSession.provider !== 'codex' && Object.prototype.hasOwnProperty.call(normalizedUpdates, 'reasoningEffort')) {
      normalizedUpdates.reasoningEffort = '';
    }

    updateSession(activeSession.id, normalizedUpdates);
  }, [activeSession, updateSession]);

  const handleNewSession = useCallback((provider = settings.provider || 'claude') => {
    const session = createConfiguredSession(settings.cwd, provider);
    rememberWorkspace(session.cwd || settings.cwd || '');
    setSessions((prev) => [session, ...prev]);
    setActiveSessionId(session.id);
  }, [createConfiguredSession, rememberWorkspace, settings.cwd, settings.provider]);

  const applyWorkspaceToChat = useCallback((path, options = {}) => {
    const normalizedPath = normalizeWorkspacePath(path);
    if (!normalizedPath) {
      return;
    }

    rememberWorkspace(normalizedPath);

    if (options.newSession || !activeSession) {
      const session = createConfiguredSession(
        normalizedPath,
        options.provider || activeSession?.provider || settings.provider || 'claude'
      );
      setSessions((prev) => [session, ...prev]);
      setActiveSessionId(session.id);
      return;
    }

    updateSession(activeSession.id, {
      cwd: normalizedPath,
    });
  }, [activeSession, createConfiguredSession, rememberWorkspace, settings.provider, updateSession]);

  useEffect(() => {
    const handler = (event) => {
      if (event.ctrlKey && event.key === 'n') {
        event.preventDefault();
        handleNewSession(settings.provider || 'claude');
      }
      if (event.ctrlKey && event.key === 'h') {
        event.preventDefault();
        setShowHistory((prev) => !prev);
      }
      if (event.altKey && event.key === 'm') {
        event.preventDefault();
        const provider = activeSession?.provider || settings.provider || 'claude';
        const modes = provider === 'codex'
          ? ['default', 'plan', 'yolo']
          : ['default', 'plan', 'acceptEdits', 'yolo'];
        const current = getSessionPermissionMode(activeSession);
        const index = modes.indexOf(current);
        if (activeSession) {
          updateSession(activeSession.id, {
            permissionMode: modes[(index + 1) % modes.length],
          });
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeSession, getSessionPermissionMode, handleNewSession, settings.provider, updateSession]);

  const handleSelectSession = useCallback((sessionId) => {
    setActiveSessionId(sessionId);
    setSessions((prev) => prev.map((session) => (
      session.id === sessionId && session.hasUnread
        ? { ...session, hasUnread: false }
        : session
    )));
  }, []);

  const handleDeleteSession = useCallback((sessionId) => {
    clearAutoRunTimer(sessionId);
    runningSessionIdsRef.current.delete(sessionId);
    cleanupSession(sessionId);
    clearWorkspaceHighlights(sessionId);
    setSessions((prev) => {
      const filtered = prev.filter((session) => session.id !== sessionId);
      if (filtered.length === 0) {
        filtered.push(createConfiguredSession(settings.cwd, settings.provider || 'claude'));
      }
      if (sessionId === activeSessionId) {
        const nextSessionId = filtered[0].id;
        setActiveSessionId(nextSessionId);
        return filtered.map((session) => (
          session.id === nextSessionId && session.hasUnread
            ? { ...session, hasUnread: false }
            : session
        ));
      }
      return filtered;
    });
  }, [activeSessionId, cleanupSession, clearAutoRunTimer, clearWorkspaceHighlights, createConfiguredSession, settings.cwd, settings.provider]);

  const sendSessionMessage = useCallback(async (targetSession, message, files = [], options = {}) => {
    if (!targetSession) {
      return false;
    }

    const sessionId = targetSession.id;
    const isAuto = options.isAuto === true;
    const currentSession = sessionsRef.current.find((session) => session.id === sessionId) || targetSession;
    const sessionModel = getSessionModel(currentSession);
    const sessionReasoningEffort = getSessionReasoningEffort(currentSession);
    const sessionPermissionMode = getSessionPermissionMode(currentSession);
    const sessionContextUsage = sessionId === activeSessionIdRef.current ? contextUsage : null;

    if (currentSession.provider === 'codex') {
      const fastCommand = parseCodexFastCommand(message);
      if (fastCommand) {
        const providerConfigResult = await window.agent?.getProviderConfig('codex');
        const fastEnabled = providerConfigResult?.success && providerConfigResult?.config?.serviceTier === 'fast';

        if (fastCommand.type === 'status') {
          appendLocalConversation(setSessions, sessionId, message, `Fast mode is ${fastEnabled ? 'on' : 'off'}.`);
          return true;
        }

        if (fastCommand.type === 'invalid') {
          appendLocalConversation(setSessions, sessionId, message, 'Usage: /fast [on|off|status]');
          return true;
        }

        const enableFast = fastCommand.type === 'toggle'
          ? !fastEnabled
          : fastCommand.type === 'on';
        const updateResult = await window.agent?.setCodexFastMode(enableFast);

        appendLocalConversation(
          setSessions,
          sessionId,
          message,
          updateResult?.success
            ? `Fast mode set to ${enableFast ? 'on' : 'off'}`
            : `Error: ${updateResult?.error || 'Failed to update Codex fast mode.'}`
        );
        return true;
      }
    }

    if (message.trim() === '/status') {
      const providerConfigResult = currentSession.provider === 'codex'
        ? await window.agent?.getProviderConfig('codex')
        : null;
      const userMessage = { role: 'user', content: '/status', localOnly: true };
      const statusLines = [
        `**${tx('App', '应用')}**: CmdDeck`,
        `**${tx('Provider', '提供方')}**: ${PROVIDER_LABELS[currentSession.provider]}`,
        `**${tx('Model', '模型')}**: ${sessionModel || tx('Default (CLI config)', '默认（CLI 配置）')}`,
        `**${tx('Reasoning Effort', '推理强度')}**: ${currentSession.provider === 'codex'
          ? (sessionReasoningEffort || tx('Default (CLI config)', '默认（CLI 配置）'))
          : tx('N/A', '不适用')}`,
        `**${tx('Fast Mode', '快速模式')}**: ${currentSession.provider === 'codex'
          ? (providerConfigResult?.config?.serviceTier || tx('Off', '关闭'))
          : tx('N/A', '不适用')}`,
        `**${tx('Mode', '模式')}**: ${sessionPermissionMode}`,
        `**${tx('Working Directory', '工作目录')}**: ${currentSession.cwd || settings.cwd || tx('Not set', '未设置')}`,
        `**${tx('Theme', '主题')}**: ${settings.theme || 'system'}`,
        `**${tx('Font Size', '字体大小')}**: ${settings.fontSize || 14}px`,
        `**${tx('Auto Run Default', '自动续跑默认次数')}**: ${defaultAutoRunCount}`,
        `**${tx('Auto Run Prompt', '自动续跑提示词')}**: ${autoRunPrompt}`,
        '',
        `**${tx('Session Messages', '会话消息数')}**: ${getSessionMessageCount(currentSession)}`,
        `**${tx('Context Usage', '上下文占用')}**: ${sessionContextUsage ? `${sessionContextUsage.percent}%` : tx('N/A', '不适用')}`,
      ];

      const statusMessage = {
        role: 'assistant',
        content: statusLines.join('\n'),
        localOnly: true,
      };

      setSessions((prev) => prev.map((session) => (
        session.id === sessionId
          ? mergeSessionMessages(session, [...(session.messages || []), userMessage, statusMessage], { updatedAt: Date.now() })
          : session
      )));
      return true;
    }

    const providerReady = await ensureProviderReady(currentSession.provider);

    if (!providerReady) {
      setProviderAvailability((prev) => ({
        ...prev,
        [currentSession.provider]: {
          checked: true,
          installed: false,
        },
      }));
      return false;
    }

    setProviderAvailability((prev) => ({
      ...prev,
      [currentSession.provider]: {
        checked: true,
        installed: true,
      },
    }));

    if (
      currentSession?.providerSessionId &&
      getSessionMessageCount(currentSession) > 0 &&
      (currentSession.messages?.length || 0) === 0
    ) {
      await syncSessionFromCli(currentSession);
    }

    const userMessage = {
      role: 'user',
      content: message,
      attachments: files.length > 0 ? files : undefined,
      autoGenerated: isAuto || undefined,
    };

    setSessions((prev) => prev.map((session) => (
      session.id === sessionId
        ? mergeSessionMessages(session, [...(session.messages || []), userMessage], {
            title: getSessionMessageCount(session) === 0
              ? buildSessionTitle(message, files)
              : session.title,
            updatedAt: Date.now(),
          })
        : session
    )));

    try {
      const result = await sendMessage(sessionId, currentSession.provider, message, {
        cwd: currentSession.cwd || settings.cwd || undefined,
        providerSessionId: currentSession?.providerSessionId || undefined,
        files: files.length > 0 ? files : undefined,
        model: sessionModel || undefined,
        reasoningEffort: currentSession.provider === 'codex'
          ? sessionReasoningEffort || undefined
          : undefined,
        permissionMode: sessionPermissionMode || undefined,
      });

      if (result?.error) {
        if (result.toolCalls?.length > 0) {
          const shouldRefreshWorkspace = rememberWorkspaceHighlights(
            sessionId,
            currentSession.cwd || currentSession.providerSessionCwd || settings.cwd || '',
            result.toolCalls
          );
          if (shouldRefreshWorkspace) {
            bumpWorkspaceRefresh(sessionId);
          }
        }

        const assistantMessage = {
          role: 'assistant',
          content: result.text || `Error: ${result.error}`,
          toolCalls: result.toolCalls?.length > 0 ? result.toolCalls : undefined,
          autoGenerated: isAuto || undefined,
        };

        setSessions((prev) => prev.map((session) => (
          session.id === sessionId
            ? mergeSessionMessages(session, [...(session.messages || []), assistantMessage], {
                hasUnread: activeSessionIdRef.current !== sessionId,
                providerSessionId: result.providerSessionId || session.providerSessionId,
                providerSessionCwd: session.providerSessionCwd || session.cwd || settings.cwd || '',
                updatedAt: Date.now(),
              })
            : session
        )));
        return true;
      }

      if (result && (String(result.text || '').trim() || result.toolCalls?.length > 0)) {
        if (result.toolCalls?.length > 0) {
          const shouldRefreshWorkspace = rememberWorkspaceHighlights(
            sessionId,
            currentSession.cwd || currentSession.providerSessionCwd || settings.cwd || '',
            result.toolCalls
          );
          if (shouldRefreshWorkspace) {
            bumpWorkspaceRefresh(sessionId);
          }
        }

        const assistantMessage = {
          role: 'assistant',
          content: result.text,
          toolCalls: result.toolCalls?.length > 0 ? result.toolCalls : undefined,
          autoGenerated: isAuto || undefined,
        };

        setSessions((prev) => prev.map((session) => (
          session.id === sessionId
            ? mergeSessionMessages(session, [...(session.messages || []), assistantMessage], {
                hasUnread: activeSessionIdRef.current !== sessionId,
                providerSessionId: result.providerSessionId || session.providerSessionId,
                providerSessionCwd: session.providerSessionCwd || session.cwd || settings.cwd || '',
                updatedAt: Date.now(),
              })
            : session
        )));
        return true;
      }
    } catch (err) {
      const command = currentSession.provider === 'codex' ? 'codex' : 'claude';
      const errorMessage = {
        role: 'assistant',
        content: tx(
          'Error: {message}\n\nMake sure {provider} is installed and accessible via the `{command}` command.',
          '错误：{message}\n\n请确认已经安装 {provider}，并且可以通过 `{command}` 命令访问。',
          {
            message: err.message,
            provider: PROVIDER_LABELS[currentSession.provider],
            command,
          }
        ),
      };

      setSessions((prev) => prev.map((session) => (
        session.id === sessionId
          ? mergeSessionMessages(session, [...(session.messages || []), errorMessage], {
              hasUnread: activeSessionIdRef.current !== sessionId,
              updatedAt: Date.now(),
            })
          : session
      )));
    }
    return true;
  }, [
    autoRunPrompt,
    contextUsage,
    defaultAutoRunCount,
    getSessionModel,
    getSessionPermissionMode,
    getSessionReasoningEffort,
    sendMessage,
    settings.cwd,
    settings.fontSize,
    settings.theme,
    syncSessionFromCli,
    tx,
    bumpWorkspaceRefresh,
    rememberWorkspaceHighlights,
  ]);

  useEffect(() => {
    sendSessionMessageRef.current = sendSessionMessage;
  }, [sendSessionMessage]);

  const handleSend = useCallback((message, files = []) => {
    if (!activeSession) {
      return Promise.resolve(false);
    }

    return sendSessionMessage(activeSession, message, files);
  }, [activeSession, sendSessionMessage]);

  const handleAbort = useCallback(() => {
    if (activeSession) {
      abort(activeSession.id, activeSession.provider);
    }
  }, [abort, activeSession]);

  const handleClear = useCallback(() => {
    if (!activeSession) {
      return;
    }

    clearAutoRunTimer(activeSession.id);
    runningSessionIdsRef.current.delete(activeSession.id);
    cleanupSession(activeSession.id);
    clearWorkspaceHighlights(activeSession.id);

    if (activeSession.providerSessionId) {
      const replacement = createConfiguredSession(
        activeSession.cwd || settings.cwd || '',
        activeSession.provider,
        {
          model: getSessionModel(activeSession),
          reasoningEffort: getSessionReasoningEffort(activeSession),
          permissionMode: getSessionPermissionMode(activeSession),
        }
      );
      setSessions((prev) => prev.map((session) => (
        session.id === activeSession.id ? replacement : session
      )));
      setActiveSessionId(replacement.id);
      return;
    }

    updateSession(activeSession.id, {
      title: 'New Chat',
      messages: [],
      messageCount: 0,
      lastMessagePreview: '',
      hasAttachments: false,
      autoRunEnabled: false,
      autoRunRemaining: 0,
      autoRunTotal: 0,
      syncWithCli: false,
      externalCliPid: null,
    });
  }, [
    activeSession,
    cleanupSession,
    clearAutoRunTimer,
    createConfiguredSession,
    clearWorkspaceHighlights,
    getSessionModel,
    getSessionPermissionMode,
    getSessionReasoningEffort,
    settings.cwd,
    updateSession,
  ]);

  const handleSelectDirectory = useCallback(async () => {
    if (!window.claude?.selectDirectory) {
      return;
    }
    const dir = await window.claude.selectDirectory();
    if (dir) {
      applyWorkspaceToChat(dir);
    }
  }, [applyWorkspaceToChat]);

  const handleBrowseWorkspace = useCallback(async () => {
    if (!window.claude?.selectDirectory) {
      return;
    }

    const dir = await window.claude.selectDirectory();
    if (dir) {
      applyWorkspaceToChat(dir);
    }
  }, [applyWorkspaceToChat]);

  const handleBrowseDefaultDirectory = useCallback(async () => {
    if (!window.claude?.selectDirectory) {
      return;
    }

    const dir = await window.claude.selectDirectory();
    if (!dir) {
      return;
    }

    rememberWorkspace(dir);
    updateSettings({ cwd: dir });
  }, [rememberWorkspace, updateSettings]);

  const handleContinueProviderSession = useCallback(async (historySession) => {
    const existingSession = sessions.find((session) => (
      session.provider === historySession.provider &&
      session.providerSessionId === historySession.sessionId
    ));

    if (existingSession) {
      handleSelectSession(existingSession.id);
      return;
    }

    const result = await window.agent?.loadSession(historySession.provider, historySession.sessionId);
    const messages = result?.success
      ? normalizeHistoryMessages(result.messages || [])
      : [];

    const session = createConfiguredSession(historySession.project || settings.cwd, historySession.provider);
    session.title = historySession.title || `Continued ${PROVIDER_LABELS[historySession.provider]}`;
    session.providerSessionId = historySession.sessionId;
    session.providerSessionCwd = historySession.project || settings.cwd || '';
    session.syncWithCli = false;
    session.messages = messages;
    Object.assign(session, summarizeMessages(messages));
    session.cwd = historySession.project || settings.cwd;

    rememberWorkspace(session.cwd);

    setSessions((prev) => [session, ...prev]);
    setActiveSessionId(session.id);

    if (window.agent?.setSessionId) {
      window.agent.setSessionId(historySession.provider, session.id, historySession.sessionId);
    }
  }, [createConfiguredSession, handleSelectSession, rememberWorkspace, sessions, settings.cwd]);

  const handleOpenInCli = useCallback(async () => {
    if (!activeSession || !window.agent?.openInCli) {
      return;
    }

    const result = await window.agent.openInCli(
      activeSession.id,
      activeSession.provider,
      activeSession.providerSessionId
        ? (activeSession.providerSessionCwd || activeSession.cwd || settings.cwd || '')
        : (activeSession.cwd || settings.cwd || ''),
      activeSession.providerSessionId || null
    );

    if (result?.success) {
      const canSync = Boolean(activeSession.providerSessionId);
      updateSession(activeSession.id, {
        syncWithCli: canSync,
        externalCliPid: result.pid || null,
      });
      setCliLaunchStatus({
        type: 'success',
        message: result.resumed
          ? tx('Resumed in external CLI', '已在外部 CLI 中继续')
          : (canSync
              ? tx('Opened external CLI', '已打开外部 CLI')
              : tx('Opened external CLI without session sync', '已打开外部 CLI，但未启用会话同步')),
      });
    } else {
      setCliLaunchStatus({
        type: 'error',
        message: result?.error || tx('Failed to open external CLI', '打开外部 CLI 失败'),
      });
    }
  }, [activeSession, settings.cwd, tx, updateSession]);

  const shouldAutoRunSession = useCallback((session) => {
    if (!session) {
      return false;
    }

    const lastMessage = getLastAssistantMessage(session.messages || []);
    return Boolean(
      session.autoRunEnabled &&
      getStoredAutoRunCount(session.autoRunRemaining) > 0 &&
      !session.syncWithCli &&
      !runningSessionIdsRef.current.has(session.id) &&
      lastMessage &&
      !lastMessage.localOnly &&
      !isErrorAssistantMessage(lastMessage)
    );
  }, []);

  const handleToggleAutoRun = useCallback(() => {
    if (!activeSession) {
      return;
    }

    clearAutoRunTimer(activeSession.id);
    runningSessionIdsRef.current.delete(activeSession.id);
    const nextTotal = defaultAutoRunCount;

    setSessions((prev) => prev.map((session) => {
      if (session.id !== activeSession.id) {
        return session;
      }

      const enable = !session.autoRunEnabled;
      return {
        ...session,
        autoRunEnabled: enable,
        autoRunRemaining: enable ? nextTotal : 0,
        autoRunTotal: nextTotal,
      };
    }));

    window.setTimeout(() => {
      scheduleAutoRunSessionsRef.current();
    }, 0);
  }, [activeSession, clearAutoRunTimer, defaultAutoRunCount]);

  const scheduleAutoRunSessions = useCallback((sessionList = sessionsRef.current) => {
    const knownSessionIds = new Set(sessionList.map((session) => session.id));
    for (const sessionId of autoRunTimeoutsRef.current.keys()) {
      if (!knownSessionIds.has(sessionId)) {
        clearAutoRunTimer(sessionId);
      }
    }

    sessionList.forEach((session) => {
      const shouldSchedule = shouldAutoRunSession(session);
      const hasTimer = autoRunTimeoutsRef.current.has(session.id);

      if (!shouldSchedule) {
        if (hasTimer) {
          clearAutoRunTimer(session.id);
        }
        return;
      }

      if (hasTimer) {
        return;
      }

      const timeoutId = window.setTimeout(async () => {
        clearAutoRunTimer(session.id);

        const latestSession = sessionsRef.current.find((current) => current.id === session.id);
        if (!latestSession || !shouldAutoRunSession(latestSession)) {
          scheduleAutoRunSessionsRef.current();
          return;
        }

        runningSessionIdsRef.current.add(session.id);
        const nextRemaining = Math.max(0, getStoredAutoRunCount(latestSession.autoRunRemaining) - 1);

        setSessions((prev) => prev.map((current) => (
          current.id === session.id
            ? {
                ...current,
                autoRunEnabled: nextRemaining > 0,
                autoRunRemaining: nextRemaining,
                autoRunTotal: getStoredAutoRunCount(current.autoRunTotal) || autoRunConfigRef.current.defaultCount,
              }
            : current
        )));

        try {
          const success = await sendSessionMessageRef.current?.(
            latestSession,
            autoRunConfigRef.current.prompt,
            [],
            { isAuto: true }
          );

          if (success === false) {
            setSessions((prev) => prev.map((current) => (
              current.id === session.id
                ? {
                    ...current,
                    autoRunEnabled: false,
                    autoRunRemaining: 0,
                  }
                : current
            )));
          }
        } finally {
          runningSessionIdsRef.current.delete(session.id);
          scheduleAutoRunSessionsRef.current();
        }
      }, AUTO_RUN_IDLE_MS);

      autoRunTimeoutsRef.current.set(session.id, timeoutId);
    });
  }, [clearAutoRunTimer, shouldAutoRunSession]);

  useEffect(() => {
    scheduleAutoRunSessionsRef.current = scheduleAutoRunSessions;
  }, [scheduleAutoRunSessions]);

  useEffect(() => {
    scheduleAutoRunSessions(sessions);
  }, [scheduleAutoRunSessions, sessions]);

  return (
    <I18nProvider value={i18n}>
      <div
        className="h-screen box-border flex flex-col overflow-hidden border-[0.5px] border-black/20 bg-claude-bg-light dark:border-black/55 dark:bg-claude-bg-dark"
        style={{ '--app-font-size': `${settings.fontSize}px` }}
      >
        <TitleBar
          title={activeSession ? localizeSessionTitle(activeSession.title, tx) : 'CmdDeck'}
        />

        <div className="flex flex-1 overflow-hidden">
          <Sidebar
            sessions={sessions}
            activeSessionId={activeSessionId}
            onSelectSession={handleSelectSession}
            onNewSession={handleNewSession}
            onDeleteSession={handleDeleteSession}
            onToggleTheme={toggleTheme}
            onOpenSettings={() => setShowSettings(true)}
            onOpenHistory={() => setShowHistory(true)}
            isDark={settings.theme === 'dark'}
            currentCwd={activeSession?.cwd || settings.cwd}
            onSelectDirectory={handleSelectDirectory}
            defaultProvider={settings.provider || 'claude'}
          />

          <div className="flex min-w-0 flex-1 flex-col">
            {activeSession && (
              <div className="flex items-center gap-2 border-b border-claude-border-light bg-claude-surface-light px-4 py-1.5 text-xs text-gray-500 dark:border-claude-border-dark dark:bg-claude-surface-dark dark:text-gray-400">
                <FolderOpen size={12} />
                <span className="truncate">
                  {activeSession.cwd || settings.cwd || tx('No working directory', '未设置工作目录')}
                </span>
                {cliLaunchStatus && (
                  <span
                    className={`hidden truncate sm:inline ${
                      cliLaunchStatus.type === 'error' ? 'text-red-400' : 'text-emerald-400'
                    }`}
                    title={cliLaunchStatus.message}
                  >
                    {cliLaunchStatus.message}
                  </span>
                )}
                <div className="ml-auto flex shrink-0 items-center gap-2">
                  <button
                    onClick={handleOpenInCli}
                    disabled={!activeProviderStatus.installed}
                    className="inline-flex items-center gap-1 rounded-lg border border-claude-border-light bg-black/5 px-2 py-1 text-[10px] font-medium text-claude-text-light transition-colors hover:border-claude-orange/40 hover:text-claude-orange disabled:cursor-not-allowed disabled:opacity-50 dark:border-claude-border-dark dark:bg-white/5 dark:text-claude-text-dark"
                    title={activeSession.providerSessionId
                      ? tx('Resume this session in the external CLI', '在外部 CLI 中继续这个会话')
                      : tx('Open a new external CLI session in this directory', '在当前目录打开新的外部 CLI 会话')}
                  >
                    <ExternalLink size={11} />
                    {activeSession.providerSessionId ? tx('Resume in CLI', 'CLI 继续') : tx('Open in CLI', '打开 CLI')}
                  </button>
                  <button
                    onClick={handleToggleAutoRun}
                    className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-medium transition-all ${
                      activeSession.autoRunEnabled
                        ? 'border-emerald-500/45 bg-emerald-500/14 text-emerald-700 shadow-[0_0_0_1px_rgba(16,185,129,0.12),0_0_14px_rgba(16,185,129,0.18)] dark:border-emerald-400/40 dark:bg-emerald-500/16 dark:text-emerald-300'
                        : 'border-claude-border-light bg-black/5 text-claude-text-light hover:border-claude-orange/40 hover:text-claude-orange dark:border-claude-border-dark dark:bg-white/5 dark:text-claude-text-dark'
                    }`}
                    title={activeSession.syncWithCli
                      ? tx('Auto-run is paused while external CLI sync is active', '外部 CLI 同步期间，自动续跑已暂停')
                      : tx('Auto-run the next step every 3 seconds while idle, up to {count} times', '空闲 3 秒后自动执行下一步，最多 {count} 次', { count: activeAutoRunTotal })}
                  >
                    <RotateCw size={11} className={activeSession.autoRunEnabled ? 'animate-spin' : ''} />
                    {activeSession.autoRunEnabled
                      ? tx('Auto {remaining}/{total}', '自动 {remaining}/{total}', { remaining: activeAutoRunRemaining, total: activeAutoRunTotal })
                      : tx('Auto', '自动')}
                  </button>
                  <span className="rounded-full bg-claude-orange/10 px-2 py-0.5 text-[10px] font-medium text-claude-orange">
                    {PROVIDER_LABELS[activeSession.provider]}
                  </span>
                </div>
              </div>
            )}

            {activeProviderStatus.checked && !activeProviderStatus.installed && (
              <ProviderInstallCard
                provider={activeProvider}
                copiedInstallCommand={copiedInstallCommand}
                onCopy={async (commandKey, command) => {
                  try {
                    await navigator.clipboard.writeText(command);
                    setCopiedInstallCommand(commandKey);
                    window.setTimeout(() => {
                      setCopiedInstallCommand((current) => (current === commandKey ? null : current));
                    }, 2000);
                  } catch {
                    setCopiedInstallCommand(null);
                  }
                }}
              />
            )}

            <ChatView
              sessionKey={activeSession?.id || ''}
              messages={activeSession?.messages || []}
              streamingText={streamingText}
              streamingToolCalls={streamingToolCalls}
              isStreaming={isStreaming}
              isLoadingHistory={isActiveSessionLoading && shouldHydrateActiveSession}
              thinkingText={thinkingText}
              progressInfo={progressInfo}
              onSend={handleSend}
              currentProvider={activeSession?.provider || settings.provider || 'claude'}
            />

            <InputArea
              onSend={handleSend}
              onAbort={handleAbort}
              onClear={handleClear}
              onDeleteSession={() => handleDeleteSession(activeSessionId)}
              onNewSession={handleNewSession}
              onToggleTheme={toggleTheme}
              onOpenSettings={() => setShowSettings(true)}
              onOpenHistory={() => setShowHistory(true)}
              onSelectDirectory={handleSelectDirectory}
              currentModel={getSessionModel(activeSession)}
              onModelChange={(model) => updateActiveSessionConfig({ model })}
              currentReasoningEffort={getSessionReasoningEffort(activeSession)}
              onReasoningEffortChange={(reasoningEffort) => updateActiveSessionConfig({ reasoningEffort })}
              permissionMode={getSessionPermissionMode(activeSession)}
              onPermissionModeChange={(permissionMode) => updateActiveSessionConfig({ permissionMode })}
              isStreaming={isStreaming}
              disabled={!activeSession || (isActiveSessionLoading && shouldHydrateActiveSession)}
              contextUsage={contextUsage}
              turnTimer={turnTimer}
              currentProvider={activeSession?.provider || settings.provider || 'claude'}
            />
          </div>

          <WorkspacePanel
            collapsed={Boolean(settings.workspacePanelCollapsed)}
            onToggleCollapse={() => updateSettings({ workspacePanelCollapsed: !settings.workspacePanelCollapsed })}
            workspacePath={activeWorkspacePath}
            fileHighlights={activeWorkspaceHighlights}
            refreshToken={activeWorkspaceRefreshToken}
            onBrowseWorkspace={handleBrowseWorkspace}
          />
        </div>

        {showSettings && (
          <SettingsPanel
            settings={settings}
            onUpdate={updateSettings}
            onClose={() => setShowSettings(false)}
            onBrowseDefaultDirectory={handleBrowseDefaultDirectory}
          />
        )}

        {showHistory && (
          <HistoryPanel
            sessions={sessions}
            activeSessionId={activeSessionId}
            onSelectSession={handleSelectSession}
            onDeleteSession={handleDeleteSession}
            onContinueProviderSession={handleContinueProviderSession}
            onClose={() => setShowHistory(false)}
          />
        )}
      </div>
    </I18nProvider>
  );
}

function normalizeHistoryMessages(messages) {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
    timestamp: message.timestamp,
    toolCalls: message.toolUses
      ? message.toolUses.map((tool) => ({
          id: tool.id || undefined,
          name: tool.name,
          input: tool.input,
          result: tool.result,
          status: tool.status === 'running' ? 'error' : (tool.status || 'completed'),
        }))
      : undefined,
  }));
}

function mergeSessionMessages(session, messages, extraUpdates = {}) {
  return {
    ...session,
    ...summarizeMessages(messages),
    messages,
    ...extraUpdates,
  };
}

function getSessionMessageCount(session) {
  if (typeof session?.messageCount === 'number') {
    return session.messageCount;
  }

  return session?.messages?.length || 0;
}

function getLatestMessageTimestamp(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return null;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const rawTimestamp = messages[index]?.timestamp;
    const timestamp = typeof rawTimestamp === 'number' ? rawTimestamp : Date.parse(rawTimestamp);
    if (Number.isFinite(timestamp)) {
      return timestamp;
    }
  }

  return null;
}

function hasSameConversation(currentMessages, syncedMessages) {
  if (currentMessages.length !== syncedMessages.length) {
    return false;
  }

  for (let index = 0; index < currentMessages.length; index += 1) {
    const current = currentMessages[index];
    const synced = syncedMessages[index];

    if (current.role !== synced.role || current.content !== synced.content) {
      return false;
    }

    const currentTools = current.toolCalls || [];
    const syncedTools = synced.toolCalls || [];
    if (currentTools.length !== syncedTools.length) {
      return false;
    }

    for (let toolIndex = 0; toolIndex < currentTools.length; toolIndex += 1) {
      const currentTool = currentTools[toolIndex];
      const syncedTool = syncedTools[toolIndex];
      if (
        currentTool.name !== syncedTool.name ||
        currentTool.status !== syncedTool.status ||
        JSON.stringify(currentTool.input || null) !== JSON.stringify(syncedTool.input || null) ||
        JSON.stringify(currentTool.result || null) !== JSON.stringify(syncedTool.result || null)
      ) {
        return false;
      }
    }
  }

  return true;
}

function buildSessionTitle(message, files = []) {
  const trimmed = (message || '').trim();
  if (trimmed) {
    return trimmed.slice(0, 40) + (trimmed.length > 40 ? '...' : '');
  }

  if (files.length > 0) {
    const firstName = files[0].split(/[/\\]/).pop();
    if (files.length === 1 && firstName) {
      return firstName;
    }
    return `${files.length} attachments`;
  }

  return 'New Chat';
}

function ProviderInstallCard({ provider, copiedInstallCommand, onCopy }) {
  const { tx } = useI18n();
  const guide = getInstallGuide(provider);

  return (
    <div className="mx-4 mt-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
      <div className="text-sm font-medium text-amber-200">
        {tx('{provider} is not installed', '{provider} 尚未安装', { provider: guide.label })}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-amber-50/90">
        {tx(
          'Install it first, then restart the app and open this chat again.',
          '请先安装，然后重启应用，再重新打开这个聊天。'
        )}
      </p>
      <div className="mt-3 space-y-2">
        <InstallCommandRow
          label={tx('npm', 'npm')}
          command={guide.npm}
          copied={copiedInstallCommand === `${provider}-npm`}
          onCopy={() => onCopy(`${provider}-npm`, guide.npm)}
        />
        <InstallCommandRow
          label={tx('China mirror', '国内镜像')}
          command={guide.mirror}
          copied={copiedInstallCommand === `${provider}-mirror`}
          onCopy={() => onCopy(`${provider}-mirror`, guide.mirror)}
        />
      </div>
    </div>
  );
}

function InstallCommandRow({ label, command, copied, onCopy }) {
  const { tx } = useI18n();

  return (
    <div className="rounded-xl border border-amber-500/20 bg-black/10 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-amber-200/80">
          {label}
        </span>
        <button
          onClick={onCopy}
          className="ml-auto inline-flex items-center gap-1 rounded-lg border border-amber-400/20 bg-amber-400/10 px-2 py-1 text-[11px] text-amber-100 transition-colors hover:bg-amber-400/20"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? tx('Copied', '已复制') : tx('Copy', '复制')}
        </button>
      </div>
      <div className="mt-1 break-all font-mono text-[11px] text-amber-50">
        {command}
      </div>
    </div>
  );
}

async function ensureProviderReady(provider) {
  try {
    const result = await window.agent?.getVersion(provider);
    return Boolean(result?.success);
  } catch {
    return false;
  }
}

function getInstallGuide(provider) {
  if (provider === 'codex') {
    return {
      label: 'Codex',
      npm: 'npm install -g @openai/codex',
      mirror: 'npm install -g @openai/codex --registry=https://registry.npmmirror.com',
    };
  }

  return {
    label: 'Claude Code',
    npm: 'npm install -g @anthropic-ai/claude-code',
    mirror: 'npm install -g @anthropic-ai/claude-code --registry=https://registry.npmmirror.com',
  };
}

function normalizePermissionModeForProvider(provider, permissionMode) {
  const normalizedProvider = provider === 'codex' ? 'codex' : 'claude';
  const normalizedMode = typeof permissionMode === 'string' ? permissionMode : 'default';
  const allowedModes = normalizedProvider === 'codex'
    ? ['default', 'plan', 'yolo']
    : ['default', 'plan', 'acceptEdits', 'yolo'];

  return allowedModes.includes(normalizedMode) ? normalizedMode : 'default';
}

function getConfiguredAutoRunCount(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return 5;
  }

  return Math.max(1, Math.min(parsed, 20));
}

function getConfiguredAutoRunPrompt(value) {
  if (typeof value !== 'string') {
    return DEFAULT_AUTO_RUN_PROMPT;
  }

  const trimmed = value.trim();
  return trimmed || DEFAULT_AUTO_RUN_PROMPT;
}

function getStoredAutoRunCount(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, Math.min(parsed, 99));
}

function normalizeWorkspacePath(path) {
  if (typeof path !== 'string') {
    return '';
  }

  return path.trim();
}

function mergeWorkspacePaths(existingPaths = [], additions = []) {
  const next = [];
  const seen = new Set();

  [...(additions || []), ...(existingPaths || [])].forEach((path) => {
    const normalizedPath = normalizeWorkspacePath(path);
    if (!normalizedPath) {
      return;
    }

    const key = normalizedPath.toLowerCase();
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    next.push(normalizedPath);
  });

  return next.slice(0, 12);
}

function hasSameWorkspacePaths(left = [], right = []) {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

function getLastAssistantMessage(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return null;
  }

  const lastMessage = messages[messages.length - 1];
  return lastMessage?.role === 'assistant' ? lastMessage : null;
}

function buildWorkspaceHighlights(storedHighlights = {}, workspacePath = '', streamingToolCalls = []) {
  const runtimeHighlights = mergeWorkspaceHighlightMaps({}, storedHighlights);
  const streamingHighlights = buildWorkspaceHighlightMap(streamingToolCalls, workspacePath);
  return mergeWorkspaceHighlightMaps(runtimeHighlights, streamingHighlights);
}

function buildWorkspaceHighlightMap(toolCalls = [], workspacePath = '') {
  const highlights = {};

  for (const toolCall of toolCalls || []) {
    const markers = extractWorkspaceMarkersFromToolCall(toolCall);
    for (const marker of markers) {
      const resolvedPath = resolveWorkspaceMarkerPath(marker.path, workspacePath);
      if (!resolvedPath || !marker.status) {
        continue;
      }

      highlights[resolvedPath] = mergeWorkspaceHighlightStatus(highlights[resolvedPath], marker.status);
    }
  }

  return highlights;
}

function mergeWorkspaceHighlightMaps(base = {}, incoming = {}) {
  const merged = { ...(base || {}) };

  for (const [targetPath, status] of Object.entries(incoming || {})) {
    const normalizedPath = normalizeWorkspaceMarkerPath(targetPath);
    if (!normalizedPath || !status) {
      continue;
    }

    merged[normalizedPath] = mergeWorkspaceHighlightStatus(merged[normalizedPath], status);
  }

  return merged;
}

function mergeWorkspaceHighlightStatus(currentStatus, nextStatus) {
  if (currentStatus === 'created' || nextStatus === 'created') {
    return 'created';
  }

  if (nextStatus === 'modified') {
    return 'modified';
  }

  return currentStatus || '';
}

function areSameWorkspaceHighlightMaps(left = {}, right = {}) {
  const leftEntries = Object.entries(left || {});
  const rightEntries = Object.entries(right || {});
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }

  for (const [targetPath, status] of leftEntries) {
    if (right[targetPath] !== status) {
      return false;
    }
  }

  return true;
}

function resolveWorkspaceMarkerPath(targetPath, workspacePath = '') {
  const normalizedPath = normalizeWorkspaceMarkerPath(targetPath);
  if (!normalizedPath) {
    return '';
  }

  if (isAbsoluteWorkspaceMarkerPath(normalizedPath)) {
    return collapseWorkspaceMarkerPath(normalizedPath);
  }

  const normalizedWorkspacePath = normalizeWorkspaceMarkerPath(workspacePath);
  if (!normalizedWorkspacePath) {
    return collapseWorkspaceMarkerPath(normalizedPath);
  }

  return joinWorkspaceMarkerPath(normalizedWorkspacePath, normalizedPath);
}

function isAbsoluteWorkspaceMarkerPath(targetPath) {
  return /^[a-zA-Z]:\\/.test(targetPath) || /^\\\\/.test(targetPath);
}

function joinWorkspaceMarkerPath(basePath, relativePath) {
  const normalizedBase = normalizeWorkspaceMarkerPath(basePath).replace(/[\\]+$/, '');
  const normalizedRelative = normalizeWorkspaceMarkerPath(relativePath).replace(/^(?:\.\\)+/, '');
  return collapseWorkspaceMarkerPath(
    normalizedBase
      ? `${normalizedBase}\\${normalizedRelative}`
      : normalizedRelative
  );
}

function collapseWorkspaceMarkerPath(targetPath) {
  const normalizedPath = normalizeWorkspaceMarkerPath(targetPath);
  if (!normalizedPath) {
    return '';
  }

  const isUncPath = normalizedPath.startsWith('\\\\');
  const driveMatch = normalizedPath.match(/^[a-zA-Z]:\\/);
  const prefix = isUncPath ? '\\\\' : (driveMatch ? normalizedPath.slice(0, 2) : '');
  const remainder = isUncPath
    ? normalizedPath.slice(2)
    : (driveMatch ? normalizedPath.slice(2) : normalizedPath);
  const stack = [];

  for (const segment of remainder.split('\\').filter(Boolean)) {
    if (segment === '.') {
      continue;
    }

    if (segment === '..') {
      if (stack.length > 0 && stack[stack.length - 1] !== '..') {
        stack.pop();
      } else if (!prefix) {
        stack.push(segment);
      }
      continue;
    }

    stack.push(segment);
  }

  if (isUncPath) {
    return `\\\\${stack.join('\\')}`;
  }

  if (driveMatch) {
    return `${prefix}\\${stack.join('\\')}`;
  }

  return stack.join('\\');
}

function extractWorkspaceMarkersFromToolCall(toolCall) {
  if (!toolCall || typeof toolCall !== 'object') {
    return [];
  }

  const normalizedName = String(toolCall.name || '').toLowerCase();
  const input = toolCall.input;

  if (Array.isArray(input?.changes) && input.changes.length > 0) {
    return extractWorkspaceMarkersFromChanges(input.changes);
  }

  if (normalizedName.includes('write')) {
    return extractPathMarkersFromInput(input, 'created');
  }

  if (normalizedName.includes('edit')) {
    const directMarkers = extractPathMarkersFromInput(input, 'modified');
    if (directMarkers.length > 0) {
      return directMarkers;
    }

    return extractPatchMarkers(input);
  }

  return [];
}

function extractWorkspaceMarkersFromChanges(changes) {
  const markers = [];

  for (const change of changes) {
    const path = typeof change?.path === 'string' ? change.path.trim() : '';
    const kind = String(change?.kind || '').toLowerCase();
    if (!path) {
      continue;
    }

    if (kind === 'add') {
      markers.push({ path, status: 'created' });
      continue;
    }

    if (kind === 'modify' || kind === 'update') {
      markers.push({ path, status: 'modified' });
    }
  }

  return dedupeWorkspaceMarkers(markers);
}

function extractPathMarkersFromInput(input, status) {
  if (!input || typeof input !== 'object') {
    return [];
  }

  const keys = ['file_path', 'path', 'target_path'];
  const markers = [];

  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) {
      markers.push({
        path: value.trim(),
        status,
      });
    }
  }

  return dedupeWorkspaceMarkers(markers);
}

function extractPatchMarkers(input) {
  const patchText = getPatchText(input);
  if (!patchText) {
    return [];
  }

  const markers = [];
  const linePattern = /^\*\*\* (Add|Update) File:\s+(.+)$/gm;
  let match = linePattern.exec(patchText);

  while (match) {
    markers.push({
      path: String(match[2] || '').trim(),
      status: match[1] === 'Add' ? 'created' : 'modified',
    });
    match = linePattern.exec(patchText);
  }

  return dedupeWorkspaceMarkers(markers);
}

function getPatchText(input) {
  if (!input) {
    return '';
  }

  if (typeof input === 'string') {
    return input;
  }

  const candidates = [
    input.patch,
    input.input,
    input.text,
    input.replacement,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.includes('*** Begin Patch')) {
      return candidate;
    }
  }

  return '';
}

function dedupeWorkspaceMarkers(markers) {
  const seen = new Set();
  const deduped = [];

  for (const marker of markers) {
    const path = normalizeWorkspaceMarkerPath(marker?.path);
    if (!path) {
      continue;
    }

    const key = `${marker.status}:${path.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push({
      path,
      status: marker.status,
    });
  }

  return deduped;
}

function normalizeWorkspaceMarkerPath(path) {
  if (typeof path !== 'string') {
    return '';
  }

  return path.trim().replace(/\//g, '\\');
}

function extractNewAssistantToolCalls(currentMessages = [], syncedMessages = []) {
  if (!Array.isArray(currentMessages) || !Array.isArray(syncedMessages)) {
    return [];
  }

  if (currentMessages.length === 0 || syncedMessages.length <= currentMessages.length) {
    return [];
  }

  for (let index = 0; index < currentMessages.length; index += 1) {
    if (!areConversationMessagesEqual(currentMessages[index], syncedMessages[index])) {
      return [];
    }
  }

  const nextToolCalls = [];
  for (let index = currentMessages.length; index < syncedMessages.length; index += 1) {
    const message = syncedMessages[index];
    if (message?.role === 'assistant' && Array.isArray(message.toolCalls)) {
      nextToolCalls.push(...message.toolCalls);
    }
  }

  return nextToolCalls;
}

function areConversationMessagesEqual(leftMessage, rightMessage) {
  if (!leftMessage || !rightMessage) {
    return false;
  }

  if (leftMessage.role !== rightMessage.role || leftMessage.content !== rightMessage.content) {
    return false;
  }

  return JSON.stringify(leftMessage.toolCalls || []) === JSON.stringify(rightMessage.toolCalls || []);
}

function parseCodexFastCommand(message) {
  const trimmed = String(message || '').trim();
  if (!trimmed.toLowerCase().startsWith('/fast')) {
    return null;
  }

  const match = trimmed.match(/^\/fast(?:\s+(\S+))?\s*$/i);
  if (!match) {
    return { type: 'invalid' };
  }

  const action = (match[1] || '').toLowerCase();
  if (!action) {
    return { type: 'toggle' };
  }
  if (action === 'on' || action === 'off' || action === 'status') {
    return { type: action };
  }
  return { type: 'invalid' };
}

function appendLocalConversation(setSessions, sessionId, userContent, assistantContent) {
  const userMessage = {
    role: 'user',
    content: userContent,
    localOnly: true,
  };
  const assistantMessage = {
    role: 'assistant',
    content: assistantContent,
    localOnly: true,
  };

  setSessions((prev) => prev.map((session) => (
    session.id === sessionId
      ? mergeSessionMessages(session, [...(session.messages || []), userMessage, assistantMessage], { updatedAt: Date.now() })
      : session
  )));
}

function isErrorAssistantMessage(message) {
  if (message?.role !== 'assistant' || typeof message?.content !== 'string') {
    return false;
  }

  return (
    message.content.startsWith('Error:')
    || message.content.startsWith('错误:')
    || message.content.startsWith('错误：')
  );
}
