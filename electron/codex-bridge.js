const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg']);
const TOOL_NAME_MAP = {
  shell_command: 'Bash',
  file_read: 'Read',
  read_file: 'Read',
  file_write: 'Write',
  write_file: 'Write',
  file_edit: 'Edit',
  edit_file: 'Edit',
  patch_apply: 'Edit',
  web_search: 'WebSearch',
  search_web: 'WebSearch',
  web_fetch: 'WebFetch',
  fetch_url: 'WebFetch',
  grep_search: 'Grep',
  search_files: 'Grep',
  glob_search: 'Glob',
  list_directory: 'Glob',
  file_change: 'File Change',
  apply_patch: 'Edit',
  view_image: 'Read',
  update_plan: 'Task Plan',
  request_user_input: 'Prompt User',
  'multi_tool_use.parallel': 'Multi Tool',
};
const NON_TOOL_ITEM_TYPES = new Set([
  'agent_message',
  'reasoning',
  'user_message',
  'system_message',
  'message',
  'approval_request',
]);

class CodexBridge extends EventEmitter {
  constructor() {
    super();
    this.processes = new Map();
    this.sessionIds = new Map();
    this.turnStates = new Map();
  }

  sendMessage(sessionId, message, options = {}) {
    const { cwd, files, resumeSessionId, requestId, model, permissionMode, reasoningEffort } = options;
    const providerSessionId = resumeSessionId || this.sessionIds.get(sessionId);
    const args = providerSessionId
      ? ['exec', 'resume']
      : ['exec'];

    args.push('--json', '--skip-git-repo-check');

    if (model) {
      args.push('--model', model);
    }

    if (reasoningEffort) {
      args.push('-c', `model_reasoning_effort=${reasoningEffort}`);
    }

    applyPermissionMode(args, permissionMode);

    let fullMessage = (message || '').trim();
    if (files && files.length > 0) {
      const dirs = new Set();
      const refs = [];

      for (const filePath of files) {
        try {
          if (!fs.existsSync(filePath)) {
            continue;
          }
        } catch {
          continue;
        }

        dirs.add(path.dirname(filePath));
        const ext = path.extname(filePath).toLowerCase();
        if (IMAGE_EXTS.has(ext)) {
          args.push('--image', filePath);
          refs.push(`[Attached image: ${filePath}]\nPlease inspect this attached image as part of the request.`);
        } else {
          refs.push(`[Attached file: ${filePath}]\nPlease inspect this file in the workspace: ${filePath}`);
        }
      }

      for (const dir of dirs) {
        if (!providerSessionId) {
          args.push('--add-dir', dir);
        }
      }

      if (refs.length > 0) {
        const userTask = fullMessage || 'Please inspect the attached files and images, then respond with what you found.';
        fullMessage = `${refs.join('\n\n')}\n\n---\n\n${userTask}`;
      }
    }

    if (!fullMessage) {
      fullMessage = 'Please help with this request.';
    }

    if (providerSessionId) {
      args.push(providerSessionId);
    }

    args.push('-');

    const spawnOptions = { shell: false };
    if (cwd) {
      spawnOptions.cwd = cwd;
    }

    const command = ['codex', ...args.map(quoteForCmd)].join(' ');
    const proc = spawn('cmd.exe', ['/d', '/s', '/c', command], spawnOptions);
    this.processes.set(sessionId, proc);
    this.turnStates.set(sessionId, { agentMessageCount: 0 });

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
          provider: 'codex',
          sessionId,
          requestId,
          type: 'stderr',
          text,
        });
      }
    });

    proc.on('close', (code) => {
      this.processes.delete(sessionId);
      this.turnStates.delete(sessionId);
      if (buffer.trim()) {
        this.handleRawEvent(sessionId, requestId, buffer.trim());
      }
      this.emit('event', {
        provider: 'codex',
        sessionId,
        requestId,
        type: 'process_end',
        exitCode: code,
      });
    });

    proc.on('error', (err) => {
      this.processes.delete(sessionId);
      this.turnStates.delete(sessionId);
      this.emit('event', {
        provider: 'codex',
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

    switch (event.type) {
      case 'thread.started':
        if (event.thread_id) {
          this.sessionIds.set(sessionId, event.thread_id);
          this.emit('event', {
            provider: 'codex',
            sessionId,
            requestId,
            type: 'session',
            providerSessionId: event.thread_id,
          });
        }
        return;
      case 'turn.started':
        this.emit('event', {
          provider: 'codex',
          sessionId,
          requestId,
          type: 'progress',
          message: 'Codex is working...',
        });
        return;
      case 'item.started':
      case 'item.updated':
      case 'item.completed':
        this.handleItemEvent(sessionId, requestId, event.type, event.item);
        return;
      case 'turn.completed':
        this.emit('event', {
          provider: 'codex',
          sessionId,
          requestId,
          type: 'done',
          text: null,
          usage: normalizeUsage(event.usage),
          providerSessionId: this.sessionIds.get(sessionId) || null,
        });
        return;
      case 'error':
        this.emit('event', {
          provider: 'codex',
          sessionId,
          requestId,
          type: 'error',
          message: event.message || 'Unknown error',
        });
        return;
      default:
        break;
    }
  }

  handleItemEvent(sessionId, requestId, phase, item) {
    if (!item?.type) {
      return;
    }

    if (item.type === 'agent_message') {
      if (phase === 'item.completed' && item.text) {
        const turnState = this.turnStates.get(sessionId);
        const prefix = turnState?.agentMessageCount ? '\n\n' : '';
        if (turnState) {
          turnState.agentMessageCount += 1;
        }
        this.emit('event', {
          provider: 'codex',
          sessionId,
          requestId,
          type: 'text_delta',
          text: `${prefix}${item.text}`,
        });
      }
      return;
    }

    if (item.type === 'reasoning') {
      const thinking = extractThinkingText(item);
      if (thinking) {
        this.emit('event', {
          provider: 'codex',
          sessionId,
          requestId,
          type: 'thinking_delta',
          thinking,
        });
      }
      return;
    }

    const toolCall = normalizeToolCall(item, phase);
    if (!toolCall) {
      return;
    }

    this.emit('event', {
      provider: 'codex',
      sessionId,
      requestId,
      type: phase === 'item.started' ? 'tool_call' : 'tool_call_update',
      toolCall,
    });

    if (phase === 'item.started') {
      this.emit('event', {
        provider: 'codex',
        sessionId,
        requestId,
        type: 'progress',
        message: getProgressMessage(toolCall),
      });
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

  abort(sessionId) {
    const proc = this.processes.get(sessionId);
    if (!proc) {
      return false;
    }

    terminateProcess(proc);
    this.processes.delete(sessionId);
    this.turnStates.delete(sessionId);
    return true;
  }

  abortAll() {
    for (const proc of this.processes.values()) {
      terminateProcess(proc);
    }
    this.processes.clear();
    this.turnStates.clear();
  }
}

function terminateProcess(proc) {
  if (!proc) {
    return;
  }

  if (process.platform === 'win32' && proc.pid) {
    spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }

  proc.kill('SIGTERM');
}

function quoteForCmd(arg) {
  const value = String(arg);
  if (!/[\s"&<>|^]/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '\\"')}"`;
}

function applyPermissionMode(args, permissionMode) {
  if (permissionMode === 'yolo') {
    args.push('--dangerously-bypass-approvals-and-sandbox');
    return;
  }

  if (permissionMode === 'plan') {
    args.push('-c', 'sandbox_mode=read-only');
    args.push('-c', 'approval_policy=never');
    return;
  }

  if (permissionMode === 'acceptEdits' || permissionMode === 'default' || !permissionMode) {
    args.push('-c', 'sandbox_mode=workspace-write');
    args.push('-c', 'approval_policy=never');
  }
}

function normalizeToolCall(item, phase) {
  if (item?.type === 'file_change') {
    const changes = normalizeFileChanges(item.changes);
    return {
      id: item.id || `${item.type}-${Date.now()}`,
      name: inferFileChangeToolName(changes),
      input: changes.length > 0 ? { changes } : null,
      status: getToolStatus(item, phase),
      result: phase === 'item.started' ? null : formatFileChangeResult(changes),
    };
  }

  if (item?.type === 'function_call') {
    const name = normalizeToolName(item.name);
    if (!name) {
      return null;
    }

    return {
      id: item.call_id || item.id || `${item.type}-${Date.now()}`,
      name,
      input: parseFunctionArguments(item.arguments),
      status: phase === 'item.completed' ? 'completed' : 'running',
      result: null,
    };
  }

  if (item?.type === 'function_call_output') {
    return {
      id: item.call_id || item.id || `${item.type}-${Date.now()}`,
      status: inferToolStatusFromOutput(item.output),
      result: decodeStructuredValue(item.output),
    };
  }

  if (item?.type === 'custom_tool_call') {
    const name = normalizeToolName(item.name);
    if (!name) {
      return null;
    }

    return {
      id: item.call_id || item.id || `${item.type}-${Date.now()}`,
      name,
      input: decodeStructuredValue(item.input),
      status: getCustomToolStatus(item, phase),
      result: item.output ? decodeStructuredValue(item.output) : null,
    };
  }

  if (!isToolLikeItem(item)) {
    return null;
  }

  const name = item.type === 'command_execution'
    ? inferCommandExecutionToolName(item.command)
    : normalizeToolName(item.type);
  if (!name) {
    return null;
  }

  return {
    id: item.id || `${item.type}-${Date.now()}`,
    name,
    input: extractToolInput(item),
    status: getToolStatus(item, phase),
    result: phase === 'item.started' ? null : extractToolResult(item),
  };
}

function normalizeToolName(itemType) {
  return TOOL_NAME_MAP[itemType] || itemType.split('_').map(capitalize).join(' ');
}

function getToolStatus(item, phase) {
  if (item.status === 'failed' || item.exit_code > 0) {
    return 'error';
  }
  if (phase === 'item.completed' || item.status === 'completed') {
    return 'completed';
  }
  return 'running';
}

function extractToolInput(item) {
  switch (item.type) {
    case 'command_execution':
      return { command: item.command || '' };
    case 'file_change':
      return {
        changes: normalizeFileChanges(item.changes),
      };
    case 'web_search':
      return { query: item.query || item.input || '' };
    case 'web_fetch':
      return { url: item.url || '' };
    default: {
      const input = {};
      const inputKeys = [
        'command',
        'path',
        'file_path',
        'target_path',
        'source_path',
        'cwd',
        'pattern',
        'query',
        'url',
        'input',
        'replacement',
        'old_string',
        'new_string',
        'recursive',
        'limit',
      ];

      for (const key of inputKeys) {
        if (item[key] !== undefined && item[key] !== null && item[key] !== '') {
          input[key] = item[key];
        }
      }

      return Object.keys(input).length > 0 ? input : null;
    }
  }
}

function extractToolResult(item) {
  if (item.type === 'command_execution') {
    const output = item.aggregated_output?.trimEnd();
    if (output) {
      return output;
    }
    if (item.exit_code !== null && item.exit_code !== undefined) {
      return `Command exited with code ${item.exit_code}`;
    }
    return null;
  }

  const directResult = item.result ?? item.output ?? item.output_text ?? item.text ?? null;
  if (directResult) {
    return directResult;
  }

  const result = {};
  const resultKeys = [
    'status',
    'exit_code',
    'aggregated_output',
    'stdout',
    'stderr',
    'content',
    'diff',
    'matches',
    'files',
    'message',
  ];

  for (const key of resultKeys) {
    if (item[key] !== undefined && item[key] !== null && item[key] !== '') {
      result[key] = item[key];
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

function parseFunctionArguments(rawArguments) {
  if (!rawArguments || typeof rawArguments !== 'string') {
    return null;
  }

  try {
    return decodeStructuredValue(JSON.parse(rawArguments));
  } catch {
    return rawArguments;
  }
}

function decodeStructuredValue(value) {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(decodeStructuredValue);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [key, decodeStructuredValue(entryValue)])
    );
  }

  return value;
}

function inferToolStatusFromOutput(output) {
  if (typeof output === 'string') {
    const exitCodeMatch = output.match(/Exit code:\s*(\d+)/i);
    if (exitCodeMatch) {
      return exitCodeMatch[1] === '0' ? 'completed' : 'error';
    }
  }

  return 'completed';
}

function getCustomToolStatus(item, phase) {
  if (item.status === 'failed') {
    return 'error';
  }

  if (phase === 'item.completed' || item.status === 'completed' || item.output !== undefined) {
    return 'completed';
  }

  return 'running';
}

function isToolLikeItem(item) {
  if (!item?.type || NON_TOOL_ITEM_TYPES.has(item.type)) {
    return false;
  }

  if (TOOL_NAME_MAP[item.type]) {
    return true;
  }

  return [
    'command',
    'path',
    'file_path',
    'target_path',
    'source_path',
    'url',
    'query',
    'pattern',
    'aggregated_output',
    'stdout',
    'stderr',
    'diff',
    'matches',
    'files',
    'exit_code',
  ].some((key) => item[key] !== undefined && item[key] !== null);
}

function extractThinkingText(item) {
  if (typeof item.text === 'string' && item.text.trim()) {
    return item.text;
  }

  if (Array.isArray(item.summary)) {
    const text = item.summary
      .map((entry) => (typeof entry === 'string' ? entry : entry?.text || ''))
      .filter(Boolean)
      .join('\n');
    return text || null;
  }

  return null;
}

function getProgressMessage(toolCall) {
  if (toolCall.name === 'Bash') {
    return 'Running shell command...';
  }
  if (toolCall.name === 'Read') {
    return 'Reading files...';
  }
  if (toolCall.name === 'Grep') {
    return 'Searching files...';
  }
  if (toolCall.name === 'Glob') {
    return 'Listing files...';
  }
  return `Running ${toolCall.name}...`;
}

function inferCommandExecutionToolName(command) {
  const normalized = String(command || '').toLowerCase();

  if (
    normalized.includes('get-content')
    || normalized.match(/(^|[\s"'`])(cat|type|more|less|head|tail)([\s"'`]|$)/)
  ) {
    return 'Read';
  }

  if (
    normalized.includes('get-childitem')
    || normalized.match(/(^|[\s"'`])(ls|dir)([\s"'`]|$)/)
  ) {
    return 'Glob';
  }

  if (
    normalized.match(/(^|[\s"'`])(rg|grep|findstr|select-string)([\s"'`]|$)/)
  ) {
    return 'Grep';
  }

  return 'Bash';
}

function normalizeFileChanges(changes) {
  if (!Array.isArray(changes)) {
    return [];
  }

  return changes
    .map((change) => ({
      path: typeof change?.path === 'string' ? change.path : '',
      kind: typeof change?.kind === 'string' ? change.kind : '',
    }))
    .filter((change) => change.path);
}

function inferFileChangeToolName(changes) {
  if (!Array.isArray(changes) || changes.length === 0) {
    return 'File Change';
  }

  const kinds = new Set(changes.map((change) => change.kind));
  if (kinds.size === 1 && kinds.has('add')) {
    return 'Write';
  }
  if (kinds.size === 1 && (kinds.has('modify') || kinds.has('update'))) {
    return 'Edit';
  }
  return 'File Change';
}

function formatFileChangeResult(changes) {
  if (!Array.isArray(changes) || changes.length === 0) {
    return null;
  }

  return changes
    .map((change) => `${change.kind || 'change'}: ${change.path}`)
    .join('\n');
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
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

module.exports = { CodexBridge };
