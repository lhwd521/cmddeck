import React, { useState, useEffect, useImperativeHandle, forwardRef, useMemo } from 'react';
import {
  Trash2,
  Minimize2,
  LogOut,
  Plus,
  Moon,
  Settings,
  History,
  FolderOpen,
  Cpu,
  Wand2,
  Check,
  ArrowLeft,
  Loader2,
  ShieldOff,
  HelpCircle,
  FileEdit,
  Gauge,
} from 'lucide-react';
import { useI18n } from '../i18n';

function getClaudeModels(tx) {
  return [
    { id: '', label: tx('Default (CLI config)', '默认（CLI 配置）'), desc: tx('Use the Claude CLI default model', '使用 Claude CLI 默认模型') },
    // Aliases — always resolve to the latest in that family
    { id: 'sonnet', label: 'Sonnet', desc: 'claude-sonnet-4-6 · ' + tx('Balanced speed & quality', '速度与质量均衡') },
    { id: 'opus', label: 'Opus', desc: 'claude-opus-4-6 · ' + tx('Most capable, complex reasoning', '能力最强，适合复杂推理') },
    { id: 'haiku', label: 'Haiku', desc: 'claude-haiku-4-5 · ' + tx('Fast, lightweight tasks', '快速轻量任务') },
    // Full model IDs
    { id: 'claude-opus-4-6', label: 'Opus 4.6', desc: tx('Most capable — complex analysis & reasoning', '能力最强 — 复杂分析与推理') },
    { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', desc: tx('Best balance of capability and cost', '能力与成本最佳均衡') },
    { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', desc: tx('High-volume, simple tasks — fastest & cheapest', '高频简单任务 — 最快最便宜') },
  ];
}

function getCodexModels(tx) {
  return [
    { id: '', label: tx('Default (CLI config)', '默认（CLI 配置）'), desc: tx('Use the Codex CLI configured model', '使用 Codex CLI 已配置的模型') },
    { id: 'gpt-5.4', label: 'GPT-5.4', desc: tx('Current Codex CLI default model family', '当前 Codex CLI 默认模型系列') },
    { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', desc: tx('Matches many current Codex CLI configs', '兼容许多当前 Codex CLI 配置') },
    { id: 'gpt-5.2-codex', label: 'GPT-5.2 Codex', desc: tx('Supports low/medium/high/xhigh effort', '支持 low / medium / high / xhigh 推理强度') },
    { id: 'gpt-5.1-codex', label: 'GPT-5.1 Codex', desc: tx('General Codex coding model', '通用 Codex 编码模型') },
    { id: 'gpt-5.1-codex-max', label: 'GPT-5.1 Codex Max', desc: tx('Higher reasoning and reliability', '更高的推理能力和稳定性') },
    { id: 'gpt-5.1-codex-mini', label: 'GPT-5.1 Codex Mini', desc: tx('Faster and cheaper Codex option', '更快、更便宜的 Codex 选项') },
    { id: 'gpt-5-codex', label: 'GPT-5 Codex', desc: tx('Earlier GPT-5 Codex release', '较早版本的 GPT-5 Codex') },
  ];
}

function getCodexEfforts(tx) {
  return [
    { id: '', label: tx('Default (CLI config)', '默认（CLI 配置）'), desc: tx('Use the Codex CLI configured reasoning effort', '使用 Codex CLI 已配置的推理强度'), color: 'text-gray-400' },
    { id: 'low', label: tx('Low', '低'), desc: tx('Fastest reasoning pass', '最快的推理模式'), color: 'text-sky-400' },
    { id: 'medium', label: tx('Medium', '中'), desc: tx('Balanced speed and depth', '速度与深度均衡'), color: 'text-green-400' },
    { id: 'high', label: tx('High', '高'), desc: tx('More deliberate reasoning', '更充分的推理'), color: 'text-amber-400' },
    { id: 'xhigh', label: 'XHigh', desc: tx('Deepest reasoning supported by many Codex models', '许多 Codex 模型支持的最深推理'), color: 'text-red-400' },
  ];
}

function getClaudeModes(tx) {
  return [
    { id: 'default',            label: tx('Default', '默认'),                 desc: tx('Ask permission before executing sensitive actions', '执行敏感操作前先询问'),                       color: 'text-gray-400'   },
    { id: 'plan',               label: tx('Plan', '规划'),                    desc: tx('Plan only — no file edits, no shell commands', '只规划 — 不修改文件，不执行命令'),                 color: 'text-blue-400'   },
    { id: 'auto',               label: 'Auto',                                desc: tx('Smart auto-approve — low-risk actions proceed without prompts', '智能自动批准 — 低风险操作无需询问'), color: 'text-teal-400'   },
    { id: 'acceptEdits',        label: tx('Accept Edits', '接受编辑'),        desc: tx('Auto-accept file edits, ask for other actions', '自动接受文件修改，其他操作仍需确认'),             color: 'text-yellow-400' },
    { id: 'dontAsk',            label: tx("Don't Ask", '免打扰'),             desc: tx('Auto-approve most actions, minimal interruptions', '自动批准大多数操作，最少打扰'),                color: 'text-orange-400' },
    { id: 'bypassPermissions',  label: tx('Bypass Permissions', '绕过权限'),  desc: tx('Bypass all permission checks — use in trusted environments', '绕过所有权限检查 — 仅在受信环境使用'),  color: 'text-red-400'    },
    { id: 'yolo',               label: 'YOLO',                                desc: tx('--dangerously-skip-permissions flag — no restrictions at all', '--dangerously-skip-permissions — 完全无限制'), color: 'text-red-500' },
  ];
}

function getCodexModes(tx) {
  return [
    { id: 'plan', label: tx('Read Only', '只读'), desc: tx('Map to codex --sandbox read-only', '对应 codex --sandbox read-only'), color: 'text-blue-400' },
    { id: 'default', label: tx('Workspace Write', '工作区可写'), desc: tx('Map to codex --sandbox workspace-write', '对应 codex --sandbox workspace-write'), color: 'text-green-400' },
    { id: 'yolo', label: tx('Danger Full Access', '危险全权限'), desc: tx('Map to codex dangerous bypass mode', '对应 codex 危险绕过模式'), color: 'text-red-400' },
  ];
}

function getClaudeCommands(tx) {
  return [
    { cmd: '/new', desc: tx('Create new chat', '创建新聊天'), icon: Plus, type: 'local', group: tx('Session', '会话') },
    { cmd: '/clear', desc: tx('Clear current chat', '清空当前聊天'), icon: Trash2, type: 'local', group: tx('Session', '会话') },
    { cmd: '/quit', desc: tx('Close current chat', '关闭当前聊天'), icon: LogOut, type: 'local', group: tx('Session', '会话') },
    { cmd: '/compact', desc: tx('Compact conversation', '压缩会话上下文'), icon: Minimize2, type: 'cli', group: tx('Session', '会话') },
    { cmd: '/model', desc: tx('Switch model', '切换模型'), icon: Cpu, type: 'model', group: tx('Settings', '设置') },
    { cmd: '/mode', desc: tx('Switch permission mode', '切换权限模式'), icon: ShieldOff, type: 'mode', group: tx('Settings', '设置') },
    { cmd: '/theme', desc: tx('Toggle theme', '切换主题'), icon: Moon, type: 'local', group: tx('Settings', '设置') },
    { cmd: '/settings', desc: tx('Open settings', '打开设置'), icon: Settings, type: 'local', group: tx('Settings', '设置') },
    { cmd: '/history', desc: tx('Open history', '打开历史记录'), icon: History, type: 'local', group: tx('Settings', '设置') },
    { cmd: '/dir', desc: tx('Change working directory', '更改工作目录'), icon: FolderOpen, type: 'local', group: tx('Project', '项目') },
    { cmd: '/init', desc: tx('Initialize project memory', '初始化项目记忆'), icon: FileEdit, type: 'cli', group: tx('Project', '项目') },
    { cmd: '/skills', desc: tx('View installed skills', '查看已安装技能'), icon: Wand2, type: 'skills', group: tx('Tools', '工具') },
    { cmd: '/status', desc: tx('Show app status', '显示应用状态'), icon: HelpCircle, type: 'local', group: tx('Tools', '工具') },
  ];
}

function getCodexCommands(tx) {
  return [
    { cmd: '/new', desc: tx('Create new chat', '创建新聊天'), icon: Plus, type: 'local', group: tx('Session', '会话') },
    { cmd: '/clear', desc: tx('Clear current chat', '清空当前聊天'), icon: Trash2, type: 'local', group: tx('Session', '会话') },
    { cmd: '/quit', desc: tx('Close current chat', '关闭当前聊天'), icon: LogOut, type: 'local', group: tx('Session', '会话') },
    { cmd: '/compact', desc: tx('Compact conversation', '压缩会话上下文'), icon: Minimize2, type: 'cli', group: tx('Session', '会话') },
    { cmd: '/model', desc: tx('Switch Codex model, then reasoning effort', '切换 Codex 模型，然后选择推理强度'), icon: Cpu, type: 'model', group: tx('Settings', '设置') },
    { cmd: '/effort', desc: tx('Switch Codex reasoning effort', '切换 Codex 推理强度'), icon: Gauge, type: 'effort', group: tx('Settings', '设置') },
    { cmd: '/mode', desc: tx('Switch Codex sandbox mode', '切换 Codex 沙箱模式'), icon: ShieldOff, type: 'mode', group: tx('Settings', '设置') },
    { cmd: '/theme', desc: tx('Toggle theme', '切换主题'), icon: Moon, type: 'local', group: tx('Settings', '设置') },
    { cmd: '/settings', desc: tx('Open settings', '打开设置'), icon: Settings, type: 'local', group: tx('Settings', '设置') },
    { cmd: '/history', desc: tx('Open history', '打开历史记录'), icon: History, type: 'local', group: tx('Settings', '设置') },
    { cmd: '/dir', desc: tx('Change working directory', '更改工作目录'), icon: FolderOpen, type: 'local', group: tx('Project', '项目') },
    { cmd: '/status', desc: tx('Show app status', '显示应用状态'), icon: HelpCircle, type: 'local', group: tx('Tools', '工具') },
  ];
}

const SlashCommandMenu = forwardRef(function SlashCommandMenu(
  { filter, onSelect, onClose, currentModel, currentReasoningEffort = '', permissionMode, currentProvider = 'claude' },
  ref
) {
  const { tx } = useI18n();
  const [activeIndex, setActiveIndex] = useState(0);
  const [view, setView] = useState('commands');
  const [modelIndex, setModelIndex] = useState(0);
  const [skills, setSkills] = useState(null);
  const [skillIndex, setSkillIndex] = useState(0);
  const [modeIndex, setModeIndex] = useState(0);
  const [effortIndex, setEffortIndex] = useState(0);
  const [providerConfig, setProviderConfig] = useState({});

  const modelOptions = useMemo(() => {
    const base = currentProvider === 'codex' ? getCodexModels(tx) : getClaudeModels(tx);
    const defaultDescription = currentProvider === 'codex' && providerConfig.model
      ? tx('Use the Codex CLI configured model ({model})', '使用 Codex CLI 已配置的模型（{model}）', { model: providerConfig.model })
      : base[0].desc;
    const withDefault = [{ ...base[0], desc: defaultDescription }, ...base.slice(1)];

    if (currentModel && !base.some((item) => item.id === currentModel)) {
      return [
        ...withDefault,
        { id: currentModel, label: currentModel, desc: tx('Current custom model value', '当前自定义模型值') },
      ];
    }

    if (currentProvider === 'codex' && providerConfig.model && !withDefault.some((item) => item.id === providerConfig.model)) {
      return [
        ...withDefault,
        { id: providerConfig.model, label: providerConfig.model, desc: tx('Current CLI config model', '当前 CLI 配置模型') },
      ];
    }

    return withDefault;
  }, [currentModel, currentProvider, providerConfig.model, tx]);

  const effortOptions = useMemo(() => {
    if (currentProvider !== 'codex') {
      return [];
    }

    const base = getCodexEfforts(tx);
    const defaultDescription = providerConfig.reasoningEffort
      ? tx('Use the Codex CLI configured reasoning effort ({effort})', '使用 Codex CLI 已配置的推理强度（{effort}）', { effort: providerConfig.reasoningEffort })
      : base[0].desc;

    return [{ ...base[0], desc: defaultDescription }, ...base.slice(1)];
  }, [currentProvider, providerConfig.reasoningEffort, tx]);

  const modeOptions = useMemo(
    () => (currentProvider === 'codex' ? getCodexModes(tx) : getClaudeModes(tx)),
    [currentProvider, tx]
  );
  const providerLabel = currentProvider === 'codex' ? 'Codex' : 'Claude';
  const availableCommands = useMemo(
    () => (currentProvider === 'codex' ? getCodexCommands(tx) : getClaudeCommands(tx)),
    [currentProvider, tx]
  );

  const filtered = availableCommands.filter((command) => command.cmd.startsWith(filter.toLowerCase()));

  useEffect(() => {
    setActiveIndex(0);
    setView('commands');
  }, [filter, currentProvider]);

  useEffect(() => {
    let cancelled = false;

    async function loadProviderConfig() {
      if (currentProvider !== 'codex' || !window.agent?.getProviderConfig) {
        setProviderConfig({});
        return;
      }

      try {
        const result = await window.agent.getProviderConfig('codex');
        if (!cancelled) {
          setProviderConfig(result?.success ? (result.config || {}) : {});
        }
      } catch {
        if (!cancelled) {
          setProviderConfig({});
        }
      }
    }

    loadProviderConfig();
    return () => {
      cancelled = true;
    };
  }, [currentProvider]);

  useEffect(() => {
    if (filter.toLowerCase() === '/model' && filtered.length === 1 && filtered[0].cmd === '/model') {
      setView('model');
      const index = modelOptions.findIndex((item) => item.id === (currentModel || ''));
      setModelIndex(index >= 0 ? index : 0);
    }
  }, [filter, filtered, currentModel, modelOptions]);

  useEffect(() => {
    if (filter.toLowerCase() === '/mode' && filtered.length === 1 && filtered[0].cmd === '/mode') {
      setView('mode');
      const index = modeOptions.findIndex((item) => item.id === (permissionMode || 'default'));
      setModeIndex(index >= 0 ? index : 0);
    }
  }, [filter, filtered, permissionMode, modeOptions]);

  useEffect(() => {
    if (filter.toLowerCase() === '/effort' && filtered.length === 1 && filtered[0].cmd === '/effort') {
      setView('effort');
      const index = effortOptions.findIndex((item) => item.id === (currentReasoningEffort || ''));
      setEffortIndex(index >= 0 ? index : 0);
    }
  }, [currentReasoningEffort, effortOptions, filter, filtered]);

  useEffect(() => {
    if (filter.toLowerCase() === '/skills' && filtered.length === 1 && filtered[0].cmd === '/skills') {
      openSkillsView();
    }
  }, [filter, filtered]);

  const openSkillsView = () => {
    setView('skills');
    setSkillIndex(0);
    if (skills === null && window.claude?.listSkills) {
      window.claude.listSkills().then((result) => {
        setSkills(result?.skills || []);
      });
    }
  };

  useImperativeHandle(ref, () => ({
    handleKeyDown(key) {
      if (view === 'model') {
        if (key === 'ArrowDown') {
          setModelIndex((prev) => (prev + 1) % modelOptions.length);
        } else if (key === 'ArrowUp') {
          setModelIndex((prev) => (prev - 1 + modelOptions.length) % modelOptions.length);
        } else if (key === 'Enter') {
          onSelect({ cmd: '/model', type: 'model', modelId: modelOptions[modelIndex].id });
        } else if (key === 'Escape' || key === 'ArrowLeft') {
          filter.toLowerCase() === '/model' ? onClose() : setView('commands');
        }
        return;
      }

      if (view === 'skills') {
        const list = skills || [];
        if (key === 'ArrowDown' && list.length > 0) {
          setSkillIndex((prev) => (prev + 1) % list.length);
        } else if (key === 'ArrowUp' && list.length > 0) {
          setSkillIndex((prev) => (prev - 1 + list.length) % list.length);
        } else if (key === 'Enter' && list.length > 0) {
          const skill = list[skillIndex >= list.length ? 0 : skillIndex];
          onSelect({ cmd: `/${skill.name}`, type: 'skill', skillName: skill.name });
        } else if (key === 'Escape' || key === 'ArrowLeft') {
          filter.toLowerCase() === '/skills' ? onClose() : setView('commands');
        }
        return;
      }

      if (view === 'mode') {
        if (key === 'ArrowDown') {
          setModeIndex((prev) => (prev + 1) % modeOptions.length);
        } else if (key === 'ArrowUp') {
          setModeIndex((prev) => (prev - 1 + modeOptions.length) % modeOptions.length);
        } else if (key === 'Enter') {
          onSelect({ cmd: '/mode', type: 'mode', modeId: modeOptions[modeIndex].id });
        } else if (key === 'Escape' || key === 'ArrowLeft') {
          filter.toLowerCase() === '/mode' ? onClose() : setView('commands');
        }
        return;
      }

      if (view === 'effort') {
        if (key === 'ArrowDown') {
          setEffortIndex((prev) => (prev + 1) % effortOptions.length);
        } else if (key === 'ArrowUp') {
          setEffortIndex((prev) => (prev - 1 + effortOptions.length) % effortOptions.length);
        } else if (key === 'Enter') {
          onSelect({ cmd: '/effort', type: 'effort', effortId: effortOptions[effortIndex].id });
        } else if (key === 'Escape' || key === 'ArrowLeft') {
          filter.toLowerCase() === '/effort' ? onClose() : setView('commands');
        }
        return;
      }

      if (key === 'ArrowDown') {
        setActiveIndex((prev) => (prev + 1) % filtered.length);
      } else if (key === 'ArrowUp') {
        setActiveIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
      } else if (key === 'Enter' && filtered.length > 0) {
        const command = filtered[activeIndex >= filtered.length ? 0 : activeIndex];
        if (command.type === 'model') {
          setView('model');
          const index = modelOptions.findIndex((item) => item.id === (currentModel || ''));
          setModelIndex(index >= 0 ? index : 0);
        } else if (command.type === 'effort') {
          setView('effort');
          const index = effortOptions.findIndex((item) => item.id === (currentReasoningEffort || ''));
          setEffortIndex(index >= 0 ? index : 0);
        } else if (command.type === 'mode') {
          setView('mode');
          const index = modeOptions.findIndex((item) => item.id === (permissionMode || 'default'));
          setModeIndex(index >= 0 ? index : 0);
        } else if (command.type === 'skills') {
          openSkillsView();
        } else {
          onSelect(command);
        }
      } else if (key === 'Escape') {
        onClose();
      }
    },
  }), [activeIndex, currentModel, currentReasoningEffort, effortIndex, effortOptions, filter, filtered, modeIndex, modeOptions, modelIndex, modelOptions, onClose, onSelect, permissionMode, skillIndex, skills, view]);

  if (filtered.length === 0) {
    return null;
  }

  const panelClass = 'absolute bottom-full left-0 right-0 mb-1 mx-2 bg-claude-surface-light/80 dark:bg-claude-surface-dark/80 backdrop-blur-xl border border-claude-border-light dark:border-claude-border-dark rounded-2xl shadow-lg overflow-hidden z-50';
  const headerClass = 'flex items-center gap-2 px-4 py-2 border-b border-claude-border-light/50 dark:border-claude-border-dark/50';
  const footerClass = 'px-4 py-1.5 text-[10px] text-gray-400 dark:text-gray-500 border-t border-claude-border-light/50 dark:border-claude-border-dark/50';

  if (view === 'model') {
    return (
      <div className={panelClass}>
        <div className={headerClass}>
          {filter.toLowerCase() !== '/model' && (
            <button onClick={() => setView('commands')} className="p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors">
              <ArrowLeft size={14} className="text-gray-400" />
            </button>
          )}
          <Cpu size={14} className="text-claude-orange" />
          <span className="text-xs font-semibold text-claude-text-light dark:text-claude-text-dark">
            {tx('{provider} Models', '{provider} 模型', { provider: providerLabel })}
          </span>
        </div>
        {modelOptions.map((item, index) => (
          <button
            key={item.id || '__default__'}
            onClick={() => onSelect({ cmd: '/model', type: 'model', modelId: item.id })}
            onMouseEnter={() => setModelIndex(index)}
            className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
              index === modelIndex
                ? 'bg-claude-orange/10 text-claude-orange'
                : 'text-claude-text-light dark:text-claude-text-dark hover:bg-black/5 dark:hover:bg-white/5'
            }`}
          >
            <span className="w-4 shrink-0 flex items-center justify-center">
              {(currentModel || '') === item.id && <Check size={14} className="text-green-500" />}
            </span>
            <span className="font-medium min-w-[110px]">{item.label}</span>
            <span className="text-xs opacity-50">{item.desc}</span>
          </button>
        ))}
        <div className={footerClass}>
          {currentProvider === 'codex'
            ? tx('Arrow keys navigate. After model selection, the effort picker opens for low/medium/high/xhigh.', '方向键导航。选择模型后，会继续打开推理强度选择器。')
            : tx('Arrow keys navigate, Enter selects, Esc closes.', '方向键导航，Enter 选择，Esc 关闭。')}
        </div>
      </div>
    );
  }

  if (view === 'skills') {
    return (
      <div className={panelClass} style={{ maxHeight: '400px' }}>
        <div className={headerClass}>
          {filter.toLowerCase() !== '/skills' && (
            <button onClick={() => setView('commands')} className="p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors">
              <ArrowLeft size={14} className="text-gray-400" />
            </button>
          )}
          <Wand2 size={14} className="text-claude-orange" />
          <span className="text-xs font-semibold text-claude-text-light dark:text-claude-text-dark">
            {tx('Installed Skills', '已安装技能')}
          </span>
          {skills && <span className="text-[9px] ml-auto text-gray-400">{skills.length}</span>}
        </div>
        <div className="overflow-y-auto" style={{ maxHeight: '320px' }}>
          {skills === null ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-gray-400">
              <Loader2 size={16} className="animate-spin" />
              {tx('Loading...', '加载中...')}
            </div>
          ) : skills.length === 0 ? (
            <div className="py-6 text-center text-sm text-gray-400">{tx('No installed skills.', '没有已安装技能。')}</div>
          ) : (
            skills.map((skill, index) => (
              <button
                key={skill.name}
                onClick={() => onSelect({ cmd: `/${skill.name}`, type: 'skill', skillName: skill.name })}
                onMouseEnter={() => setSkillIndex(index)}
                className={`w-full flex items-start gap-3 px-4 py-2 text-left text-sm transition-colors ${
                  index === skillIndex
                    ? 'bg-claude-orange/10 text-claude-orange'
                    : 'text-claude-text-light dark:text-claude-text-dark hover:bg-black/5 dark:hover:bg-white/5'
                }`}
              >
                <Wand2 size={13} className="shrink-0 mt-0.5 opacity-50" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">/{skill.name}</div>
                  {skill.description && <div className="text-[11px] opacity-50 truncate mt-0.5">{skill.description}</div>}
                </div>
              </button>
            ))
          )}
        </div>
        <div className={footerClass}>{tx('Arrow keys navigate, Enter runs the selected skill.', '方向键导航，Enter 运行所选技能。')}</div>
      </div>
    );
  }

  if (view === 'mode') {
    return (
      <div className={panelClass}>
        <div className={headerClass}>
          {filter.toLowerCase() !== '/mode' && (
            <button onClick={() => setView('commands')} className="p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors">
              <ArrowLeft size={14} className="text-gray-400" />
            </button>
          )}
          <ShieldOff size={14} className="text-claude-orange" />
          <span className="text-xs font-semibold text-claude-text-light dark:text-claude-text-dark">
            {tx('{provider} Modes', '{provider} 模式', { provider: providerLabel })}
          </span>
        </div>
        {modeOptions.map((item, index) => (
          <button
            key={item.id}
            onClick={() => onSelect({ cmd: '/mode', type: 'mode', modeId: item.id })}
            onMouseEnter={() => setModeIndex(index)}
            className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
              index === modeIndex
                ? 'bg-claude-orange/10 text-claude-orange'
                : 'text-claude-text-light dark:text-claude-text-dark hover:bg-black/5 dark:hover:bg-white/5'
            }`}
          >
            <span className="w-4 shrink-0 flex items-center justify-center">
              {(permissionMode || 'default') === item.id && <Check size={14} className="text-green-500" />}
            </span>
            <span className={`font-medium min-w-[120px] ${item.color}`}>{item.label}</span>
            <span className="text-xs opacity-50">{item.desc}</span>
          </button>
        ))}
        <div className={footerClass}>{tx('Arrow keys navigate, Enter selects, Alt+M cycles quickly.', '方向键导航，Enter 选择，Alt+M 可快速切换。')}</div>
      </div>
    );
  }

  if (view === 'effort') {
    return (
      <div className={panelClass}>
        <div className={headerClass}>
          {filter.toLowerCase() !== '/effort' && (
            <button onClick={() => setView('commands')} className="p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors">
              <ArrowLeft size={14} className="text-gray-400" />
            </button>
          )}
          <Gauge size={14} className="text-claude-orange" />
          <span className="text-xs font-semibold text-claude-text-light dark:text-claude-text-dark">
            {tx('Codex Reasoning Effort', 'Codex 推理强度')}
          </span>
        </div>
        {effortOptions.map((item, index) => (
          <button
            key={item.id || '__default_effort__'}
            onClick={() => onSelect({ cmd: '/effort', type: 'effort', effortId: item.id })}
            onMouseEnter={() => setEffortIndex(index)}
            className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
              index === effortIndex
                ? 'bg-claude-orange/10 text-claude-orange'
                : 'text-claude-text-light dark:text-claude-text-dark hover:bg-black/5 dark:hover:bg-white/5'
            }`}
          >
            <span className="w-4 shrink-0 flex items-center justify-center">
              {(currentReasoningEffort || '') === item.id && <Check size={14} className="text-green-500" />}
            </span>
            <span className={`font-medium min-w-[110px] ${item.color}`}>{item.label}</span>
            <span className="text-xs opacity-50">{item.desc}</span>
          </button>
        ))}
        <div className={footerClass}>{tx('Choose Default, low, medium, high, or xhigh. Codex maps this to `model_reasoning_effort`.', '可选择默认、low、medium、high 或 xhigh。Codex 会将其映射到 `model_reasoning_effort`。')}</div>
      </div>
    );
  }

  const showGroups = filter === '/';
  let lastGroup = null;

  return (
    <div className={`${panelClass} overflow-y-auto`} style={{ maxHeight: '360px' }}>
      {filtered.map((command, index) => {
        const Icon = command.icon;
        const groupLabel = showGroups && command.group !== lastGroup ? command.group : null;
        lastGroup = command.group;
        const isActive = index === activeIndex;

        return (
          <React.Fragment key={command.cmd}>
            {groupLabel && (
              <div className="px-4 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 bg-black/[0.02] dark:bg-white/[0.02] border-t border-claude-border-light/50 dark:border-claude-border-dark/50 first:border-t-0">
                {groupLabel}
              </div>
            )}
            <button
              onClick={() => {
                if (command.type === 'model') {
                  setView('model');
                  const optionIndex = modelOptions.findIndex((item) => item.id === (currentModel || ''));
                  setModelIndex(optionIndex >= 0 ? optionIndex : 0);
                } else if (command.type === 'effort') {
                  setView('effort');
                  const optionIndex = effortOptions.findIndex((item) => item.id === (currentReasoningEffort || ''));
                  setEffortIndex(optionIndex >= 0 ? optionIndex : 0);
                } else if (command.type === 'mode') {
                  setView('mode');
                  const optionIndex = modeOptions.findIndex((item) => item.id === (permissionMode || 'default'));
                  setModeIndex(optionIndex >= 0 ? optionIndex : 0);
                } else if (command.type === 'skills') {
                  openSkillsView();
                } else {
                  onSelect(command);
                }
              }}
              onMouseEnter={() => setActiveIndex(index)}
              className={`w-full flex items-center gap-3 px-4 py-2 text-left text-sm transition-colors relative ${
                isActive
                  ? 'bg-claude-orange/10 text-claude-orange'
                  : 'text-claude-text-light dark:text-claude-text-dark hover:bg-black/5 dark:hover:bg-white/5'
              }`}
            >
              {isActive && <div className="absolute left-0 top-1 bottom-1 w-[3px] rounded-r bg-claude-orange" />}
              <Icon size={14} className="shrink-0 opacity-60" />
              <span className="font-medium min-w-[100px]">{command.cmd}</span>
              <span className="text-xs opacity-50 truncate flex-1">{command.desc}</span>
              {command.type === 'model' && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-claude-orange/10 text-claude-orange shrink-0">
                  {providerLabel}
                </span>
              )}
              {command.type === 'effort' && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-fuchsia-500/10 text-fuchsia-400 shrink-0">
                  Codex
                </span>
              )}
              {command.type === 'mode' && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/5 text-gray-400 shrink-0">
                  {providerLabel}
                </span>
              )}
              {command.type === 'cli' && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500 dark:text-blue-400 shrink-0">
                  CLI
                </span>
              )}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
});

export default SlashCommandMenu;
