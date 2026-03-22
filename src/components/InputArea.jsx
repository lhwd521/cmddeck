import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  StopCircle,
  Paperclip,
  X,
  Image,
  FileText,
  File,
  Maximize2,
  Minimize2,
  Copy,
  Check,
} from 'lucide-react';
import SlashCommandMenu from './SlashCommandMenu';
import { useI18n } from '../i18n';

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg'];
const WORKSPACE_TRANSFER_TYPE = 'application/x-cmddeck-workspace-paths';

function isImageFile(filePath) {
  const ext = filePath.toLowerCase().split('.').pop();
  return IMAGE_EXTS.some((e) => e.slice(1) === ext);
}

function getFileIcon(filePath) {
  if (isImageFile(filePath)) return Image;
  const ext = filePath.toLowerCase().split('.').pop();
  if (['txt', 'md', 'json', 'js', 'ts', 'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'css', 'html', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'log', 'csv'].includes(ext)) {
    return FileText;
  }
  return File;
}

function AttachmentChip({ file, onRemove }) {
  const isImage = isImageFile(file.path);
  const Icon = getFileIcon(file.path);
  const fileName = file.path.split(/[/\\]/).pop();

  return (
    <div className="relative group inline-flex flex-col items-center">
      {isImage && file.previewUrl ? (
        <div className="relative w-16 h-16 rounded-lg overflow-hidden border border-claude-border-light dark:border-claude-border-dark bg-black/5 dark:bg-white/5">
          <img src={file.previewUrl} alt={fileName} className="w-full h-full object-cover" />
          <button
            onClick={onRemove}
            className="absolute top-0.5 right-0.5 p-0.5 rounded-full bg-black/60 text-white hover:bg-red-500 transition-colors"
          >
            <X size={8} />
          </button>
        </div>
      ) : (
        <div className="relative flex items-center gap-1.5 px-2 py-1 rounded-lg bg-claude-orange/10 border border-claude-orange/20">
          <Icon size={12} className="text-claude-orange shrink-0" />
          <span className="max-w-[120px] truncate text-[11px] text-claude-text-light dark:text-claude-text-dark">
            {fileName}
          </span>
          <button onClick={onRemove} className="p-0.5 hover:bg-red-500/20 rounded transition-colors">
            <X size={8} className="text-claude-text-light dark:text-claude-text-dark" />
          </button>
        </div>
      )}
    </div>
  );
}

export default function InputArea({ onSend, onAbort, onClear, onDeleteSession, onNewSession, onToggleTheme, onOpenSettings, onOpenHistory, onSelectDirectory, currentModel, onModelChange, currentReasoningEffort = '', onReasoningEffortChange, permissionMode, onPermissionModeChange, isStreaming, disabled, contextUsage, turnTimer, currentProvider = 'claude' }) {
  const { tx } = useI18n();
  const [text, setText] = useState('');
  const [attachedFiles, setAttachedFiles] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashFilter, setSlashFilter] = useState('');
  const textareaRef = useRef(null);
  const slashMenuRef = useRef(null);
  const dragDepthRef = useRef(0);

  useEffect(() => {
    if (!isStreaming && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isStreaming, isExpanded]);

  useEffect(() => {
    const preventWindowDrop = (event) => {
      if (!hasDroppedFiles(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
    };

    window.addEventListener('dragover', preventWindowDrop);
    window.addEventListener('drop', preventWindowDrop);

    return () => {
      window.removeEventListener('dragover', preventWindowDrop);
      window.removeEventListener('drop', preventWindowDrop);
    };
  }, []);

  const addFiles = async (filePaths) => {
    const newFiles = [];
    for (const p of filePaths) {
      if (!p || attachedFiles.some((f) => f.path === p)) continue;
      let previewUrl = null;
      if (isImageFile(p)) {
        try {
          const result = await window.claude?.readFileAsDataUrl(p);
          if (result?.success) previewUrl = result.dataUrl;
        } catch (e) {
          console.warn('Failed to read image preview:', e);
        }
      }
      newFiles.push({ path: p, previewUrl });
    }
    if (newFiles.length > 0) {
      setAttachedFiles((prev) => [...prev, ...newFiles]);
    }
  };

  // Add files with an already-known data URL (for clipboard paste)
  const addFileWithPreview = (filePath, dataUrl) => {
    if (!filePath || attachedFiles.some((f) => f.path === filePath)) return;
    setAttachedFiles((prev) => [...prev, { path: filePath, previewUrl: dataUrl }]);
  };

  const insertTextAtCursor = (value) => {
    if (!value) {
      return;
    }

    setText((prev) => {
      const element = textareaRef.current;
      if (!element) {
        return prev ? `${prev}\n${value}` : value;
      }

      const start = element.selectionStart ?? prev.length;
      const end = element.selectionEnd ?? start;
      const prefix = prev.slice(0, start);
      const suffix = prev.slice(end);
      const needsLeadingBreak = prefix && !prefix.endsWith('\n') ? '\n' : '';
      const needsTrailingBreak = suffix && !value.endsWith('\n') ? '\n' : '';

      return `${prefix}${needsLeadingBreak}${value}${needsTrailingBreak}${suffix}`;
    });

    window.requestAnimationFrame(() => {
      const element = textareaRef.current;
      if (!element) {
        return;
      }

      element.focus();
      element.style.height = 'auto';
      const clamped = Math.min(element.scrollHeight, 150);
      element.style.height = `${clamped}px`;
      element.classList.toggle('has-overflow', element.scrollHeight > 150);
    });
  };

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed && attachedFiles.length === 0) return;
    if (isStreaming) return; // Don't send while streaming

    const draftText = text;
    const draftFiles = attachedFiles;
    const wasExpanded = isExpanded;

    setText('');
    setAttachedFiles([]);
    setShowSlashMenu(false);
    setSlashFilter('');
    setIsExpanded(false);

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.classList.remove('has-overflow');
    }

    try {
      const success = await onSend(trimmed, draftFiles.map((f) => f.path));
      if (success === false) {
        setText(draftText);
        setAttachedFiles(draftFiles);
        setIsExpanded(wasExpanded);
        return;
      }
    } catch (err) {
      setText(draftText);
      setAttachedFiles(draftFiles);
      setIsExpanded(wasExpanded);
      throw err;
    }
  };

  const handleSlashSelect = (cmd) => {
    const shouldContinueToCodexEffort =
      currentProvider === 'codex' &&
      cmd.type === 'model' &&
      cmd.cmd === '/model' &&
      cmd.modelId !== undefined;

    if (shouldContinueToCodexEffort) {
      setShowSlashMenu(true);
      setSlashFilter('/effort');
      setText('/effort');
      if (textareaRef.current) {
        const nextValue = '/effort';
        window.requestAnimationFrame(() => {
          if (!textareaRef.current) {
            return;
          }
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(nextValue.length, nextValue.length);
          textareaRef.current.style.height = 'auto';
          textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 150) + 'px';
        });
      }
    } else {
      setShowSlashMenu(false);
      setSlashFilter('');
      setText('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
    }

    // Model selection
    if (cmd.type === 'model' && cmd.cmd === '/model' && cmd.modelId !== undefined) {
      if (onModelChange) onModelChange(cmd.modelId);
      return;
    }

    // Mode selection
    if (cmd.type === 'mode' && cmd.cmd === '/mode' && cmd.modeId !== undefined) {
      if (onPermissionModeChange) onPermissionModeChange(cmd.modeId);
      return;
    }

    // Effort selection
    if (cmd.type === 'effort' && cmd.cmd === '/effort' && cmd.effortId !== undefined) {
      if (onReasoningEffortChange) onReasoningEffortChange(cmd.effortId);
      return;
    }

    // Skill execution — send /<skillName> as message to CLI
    if (cmd.type === 'skill' && cmd.skillName) {
      onSend(`/${cmd.skillName}`, []);
      return;
    }

    if (cmd.type === 'cli') {
      onSend(cmd.cmd, []);
      return;
    }

    switch (cmd.cmd) {
      case '/clear':
        if (onClear) onClear();
        break;
      case '/quit':
        if (onDeleteSession) onDeleteSession();
        break;
      case '/new':
        if (onNewSession) onNewSession();
        break;
      case '/theme':
        if (onToggleTheme) onToggleTheme();
        break;
      case '/settings':
        if (onOpenSettings) onOpenSettings();
        break;
      case '/history':
        if (onOpenHistory) onOpenHistory();
        break;
      case '/dir':
        if (onSelectDirectory) onSelectDirectory();
        break;
      case '/status':
        onSend('/status', []);
        break;
    }
  };

  const handleKeyDown = (e) => {
    // Forward keys to slash menu when visible
    if (showSlashMenu) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Escape' || e.key === 'ArrowLeft') {
        e.preventDefault();
        if (slashMenuRef.current) {
          slashMenuRef.current.handleKeyDown(e.key);
        }
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (slashMenuRef.current) {
          // 菜单有匹配项 → 执行选中命令
          slashMenuRef.current.handleKeyDown(e.key);
        } else {
          // 菜单无匹配项 → 直接发送给 CLI
          setShowSlashMenu(false);
          setSlashFilter('');
          handleSend();
        }
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !isExpanded) {
      e.preventDefault();
      handleSend();
    }
    // In expanded mode, Ctrl+Enter to send
    if (e.key === 'Enter' && e.ctrlKey && isExpanded) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === 'Escape') {
      if (isExpanded) {
        setIsExpanded(false);
      } else if (isStreaming) {
        onAbort();
      }
    }
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = 0;
    setIsDragging(false);

    const droppedEntries = collectDroppedEntries(e.dataTransfer);
    if (droppedEntries.length === 0) {
      return;
    }

    const unknownPaths = droppedEntries
      .filter((entry) => entry.isDirectory === null)
      .map((entry) => entry.path);
    let directoryPaths = new Set(
      droppedEntries
        .filter((entry) => entry.isDirectory === true)
        .map((entry) => entry.path)
    );

    if (unknownPaths.length > 0 && window.claude?.classifyPaths) {
      const result = await window.claude.classifyPaths(unknownPaths);
      if (result?.success) {
        directoryPaths = new Set([
          ...directoryPaths,
          ...result.items.filter((item) => item.isDirectory).map((item) => item.path),
        ]);
      }
    }

    const filePaths = [];
    const folderPaths = [];

    for (const entry of droppedEntries) {
      if (directoryPaths.has(entry.path)) {
        folderPaths.push(entry.path);
      } else {
        filePaths.push(entry.path);
      }
    }

    if (filePaths.length > 0) {
      await addFiles(filePaths);
    }

    if (folderPaths.length > 0) {
      insertTextAtCursor(folderPaths.join('\n'));
    }
  };

  const handleDragEnter = (e) => {
    if (!hasDroppedFiles(e.dataTransfer)) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current += 1;
    setIsDragging(true);
  };

  const handleDragOver = (e) => {
    if (!hasDroppedFiles(e.dataTransfer)) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    if (!hasDroppedFiles(e.dataTransfer)) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragging(false);
    }
  };

  const removeFile = (index) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleAttachClick = async () => {
    if (!window.claude?.selectFiles) return;
    const filePaths = await window.claude.selectFiles();
    if (filePaths && filePaths.length > 0) {
      await addFiles(filePaths);
    }
  };

  // Handle paste - support pasting screenshots from clipboard
  const handlePaste = async (e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageItems = items.filter((item) => item.type.startsWith('image/'));
    if (imageItems.length === 0) return; // let default text paste happen

    e.preventDefault();
    for (const item of imageItems) {
      const blob = item.getAsFile();
      if (!blob) continue;
      try {
        const arrayBuffer = await blob.arrayBuffer();
        const base64 = btoa(
          new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
        );
        const result = await window.claude?.saveClipboardImage(base64, item.type);
        if (result?.success && result.path) {
          const dataUrl = `data:${item.type};base64,${base64}`;
          addFileWithPreview(result.path, dataUrl);
        }
      } catch (err) {
        console.error('Failed to save pasted image:', err);
      }
    }
  };

  const handleCopyText = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Auto-resize textarea (non-expanded mode)
  const handleInput = (e) => {
    const val = e.target.value;
    setText(val);

    // Slash command detection
    if (val.startsWith('/') && !val.includes(' ')) {
      setShowSlashMenu(true);
      setSlashFilter(val);
    } else {
      setShowSlashMenu(false);
      setSlashFilter('');
    }

    if (!isExpanded && textareaRef.current) {
      const ta = textareaRef.current;
      ta.style.height = 'auto';
      const clamped = Math.min(ta.scrollHeight, 150);
      ta.style.height = clamped + 'px';
      ta.classList.toggle('has-overflow', ta.scrollHeight > 150);
    }
  };

  const lineCount = text.split('\n').length;
  const charCount = text.length;
  const providerLabel = currentProvider === 'codex' ? 'Codex' : 'Claude Code';
  const permissionLabel = getPermissionLabel(currentProvider, permissionMode, tx);
  const permissionTone = getPermissionTone(currentProvider, permissionMode);
  const effortLabel = getEffortLabel(currentProvider, currentReasoningEffort, tx);

  // Expanded fullscreen editor
  if (isExpanded) {
    return (
      <div
        className="fixed inset-0 z-40 bg-claude-bg-light dark:bg-claude-bg-dark flex flex-col"
        onDragEnter={handleDragEnter}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-claude-border-light dark:border-claude-border-dark bg-claude-surface-light dark:bg-claude-surface-dark">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-claude-text-light dark:text-claude-text-dark">
              {tx('Edit Message', '编辑消息')}
            </span>
            <span className="text-[10px] rounded-full bg-claude-orange/10 px-2 py-0.5 text-claude-orange">
              {providerLabel}
            </span>
            <span className="text-[10px] text-gray-400">
              {tx('{lines} lines | {chars} chars', '{lines} 行 | {chars} 字符', { lines: lineCount, chars: charCount })}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleAttachClick}
              className="p-1.5 rounded-lg text-gray-400 hover:text-claude-orange hover:bg-claude-orange/10 transition-colors"
              title={tx('Attach files', '附加文件')}
            >
              <Paperclip size={16} />
            </button>
            <button
              onClick={handleCopyText}
              className="p-1.5 rounded-lg text-gray-400 hover:text-claude-orange hover:bg-claude-orange/10 transition-colors"
              title={tx('Copy text', '复制文本')}
            >
              {copied ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
            </button>
            <button
              onClick={() => setIsExpanded(false)}
              className="p-1.5 rounded-lg text-gray-400 hover:text-claude-text-light dark:hover:text-claude-text-dark hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
              title={tx('Collapse (Esc)', '收起（Esc）')}
            >
              <Minimize2 size={16} />
            </button>
          </div>
        </div>

        {/* Attachments */}
        {attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-2 px-4 py-2 border-b border-claude-border-light dark:border-claude-border-dark">
            {attachedFiles.map((f, i) => (
              <AttachmentChip key={f.path + i} file={f} onRemove={() => removeFile(i)} />
            ))}
          </div>
        )}

        {/* Editor */}
        <div className="flex-1 relative">
          {isDragging && (
            <div className="absolute inset-4 z-10 rounded-2xl border-2 border-dashed border-claude-orange/50 bg-claude-orange/10 flex items-center justify-center gap-2 text-claude-orange text-sm pointer-events-none">
              <Paperclip size={16} />
              {tx('Drop files or folders here', '将文件或文件夹拖到这里')}
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={tx(
              'Write your {provider} message here... (Ctrl+Enter to send, Esc to collapse, Ctrl+V paste screenshot)',
              '在这里输入发给 {provider} 的消息...（Ctrl+Enter 发送，Esc 收起，Ctrl+V 粘贴截图）',
              { provider: providerLabel }
            )}
            disabled={disabled}
            onPaste={handlePaste}
            className="w-full h-full resize-none p-4 bg-transparent text-claude-text-light dark:text-claude-text-dark text-sm font-mono leading-relaxed focus:outline-none placeholder:text-gray-400"
            autoFocus
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-claude-border-light dark:border-claude-border-dark bg-claude-surface-light dark:bg-claude-surface-dark">
          <span className="text-[10px] text-gray-400">
            {tx('Ctrl+Enter to send | Esc to collapse', 'Ctrl+Enter 发送 | Esc 收起')}
          </span>
          <div className="flex items-center gap-2">
            {isStreaming && (
              <button
                onClick={onAbort}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-red-500 hover:bg-red-600 text-white transition-all"
              >
                <StopCircle size={14} /> {tx('Stop', '停止')}
              </button>
            )}
            <button
              onClick={handleSend}
              disabled={disabled || isStreaming || (!text.trim() && attachedFiles.length === 0)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                !isStreaming && (text.trim() || attachedFiles.length > 0)
                  ? 'bg-claude-orange hover:opacity-90 text-white'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-400 cursor-not-allowed'
              }`}
            >
              <Send size={14} /> {tx('Send', '发送')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Normal compact mode
  return (
    <div
      className={`px-4 py-3 border-t border-claude-border-light dark:border-claude-border-dark bg-claude-bg-light dark:bg-claude-bg-dark transition-colors ${
        isDragging ? 'bg-claude-orange/5 border-claude-orange' : ''
      }`}
      onDragEnter={handleDragEnter}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >

      {/* Drop overlay */}
      {isDragging && (
        <div className="mb-2 py-4 rounded-xl border-2 border-dashed border-claude-orange/50 bg-claude-orange/5 flex items-center justify-center gap-2 text-claude-orange text-sm">
          <Paperclip size={16} />
          {tx('Drop files or folders here', '将文件或文件夹拖到这里')}
        </div>
      )}

      {/* Attachments */}
      {attachedFiles.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2 p-2 rounded-xl bg-claude-surface-light dark:bg-claude-surface-dark border border-claude-border-light dark:border-claude-border-dark">
          {attachedFiles.map((f, i) => (
            <AttachmentChip key={f.path + i} file={f} onRemove={() => removeFile(i)} />
          ))}
        </div>
      )}

      {/* Input Row */}
      <div className="flex items-center gap-2 relative">
        {/* Slash command menu */}
        {showSlashMenu && (
          <SlashCommandMenu
            ref={slashMenuRef}
            filter={slashFilter}
            onSelect={handleSlashSelect}
            onClose={() => { setShowSlashMenu(false); setSlashFilter(''); }}
            currentModel={currentModel}
            currentReasoningEffort={currentReasoningEffort}
            permissionMode={permissionMode}
            currentProvider={currentProvider}
          />
        )}
        <button
          onClick={handleAttachClick}
          disabled={disabled || isStreaming}
          className="shrink-0 h-[42px] w-[42px] inline-flex items-center justify-center rounded-xl text-gray-400 hover:text-claude-orange hover:bg-claude-orange/10 transition-colors disabled:opacity-50"
          title={tx('Attach files', '附加文件')}
        >
          <Paperclip size={18} />
        </button>

        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={isStreaming
              ? tx('{provider} is responding... (you can still type and send)', '{provider} 正在回复...（你仍然可以继续输入和发送）', { provider: providerLabel })
              : tx('Ask {provider} anything... (Ctrl+V paste screenshot)', '向 {provider} 发送任何内容...（Ctrl+V 粘贴截图）', { provider: providerLabel })}
            disabled={disabled}
            rows={1}
            className="w-full resize-none rounded-xl px-4 py-2.5 bg-claude-surface-light dark:bg-claude-surface-dark text-claude-text-light dark:text-claude-text-dark text-sm border border-claude-border-light dark:border-claude-border-dark focus:border-claude-orange focus:outline-none focus:shadow-sm focus:shadow-claude-orange/20 transition-all placeholder:text-gray-400 input-scrollbar"
            style={{ maxHeight: '150px' }}
          />
        </div>

        {/* Expand button */}
        <button
          onClick={() => setIsExpanded(true)}
          className="shrink-0 h-[42px] w-[42px] inline-flex items-center justify-center rounded-xl text-gray-400 hover:text-claude-text-light dark:hover:text-claude-text-dark hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          title={tx('Expand editor', '展开编辑器')}
        >
          <Maximize2 size={16} />
        </button>

        {/* Stop button (only during streaming) */}
        {isStreaming && (
          <button
            onClick={onAbort}
            className="shrink-0 h-[42px] w-[42px] inline-flex items-center justify-center rounded-xl bg-red-500 hover:bg-red-600 text-white transition-all"
            title={tx('Stop response (Esc)', '停止回复（Esc）')}
          >
            <StopCircle size={18} />
          </button>
        )}

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={disabled || isStreaming || (!text.trim() && attachedFiles.length === 0)}
          className={`shrink-0 h-[42px] w-[42px] inline-flex items-center justify-center rounded-xl transition-all ${
            !isStreaming && (text.trim() || attachedFiles.length > 0)
              ? 'bg-claude-orange hover:bg-claude-orange-light text-white shadow-sm shadow-claude-orange/25'
              : 'bg-gray-200 dark:bg-gray-700 text-gray-400 cursor-not-allowed'
          }`}
          title={tx('Send message', '发送消息')}
        >
          <Send size={18} />
        </button>
      </div>

      {/* Status bar — left/right layout */}
      <div className="mt-1 text-[10px] text-gray-400 dark:text-gray-600 flex items-center justify-between px-1">
        {/* Left: timer & tokens */}
        <div className="flex items-center gap-2">
          {isStreaming && turnTimer ? (
            <span>{(turnTimer.elapsed / 1000).toFixed(1)}s</span>
          ) : turnTimer?.elapsed ? (
            <>
              <span>{(turnTimer.elapsed / 1000).toFixed(1)}s</span>
              {turnTimer.tokens && (
                <span>{(turnTimer.tokens.input + turnTimer.tokens.output).toLocaleString()} tok</span>
              )}
            </>
          ) : (
            <span>{tx('Enter send | Shift+Enter newline | / commands', 'Enter 发送 | Shift+Enter 换行 | / 命令')}</span>
          )}
          {charCount > 0 && <span>{tx('{count} ch', '{count} 字', { count: charCount })}</span>}
        </div>
        {/* Right: mode & context */}
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-claude-orange/10 px-1.5 py-0.5 text-claude-orange">
            {providerLabel}
          </span>
          {permissionLabel && (
            <span className={permissionTone}>
              {permissionLabel}
            </span>
          )}
          {effortLabel && (
            <span className="text-fuchsia-400">
              {effortLabel}
            </span>
          )}
          {contextUsage && currentProvider !== 'codex' && (
            <span className={
              contextUsage.percent > 80 ? 'text-red-500' :
              contextUsage.percent >= 50 ? 'text-yellow-500' :
              ''
            }>
              {tx('Ctx {percent}%', '上下文 {percent}%', { percent: contextUsage.percent })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function hasDroppedFiles(dataTransfer) {
  const types = Array.from(dataTransfer?.types || []);
  return types.includes('Files') || types.includes(WORKSPACE_TRANSFER_TYPE);
}

function collectDroppedEntries(dataTransfer) {
  const workspaceEntries = parseWorkspaceEntries(dataTransfer);
  if (workspaceEntries.length > 0) {
    return workspaceEntries;
  }

  const entries = [];
  const seenPaths = new Set();
  const items = Array.from(dataTransfer?.items || []);

  for (const item of items) {
    if (item.kind !== 'file') {
      continue;
    }

    const file = item.getAsFile?.();
    const path = file
      ? window.claude?.getPathForFile?.(file) || ''
      : '';
    if (!path || seenPaths.has(path)) {
      continue;
    }

    const entry = item.webkitGetAsEntry?.() || null;
    entries.push({
      path,
      isDirectory: entry ? entry.isDirectory === true : null,
    });
    seenPaths.add(path);
  }

  if (entries.length > 0) {
    return entries;
  }

  const files = Array.from(dataTransfer?.files || []);
  for (const file of files) {
    const path = file
      ? window.claude?.getPathForFile?.(file) || ''
      : '';
    if (!path || seenPaths.has(path)) {
      continue;
    }

    entries.push({
      path,
      isDirectory: null,
    });
    seenPaths.add(path);
  }

  return entries;
}

function parseWorkspaceEntries(dataTransfer) {
  try {
    const raw = dataTransfer?.getData?.(WORKSPACE_TRANSFER_TYPE);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    const seenPaths = new Set();
    return parsed
      .map((entry) => ({
        path: typeof entry?.path === 'string' ? entry.path : '',
        isDirectory: entry?.isDirectory === true,
      }))
      .filter((entry) => {
        if (!entry.path || seenPaths.has(entry.path)) {
          return false;
        }

        seenPaths.add(entry.path);
        return true;
      });
  } catch {
    return [];
  }
}

function getEffortLabel(provider, reasoningEffort, tx) {
  if (provider !== 'codex') {
    return null;
  }

  if (!reasoningEffort) {
    return null;
  }

  return tx('Effort {effort}', '强度 {effort}', { effort: reasoningEffort });
}

function getPermissionLabel(provider, permissionMode, tx) {
  if (!permissionMode || permissionMode === 'default') {
    return provider === 'codex' ? tx('Workspace Write', '工作区可写') : null;
  }

  if (provider === 'codex') {
    if (permissionMode === 'plan') return tx('Read Only', '只读');
    if (permissionMode === 'yolo') return tx('Danger Full Access', '危险全权限');
    if (permissionMode === 'acceptEdits') return tx('Workspace Write', '工作区可写');
  }

  if (permissionMode === 'yolo') return 'YOLO';
  if (permissionMode === 'plan') return tx('Plan', '规划');
  if (permissionMode === 'acceptEdits') return tx('AutoEdit', '自动编辑');
  return permissionMode;
}

function getPermissionTone(provider, permissionMode) {
  if (provider === 'codex' && (!permissionMode || permissionMode === 'default' || permissionMode === 'acceptEdits')) {
    return 'text-green-400';
  }
  if (permissionMode === 'yolo') return 'text-red-500';
  if (permissionMode === 'plan') return 'text-blue-400';
  if (permissionMode === 'acceptEdits') return 'text-yellow-400';
  return '';
}
