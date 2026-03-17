import { useState, useCallback, useRef, useEffect } from 'react';

let _reqCounter = 0;

function formatErrorText(message) {
  const trimmed = String(message || '').trim();
  if (!trimmed) {
    return 'Error: Unknown error';
  }

  return /^error:/i.test(trimmed) ? trimmed : `Error: ${trimmed}`;
}

export function useClaude() {
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [streamingToolCalls, setStreamingToolCalls] = useState([]);
  const [thinkingText, setThinkingText] = useState('');
  const [progressInfo, setProgressInfo] = useState(null);
  const [contextUsage, setContextUsage] = useState(null);
  const [turnTimer, setTurnTimer] = useState(null);
  // { startTime: number, elapsed: number, tokens: { input, output } | null }

  // Map<sessionId, { requestId, resolve, turnData, timeoutId }>
  const sessionsRef = useRef(new Map());
  // Which session the user is currently viewing
  const activeViewRef = useRef(null);

  // Sync React state from a session's turnData (or clear if not streaming)
  const syncStateFromSession = useCallback((sessionId) => {
    const entry = sessionsRef.current.get(sessionId);
    if (entry && entry.resolve) {
      // Session is actively streaming — show its progress
      setIsStreaming(true);
      setStreamingText(entry.turnData.text);
      setStreamingToolCalls([...entry.turnData.toolCalls]);
      setThinkingText(entry.turnData.thinkingText || '');
      setProgressInfo(entry.turnData.progressInfo || null);
    } else {
      // Not streaming
      setIsStreaming(false);
      setStreamingText('');
      setStreamingToolCalls([]);
      setThinkingText('');
      setProgressInfo(null);
    }
    // Sync context usage from session's last known usage
    if (entry?.turnData?.usage) {
      setContextUsage(entry.turnData.usage);
    } else {
      setContextUsage(null);
    }
    // Sync turnTimer
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
    if (entry) {
      if (entry.timeoutId) clearTimeout(entry.timeoutId);
      if (entry.resolve) {
        entry.resolve({
          text: entry.turnData.text || '[Session deleted]',
          toolCalls: [...entry.turnData.toolCalls],
          ccSessionId: entry.turnData.ccSessionId,
        });
      }
      sessionsRef.current.delete(sessionId);
    }
  }, []);

  useEffect(() => {
    if (!window.claude?.onEvent) return;

    const unsubscribe = window.claude.onEvent((event) => {
      const eventSessionId = event.sessionId;
      const entry = sessionsRef.current.get(eventSessionId);

      // Uncomment for debugging:
      // console.log('[useClaude] event:', event.type, 'sid:', eventSessionId, 'rid:', event.requestId);

      if (!entry || event.requestId !== entry.requestId) {
        return;
      }

      const data = entry.turnData;
      const isViewing = eventSessionId === activeViewRef.current;

      switch (event.type) {
        case 'system':
          if (event.session_id) data.ccSessionId = event.session_id;
          break;

        case 'assistant':
          if (event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === 'text') {
                data.text += block.text;
                if (isViewing) setStreamingText(data.text);
              } else if (block.type === 'tool_use') {
                data.toolCalls.push({
                  id: block.id,
                  name: block.name,
                  input: block.input,
                  status: 'running',
                  result: null,
                });
                if (isViewing) setStreamingToolCalls([...data.toolCalls]);
              } else if (block.type === 'thinking') {
                data.thinkingText = block.thinking || '';
                if (isViewing) setThinkingText(data.thinkingText);
              }
            }
          }
          if (event.session_id) data.ccSessionId = event.session_id;
          break;

        case 'content_block_delta':
          if (event.delta?.type === 'text_delta') {
            data.text += event.delta.text;
            if (isViewing) setStreamingText(data.text);
          } else if (event.delta?.type === 'thinking_delta') {
            data.thinkingText = (data.thinkingText || '') + (event.delta.thinking || '');
            if (isViewing) setThinkingText(data.thinkingText);
          }
          break;

        case 'progress':
          data.progressInfo = { message: event.message || event.content };
          if (isViewing) setProgressInfo(data.progressInfo);
          break;

        case 'result': {
          const finalText = event.result || data.text;
          data.text = finalText;
          if (event.session_id) data.ccSessionId = event.session_id;
          data.finalElapsed = Date.now() - data.startTime;
          if (event.usage) {
            const inputTokens = event.usage.input_tokens || 0;
            const outputTokens = event.usage.output_tokens || 0;
            const percent = Math.round(inputTokens / 200000 * 100);
            data.usage = { inputTokens, outputTokens, percent };
            data.tokens = { input: inputTokens, output: outputTokens };
            if (isViewing) setContextUsage(data.usage);
          }
          for (const tc of data.toolCalls) {
            if (tc.status === 'running') tc.status = 'completed';
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
              ccSessionId: data.ccSessionId,
            });
            entry.resolve = null;
          }
          if (entry.timeoutId) clearTimeout(entry.timeoutId);
          break;
        }

        case 'process_end':
          if (!data.finalElapsed) data.finalElapsed = Date.now() - data.startTime;
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
                  ccSessionId: data.ccSessionId,
                  error: stderrText,
                });
                entry.resolve = null;
              }
              if (entry.timeoutId) clearTimeout(entry.timeoutId);
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
              ccSessionId: data.ccSessionId,
            });
            entry.resolve = null;
          }
          if (entry.timeoutId) clearTimeout(entry.timeoutId);
          break;

        case 'error':
          if (!data.finalElapsed) data.finalElapsed = Date.now() - data.startTime;
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
                ccSessionId: data.ccSessionId,
                error: errorMessage,
              });
              entry.resolve = null;
            }
            if (entry.timeoutId) clearTimeout(entry.timeoutId);
          }
          break;

        case 'stderr':
          data.stderrText = data.stderrText
            ? `${data.stderrText}\n${event.text}`
            : (event.text || '');
          console.warn('[claude stderr]', event.text);
          break;
      }
    });

    return () => { if (unsubscribe) unsubscribe(); };
  }, []);

  // Real-time elapsed timer during streaming
  useEffect(() => {
    if (!isStreaming || !turnTimer?.startTime) return;
    const id = setInterval(() => {
      setTurnTimer((prev) => prev ? { ...prev, elapsed: Date.now() - prev.startTime } : prev);
    }, 100);
    return () => clearInterval(id);
  }, [isStreaming, turnTimer?.startTime]);

  const sendMessage = useCallback(
    async (sessionId, message, options = {}) => {
      const requestId = `req-${++_reqCounter}-${Date.now()}`;
      // Uncomment for debugging:
      // console.log('[useClaude] sendMessage, sid:', sessionId, 'requestId:', requestId);

      const turnData = {
        text: '',
        toolCalls: [],
        ccSessionId: null,
        thinkingText: '',
        progressInfo: null,
        usage: null,
        stderrText: '',
        startTime: Date.now(),
        finalElapsed: null,
        tokens: null,
      };

      // Clean up previous entry for this session if exists
      const prev = sessionsRef.current.get(sessionId);
      if (prev?.timeoutId) clearTimeout(prev.timeoutId);

      // Register in Map before IPC call so events are matched immediately
      const entry = { requestId, turnData, resolve: null, timeoutId: null };
      sessionsRef.current.set(sessionId, entry);

      // Update React state if this is the viewed session
      if (activeViewRef.current === sessionId) {
        setIsStreaming(true);
        setStreamingText('');
        setStreamingToolCalls([]);
        setThinkingText('');
        setProgressInfo(null);
        setTurnTimer({ startTime: turnData.startTime, elapsed: 0, tokens: null });
      }

      const sendResult = await window.claude.sendMessage(sessionId, message, {
        cwd: options.cwd,
        files: options.files,
        resumeSessionId: options.resumeSessionId,
        model: options.model,
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
        // Safety timeout: 5 minutes per session
        entry.timeoutId = setTimeout(() => {
          if (entry.resolve === resolve) {
            entry.resolve = null;
            resolve({
              text: turnData.text || 'Response timed out',
              toolCalls: turnData.toolCalls,
              ccSessionId: turnData.ccSessionId,
            });
            if (activeViewRef.current === sessionId) {
              setIsStreaming(false);
            }
          }
        }, 300000);
      });
    },
    []
  );

  const abort = useCallback(async (sessionId) => {
    if (window.claude?.abort) {
      await window.claude.abort(sessionId);
    }
    const entry = sessionsRef.current.get(sessionId);
    if (entry) {
      if (entry.timeoutId) clearTimeout(entry.timeoutId);
      if (entry.resolve) {
        entry.resolve({
          text: entry.turnData.text || '[Aborted]',
          toolCalls: entry.turnData.toolCalls,
          ccSessionId: entry.turnData.ccSessionId,
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
