import * as Dialog from '@radix-ui/react-dialog';
import { ChevronRight, Folder, FileText, Home, ArrowUp, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { fetchJson } from '../lib/fetch-json.js';

interface BrowseEntry {
  name: string;
  isDir: boolean;
}

interface BrowseResponse {
  path: string;
  parent: string | null;
  home: string;
  entries: BrowseEntry[];
}

export interface FolderPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: 'dir' | 'file';
  initialPath?: string;
  title?: string;
  confirmLabel?: string;
  onSelect: (path: string) => void;
}

export default function FolderPicker({
  open,
  onOpenChange,
  mode = 'dir',
  initialPath,
  title,
  confirmLabel,
  onSelect,
}: FolderPickerProps) {
  const [data, setData] = useState<BrowseResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const browse = useCallback(
    async (target?: string) => {
      setLoading(true);
      setError(null);
      try {
        const qs = target ? `?path=${encodeURIComponent(target)}&mode=${mode}` : `?mode=${mode}`;
        const res = await fetchJson<BrowseResponse>(`/api/fs/browse${qs}`);
        setData(res);
        setSelectedFile(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to browse');
      } finally {
        setLoading(false);
      }
    },
    [mode]
  );

  useEffect(() => {
    if (!open) return;
    void browse(initialPath);
  }, [open, initialPath, browse]);

  const headingLabel = title ?? (mode === 'file' ? 'Choose file' : 'Choose folder');
  const confirmText = confirmLabel ?? (mode === 'file' ? 'Use file' : 'Use this folder');

  function confirm(): void {
    if (mode === 'file') {
      if (selectedFile) onSelect(selectedFile);
      return;
    }
    if (data) onSelect(data.path);
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-xl">
          <Dialog.Title className="text-base font-semibold text-zinc-900">{headingLabel}</Dialog.Title>

          <div className="mt-3 flex items-center gap-1">
            <button
              type="button"
              onClick={() => browse(data?.home)}
              className="rounded-md border border-zinc-200 bg-white p-1.5 text-zinc-600 hover:bg-zinc-50"
              title="Home"
            >
              <Home size={14} />
            </button>
            <button
              type="button"
              disabled={!data?.parent}
              onClick={() => data?.parent && browse(data.parent)}
              className="rounded-md border border-zinc-200 bg-white p-1.5 text-zinc-600 hover:bg-zinc-50 disabled:opacity-40"
              title="Parent"
            >
              <ArrowUp size={14} />
            </button>
            <div className="ml-1 flex-1 truncate rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 font-mono text-[12px] text-zinc-700">
              {data?.path ?? '…'}
            </div>
          </div>

          <div className="mt-3 h-72 overflow-y-auto rounded-lg border border-zinc-200">
            {loading && (
              <div className="flex h-full items-center justify-center text-zinc-400">
                <Loader2 size={18} className="animate-spin" />
              </div>
            )}
            {!loading && error && (
              <div className="flex h-full items-center justify-center px-4 text-center text-sm text-red-600">
                {error}
              </div>
            )}
            {!loading && !error && data && (
              <ul className="divide-y divide-zinc-100">
                {data.entries.length === 0 && (
                  <li className="px-3 py-6 text-center text-sm text-zinc-400">Empty</li>
                )}
                {data.entries.map((entry) => {
                  const fullPath = `${data.path === '/' ? '' : data.path}/${entry.name}`;
                  const isSelectedFile = mode === 'file' && selectedFile === fullPath;
                  return (
                    <li key={entry.name}>
                      <button
                        type="button"
                        onClick={() => {
                          if (entry.isDir) {
                            void browse(fullPath);
                          } else {
                            setSelectedFile(fullPath);
                          }
                        }}
                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                          isSelectedFile ? 'bg-blue-50 text-blue-900' : 'hover:bg-zinc-50'
                        }`}
                      >
                        {entry.isDir ? (
                          <Folder size={14} className="shrink-0 text-zinc-500" />
                        ) : (
                          <FileText size={14} className="shrink-0 text-zinc-400" />
                        )}
                        <span className="flex-1 truncate">{entry.name}</span>
                        {entry.isDir && <ChevronRight size={14} className="text-zinc-300" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {mode === 'file' && (
            <div className="mt-2 truncate font-mono text-[11px] text-zinc-500">
              {selectedFile ?? 'No file selected'}
            </div>
          )}

          <div className="mt-4 flex items-center justify-end gap-2">
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                Cancel
              </button>
            </Dialog.Close>
            <button
              type="button"
              disabled={mode === 'file' ? !selectedFile : !data}
              onClick={confirm}
              className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {confirmText}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
