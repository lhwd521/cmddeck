const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg']);

class ClaudeBridge extends EventEmitter {
  constructor() {
    super();
    this.processes = new Map();
    this.sessionIds = new Map();
  }

  sendMessage(sessionId, message, options = {}) {
    const { cwd, files, resumeSessionId, requestId, model, permissionMode } = options;
    const args = ['-p', '--output-format', 'stream-json', '--verbose'];

    if (model) {
      args.push('--model', model);
    }

    if (permissionMode === 'yolo') {
      args.push('--dangerously-skip-permissions');
    } else if (permissionMode && permissionMode !== 'default') {
      // All other modes map directly to --permission-mode:
      // plan | acceptEdits | bypassPermissions | dontAsk | auto
      args.push('--permission-mode', permissionMode);
    }

    let fullMessage = message;
    if (files && files.length > 0) {
      const dirs = new Set();
      const validFiles = [];

      for (const filePath of files) {
        try {
          if (fs.existsSync(filePath)) {
            dirs.add(path.dirname(filePath));
            validFiles.push(filePath);
          }
        } catch {
          // Ignore unreadable files.
        }
      }

      for (const dir of dirs) {
        args.push('--add-dir', dir);
      }

      if (validFiles.length > 0) {
        const refs = validFiles.map((filePath) => {
          const ext = path.extname(filePath).toLowerCase();
          if (IMAGE_EXTS.has(ext)) {
            return `[Attached image: ${filePath}]\nPlease use the Read tool to view this image file: ${filePath}`;
          }
          return `[Attached file: ${filePath}]\nPlease use the Read tool to read this file: ${filePath}`;
        }).join('\n\n');
        fullMessage = `${refs}\n\n---\n\n${message}`;
      }
    }

    const providerSessionId = resumeSessionId || this.sessionIds.get(sessionId);
    if (providerSessionId) {
      args.push('--resume', providerSessionId);
    }

    const env = { ...process.env };
    delete env.CLAUDECODE;

    const spawnOptions = { env, shell: true };
    if (cwd) {
      spawnOptions.cwd = cwd;
    }

    const proc = spawn('claude', args, spawnOptions);
    this.processes.set(sessionId, proc);

    proc.stdin.write(fullMessage);
    proc.stdin.end();

    let buffer = '';

    proc.stdout.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        this.handleRawEvent(sessionId, requestId, line);
      }
    });

    proc.stderr.on('data', (data) => {
      const text = data.toString().trim();
      if (text) {
        this.emit('event', {
          provider: 'claude',
          sessionId,
          requestId,
          type: 'stderr',
          text,
        });
      }
    });

    proc.on('close', (code) => {
      this.processes.delete(sessionId);
      if (buffer.trim()) {
        this.handleRawEvent(sessionId, requestId, buffer.trim());
      }
      this.emit('event', {
        provider: 'claude',
        sessionId,
        requestId,
        type: 'process_end',
        exitCode: code,
      });
    });

    proc.on('error', (err) => {
      this.processes.delete(sessionId);
      this.emit('event', {
        provider: 'claude',
        sessionId,
        requestId,
        type: 'error',
        message: err.message,
      });
    });

    return requestId;
  }

  handleRawEvent(sessionId, requestId, line) {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    let event;
    try {
      event = JSON.parse(trimmed);
    } catch {
      return;
    }

    if (event.session_id) {
      this.sessionIds.set(sessionId, event.session_id);
      this.emit('event', {
        provider: 'claude',
        sessionId,
        requestId,
        type: 'session',
        providerSessionId: event.session_id,
      });
    }

    switch (event.type) {
      case 'assistant':
        this.handleAssistantBlocks(sessionId, requestId, event.message?.content || []);
        break;
      case 'content_block_delta':
        if (event.delta?.type === 'text_delta' && event.delta.text) {
          this.emit('event', {
            provider: 'claude',
            sessionId,
            requestId,
            type: 'text_delta',
            text: event.delta.text,
          });
        } else if (event.delta?.type === 'thinking_delta' && event.delta.thinking) {
          this.emit('event', {
            provider: 'claude',
            sessionId,
            requestId,
            type: 'thinking_delta',
            thinking: event.delta.thinking,
          });
        }
        break;
      case 'progress':
        this.emit('event', {
          provider: 'claude',
          sessionId,
          requestId,
          type: 'progress',
          message: event.message || event.content || '',
        });
        break;
      case 'result':
        this.emit('event', {
          provider: 'claude',
          sessionId,
          requestId,
          type: 'done',
          text: event.result || '',
          usage: normalizeUsage(event.usage),
          providerSessionId: event.session_id || this.sessionIds.get(sessionId) || null,
        });
        break;
      case 'error':
        this.emit('event', {
          provider: 'claude',
          sessionId,
          requestId,
          type: 'error',
          message: event.message || 'Unknown error',
        });
        break;
      default:
        break;
    }
  }

  handleAssistantBlocks(sessionId, requestId, blocks) {
    for (const block of blocks) {
      if (block.type === 'text' && block.text) {
        this.emit('event', {
          provider: 'claude',
          sessionId,
          requestId,
          type: 'text_delta',
          text: block.text,
        });
      } else if (block.type === 'tool_use') {
        this.emit('event', {
          provider: 'claude',
          sessionId,
          requestId,
          type: 'tool_call',
          toolCall: {
            id: block.id,
            name: block.name,
            input: block.input,
            status: 'running',
            result: null,
          },
        });
      } else if (block.type === 'thinking' && block.thinking) {
        this.emit('event', {
          provider: 'claude',
          sessionId,
          requestId,
          type: 'thinking_delta',
          thinking: block.thinking,
        });
      }
    }
  }

  getSessionId(sessionId) {
    return this.sessionIds.get(sessionId) || null;
  }

  setSessionId(sessionId, providerSessionId) {
    if (providerSessionId) {
      this.sessionIds.set(sessionId, providerSessionId);
    }
  }

  getCCSessionId(sessionId) {
    return this.getSessionId(sessionId);
  }

  setCCSessionId(sessionId, providerSessionId) {
    this.setSessionId(sessionId, providerSessionId);
  }

  abort(sessionId) {
    const proc = this.processes.get(sessionId);
    if (!proc) {
      return false;
    }

    proc.kill('SIGTERM');
    this.processes.delete(sessionId);
    return true;
  }

  abortAll() {
    for (const proc of this.processes.values()) {
      proc.kill('SIGTERM');
    }
    this.processes.clear();
  }
}

function normalizeUsage(usage) {
  if (!usage) {
    return null;
  }

  return {
    inputTokens: usage.input_tokens || 0,
    outputTokens: usage.output_tokens || 0,
  };
}

module.exports = { ClaudeBridge };
