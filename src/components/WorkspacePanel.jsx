import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  File,
  Folder,
  FolderOpen,
  Minus,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { useI18n } from '../i18n';

const TREE_INDENT_PX = 14;
const WORKSPACE_TRANSFER_TYPE = 'application/x-cmddeck-workspace-paths';

export default function WorkspacePanel({
  collapsed = false,
  workspacePath = '',
  fileHighlights = {},
  refreshToken = 0,
  onToggleCollapse,
  onBrowseWorkspace,
}) {
  const { tx } = useI18n();
  const readFolderErrorLabel = tx('Unable to read this folder.', '无法读取这个文件夹。');
  const panelRef = useRef(null);
  const [rootNode, setRootNode] = useState(null);
  const [selectedPath, setSelectedPath] = useState('');
  const [loadingPaths, setLoadingPaths] = useState([]);
  const [contextMenu, setContextMenu] = useState(null);
  const loadingPathsRef = useRef(new Set());

  const setPathLoading = useCallback((targetPath, isLoading) => {
    if (!targetPath) {
      return;
    }

    if (isLoading) {
      loadingPathsRef.current.add(targetPath);
    } else {
      loadingPathsRef.current.delete(targetPath);
    }

    setLoadingPaths([...loadingPathsRef.current]);
  }, []);

  const isPathLoading = useCallback((targetPath) => (
    targetPath ? loadingPaths.includes(targetPath) : false
  ), [loadingPaths]);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const loadNodeChildren = useCallback(async (targetPath) => {
    if (!targetPath || loadingPathsRef.current.has(targetPath)) {
      return;
    }

    setPathLoading(targetPath, true);

    try {
      const result = await window.electron?.listDirectory?.(targetPath);
      const nextChildren = result?.success
        ? (result.entries || []).map(createTreeNode)
        : [];
      const nextError = result?.success
        ? ''
        : (result?.error || readFolderErrorLabel);

      setRootNode((current) => updateTreeNode(current, targetPath, (node) => ({
        ...node,
        children: nextChildren,
        childrenLoaded: true,
        loadError: nextError,
      })));
    } finally {
      setPathLoading(targetPath, false);
    }
  }, [readFolderErrorLabel, setPathLoading]);

  const refreshRoot = useCallback(async () => {
    if (!workspacePath) {
      return;
    }

    const nextRoot = {
      ...createTreeNode({
        name: getPathLabel(workspacePath),
        path: workspacePath,
        isDirectory: true,
      }),
      expanded: true,
    };

    closeContextMenu();
    setSelectedPath(workspacePath);
    setRootNode(nextRoot);
    await loadNodeChildren(workspacePath);
  }, [closeContextMenu, loadNodeChildren, workspacePath]);

  useEffect(() => {
    closeContextMenu();

    if (!workspacePath) {
      setRootNode(null);
      setSelectedPath('');
      return;
    }

    const nextRoot = {
      ...createTreeNode({
        name: getPathLabel(workspacePath),
        path: workspacePath,
        isDirectory: true,
      }),
      expanded: true,
    };

    setSelectedPath(workspacePath);
    setRootNode(nextRoot);
    loadNodeChildren(workspacePath);
  }, [closeContextMenu, loadNodeChildren, workspacePath]);

  useEffect(() => {
    if (!workspacePath || refreshToken <= 0) {
      return;
    }

    refreshRoot();
  }, [refreshRoot, refreshToken, workspacePath]);

  useEffect(() => {
    if (!contextMenu) {
      return undefined;
    }

    const handleClose = () => {
      setContextMenu(null);
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setContextMenu(null);
      }
    };

    window.addEventListener('click', handleClose);
    window.addEventListener('blur', handleClose);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('click', handleClose);
      window.removeEventListener('blur', handleClose);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu]);

  const openPath = useCallback(async (targetPath) => {
    if (!targetPath) {
      return;
    }

    await window.electron?.openPath?.(targetPath);
  }, []);

  const revealPath = useCallback(async (targetPath) => {
    if (!targetPath) {
      return;
    }

    await window.electron?.revealPath?.(targetPath);
  }, []);

  const copyPath = useCallback(async (targetPath) => {
    if (!targetPath) {
      return;
    }

    try {
      await navigator.clipboard.writeText(targetPath);
    } catch {
      // Ignore clipboard failures in the panel.
    }
  }, []);

  const handleToggleFolder = useCallback(async (node) => {
    if (!node?.isDirectory) {
      return;
    }

    setSelectedPath(node.path);
    setRootNode((current) => updateTreeNode(current, node.path, (item) => ({
      ...item,
      expanded: !item.expanded,
    })));

    if (!node.expanded && !node.childrenLoaded) {
      await loadNodeChildren(node.path);
    }
  }, [loadNodeChildren]);

  const handleDoubleClick = useCallback(async (node) => {
    if (!node?.path) {
      return;
    }

    setSelectedPath(node.path);
    await openPath(node.path);
  }, [openPath]);

  const handleContextMenu = useCallback((event, node) => {
    event.preventDefault();
    event.stopPropagation();
    const panelRect = panelRef.current?.getBoundingClientRect();
    const relativeX = panelRect ? event.clientX - panelRect.left : event.clientX;
    const relativeY = panelRect ? event.clientY - panelRect.top : event.clientY;
    setSelectedPath(node.path);
    setContextMenu({
      x: relativeX,
      y: relativeY,
      node,
    });
  }, []);

  const handleDragStart = useCallback((event, node) => {
    if (!node?.path) {
      return;
    }

    closeContextMenu();
    setSelectedPath(node.path);
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(WORKSPACE_TRANSFER_TYPE, JSON.stringify([{
      path: node.path,
      isDirectory: node.isDirectory === true,
    }]));
    event.dataTransfer.setData('text/plain', node.path);
  }, [closeContextMenu]);

  if (collapsed) {
    return (
      <aside className="flex w-12 shrink-0 flex-col border-l border-claude-border-light bg-claude-surface-light/72 dark:border-claude-border-dark dark:bg-claude-surface-dark/72">
        <button
          onClick={onToggleCollapse}
          className="mx-auto mt-3 inline-flex h-8 w-8 items-center justify-center rounded-xl border border-claude-border-light bg-black/5 text-claude-text-light transition-colors hover:border-claude-orange/35 hover:text-claude-orange dark:border-claude-border-dark dark:bg-white/5 dark:text-claude-text-dark"
          title={tx('Expand workspace', '展开工作区')}
        >
          <ChevronLeft size={16} />
        </button>
        <div className="mt-4 flex justify-center">
          <div
            className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-claude-orange/10 text-claude-orange"
            title={tx('Workspace explorer', '工作区文件树')}
          >
            <FolderOpen size={15} />
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside
      ref={panelRef}
      className="relative flex w-[320px] shrink-0 flex-col border-l border-claude-border-light bg-claude-surface-light/72 backdrop-blur-sm dark:border-claude-border-dark dark:bg-claude-surface-dark/72"
    >
      <div className="flex items-center gap-2 border-b border-claude-border-light px-4 py-3 dark:border-claude-border-dark">
        <div className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-claude-orange/10 text-claude-orange">
          <FolderOpen size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-claude-text-light dark:text-claude-text-dark">
            {tx('Workspace', '工作区')}
          </div>
          <div className="truncate text-[11px] text-gray-500 dark:text-gray-400">
            {workspacePath || tx('No folder selected', '还没有选择文件夹')}
          </div>
        </div>
        <button
          onClick={onBrowseWorkspace}
          className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-claude-border-light bg-black/5 text-claude-text-light transition-colors hover:border-claude-orange/35 hover:text-claude-orange dark:border-claude-border-dark dark:bg-white/5 dark:text-claude-text-dark"
          title={tx('Choose workspace', '选择工作区')}
        >
          <Folder size={15} />
        </button>
        <button
          onClick={refreshRoot}
          disabled={!workspacePath || isPathLoading(workspacePath)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-claude-border-light bg-black/5 text-claude-text-light transition-colors hover:border-claude-orange/35 hover:text-claude-orange disabled:cursor-not-allowed disabled:opacity-50 dark:border-claude-border-dark dark:bg-white/5 dark:text-claude-text-dark"
          title={tx('Refresh file tree', '刷新文件树')}
        >
          <RefreshCw size={15} className={isPathLoading(workspacePath) ? 'animate-spin' : ''} />
        </button>
        <button
          onClick={onToggleCollapse}
          className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-claude-border-light bg-black/5 text-claude-text-light transition-colors hover:border-claude-orange/35 hover:text-claude-orange dark:border-claude-border-dark dark:bg-white/5 dark:text-claude-text-dark"
          title={tx('Collapse workspace', '收起工作区')}
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {!workspacePath ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <div className="rounded-2xl border border-dashed border-claude-border-light px-5 py-6 dark:border-claude-border-dark">
            <div className="text-sm font-medium text-claude-text-light dark:text-claude-text-dark">
              {tx('Choose a folder for this chat first', '先给这个聊天选择一个文件夹')}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
              {tx(
                'After selecting a workspace, the full file tree will appear here.',
                '选中工作区后，这里会显示完整的文件树。'
              )}
            </p>
            <button
              onClick={onBrowseWorkspace}
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-claude-orange px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              <FolderOpen size={14} />
              {tx('Choose workspace', '选择工作区')}
            </button>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
          {rootNode && (
            <TreeNode
              node={rootNode}
              depth={0}
              fileHighlights={fileHighlights}
              selectedPath={selectedPath}
              loadingPaths={loadingPaths}
              onSelect={setSelectedPath}
              onToggleFolder={handleToggleFolder}
              onDoubleClick={handleDoubleClick}
              onContextMenu={handleContextMenu}
              onDragStart={handleDragStart}
              onDragEnd={closeContextMenu}
              tx={tx}
            />
          )}
        </div>
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          isDirectory={contextMenu.node?.isDirectory === true}
          onClose={closeContextMenu}
          onOpen={async () => {
            await openPath(contextMenu.node?.path);
            closeContextMenu();
          }}
          onReveal={async () => {
            await revealPath(contextMenu.node?.path);
            closeContextMenu();
          }}
          onCopyPath={async () => {
            await copyPath(contextMenu.node?.path);
            closeContextMenu();
          }}
          tx={tx}
        />
      )}
    </aside>
  );
}

