import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Loader2,
  LogIn,
  Pencil,
  ShieldAlert,
  UploadCloud,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { AgentLogo } from '../components/agent-brand';
import { refreshAuthStatus, useAuthStatus } from '../lib/auth-status.js';
import { toast } from '../components/ui/toast.js';

type Agent = 'claude' | 'codex' | 'gemini';
type PublishMode = 'upload' | 'github';

interface ProfileContents {
  profile: {
    name: string;
    description?: string;
    mcps: Record<string, unknown>;
  };
  manifest: {
    plugins?: Array<{ agent: Agent; name: string }>;
    userSkills?: Array<{ agent: Agent; name: string }>;
  } | null;
}

interface PreviewItem {
  name: string;
  agents: Agent[];
}

export interface PublishProfilePanelProps {
  profileName: string;
  onCancel: () => void;
  onPublished: () => void;
  onEdit: (profileName: string) => void;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export default function PublishProfilePanel({
  profileName,
  onCancel,
  onPublished,
  onEdit,
}: PublishProfilePanelProps) {
  const [mode, setMode] = useState<PublishMode>('upload');
  const [repoUrl, setRepoUrl] = useState('');
  const [summary, setSummary] = useState('');
  const [refName, setRefName] = useState('main');
  const [profilePath, setProfilePath] = useState('profile.yaml');
  const [version, setVersion] = useState('1.0.0');
  const [changelog, setChangelog] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contents, setContents] = useState<ProfileContents | null>(null);
  const [loadingContents, setLoadingContents] = useState(false);
  const [success, setSuccess] = useState<{ slug: string; url: string | null } | null>(null);
  const { status } = useAuthStatus();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const slug = slugify(profileName);
  const title = profileName;

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

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
  }, [profileName]);

  const groups = useMemo(() => {
    if (!contents)
      return { mcps: [], plugins: [], skills: [] } as {
        mcps: PreviewItem[];
        plugins: PreviewItem[];
        skills: PreviewItem[];
      };
    const mcps: PreviewItem[] = Object.keys(contents.profile.mcps ?? {})
      .sort()
      .map((name) => ({ name, agents: [] }));
    const pluginMap = new Map<string, Set<Agent>>();
    for (const p of contents.manifest?.plugins ?? []) {
      const s = pluginMap.get(p.name) ?? new Set<Agent>();
      s.add(p.agent);
      pluginMap.set(p.name, s);
    }
    const plugins: PreviewItem[] = Array.from(pluginMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, set]) => ({ name, agents: Array.from(set).sort() }));
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

  async function startSignIn() {
    setBusy(true);
    try {
      const res = await fetch('/api/auth/start', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { url } = (await res.json()) as { url: string };
      window.open(url, '_blank', 'noopener,noreferrer');
      if (pollRef.current) clearInterval(pollRef.current);
      const stop = Date.now() + 5 * 60 * 1000;
      pollRef.current = setInterval(async () => {
        const data = await refreshAuthStatus();
        if (data?.signedIn || Date.now() > stop) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          if (data?.signedIn) toast.success('Signed in to brainctl');
        }
      }, 2000);
    } catch (err) {
      toast.error(`Sign-in failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!slug || !title) {
      setError('Profile name is required.');
      return;
    }
    if (mode === 'github' && !repoUrl.trim()) {
      setError('GitHub repo URL is required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const endpoint =
        mode === 'github' ? '/api/profiles/register-github' : '/api/profiles/publish';
      const body =
        mode === 'github'
          ? {
              repoUrl: repoUrl.trim(),
              slug,
              title,
              summary: summary.trim() || undefined,
              refName: refName.trim() || undefined,
              profilePath: profilePath.trim() || undefined,
            }
          : {
              profileName,
              slug,
              title,
              summary: summary.trim() || undefined,
              version: version.trim() || undefined,
              changelog: changelog.trim() || undefined,
            };
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        const raw = data.error ?? `HTTP ${res.status}`;
        if (res.status === 409 || /conflict|already|exists|taken|duplicate/i.test(raw)) {
          throw new Error(
            `The name "${title}" is already published in the registry. Rename the profile locally and try again.`
          );
        }
        throw new Error(raw);
      }
      toast.success(
        mode === 'github'
          ? `Registered "${slug}" with the brainctl registry`
          : `Published "${slug}" to the brainctl registry`
      );
      onPublished();
      const frontend = status?.apiFrontendUrl?.replace(/\/$/, '') ?? null;
      const publicUrl = frontend ? `${frontend}/profiles/${slug}` : null;
      setSuccess({ slug, url: publicUrl });
      if (publicUrl) {
        window.open(publicUrl, '_blank', 'noopener,noreferrer');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(`Publish failed: ${message}`);
    } finally {
      setBusy(false);
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
            <UploadCloud size={18} className="shrink-0 text-zinc-600" />
            <span className="whitespace-nowrap">Publish to registry</span>
          </h3>
          <p className="mt-1 hidden max-w-4xl text-[13px] font-medium leading-relaxed text-zinc-500 lg:block">
            Upload your local profile package, or register a GitHub-hosted profile by URL.
            The slug and title come from your profile name — rename the profile locally to
            change them.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <button
            type="button"
            onClick={() => onEdit(profileName)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 text-[12px] font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50 hover:text-zinc-900"
          >
            <Pencil size={13} /> Edit profile
          </button>
          {totalItems > 0 && (
            <div className="text-xs text-zinc-500">
              {totalItems} item{totalItems === 1 ? '' : 's'}
            </div>
          )}
        </div>
      </div>

<div className="scrollbar-none grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-5 xl:grid-cols-[22rem_minmax(0,1fr)] xl:overflow-hidden">
        <aside className="flex flex-col gap-4 xl:min-h-0">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <div className="inline-flex h-8 shrink-0 items-center gap-0.5 rounded-lg bg-zinc-100 p-0.5">
              <button
                type="button"
                onClick={() => setMode('upload')}
                disabled={busy}
                className={`h-7 rounded-md px-3 text-[12px] font-medium transition-colors ${
                  mode === 'upload'
                    ? 'bg-white text-zinc-900 shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-700'
                }`}
              >
                Direct upload
              </button>
              <button
                type="button"
                onClick={() => setMode('github')}
                disabled={busy}
                className={`h-7 rounded-md px-3 text-[12px] font-medium transition-colors ${
                  mode === 'github'
                    ? 'bg-white text-zinc-900 shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-700'
                }`}
              >
                From GitHub
              </button>
            </div>
            <span
              className="min-w-0 truncate font-mono text-[11px] text-zinc-500"
              title={slug}
            >
              {slug || '—'}
            </span>
          </div>

          {mode === 'github' && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-zinc-700">GitHub repo URL</span>
              <input
                type="text"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                disabled={busy}
                placeholder="https://github.com/user/repo"
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none"
              />
            </label>
          )}

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-zinc-700">
              Summary <span className="font-normal text-zinc-400">(optional)</span>
            </span>
            <input
              type="text"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              disabled={busy}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none"
            />
          </label>

          {mode === 'github' ? (
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-zinc-700">Ref</span>
                <input
                  type="text"
                  value={refName}
                  onChange={(e) => setRefName(e.target.value)}
                  disabled={busy}
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-zinc-700">Profile path</span>
                <input
                  type="text"
                  value={profilePath}
                  onChange={(e) => setProfilePath(e.target.value)}
                  disabled={busy}
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none"
                />
              </label>
            </div>
          ) : (
            <div className="grid grid-cols-[1fr_2fr] gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-zinc-700">Version</span>
                <input
                  type="text"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  disabled={busy}
                  placeholder="1.0.0"
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-zinc-700">
                  Changelog <span className="font-normal text-zinc-400">(optional)</span>
                </span>
                <input
                  type="text"
                  value={changelog}
                  onChange={(e) => setChangelog(e.target.value)}
                  disabled={busy}
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none"
                />
              </label>
            </div>
          )}

          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
            <ShieldAlert size={14} className="mt-0.5 shrink-0" />
            <span>
              Check for secrets first — published profiles are public and you're responsible
              for what you upload.
            </span>
          </div>

          {status && !status.signedIn && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <span>You need to sign in to publish.</span>
              <button
                type="button"
                onClick={() => void startSignIn()}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-2 py-1 text-[11px] font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
              >
                <LogIn size={12} /> Sign in
              </button>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
              {error}
            </div>
          )}
        </aside>

        <div className="flex min-h-[20rem] flex-col rounded-xl border border-zinc-200 bg-zinc-50/40 xl:min-h-0">
          <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-4 py-3">
            <div>
              <div className="text-sm font-semibold text-zinc-900">What will be uploaded</div>
              <div className="text-xs text-zinc-500">
                These are the items packaged from your local profile.
              </div>
            </div>
            <div className="text-xs text-zinc-500">
              {totalItems > 0 ? `${totalItems} item${totalItems === 1 ? '' : 's'}` : null}
            </div>
          </div>
          <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto p-4 text-sm">
            {loadingContents ? (
              <p className="inline-flex items-center gap-2 text-zinc-500">
                <Loader2 size={14} className="animate-spin" /> Loading…
              </p>
            ) : totalItems === 0 ? (
              <p className="text-zinc-500">This profile has no items to upload.</p>
            ) : (
              <div className="grid gap-4 xl:grid-cols-3">
                <PreviewGroup label="Skills" items={groups.skills} />
                <PreviewGroup label="MCPs" items={groups.mcps} />
                <PreviewGroup label="Plugins" items={groups.plugins} />
              </div>
            )}
          </div>
        </div>
      </div>

      {success && (
        <div className="mx-5 mb-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-900">
          <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="font-semibold">Published "{success.slug}" to the registry.</div>
            {success.url ? (
              <div className="mt-0.5 text-emerald-800">
                Opened the package page in a new tab.{' '}
                <a
                  href={success.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium underline underline-offset-2"
                >
                  Open again <ExternalLink size={11} />
                </a>
              </div>
            ) : (
              <div className="mt-0.5 text-emerald-800">
                Sign in to the brainctl web app to view the package page.
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-zinc-200 p-5">
        <div className="text-xs text-zinc-500">
          {totalItems > 0
            ? `${totalItems} item${totalItems === 1 ? '' : 's'} → ${slug || '—'}`
            : null}
        </div>
        <div className="flex items-center gap-3">
          {success ? (
            <>
              {success.url && (
                <a
                  href={success.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[36px] items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 shadow-sm transition-all hover:bg-zinc-50 hover:text-zinc-900"
                >
                  <ExternalLink size={14} /> View package
                </a>
              )}
              <button
                type="button"
                onClick={onCancel}
                className="inline-flex min-h-[36px] items-center justify-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white shadow-sm transition-all hover:bg-zinc-800"
              >
                Done
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={onCancel}
                className="inline-flex min-h-[36px] items-center justify-center rounded-lg border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 shadow-sm transition-all hover:bg-zinc-50 hover:text-zinc-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={busy || !status?.signedIn || !slug}
                title={status?.signedIn ? '' : 'Sign in to publish'}
                className="inline-flex min-h-[36px] items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white shadow-sm transition-all hover:bg-zinc-800 disabled:opacity-60"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <UploadCloud size={14} />}
                {busy ? 'Publishing…' : mode === 'github' ? 'Register' : 'Publish'}
              </button>
            </>
          )}
        </div>
      </div>
    </section>
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
