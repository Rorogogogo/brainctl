import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FolderOpen,
  Loader2,
  Pencil,
  UploadCloud,
  Wand2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { AgentLogo } from '../components/agent-brand';
import { toast } from '../components/ui/toast.js';

type Agent = 'claude' | 'codex' | 'antigravity';

interface PluginManifestEntry {
  agent: Agent;
  name: string;
  source?: string;
  version?: string;
  pluginSkills?: string[];
  pluginMcps?: string[];
  pluginAgents?: string[];
  pluginCommands?: string[];
}

interface ProfileContents {
  profile: {
    name: string;
    description?: string;
    mcps: Record<string, unknown>;
  };
  manifest: {
    plugins?: PluginManifestEntry[];
    userSkills?: Array<{ agent: Agent; name: string }>;
  } | null;
}

interface PublishedInfo {
  slug: string;
  profileId?: string;
  version?: string;
  lastPublishedAt?: string;
  url?: string;
  manageUrl?: string;
}

interface PreviewItem {
  name: string;
  agents: Agent[];
}

interface PluginPreviewItem extends PreviewItem {
  version?: string;
  skills: string[];
  mcps: string[];
  agentsProvided: string[];
  commands: string[];
}

export interface ViewProfilePanelProps {
  profileName: string;
  onCancel: () => void;
  onApply: (profileName: string) => void;
  onPublish: (profileName: string) => void;
  onEdit: (profileName: string) => void;
}