function TreeNode({
  node,
  depth,
  fileHighlights,
  selectedPath,
  loadingPaths,
  onSelect,
  onToggleFolder,
  onDoubleClick,
  onContextMenu,
  onDragStart,
  onDragEnd,
  tx,
}) {
  const normalizedNodePath = normalizeHighlightPath(node.path);
  const directHighlight = fileHighlights[normalizedNodePath] || '';
  const descendantHighlight = !directHighlight && node.isDirectory
    ? getDescendantHighlight(normalizedNodePath, fileHighlights)
    : '';
  const highlight = directHighlight || descendantHighlight;
  const isSelected = selectedPath === node.path;
  const isExpanded = Boolean(node.expanded);
  const isLoading = loadingPaths.includes(node.path);
  const leftPadding = 8 + depth * TREE_INDENT_PX;
  const rowClasses = getTreeRowClasses(isSelected, directHighlight);

  return (
    <div>
      <div
        onClick={() => onSelect(node.path)}
        onDoubleClick={() => onDoubleClick(node)}
        onContextMenu={(event) => onContextMenu(event, node)}
        onDragStart={(event) => onDragStart(event, node)}
        onDragEnd={onDragEnd}
        draggable
        className={`group flex cursor-default items-center gap-1 rounded-xl px-2 py-1.5 text-sm transition-colors ${rowClasses}`}
        style={{ paddingLeft: `${leftPadding}px` }}
        title={node.path}
      >
        {node.isDirectory ? (
          <button
            onClick={(event) => {
              event.stopPropagation();
              onToggleFolder(node);
            }}
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-black/5 hover:text-claude-orange dark:text-gray-400 dark:hover:bg-white/5"
            title={isExpanded ? tx('Collapse folder', '收起文件夹') : tx('Expand folder', '展开文件夹')}
          >
            {isExpanded ? <Minus size={12} /> : <Plus size={12} />}
          </button>
        ) : (
          <span className="inline-flex h-5 w-5 shrink-0" />
        )}

        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
          {node.isDirectory ? (
            isExpanded ? <FolderOpen size={15} className="text-claude-orange" /> : <Folder size={15} className="text-claude-orange" />
          ) : (
            <File size={14} className="text-gray-500 dark:text-gray-400" />
          )}
        </span>

        <span className="min-w-0 flex-1 truncate">
          {node.name}
        </span>

        {highlight && (
          <span className={`inline-flex h-2.5 w-2.5 shrink-0 rounded-full ${getHighlightDotClass(highlight)}`} />
        )}
      </div>

      {node.isDirectory && isExpanded && (
        <div>
          {isLoading && (
            <div
              className="flex items-center gap-2 px-2 py-1 text-[11px] text-gray-500 dark:text-gray-400"
              style={{ paddingLeft: `${leftPadding + TREE_INDENT_PX + 12}px` }}
            >
              <RefreshCw size={11} className="animate-spin" />
              {tx('Loading...', '加载中...')}
            </div>
          )}

          {!isLoading && node.loadError && (
            <div
              className="px-2 py-1 text-[11px] leading-relaxed text-red-500"
              style={{ paddingLeft: `${leftPadding + TREE_INDENT_PX + 12}px` }}
            >
              {node.loadError}
            </div>
          )}

          {!isLoading && !node.loadError && node.childrenLoaded && node.children.length === 0 && (
            <div
              className="px-2 py-1 text-[11px] text-gray-500 dark:text-gray-400"
              style={{ paddingLeft: `${leftPadding + TREE_INDENT_PX + 12}px` }}
            >
              {tx('Empty folder', '空文件夹')}
            </div>
          )}

          {!isLoading && !node.loadError && node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              fileHighlights={fileHighlights}
              selectedPath={selectedPath}
              loadingPaths={loadingPaths}
              onSelect={onSelect}
              onToggleFolder={onToggleFolder}
              onDoubleClick={onDoubleClick}
              onContextMenu={onContextMenu}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              tx={tx}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ContextMenu({ x, y, isDirectory, onClose, onOpen, onReveal, onCopyPath, tx }) {
  const left = Math.max(8, Math.min(x, 320 - 176 - 8));
  const top = Math.max(8, y);

  return (
    <div
      className="absolute z-50 w-44 rounded-xl border border-claude-border-light bg-claude-surface-light p-1.5 shadow-2xl dark:border-claude-border-dark dark:bg-claude-surface-dark"
      style={{ left, top }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <MenuItem
        icon={<ExternalLink size={13} />}
        label={isDirectory ? tx('Open folder', '打开文件夹') : tx('Open file', '打开文件')}
        onClick={onOpen}
      />
      <MenuItem
        icon={<FolderOpen size={13} />}
        label={tx('Reveal in Explorer', '在资源管理器中显示')}
        onClick={onReveal}
      />
      <MenuItem
        icon={<Copy size={13} />}
        label={tx('Copy path', '复制路径')}
        onClick={onCopyPath}
      />
      <button
        onClick={onClose}
        className="mt-1 w-full rounded-lg px-2 py-1.5 text-left text-[11px] text-gray-500 transition-colors hover:bg-black/[0.05] dark:text-gray-400 dark:hover:bg-white/[0.05]"
      >
        {tx('Close', '关闭')}
      </button>
    </div>
  );
}

function MenuItem({ icon, label, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-claude-text-light transition-colors hover:bg-black/[0.05] dark:text-claude-text-dark dark:hover:bg-white/[0.05]"
    >
      <span className="inline-flex h-4 w-4 items-center justify-center text-gray-500 dark:text-gray-400">
        {icon}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}

function createTreeNode(entry) {
  return {
    name: entry.name,
    path: entry.path,
    isDirectory: entry.isDirectory === true,
    expanded: false,
    childrenLoaded: false,
    children: [],
    loadError: '',
  };
}

function updateTreeNode(node, targetPath, updater) {
  if (!node) {
    return node;
  }

  if (node.path === targetPath) {
    return updater(node);
  }

  if (!Array.isArray(node.children) || node.children.length === 0) {
    return node;
  }

  let changed = false;
  const nextChildren = node.children.map((child) => {
    const nextChild = updateTreeNode(child, targetPath, updater);
    if (nextChild !== child) {
      changed = true;
    }
    return nextChild;
  });

  return changed ? { ...node, children: nextChildren } : node;
}

function getPathLabel(targetPath) {
  const parts = String(targetPath || '').split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] || targetPath || 'Workspace';
}

function getDescendantHighlight(folderPath, fileHighlights) {
  const prefix = `${normalizeHighlightPath(folderPath).replace(/[\\/]+$/, '')}\\`.toLowerCase();
  let hasModified = false;

  for (const [targetPath, status] of Object.entries(fileHighlights || {})) {
    const normalizedTarget = normalizeHighlightPath(targetPath).toLowerCase();
    if (!normalizedTarget.startsWith(prefix)) {
      continue;
    }

    if (status === 'created') {
      return 'created';
    }

    if (status === 'modified') {
      hasModified = true;
    }
  }

  return hasModified ? 'modified' : '';
}

function getTreeRowClasses(isSelected, directHighlight) {
  if (directHighlight === 'created') {
    return isSelected
      ? 'bg-emerald-500/16 text-emerald-700 ring-1 ring-emerald-500/25 dark:text-emerald-300'
      : 'bg-emerald-500/8 text-emerald-700 hover:bg-emerald-500/12 dark:text-emerald-300 dark:hover:bg-emerald-500/14';
  }

  if (directHighlight === 'modified') {
    return isSelected
      ? 'bg-amber-500/16 text-amber-700 ring-1 ring-amber-500/25 dark:text-amber-300'
      : 'bg-amber-500/8 text-amber-700 hover:bg-amber-500/12 dark:text-amber-300 dark:hover:bg-amber-500/14';
  }

  return isSelected
    ? 'bg-claude-orange/12 text-claude-orange'
    : 'text-claude-text-light hover:bg-black/[0.05] dark:text-claude-text-dark dark:hover:bg-white/[0.05]';
}

function getHighlightDotClass(highlight) {
  if (highlight === 'created') {
    return 'bg-emerald-500';
  }

  if (highlight === 'modified') {
    return 'bg-amber-600 dark:bg-amber-400';
  }

  return 'bg-transparent';
}

function normalizeHighlightPath(targetPath) {
  return String(targetPath || '').replace(/\//g, '\\').trim();
}
