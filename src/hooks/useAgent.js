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
          const finalText = event.text ?? data.text;
          data.text = finalText;
          if (event.providerSessionId) {
            data.providerSessionId = event.providerSessionId;
          }
          data.finalElapsed = Date.now() - data.startTime;
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
            setIsStreaming(false);
            setTurnTimer({
              startTime: data.startTime,
              elapsed: data.finalElapsed,
              tokens: data.tokens,
            });
          }
          if (entry.resolve) {
            entry.resolve({
              text: finalText,
              toolCalls: [...data.toolCalls],
              providerSessionId: data.providerSessionId,
            });
            entry.resolve = null;
          }
          if (entry.timeoutId) {
            clearTimeout(entry.timeoutId);
          }
          break;
        }
        case 'process_end':
          if (!data.finalElapsed) {
            data.finalElapsed = Date.now() - data.startTime;
          }
          {
            const exitCode = typeof event.exitCode === 'number' ? event.exitCode : null;
            const stderrText = String(data.stderrText || '').trim();
            if (exitCode !== null && exitCode !== 0 && !String(data.text || '').trim() && stderrText) {
              if (isViewing) {
                setIsStreaming(false);
                setTurnTimer({
                  startTime: data.startTime,
                  elapsed: data.finalElapsed,
                  tokens: data.tokens,
                });
              }
              if (entry.resolve) {
                entry.resolve({
                  text: formatErrorText(stderrText),
                  toolCalls: [...data.toolCalls],
                  providerSessionId: data.providerSessionId,
                  error: stderrText,
                });
                entry.resolve = null;
              }
              if (entry.timeoutId) {
                clearTimeout(entry.timeoutId);
              }
              break;
            }
          }
          if (isViewing) {
            setIsStreaming(false);
            setTurnTimer({
              startTime: data.startTime,
              elapsed: data.finalElapsed,
              tokens: data.tokens,
            });
          }
          if (entry.resolve) {
            entry.resolve({
              text: data.text || '',
              toolCalls: [...data.toolCalls],
              providerSessionId: data.providerSessionId,
            });
            entry.resolve = null;
          }
          if (entry.timeoutId) {
            clearTimeout(entry.timeoutId);
          }
          break;
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
            if (entry.resolve) {
              entry.resolve({
                text: data.text || formattedError,
                toolCalls: [...data.toolCalls],
                providerSessionId: data.providerSessionId,
                error: errorMessage,
              });
              entry.resolve = null;
            }
            if (entry.timeoutId) {
              clearTimeout(entry.timeoutId);
            }
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

    const entry = { requestId, provider, turnData, resolve: null, timeoutId: null };
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
      entry.timeoutId = setTimeout(() => {
        if (entry.resolve === resolve) {
          entry.resolve = null;
          resolve({
            text: turnData.text || 'Response timed out',
            toolCalls: turnData.toolCalls,
            providerSessionId: turnData.providerSessionId,
          });
          if (activeViewRef.current === sessionId) {
            setIsStreaming(false);
          }
        }
      }, 300000);
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
        entry.resolve({
          text: entry.turnData.text || '[Aborted]',
          toolCalls: entry.turnData.toolCalls,
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