export default function ViewProfilePanel({
  profileName,
  onCancel,
  onApply,
  onPublish,
  onEdit,
}: ViewProfilePanelProps) {
  const [contents, setContents] = useState<ProfileContents | null>(null);
  const [loadingContents, setLoadingContents] = useState(false);
  const [reloadKey] = useState(0);
  const [published, setPublished] = useState<PublishedInfo | null>(null);
  const [sourceAgent, setSourceAgent] = useState<Agent | null>(null);

  useEffect(() => {
    let aborted = false;
    setLoadingContents(true);
    void (async () => {
      try {
        const r = await fetch(`/api/profiles/${encodeURIComponent(profileName)}/contents`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = (await r.json()) as ProfileContents;
        if (!aborted) setContents(data);
      } catch {
        if (!aborted) setContents(null);
      } finally {
        if (!aborted) setLoadingContents(false);
      }
    })();
    return () => {
      aborted = true;
    };
  }, [profileName, reloadKey]);

  useEffect(() => {
    let aborted = false;
    void (async () => {
      try {
        const r = await fetch('/api/profiles');
        const data = (await r.json()) as {
          profiles: Array<{
            name: string;
            sourceAgent?: Agent;
            published?: PublishedInfo;
          }>;
        };
        const me = data.profiles.find((p) => p.name === profileName);
        if (!aborted) {
          setPublished(me?.published ?? null);
          setSourceAgent(me?.sourceAgent ?? null);
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      aborted = true;
    };
  }, [profileName, reloadKey]);

  const groups = useMemo(() => {
    if (!contents)
      return { mcps: [], plugins: [], skills: [] } as {
        mcps: PreviewItem[];
        plugins: PluginPreviewItem[];
        skills: PreviewItem[];
      };
    const mcps: PreviewItem[] = Object.keys(contents.profile.mcps ?? {})
      .sort()
      .map((name) => ({ name, agents: [] }));

    interface PluginAccum {
      agents: Set<Agent>;
      version?: string;
      skills: Set<string>;
      mcps: Set<string>;
      agentsProvided: Set<string>;
      commands: Set<string>;
    }
    const pluginMap = new Map<string, PluginAccum>();
    for (const p of contents.manifest?.plugins ?? []) {
      let acc = pluginMap.get(p.name);
      if (!acc) {
        acc = {
          agents: new Set(),
          version: p.version,
          skills: new Set(),
          mcps: new Set(),
          agentsProvided: new Set(),
          commands: new Set(),
        };
        pluginMap.set(p.name, acc);
      }
      acc.agents.add(p.agent);
      if (p.version && !acc.version) acc.version = p.version;
      for (const s of p.pluginSkills ?? []) acc.skills.add(s);
      for (const m of p.pluginMcps ?? []) acc.mcps.add(m);
      for (const a of p.pluginAgents ?? []) acc.agentsProvided.add(a);
      for (const c of p.pluginCommands ?? []) acc.commands.add(c);
    }
    const plugins: PluginPreviewItem[] = Array.from(pluginMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, acc]) => ({
        name,
        agents: Array.from(acc.agents).sort(),
        version: acc.version,
        skills: Array.from(acc.skills).sort(),
        mcps: Array.from(acc.mcps).sort(),
        agentsProvided: Array.from(acc.agentsProvided).sort(),
        commands: Array.from(acc.commands).sort(),
      }));
    const skillMap = new Map<string, Set<Agent>>();
    for (const sk of contents.manifest?.userSkills ?? []) {
      const s = skillMap.get(sk.name) ?? new Set<Agent>();
      s.add(sk.agent);
      skillMap.set(sk.name, s);
    }
    const skills: PreviewItem[] = Array.from(skillMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, set]) => ({ name, agents: Array.from(set).sort() }));
    return { mcps, plugins, skills };
  }, [contents]);
  const totalItems = groups.mcps.length + groups.plugins.length + groups.skills.length;

  async function revealInFinder() {
    try {
      const r = await fetch(`/api/profiles/${encodeURIComponent(profileName)}/open-folder`, {
        method: 'POST',
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    } catch (err) {
      toast.error(`Open folder failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <section className="flex h-full min-h-0 flex-col rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex shrink-0 items-start justify-between gap-4 border-b border-zinc-200 p-5">
        <div className="min-w-0">
          <button
            type="button"
            onClick={onCancel}
            className="mb-3 inline-flex h-7 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2 text-[12px] font-medium text-zinc-600 shadow-sm transition hover:bg-zinc-50 hover:text-zinc-900"
          >
            <ArrowLeft size={13} />
            Local agents
          </button>
          <h3 className="m-0 flex items-center gap-2 text-xl font-semibold tracking-tight text-zinc-900">
            {sourceAgent ? (
              <span className="grid size-5 shrink-0 place-items-center overflow-hidden">
                <AgentLogo agent={sourceAgent} className="size-full object-contain" />
              </span>
            ) : null}
            <span className="truncate">{profileName}</span>
          </h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-zinc-500">
            <span>{totalItems} item{totalItems === 1 ? '' : 's'}</span>
            <span className="text-zinc-300">•</span>
            {published ? (
              <span className="inline-flex items-center gap-1.5 text-zinc-600">
                <UploadCloud size={12} /> Published
              </span>
            ) : (
              <span>Not published</span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={revealInFinder}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 text-[12px] font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50 hover:text-zinc-900"
          >
            <FolderOpen size={13} /> Reveal
          </button>
          <button
            type="button"
            onClick={() => onEdit(profileName)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 text-[12px] font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50 hover:text-zinc-900"
          >
            <Pencil size={13} /> Edit
          </button>
          <button
            type="button"
            onClick={() => onPublish(profileName)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 text-[12px] font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50 hover:text-zinc-900"
          >
            <UploadCloud size={13} /> {published ? 'Re-publish' : 'Publish'}
          </button>
          <button
            type="button"
            onClick={() => onApply(profileName)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-zinc-900 px-3 text-[12px] font-medium text-white shadow-sm transition hover:bg-zinc-800"
          >
            <Wand2 size={13} /> Apply
          </button>
        </div>
      </div>

<div className="flex min-h-0 flex-1 flex-col gap-4 p-5">
        {published && (
          <div className="shrink-0 rounded-xl border border-zinc-200 bg-white">
            <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-4 py-2.5">
              <div className="flex items-center gap-2">
                <span className="grid size-6 place-items-center rounded-md bg-emerald-50 text-emerald-700">
                  <UploadCloud size={13} />
                </span>
                <div className="flex flex-col">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                    Published to registry
                  </span>
                  <span className="text-sm font-semibold text-zinc-900">
                    {published.slug}
                    {published.version ? (
                      <span className="ml-1.5 font-mono text-[11px] font-normal text-zinc-400">
                        v{published.version}
                      </span>
                    ) : null}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {published.url ? (
                  <a
                    href={published.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-7 items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2 text-[11px] font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50 hover:text-zinc-900"
                  >
                    <ExternalLink size={11} /> Open public page
                  </a>
                ) : null}
                {published.manageUrl ? (
                  <a
                    href={published.manageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-7 items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2 text-[11px] font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50 hover:text-zinc-900"
                  >
                    <ExternalLink size={11} /> Manage
                  </a>
                ) : null}
              </div>
            </div>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 px-4 py-3 text-xs sm:grid-cols-2">
              <DataRow label="Slug" value={published.slug} mono />
              {published.version && <DataRow label="Version" value={published.version} mono />}
              {published.lastPublishedAt && (
                <DataRow
                  label="Last published"
                  value={new Date(published.lastPublishedAt).toLocaleString()}
                />
              )}
              {published.profileId && (
                <DataRow label="Profile ID" value={published.profileId} mono copyable />
              )}
            </dl>
          </div>
        )}

        <div className="flex shrink-0 items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-zinc-900">Profile contents</div>
            <div className="text-xs text-zinc-500">
              Everything packaged in this profile.
            </div>
          </div>
        </div>
        <div className="scrollbar-none min-h-[20rem] flex-1 overflow-y-auto rounded-xl border border-zinc-200 bg-zinc-50/40 p-4 text-sm">
          {loadingContents ? (
            <p className="inline-flex items-center gap-2 text-zinc-500">
              <Loader2 size={14} className="animate-spin" /> Loading…
            </p>
          ) : totalItems === 0 ? (
            <p className="text-zinc-500">This profile has no items.</p>
          ) : (
            <div className="grid gap-4 xl:grid-cols-3">
              <PreviewGroup label="Skills" items={groups.skills} />
              <PreviewGroup label="MCPs" items={groups.mcps} />
              <PluginGroup label="Plugins" items={groups.plugins} />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function DataRow({
  label,
  value,
  mono,
  copyable,
}: {
  label: string;
  value: string;
  mono?: boolean;
  copyable?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3">
      <dt className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        {label}
      </dt>
      <dd className="flex min-w-0 items-center gap-1.5 text-zinc-700">
        <span
          className={`truncate ${mono ? 'font-mono text-[11px]' : 'text-[12px]'}`}
          title={value}
        >
          {value}
        </span>
        {copyable && (
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(value);
              toast.success('Copied to clipboard');
            }}
            className="rounded p-0.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
            title="Copy"
          >
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
              <rect x="4" y="4" width="9" height="9" rx="1.5" />
              <path d="M3 11V4a1 1 0 011-1h7" />
            </svg>
          </button>
        )}
      </dd>
    </div>
  );
}

function PluginGroup({ label, items }: { label: string; items: PluginPreviewItem[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  if (items.length === 0) return null;
  function toggle(name: string) {
    const next = new Set(expanded);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setExpanded(next);
  }
  return (
    <div>
      <div className="sticky top-0 z-10 flex items-center justify-between bg-zinc-50/95 pb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          {label} ({items.length})
        </span>
      </div>
      <ul className="mt-1 flex flex-col gap-1">
        {items.map((item) => {
          const isOpen = expanded.has(item.name);
          const hasChildren =
            item.skills.length +
              item.mcps.length +
              item.agentsProvided.length +
              item.commands.length >
            0;
          return (
            <li key={`${label}-${item.name}`}>
              <div className="overflow-hidden rounded-md border border-zinc-200 bg-white">
                <button
                  type="button"
                  onClick={() => hasChildren && toggle(item.name)}
                  disabled={!hasChildren}
                  className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm text-zinc-800 ${
                    hasChildren ? 'cursor-pointer hover:bg-zinc-50' : 'cursor-default'
                  }`}
                >
                  {hasChildren ? (
                    isOpen ? (
                      <ChevronDown size={12} className="shrink-0 text-zinc-400" />
                    ) : (
                      <ChevronRight size={12} className="shrink-0 text-zinc-400" />
                    )
                  ) : (
                    <span className="size-3 shrink-0" />
                  )}
                  <span className="flex-1 truncate font-medium">{item.name}</span>
                  {item.version && (
                    <span className="font-mono text-[10px] text-zinc-400">v{item.version}</span>
                  )}
                  {item.agents.length > 0 && (
                    <span className="flex items-center gap-1">
                      {item.agents.map((agent) => (
                        <span
                          key={agent}
                          className="grid size-3.5 place-items-center overflow-hidden"
                          title={agent}
                        >
                          <AgentLogo agent={agent} className="size-full object-contain" />
                        </span>
                      ))}
                    </span>
                  )}
                </button>
                {isOpen && hasChildren && (
                  <div className="border-t border-zinc-100 bg-zinc-50/60 px-3 py-2">
                    <SubList label="Skills" items={item.skills} />
                    <SubList label="Commands" items={item.commands} />
                    <SubList label="Agents" items={item.agentsProvided} />
                    <SubList label="MCPs" items={item.mcps} />
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SubList({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mb-1.5 last:mb-0">
      <div className="mb-0.5 text-[9px] font-semibold uppercase tracking-wider text-zinc-400">
        {label} ({items.length})
      </div>
      <div className="flex flex-wrap gap-1">
        {items.map((name) => (
          <span
            key={`${label}-${name}`}
            className="rounded border border-zinc-200 bg-white px-1.5 py-0 font-mono text-[10px] text-zinc-600"
          >
            {name}
          </span>
        ))}
      </div>
    </div>
  );
}

function PreviewGroup({ label, items }: { label: string; items: PreviewItem[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="sticky top-0 z-10 flex items-center justify-between bg-zinc-50/95 pb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          {label} ({items.length})
        </span>
      </div>
      <ul className="mt-1 flex flex-col gap-1">
        {items.map((item) => (
          <li key={`${label}-${item.name}`}>
            <div className="flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-800">
              <span className="flex-1 truncate font-medium">{item.name}</span>
              {item.agents.length > 0 && (
                <span className="flex items-center gap-1">
                  {item.agents.map((agent) => (
                    <span
                      key={agent}
                      className="grid size-3.5 place-items-center overflow-hidden"
                      title={agent}
                    >
                      <AgentLogo agent={agent} className="size-full object-contain" />
                    </span>
                  ))}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
