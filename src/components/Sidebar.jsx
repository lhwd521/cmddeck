import React, { useState } from 'react';
import {
  Plus,
  MessageSquare,
  Trash2,
  Settings,
  Sun,
  Moon,
  FolderOpen,
  History,
  Paperclip,
  Terminal,
  Cpu,
  ChevronDown,
} from 'lucide-react';
import { localizeSessionTitle, useI18n } from '../i18n';

const PROVIDERS = {
  claude: {
    label: 'Claude Code',
    icon: Terminal,
    badge: 'CC',
    color: 'text-green-400',
  },
  codex: {
    label: 'Codex',
    icon: Cpu,
    badge: 'CX',
    color: 'text-sky-400',
  },
};

function formatTime(timestamp, tx, localeTag) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return tx('now', '刚刚');
  if (diffMins < 60) return tx('{count}m', '{count}分', { count: diffMins });
  if (diffHours < 24) return tx('{count}h', '{count}小时', { count: diffHours });
  if (diffDays < 7) return tx('{count}d', '{count}天', { count: diffDays });
  return date.toLocaleDateString(localeTag, { month: 'numeric', day: 'numeric' });
}

export default function Sidebar({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onToggleTheme,
  onOpenSettings,
  onOpenHistory,
  isDark,
  currentCwd,
  onSelectDirectory,
  defaultProvider,
}) {
  const [showProviderMenu, setShowProviderMenu] = useState(false);
  const { tx, localeTag } = useI18n();
  const recentSessions = sessions.slice(0, 20);

  const createSessionFor = (provider) => {
    setShowProviderMenu(false);
    onNewSession(provider);
  };

  return (
    <div className="w-64 h-full bg-claude-sidebar-light dark:bg-claude-sidebar-dark border-r border-claude-border-light dark:border-claude-border-dark flex flex-col shrink-0">
      <div className="p-3 space-y-1.5">
        <div className="relative">
          <button
            onClick={() => setShowProviderMenu((prev) => !prev)}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg bg-claude-orange text-white hover:bg-claude-orange-light active:bg-claude-orange-dim transition-colors font-medium text-sm shadow-sm"
          >
            <Plus size={16} />
            {tx('New Chat', '新建聊天')}
            <span className="ml-auto text-[10px] rounded-full bg-white/15 px-1.5 py-0.5">
              {PROVIDERS[defaultProvider]?.badge || 'CC'}
            </span>
            <ChevronDown size={14} className={`transition-transform ${showProviderMenu ? 'rotate-180' : ''}`} />
          </button>
          {showProviderMenu && (
            <div className="absolute left-0 right-0 top-full mt-1 rounded-xl border border-claude-border-light dark:border-claude-border-dark bg-claude-surface-light dark:bg-claude-surface-dark shadow-xl overflow-hidden z-20">
              {Object.entries(PROVIDERS).map(([provider, meta]) => {
                const Icon = meta.icon;
                return (
                  <button
                    key={provider}
                    onClick={() => createSessionFor(provider)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-left text-claude-text-light dark:text-claude-text-dark hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                  >
                    <Icon size={14} className={meta.color} />
                    <span className="flex-1">{meta.label}</span>
                    <span className="text-[10px] rounded-full bg-black/5 dark:bg-white/5 px-1.5 py-0.5">
                      {meta.badge}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <button
          onClick={onOpenHistory}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-claude-text-light dark:text-claude-text-dark hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-sm"
        >
          <History size={14} />
          {tx('History', '历史记录')}
          <span className="ml-auto text-[10px] text-gray-400 bg-gray-200/50 dark:bg-gray-700/50 px-1.5 py-0.5 rounded-full">
            {sessions.length}
          </span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2">
        {recentSessions.map((session) => {
          const msgCount = typeof session.messageCount === 'number'
            ? session.messageCount
            : (session.messages?.length || 0);
          const isActive = session.id === activeSessionId;
          const hasAttachments = typeof session.hasAttachments === 'boolean'
            ? session.hasAttachments
            : session.messages?.some((message) => message.attachments?.length > 0);
          const providerMeta = PROVIDERS[session.provider] || PROVIDERS.claude;
          const ProviderIcon = providerMeta.icon;

          return (
            <div
              key={session.id}
              className={`group flex items-stretch rounded-lg mb-0.5 cursor-pointer transition-colors ${
                isActive
                  ? 'bg-claude-orange/15 text-claude-orange'
                  : 'text-claude-text-light dark:text-claude-text-dark hover:bg-black/5 dark:hover:bg-white/5'
              }`}
              onClick={() => onSelectSession(session.id)}
            >
              <div className={`w-[3px] shrink-0 rounded-l-lg transition-colors ${isActive ? 'bg-claude-orange' : 'bg-transparent'}`} />

              <div className="flex flex-col px-3 py-2 flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <MessageSquare size={13} className="shrink-0" />
                  <span className="text-sm truncate flex-1">
                    {localizeSessionTitle(session.title, tx)}
                  </span>
                  {session.autoRunEnabled && (
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_0_2px_rgba(16,185,129,0.12)] animate-pulse shrink-0"
                      title={tx('Auto-run active', '自动续跑中')}
                    />
                  )}
                  {session.hasUnread && !isActive && (
                    <span
                      className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_0_2px_rgba(239,68,68,0.15)] shrink-0"
                      title={tx('New reply', '新回复')}
                    />
                  )}
                  <span className={`text-[9px] rounded-full px-1.5 py-0.5 bg-black/5 dark:bg-white/5 ${providerMeta.color}`}>
                    {providerMeta.badge}
                  </span>
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      onDeleteSession(session.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/20 rounded transition-all shrink-0"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>

                <div className="flex items-center gap-2 mt-0.5 pl-[21px]">
                  <span className="text-[10px] text-gray-400">
                    {formatTime(session.updatedAt || session.createdAt, tx, localeTag)}
                  </span>
                  {msgCount > 0 && (
                    <span className="text-[10px] text-gray-400">
                      {tx('{count} msg', '{count} 条消息', { count: msgCount })}
                    </span>
                  )}
                  {hasAttachments && <Paperclip size={9} className="text-gray-400" />}
                  <span className="ml-auto flex items-center gap-1 text-[10px] text-gray-400">
                    <ProviderIcon size={10} className={providerMeta.color} />
                    {providerMeta.label}
                  </span>
                </div>
              </div>
            </div>
          );
        })}

        {sessions.length > 20 && (
          <button
            onClick={onOpenHistory}
          className="w-full text-center text-xs text-gray-400 hover:text-claude-orange py-2 transition-colors"
        >
            {tx('View all {count} conversations...', '查看全部 {count} 条会话...', { count: sessions.length })}
          </button>
        )}
      </div>

      <div className="px-3 py-2 border-t border-claude-border-light dark:border-claude-border-dark">
        <button
          onClick={onSelectDirectory}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-claude-text-light/70 dark:text-claude-text-dark/70 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          title={currentCwd || tx('Select working directory', '选择工作目录')}
        >
          <FolderOpen size={12} className="shrink-0" />
          <span className="truncate">
            {currentCwd ? currentCwd.split(/[/\\]/).slice(-2).join('/') : tx('Set working directory', '设置工作目录')}
          </span>
        </button>
      </div>

      <div className="px-3 py-1.5 border-t border-claude-border-light dark:border-claude-border-dark flex items-center gap-1">
        <button
          onClick={onToggleTheme}
          className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-claude-text-light dark:text-claude-text-dark"
          title={isDark ? tx('Switch to Light', '切换到浅色') : tx('Switch to Dark', '切换到深色')}
        >
          {isDark ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <button
          onClick={onOpenSettings}
          className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-claude-text-light dark:text-claude-text-dark"
          title={tx('Settings', '设置')}
        >
          <Settings size={15} />
        </button>
      </div>
    </div>
  );
}
