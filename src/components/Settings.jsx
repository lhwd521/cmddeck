import React, { useState, useEffect } from 'react';
import {
  X,
  Type,
  Monitor,
  Terminal,
  RefreshCw,
  Check,
  AlertCircle,
  Cpu,
  ExternalLink,
  RotateCw,
} from 'lucide-react';
import { useI18n } from '../i18n';

export default function SettingsPanel({ settings, onUpdate, onClose }) {
  const { tx } = useI18n();
  const [versions, setVersions] = useState({ claude: null, codex: null });
  const [versionLoading, setVersionLoading] = useState(true);
  const [updatingProvider, setUpdatingProvider] = useState(null);
  const [updateResult, setUpdateResult] = useState(null);

  useEffect(() => {
    loadVersions();
  }, []);

  const loadVersions = async () => {
    setVersionLoading(true);
    try {
      const [claude, codex] = await Promise.all([
        window.agent?.getVersion('claude'),
        window.agent?.getVersion('codex'),
      ]);
      setVersions({
        claude: claude?.success ? claude.version : null,
        codex: codex?.success ? codex.version : null,
      });
    } catch {
      setVersions({ claude: null, codex: null });
    }
    setVersionLoading(false);
  };

  const handleUpdateProvider = async (provider) => {
    setUpdatingProvider(provider);
    setUpdateResult(null);

    try {
      const result = await window.agent?.updateProvider(provider);
      if (result?.success) {
        const providerLabel = provider === 'codex' ? 'Codex' : 'Claude Code';
        setUpdateResult({
          success: true,
          message: tx('{provider} updated successfully.', '{provider} 更新成功。', { provider: providerLabel }),
        });
        await loadVersions();
      } else {
        setUpdateResult({
          success: false,
          message: result?.error || tx('Update failed', '更新失败'),
        });
      }
    } catch (err) {
      setUpdateResult({
        success: false,
        message: err.message || tx('Update failed', '更新失败'),
      });
    }

    setUpdatingProvider(null);
  };

  const handleOpenCcSwitch = async () => {
    await window.electron?.openExternal?.('https://github.com/farion1231/cc-switch');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-[420px] max-h-[80vh] overflow-hidden rounded-2xl border border-claude-border-light bg-claude-surface-light shadow-2xl dark:border-claude-border-dark dark:bg-claude-surface-dark">
        <div className="flex items-center justify-between border-b border-claude-border-light px-5 py-4 dark:border-claude-border-dark">
          <h2 className="text-lg font-semibold text-claude-text-light dark:text-claude-text-dark">
            {tx('Settings', '设置')}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 transition-colors hover:bg-black/10 dark:hover:bg-white/10"
          >
            <X size={18} className="text-claude-text-light dark:text-claude-text-dark" />
          </button>
        </div>

        <div className="space-y-5 overflow-y-auto p-5" style={{ maxHeight: 'calc(80vh - 120px)' }}>
          <div>
            <label className="mb-2 flex items-center gap-2 text-sm font-medium text-claude-text-light dark:text-claude-text-dark">
              <Type size={14} />
              {tx('Font Size', '字体大小')}
            </label>
            <input
              type="range"
              min="12"
              max="25"
              value={settings.fontSize}
              onChange={(event) => onUpdate({ fontSize: parseInt(event.target.value, 10) })}
              className="w-full accent-claude-orange"
            />
            <div className="mt-1 text-xs text-gray-500">{settings.fontSize}px</div>
          </div>

          <div>
            <label className="mb-2 flex items-center gap-2 text-sm font-medium text-claude-text-light dark:text-claude-text-dark">
              <Monitor size={14} />
              {tx('Theme', '主题')}
            </label>
            <div className="flex gap-2">
              {['light', 'dark'].map((theme) => (
                <button
                  key={theme}
                  onClick={() => onUpdate({ theme })}
                  className={`flex-1 rounded-lg px-3 py-2 text-sm capitalize transition-colors ${
                    settings.theme === theme
                      ? 'bg-claude-orange text-white'
                      : 'bg-black/5 text-claude-text-light hover:bg-black/10 dark:bg-white/5 dark:text-claude-text-dark dark:hover:bg-white/10'
                  }`}
                >
                  {theme === 'light' ? tx('Light', '浅色') : tx('Dark', '深色')}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-2 flex items-center gap-2 text-sm font-medium text-claude-text-light dark:text-claude-text-dark">
              <Monitor size={14} />
              {tx('Language', '语言')}
            </label>
            <select
              value={settings.language || 'en'}
              onChange={(event) => onUpdate({ language: event.target.value })}
              className="w-full rounded-lg border border-claude-border-light bg-black/5 px-3 py-2 text-sm text-claude-text-light focus:border-claude-orange focus:outline-none dark:border-claude-border-dark dark:bg-white/5 dark:text-claude-text-dark"
            >
              <option value="en">English</option>
              <option value="zh">简体中文</option>
            </select>
          </div>

          <div>
            <label className="mb-2 flex items-center gap-2 text-sm font-medium text-claude-text-light dark:text-claude-text-dark">
              <Cpu size={14} />
              {tx('Default Provider', '默认提供方')}
            </label>
            <div className="flex gap-2">
              {[
                { id: 'claude', label: 'Claude Code' },
                { id: 'codex', label: 'Codex' },
              ].map((provider) => (
                <button
                  key={provider.id}
                  onClick={() => onUpdate({ provider: provider.id })}
                  className={`flex-1 rounded-lg px-3 py-2 text-sm transition-colors ${
                    (settings.provider || 'claude') === provider.id
                      ? 'bg-claude-orange text-white'
                      : 'bg-black/5 text-claude-text-light hover:bg-black/10 dark:bg-white/5 dark:text-claude-text-dark dark:hover:bg-white/10'
                  }`}
                >
                  {provider.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-claude-text-light dark:text-claude-text-dark">
              {tx('Default Working Directory', '默认工作目录')}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={settings.cwd || ''}
                onChange={(event) => onUpdate({ cwd: event.target.value })}
                placeholder={tx('e.g. C:/Projects', '例如 C:/Projects')}
                className="flex-1 rounded-lg border border-claude-border-light bg-black/5 px-3 py-2 text-sm text-claude-text-light focus:border-claude-orange focus:outline-none dark:border-claude-border-dark dark:bg-white/5 dark:text-claude-text-dark"
              />
              <button
                onClick={async () => {
                  const dir = await window.claude?.selectDirectory?.();
                  if (dir) onUpdate({ cwd: dir });
                }}
                className="rounded-lg bg-claude-orange px-3 py-2 text-sm text-white hover:opacity-90"
              >
                {tx('Browse', '浏览')}
              </button>
            </div>
          </div>

          <div>
            <label className="mb-2 flex items-center gap-2 text-sm font-medium text-claude-text-light dark:text-claude-text-dark">
              <RotateCw size={14} />
              {tx('Auto-Run Default Count', '自动续跑默认次数')}
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min="1"
                max="20"
                value={settings.autoRunDefaultCount ?? 5}
                onChange={(event) => onUpdate({
                  autoRunDefaultCount: Math.min(20, Math.max(1, Number.parseInt(event.target.value || '1', 10) || 1)),
                })}
                className="w-24 rounded-lg border border-claude-border-light bg-black/5 px-3 py-2 text-sm text-claude-text-light focus:border-claude-orange focus:outline-none dark:border-claude-border-dark dark:bg-white/5 dark:text-claude-text-dark"
              />
              <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                {tx(
                  'Used when you turn on Auto for a chat. Idle delay is fixed at 3 seconds.',
                  '用于开启聊天自动续跑时的默认次数。空闲延迟固定为 3 秒。'
                )}
              </p>
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-claude-text-light dark:text-claude-text-dark">
              {tx('Auto-Run Prompt', '自动续跑提示词')}
            </label>
            <textarea
              value={settings.autoRunPrompt ?? ''}
              onChange={(event) => onUpdate({ autoRunPrompt: event.target.value })}
              rows={3}
              placeholder={tx(
                'Review the current goal and plan, then execute the next step.',
                '检查当前目标和计划，执行下一步。'
              )}
              className="w-full resize-none rounded-lg border border-claude-border-light bg-black/5 px-3 py-2 text-sm text-claude-text-light focus:border-claude-orange focus:outline-none dark:border-claude-border-dark dark:bg-white/5 dark:text-claude-text-dark"
            />
            <p className="mt-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
              {tx(
                'Used for every automatic follow-up. Leave empty to use the default prompt.',
                '用于每次自动续跑。留空时使用默认提示词。'
              )}
            </p>
          </div>

          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm font-medium text-claude-text-light dark:text-claude-text-dark">
              <Terminal size={14} />
              {tx('CLI Versions', 'CLI 版本')}
            </label>

            <div className="space-y-2">
              {[
                { id: 'claude', label: 'Claude Code' },
                { id: 'codex', label: 'Codex' },
              ].map((provider) => (
                <div
                  key={provider.id}
                  className="flex items-center justify-between rounded-lg border border-claude-border-light bg-black/5 px-3 py-2.5 dark:border-claude-border-dark dark:bg-white/5"
                >
                  <span className="text-xs text-claude-muted-light dark:text-claude-muted-dark">
                    {provider.label}
                  </span>
                  <span className="text-sm font-mono text-claude-text-light dark:text-claude-text-dark">
                    {versionLoading ? '...' : versions[provider.id] || tx('Not found', '未找到')}
                  </span>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2">
              {[
                { id: 'claude', label: 'Update Claude Code', zh: '更新 Claude Code' },
                { id: 'codex', label: 'Update Codex', zh: '更新 Codex' },
              ].map((provider) => {
                const isUpdating = updatingProvider === provider.id;
                return (
                  <button
                    key={provider.id}
                    onClick={() => handleUpdateProvider(provider.id)}
                    disabled={Boolean(updatingProvider)}
                    className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                      isUpdating
                        ? 'cursor-wait bg-gray-200 text-gray-400 dark:bg-gray-700'
                        : 'border border-claude-orange/30 bg-claude-orange/10 text-claude-orange hover:bg-claude-orange/20'
                    }`}
                  >
                    <RefreshCw size={14} className={isUpdating ? 'animate-spin' : ''} />
                    {isUpdating ? tx('Updating...', '更新中...') : tx(provider.label, provider.zh)}
                  </button>
                );
              })}
            </div>

            {updateResult && (
              <div className={`mt-2 flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${
                updateResult.success
                  ? 'bg-green-500/10 text-green-500'
                  : 'bg-red-500/10 text-red-400'
              }`}>
                {updateResult.success ? <Check size={12} /> : <AlertCircle size={12} />}
                <span className="flex-1 break-all">{updateResult.message}</span>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm font-medium text-claude-text-light dark:text-claude-text-dark">
              <ExternalLink size={14} />
              {tx('Recommended Tool', '推荐工具')}
            </label>

            <div className="rounded-xl border border-claude-border-light bg-black/5 px-3 py-3 dark:border-claude-border-dark dark:bg-white/5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-claude-text-light dark:text-claude-text-dark">
                    cc-switch
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                    {tx(
                      'Recommended alongside this app for switching sources and managing CLI environments.',
                      '建议搭配这个应用一起使用，用于切换来源和管理 CLI 环境。'
                    )}
                  </p>
                </div>
                <button
                  onClick={handleOpenCcSwitch}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-claude-orange/30 bg-claude-orange/10 px-3 py-2 text-xs font-medium text-claude-orange transition-colors hover:bg-claude-orange/20"
                >
                  <ExternalLink size={13} />
                  {tx('Open', '打开')}
                </button>
              </div>
              <div className="mt-2 break-all text-[11px] text-gray-400">
                https://github.com/farion1231/cc-switch
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-claude-border-light px-5 py-3 dark:border-claude-border-dark">
          <p className="text-center text-[10px] text-gray-400">
            {tx('Settings are saved automatically', '设置会自动保存')}
          </p>
        </div>
      </div>
    </div>
  );
}
