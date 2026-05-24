import { useState, useCallback, useRef, useEffect } from 'react';

let requestCounter = 0;

const CONTEXT_LIMITS = {
  claude: 200000,
  codex: 256000,
};

function formatErrorText(message) {
  const trimmed = String(message || '').trim();
  if (!trimmed) {
    return 'Error: Unknown error';
  }

  return /^error:/i.test(trimmed) ? trimmed : `Error: ${trimmed}`;
}

function hasPermissionBlock(stderrText = '', permissionDenials = []) {
  if (Array.isArray(permissionDenials) && permissionDenials.length > 0) {
    return true;
  }

  const normalized = String(stderrText || '').toLowerCase();
  return (
    normalized.includes('approval')
    || normalized.includes('permission')
    || normalized.includes('read-only sandbox')
    || normalized.includes('sandbox')
  ) && (
    normalized.includes('rejected')
    || normalized.includes('blocked')
    || normalized.includes('denied')
    || normalized.includes('not granted')
    || normalized.includes('approval settings')
  );
}

function appendPermissionNotice(text, provider, permissionDenials = [], stderrText = '') {
  if (!hasPermissionBlock(stderrText, permissionDenials)) {
    return text || '';
  }

  const currentText = String(text || '').trimEnd();
  if (currentText.includes('CmdDeck cannot approve this request in the UI yet')) {
    return currentText;
  }

  const providerLabel = provider === 'codex' ? 'Codex' : 'Claude Code';
  const notice = `Permission required. ${providerLabel} asked for an action CmdDeck cannot approve in the UI yet. Switch to Auto/Accept Edits/YOLO, or use Resume in CLI to approve it there.`;
  return currentText ? `${currentText}\n\n${notice}` : notice;
}

function markDeniedToolCalls(toolCalls, permissionDenials = []) {
  if (!Array.isArray(permissionDenials) || permissionDenials.length === 0) {
    return;
  }

  const deniedIds = new Set(permissionDenials.map((denial) => denial.toolUseId).filter(Boolean));
  for (const toolCall of toolCalls) {
    if (deniedIds.has(toolCall.id)) {
      toolCall.status = 'error';
      toolCall.result = toolCall.result || 'Permission required.';
    }
  }
}

function upsertToolCall(toolCalls, nextToolCall) {
  if (!nextToolCall) {
    return;
  }

  const index = toolCalls.findIndex((tool) => tool.id && nextToolCall.id && tool.id === nextToolCall.id);
  if (index === -1) {
    toolCalls.push(nextToolCall);
    return;
  }

  toolCalls[index] = {
    ...toolCalls[index],
    ...nextToolCall,
    input: nextToolCall.input ?? toolCalls[index].input,
    result: nextToolCall.result ?? toolCalls[index].result,
  };
}

function stopToolCalls(toolCalls) {
  return (toolCalls || []).map((tool) => (
    tool.status === 'running'
      ? {
          ...tool,
          status: 'error',
          result: tool.result || 'Stopped by user.',
        }
      : tool
  ));
}

