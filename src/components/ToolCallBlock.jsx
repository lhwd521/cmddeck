import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Terminal,
  FileEdit,
  Search,
  Globe,
  Loader,
  Check,
  XCircle,
  Eye,
} from 'lucide-react';
import { useI18n } from '../i18n';

const TOOL_ICONS = {
  Bash: Terminal,
  'Command Execution': Terminal,
  Edit: FileEdit,
  'File Edit': FileEdit,
  Write: FileEdit,
  'File Write': FileEdit,
  Read: Eye,
  'File Read': Eye,
  Grep: Search,
  Glob: Search,
  'List Directory': Search,
  'Search Files': Search,
  WebFetch: Globe,
  WebSearch: Globe,
  'Fetch Url': Globe,
  'Search Web': Globe,
};

const STATUS_COLORS = {
  running: 'bg-yellow-400',
  completed: 'bg-green-400',
  error: 'bg-red-400',
};

function StatusIcon({ status }) {
  switch (status) {
    case 'running':
      return <Loader size={12} className="animate-spin text-yellow-400" />;
    case 'completed':
      return <Check size={12} className="text-green-400" />;
    case 'error':
      return <XCircle size={12} className="text-red-400" />;
    default:
      return null;
  }
}

export default function ToolCallBlock({ tool }) {
  const [expanded, setExpanded] = useState(false);
  const { tx } = useI18n();
  const Icon = getToolIcon(tool.name);
  const status = tool.status || 'completed';
  const barColor = STATUS_COLORS[status] || 'bg-gray-400';

  const getToolSummary = () => {
    if (!tool.input) return tool.name;
    if (Array.isArray(tool.input.changes) && tool.input.changes.length > 0) {
      const firstChange = tool.input.changes[0];
      if (tool.input.changes.length === 1) {
        return `${tool.name}: ${firstChange.path || ''}`;
      }
      return `${tool.name}: ${tool.input.changes.length} files`;
    }
    switch (tool.name) {
      case 'Bash':
      case 'Command Execution':
        return `$ ${(tool.input.command || '').slice(0, 100)}`;
      case 'Read':
      case 'File Read':
        return `${tx('Read', '读取')}: ${tool.input.file_path || tool.input.path || tool.input.command || ''}`;
      case 'Edit':
      case 'File Edit':
        return `${tx('Edit', '编辑')}: ${tool.input.file_path || tool.input.path || tool.input.command || ''}`;
      case 'Write':
      case 'File Write':
        return `${tx('Write', '写入')}: ${tool.input.file_path || tool.input.path || tool.input.command || ''}`;
      case 'Grep':
      case 'Search Files':
        return `${tx('Search', '搜索')}: ${tool.input.pattern || tool.input.command || ''}`;
      case 'Glob':
      case 'List Directory':
        return `${tx('Find', '查找')}: ${tool.input.pattern || tool.input.path || tool.input.command || ''}`;
      case 'WebSearch':
      case 'Search Web':
        return `${tx('Search', '搜索')}: ${tool.input.query || ''}`;
      case 'WebFetch':
      case 'Fetch Url':
        return `${tx('Fetch', '抓取')}: ${tool.input.url || ''}`;
      default:
        return getGenericSummary(tool);
    }
  };

  const getResultPreview = () => {
    if (!tool.result) return null;
    if (typeof tool.result === 'string') {
      return tool.result.length > 300
        ? tool.result.slice(0, 300) + '...'
        : tool.result;
    }
    if (Array.isArray(tool.result)) {
      return tool.result
        .map((b) => (typeof b === 'string' ? b : b.text || JSON.stringify(b)))
        .join('\n')
        .slice(0, 300);
    }
    return JSON.stringify(tool.result, null, 2).slice(0, 300);
  };

  return (
    <div className="my-2 flex rounded-lg overflow-hidden bg-claude-surface-light dark:bg-claude-surface-dark transition-colors">
      {/* Left color bar indicating status */}
      <div className={`w-[3px] shrink-0 ${barColor}`} />

      <div className="flex-1 min-w-0">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-left"
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <Icon size={12} className="text-claude-orange shrink-0" />
          <span className="truncate font-mono flex-1 text-claude-text-light dark:text-claude-text-dark">
            {getToolSummary()}
          </span>
          <StatusIcon status={status} />
        </button>

        {expanded && (
          <div className="border-t border-claude-border-light dark:border-claude-border-dark">
            {/* Input */}
            {tool.input && (
              <div className="px-3 py-2 bg-black/5 dark:bg-white/5">
                <div className="text-[10px] text-gray-400 mb-1 font-medium uppercase tracking-wide">
                  {tx('Input', '输入')}
                </div>
                <pre className="text-xs font-mono whitespace-pre-wrap break-all text-claude-text-light/80 dark:text-claude-text-dark/80 max-h-[200px] overflow-y-auto">
                  {typeof tool.input === 'string'
                    ? tool.input
                    : JSON.stringify(tool.input, null, 2)}
                </pre>
              </div>
            )}

            {/* Result */}
            {tool.result && (
              <div className="px-3 py-2 bg-black/3 dark:bg-white/3 border-t border-claude-border-light dark:border-claude-border-dark">
                <div className="text-[10px] text-gray-400 mb-1 font-medium uppercase tracking-wide">
                  {tx('Result', '结果')}
                </div>
                <pre className="text-xs font-mono whitespace-pre-wrap break-all text-claude-text-light/80 dark:text-claude-text-dark/80 max-h-[200px] overflow-y-auto">
                  {getResultPreview()}
                </pre>
              </div>
            )}

            {/* Loading state */}
            {status === 'running' && !tool.result && (
              <div className="px-3 py-2 flex items-center gap-2 text-xs text-yellow-400">
                <Loader size={10} className="animate-spin" />
                {tx('Running...', '执行中...')}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function getToolIcon(name) {
  if (TOOL_ICONS[name]) {
    return TOOL_ICONS[name];
  }

  if (/read/i.test(name)) return Eye;
  if (/write|edit|patch/i.test(name)) return FileEdit;
  if (/search|grep|glob|list/i.test(name)) return Search;
  if (/web|fetch|url/i.test(name)) return Globe;
  return Terminal;
}

function getGenericSummary(tool) {
  const input = tool.input || {};
  if (input.command) return `$ ${String(input.command).slice(0, 100)}`;
  if (input.file_path || input.path || input.target_path || input.source_path) {
    const target = input.file_path || input.path || input.target_path || input.source_path;
    return `${tool.name}: ${target}`;
  }
  if (input.pattern) return `${tool.name}: ${input.pattern}`;
  if (input.query) return `${tool.name}: ${input.query}`;
  if (input.url) return `${tool.name}: ${input.url}`;
  return tool.name;
}