export function useAgent() {
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [streamingToolCalls, setStreamingToolCalls] = useState([]);
  const [thinkingText, setThinkingText] = useState('');
  const [progressInfo, setProgressInfo] = useState(null);
  const [contextUsage, setContextUsage] = useState(null);
  const [turnTimer, setTurnTimer] = useState(null);

  const sessionsRef = useRef(new Map());
  const activeViewRef = useRef(null);

  const finalizeStreaming = (sessionId, entry) => {
    if (!entry) {
      return;
    }
    if (activeViewRef.current === sessionId) {
      setIsStreaming(false);
      setTurnTimer({
        startTime: entry.turnData.startTime,
        elapsed: entry.turnData.finalElapsed ?? (Date.now() - entry.turnData.startTime),
        tokens: entry.turnData.tokens,
      });
    }
  };

  const resolveEntry = (entry, payload) => {
    if (!entry?.resolve) {
      return;
    }

    entry.resolve(payload);
    entry.resolve = null;
  };

  const syncStateFromSession = useCallback((sessionId) => {
    const entry = sessionsRef.current.get(sessionId);
    if (entry && entry.resolve) {
      setIsStreaming(true);
      setStreamingText(entry.turnData.text);
      setStreamingToolCalls([...entry.turnData.toolCalls]);
      setThinkingText(entry.turnData.thinkingText || '');
      setProgressInfo(entry.turnData.progressInfo || null);
    } else {
      setIsStreaming(false);
      setStreamingText('');
      setStreamingToolCalls([]);
      setThinkingText('');
      setProgressInfo(null);
    }

    if (entry?.turnData?.usage) {
      setContextUsage(entry.turnData.usage);
    } else {
      setContextUsage(null);
    }

    if (entry?.turnData?.startTime) {
      const elapsed = entry.turnData.finalElapsed ?? (Date.now() - entry.turnData.startTime);
      setTurnTimer({
        startTime: entry.turnData.startTime,
        elapsed,
        tokens: entry.turnData.tokens || null,
      });
    } else {
      setTurnTimer(null);
    }
  }, []);

  const setViewingSession = useCallback((sessionId) => {
    activeViewRef.current = sessionId;
    syncStateFromSession(sessionId);
  }, [syncStateFromSession]);

  const cleanupSession = useCallback((sessionId) => {
    const entry = sessionsRef.current.get(sessionId);
    if (!entry) {
      return;
    }

    if (entry.timeoutId) {
      clearTimeout(entry.timeoutId);
    }

    if (entry.resolve) {
      entry.resolve({
        text: entry.turnData.text || '[Session deleted]',
        toolCalls: [...entry.turnData.toolCalls],
        providerSessionId: entry.turnData.providerSessionId,
      });
    }

    sessionsRef.current.delete(sessionId);
  }, []);

  useEffect(() => {
    if (!window.agent?.onEvent) {
      return undefined;
    }

    const unsubscribe = window.agent.onEvent((event) => {
      const entry = sessionsRef.current.get(event.sessionId);
      if (!entry || entry.provider !== event.provider || event.requestId !== entry.requestId) {
        return;
      }

      const data = entry.turnData;
      const isViewing = event.sessionId === activeViewRef.current;

      switch (event.type) {
        case 'session':
          data.providerSessionId = event.providerSessionId;
          break;
        case 'text_delta':
          data.text += event.text || '';
          if (isViewing) {
            setStreamingText(data.text);
          }
          break;
        case 'tool_call':
        case 'tool_call_update':
          upsertToolCall(data.toolCalls, event.toolCall);
          if (isViewing) {
            setStreamingToolCalls([...data.toolCalls]);
          }
          break;
        case 'thinking_delta':
          data.thinkingText = (data.thinkingText || '') + (event.thinking || '');
          if (isViewing) {
            setThinkingText(data.thinkingText);
          }
          break;
        case 'progress':
          data.progressInfo = { message: event.message || '' };
          if (isViewing) {
            setProgressInfo(data.progressInfo);
          }
          break;
        case 'done': {
          const finalText = appendPermissionNotice(
            event.text ?? data.text,
            event.provider,
            event.permissionDenials,
            data.stderrText
          );
          data.text = finalText;
          if (event.providerSessionId) {
            data.providerSessionId = event.providerSessionId;
          }
          data.finalElapsed = Date.now() - data.startTime;
          entry.turnDone = true;
          if (event.usage) {
            const inputTokens = event.usage.inputTokens || 0;
            const outputTokens = event.usage.outputTokens || 0;
            const contextLimit = CONTEXT_LIMITS[event.provider] || 200000;
            data.usage = {
              inputTokens,
              outputTokens,
              percent: Math.round((inputTokens / contextLimit) * 100),
            };
            data.tokens = { input: inputTokens, output: outputTokens };
            if (isViewing) {
              setContextUsage(data.usage);
            }
          }
          markDeniedToolCalls(data.toolCalls, event.permissionDenials);
          for (const toolCall of data.toolCalls) {
            if (toolCall.status === 'running') {
              toolCall.status = 'completed';
            }
          }
          if (isViewing) {
            setStreamingText(finalText);
            setStreamingToolCalls([...data.toolCalls]);
            setThinkingText('');
            setProgressInfo(null);
          }
          if (entry.processEnded) {
            resolveEntry(entry, {
              text: finalText,
              toolCalls: [...data.toolCalls],
              providerSessionId: data.providerSessionId,
            });
            finalizeStreaming(event.sessionId, entry);
          }
          break;
        }
        case 'process_end': {
          entry.processEnded = true;
          if (!data.finalElapsed) {
            data.finalElapsed = Date.now() - data.startTime;
          }
          const exitCode = typeof event.exitCode === 'number' ? event.exitCode : null;
          const stderrText = String(data.stderrText || '').trim();

          if (!entry.turnDone) {
            if (exitCode !== null && exitCode !== 0 && !String(data.text || '').trim() && stderrText) {
              const finalErrorText = appendPermissionNotice(
                formatErrorText(stderrText),
                event.provider,
                [],
                stderrText
              );
              resolveEntry(entry, {
                text: finalErrorText,
                toolCalls: [...data.toolCalls],
                providerSessionId: data.providerSessionId,
                error: stderrText,
              });
              finalizeStreaming(event.sessionId, entry);
              break;
            }

            resolveEntry(entry, {
              text: appendPermissionNotice(data.text || '', event.provider, [], stderrText),
              toolCalls: [...data.toolCalls],
              providerSessionId: data.providerSessionId,
            });
          } else {
            const finalText = appendPermissionNotice(data.text || '', event.provider, [], stderrText);
            data.text = finalText;
            resolveEntry(entry, {
              text: finalText,
              toolCalls: [...data.toolCalls],
              providerSessionId: data.providerSessionId,
            });
          }
          finalizeStreaming(event.sessionId, entry);
          break;
        }
        case 'error':
          if (!data.finalElapsed) {
            data.finalElapsed = Date.now() - data.startTime;
          }
          {
            const errorMessage = event.message || 'Unknown error';
            const formattedError = formatErrorText(errorMessage);
            if (isViewing) {
              setIsStreaming(false);
              setTurnTimer({
                startTime: data.startTime,
                elapsed: data.finalElapsed,
                tokens: data.tokens,
              });
            }
            resolveEntry(entry, {
              text: data.text || formattedError,
              toolCalls: [...data.toolCalls],
              providerSessionId: data.providerSessionId,
              error: errorMessage,
            });
            break;
          }
        case 'stderr':
          data.stderrText = data.stderrText
            ? `${data.stderrText}\n${event.text}`
            : (event.text || '');
          console.warn(`[${event.provider} stderr]`, event.text);
          break;
        default:
          break;
      }
    });

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, []);

  useEffect(() => {
    if (!isStreaming || !turnTimer?.startTime) {
      return undefined;
    }

    const id = setInterval(() => {
      setTurnTimer((prev) => (prev ? { ...prev, elapsed: Date.now() - prev.startTime } : prev));
    }, 100);

    return () => clearInterval(id);
  }, [isStreaming, turnTimer?.startTime]);

  const sendMessage = useCallback(async (sessionId, provider, message, options = {}) => {
    const requestId = `req-${++requestCounter}-${Date.now()}`;
    const turnData = {
      text: '',
      toolCalls: [],
      providerSessionId: null,
      thinkingText: '',
      progressInfo: null,
      usage: null,
      stderrText: '',
      startTime: Date.now(),
      finalElapsed: null,
      tokens: null,
    };

    const prev = sessionsRef.current.get(sessionId);
    if (prev?.timeoutId) {
      clearTimeout(prev.timeoutId);
    }

    const entry = {
      requestId,
      provider,
      turnData,
      resolve: null,
      timeoutId: null,
      turnDone: false,
      processEnded: false,
    };
    sessionsRef.current.set(sessionId, entry);

    if (activeViewRef.current === sessionId) {
      setIsStreaming(true);
      setStreamingText('');
      setStreamingToolCalls([]);
      setThinkingText('');
      setProgressInfo(null);
      setTurnTimer({ startTime: turnData.startTime, elapsed: 0, tokens: null });
    }

    const sendResult = await window.agent.sendMessage(provider, sessionId, message, {
      cwd: options.cwd,
      files: options.files,
      resumeSessionId: options.providerSessionId,
      model: options.model,
      reasoningEffort: options.reasoningEffort,
      permissionMode: options.permissionMode,
      requestId,
    });

    if (!sendResult.success) {
      sessionsRef.current.delete(sessionId);
      if (activeViewRef.current === sessionId) {
        setIsStreaming(false);
      }
      throw new Error(sendResult.error || 'Failed to send message');
    }

    return new Promise((resolve) => {
      entry.resolve = resolve;
    });
  }, []);

  const abort = useCallback(async (sessionId, provider) => {
    const entry = sessionsRef.current.get(sessionId);
    const activeProvider = provider || entry?.provider || 'claude';

    if (window.agent?.abort) {
      await window.agent.abort(activeProvider, sessionId);
    }

    if (entry) {
      if (entry.timeoutId) {
        clearTimeout(entry.timeoutId);
      }
      if (entry.resolve) {
        const toolCalls = stopToolCalls(entry.turnData.toolCalls);
        entry.turnData.toolCalls = toolCalls;
        entry.resolve({
          text: entry.turnData.text || '[Aborted]',
          toolCalls,
          providerSessionId: entry.turnData.providerSessionId,
        });
        entry.resolve = null;
      }
    }

    if (activeViewRef.current === sessionId) {
      setIsStreaming(false);
      setStreamingText('');
      setStreamingToolCalls([]);
      setThinkingText('');
      setProgressInfo(null);
    }
  }, []);

  return {
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
  };
}
