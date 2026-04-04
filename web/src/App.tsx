import { useEffect, useState, type ReactNode } from 'react';
import { Bot, Boxes, Download, Loader2, X } from 'lucide-react';

import { AgentLogo } from './agent-brand';
import ProfilesView from './ProfilesView';

interface ProfilesResponse {
  profiles: string[];
  activeProfile: string | null;
}

type ActionPanel = 'pack' | 'install' | null;

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error((body as { error?: string }).error ?? `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function ActionButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={[
        'inline-flex min-h-10 items-center gap-2 rounded-full border px-4 text-sm font-medium transition',
        active
          ? 'border-zinc-900 bg-zinc-900 text-white'
          : 'border-zinc-200 bg-white text-zinc-900 hover:border-zinc-300',
      ].join(' ')}
      type="button"
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function StatusNote({
  tone,
  children,
}: {
  tone: 'success' | 'error';
  children: ReactNode;
}) {
  return (
    <div
      className={[
        'rounded-2xl border px-4 py-3 text-sm',
        tone === 'success'
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
          : 'border-rose-200 bg-rose-50 text-rose-700',
      ].join(' ')}
    >
      {children}
    </div>
  );
}

function PanelShell({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="rounded-[28px] border border-zinc-200 bg-white p-5 shadow-[0_22px_60px_rgba(0,0,0,0.06)]">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
            Action
          </p>
          <h2 className="text-lg font-semibold tracking-[-0.03em] text-zinc-950">{title}</h2>
          <p className="text-sm text-zinc-500">{description}</p>
        </div>
        <button
          className="inline-flex size-9 items-center justify-center rounded-full border border-zinc-200 text-zinc-500 transition hover:border-zinc-300 hover:text-zinc-900"
          type="button"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>
      {children}
    </div>
  );
}

export default function App() {
  const [activePanel, setActivePanel] = useState<ActionPanel>(null);
  const [profiles, setProfiles] = useState<string[]>([]);
  const [activeProfile, setActiveProfile] = useState<string | null>(null);
  const [profilesLoading, setProfilesLoading] = useState(true);

  const [packProfileName, setPackProfileName] = useState('');
  const [packOutputPath, setPackOutputPath] = useState('');
  const [packBusy, setPackBusy] = useState(false);
  const [packResult, setPackResult] = useState<string | null>(null);
  const [packError, setPackError] = useState<string | null>(null);

  const [installArchivePath, setInstallArchivePath] = useState('');
  const [installForce, setInstallForce] = useState(false);
  const [installBusy, setInstallBusy] = useState(false);
  const [installResult, setInstallResult] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  useEffect(() => {
    void loadProfiles();
  }, []);

  async function loadProfiles(): Promise<void> {
    setProfilesLoading(true);
    try {
      const result = await fetchJson<ProfilesResponse>('/api/profiles');
      setProfiles(result.profiles);
      setActiveProfile(result.activeProfile);
      setPackProfileName((current) => current || result.activeProfile || result.profiles[0] || '');
    } catch {
      // Keep header usable even if profiles fail to load.
    } finally {
      setProfilesLoading(false);
    }
  }

  async function handlePack(): Promise<void> {
    if (!packProfileName) {
      setPackError('Choose a profile to export.');
      return;
    }

    setPackBusy(true);
    setPackError(null);
    setPackResult(null);
    try {
      const result = await fetchJson<{ archivePath: string }>('/api/profiles/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: packProfileName,
          outputPath: packOutputPath.trim() || undefined,
        }),
      });
      setPackResult(`Packed to ${result.archivePath}`);
    } catch (error) {
      setPackError((error as Error).message);
    } finally {
      setPackBusy(false);
    }
  }

  async function handleInstall(): Promise<void> {
    if (!installArchivePath.trim()) {
      setInstallError('Enter a profile archive path.');
      return;
    }

    setInstallBusy(true);
    setInstallError(null);
    setInstallResult(null);
    try {
      const result = await fetchJson<{ profileName: string; installedMcps: string[] }>('/api/profiles/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          archivePath: installArchivePath.trim(),
          force: installForce,
        }),
      });

      const mcpText =
        result.installedMcps.length > 0
          ? ` Installed bundled MCPs: ${result.installedMcps.join(', ')}.`
          : '';
      setInstallResult(`Installed profile "${result.profileName}".${mcpText}`);
      await loadProfiles();
    } catch (error) {
      setInstallError((error as Error).message);
    } finally {
      setInstallBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-white px-4 py-4 text-zinc-950 sm:px-6 lg:px-8">
      <div className="mx-auto grid w-full max-w-[1420px] gap-3">
        <header className="flex flex-col gap-3 rounded-[28px] border border-zinc-200 bg-white px-5 py-4 shadow-[0_18px_50px_rgba(0,0,0,0.04)] lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-10 place-items-center rounded-2xl border border-zinc-200 bg-white text-zinc-900">
              <Bot size={18} />
            </span>
            <div className="space-y-0.5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Brainctl</p>
              <h1 className="text-xl font-semibold tracking-[-0.04em] text-zinc-950">Transfer board</h1>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:justify-center">
            {(['claude', 'codex', 'gemini'] as const).map((agent) => (
              <span
                key={agent}
                className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-900"
              >
                <span className="grid size-[18px] place-items-center overflow-hidden text-zinc-900">
                  <AgentLogo agent={agent} className="size-full object-contain" />
                </span>
                {agent === 'claude' ? 'Claude Code' : agent === 'codex' ? 'Codex' : 'Gemini'}
              </span>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <ActionButton
              icon={<Boxes size={15} />}
              label="Pack"
              active={activePanel === 'pack'}
              onClick={() => {
                setActivePanel((current) => (current === 'pack' ? null : 'pack'));
                setPackError(null);
                setPackResult(null);
              }}
            />
            <ActionButton
              icon={<Download size={15} />}
              label="Install"
              active={activePanel === 'install'}
              onClick={() => {
                setActivePanel((current) => (current === 'install' ? null : 'install'));
                setInstallError(null);
                setInstallResult(null);
              }}
            />
          </div>
        </header>

        {activePanel === 'pack' ? (
          <PanelShell
            title="Pack profile"
            description="Export an existing Brainctl profile into a portable tarball."
            onClose={() => setActivePanel(null)}
          >
            <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <div className="space-y-3">
                <label className="grid gap-2 text-sm">
                  <span className="font-medium text-zinc-800">Profile</span>
                  <select
                    className="min-h-11 rounded-2xl border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-400"
                    value={packProfileName}
                    onChange={(event) => setPackProfileName(event.target.value)}
                    disabled={profilesLoading || profiles.length === 0 || packBusy}
                  >
                    {profiles.length === 0 ? (
                      <option value="">No profiles found</option>
                    ) : null}
                    {profiles.map((profile) => (
                      <option key={profile} value={profile}>
                        {profile}{profile === activeProfile ? ' (active)' : ''}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-2 text-sm">
                  <span className="font-medium text-zinc-800">Output path</span>
                  <input
                    className="min-h-11 rounded-2xl border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-400"
                    placeholder="./my-profile.tar.gz"
                    value={packOutputPath}
                    onChange={(event) => setPackOutputPath(event.target.value)}
                    disabled={packBusy}
                  />
                </label>

                <div className="flex flex-wrap gap-2">
                  <button
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-zinc-950 px-5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
                    type="button"
                    onClick={() => void handlePack()}
                    disabled={packBusy || profiles.length === 0}
                  >
                    {packBusy ? <Loader2 size={15} className="animate-spin" /> : <Boxes size={15} />}
                    Export tarball
                  </button>
                  <button
                    className="inline-flex min-h-11 items-center justify-center rounded-full border border-zinc-200 px-5 text-sm font-medium text-zinc-900 transition hover:border-zinc-300"
                    type="button"
                    onClick={() => void loadProfiles()}
                    disabled={packBusy}
                  >
                    Refresh profiles
                  </button>
                </div>
              </div>

              <div className="rounded-3xl border border-zinc-200 bg-zinc-50 p-4">
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                  Available profiles
                </p>
                <div className="flex flex-wrap gap-2">
                  {profiles.length === 0 ? (
                    <span className="text-sm text-zinc-500">No profiles in this workspace yet.</span>
                  ) : (
                    profiles.map((profile) => (
                      <button
                        key={profile}
                        className={[
                          'rounded-full border px-3 py-1.5 text-sm transition',
                          packProfileName === profile
                            ? 'border-zinc-900 bg-zinc-900 text-white'
                            : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300',
                        ].join(' ')}
                        type="button"
                        onClick={() => setPackProfileName(profile)}
                      >
                        {profile}{profile === activeProfile ? ' · active' : ''}
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-3">
              {packResult ? <StatusNote tone="success">{packResult}</StatusNote> : null}
              {packError ? <StatusNote tone="error">{packError}</StatusNote> : null}
            </div>
          </PanelShell>
        ) : null}

        {activePanel === 'install' ? (
          <PanelShell
            title="Install profile"
            description="Import a packed profile archive and unpack bundled MCPs into the local Brainctl store."
            onClose={() => setActivePanel(null)}
          >
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(260px,0.85fr)]">
              <div className="space-y-3">
                <label className="grid gap-2 text-sm">
                  <span className="font-medium text-zinc-800">Archive path</span>
                  <input
                    className="min-h-11 rounded-2xl border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-400"
                    placeholder="/path/to/profile.tar.gz"
                    value={installArchivePath}
                    onChange={(event) => setInstallArchivePath(event.target.value)}
                    disabled={installBusy}
                  />
                </label>

                <label className="inline-flex items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-3 text-sm text-zinc-700">
                  <input
                    className="size-4 rounded border-zinc-300"
                    type="checkbox"
                    checked={installForce}
                    onChange={(event) => setInstallForce(event.target.checked)}
                    disabled={installBusy}
                  />
                  Overwrite an existing profile with the same name
                </label>

                <button
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-zinc-950 px-5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
                  type="button"
                  onClick={() => void handleInstall()}
                  disabled={installBusy}
                >
                  {installBusy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                  Import archive
                </button>
              </div>

              <div className="rounded-3xl border border-zinc-200 bg-zinc-50 p-4">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                  What happens
                </p>
                <ul className="grid gap-2 text-sm leading-6 text-zinc-600">
                  <li>Unpacks the tarball into the Brainctl profile store.</li>
                  <li>Installs bundled MCP dependencies when the package includes them.</li>
                  <li>Keeps the transfer board focused on local agent sync after import.</li>
                </ul>
              </div>
            </div>

            <div className="mt-4 grid gap-3">
              {installResult ? <StatusNote tone="success">{installResult}</StatusNote> : null}
              {installError ? <StatusNote tone="error">{installError}</StatusNote> : null}
            </div>
          </PanelShell>
        ) : null}

        <section className="rounded-[32px] border border-zinc-200 bg-white p-4 shadow-[0_20px_60px_rgba(0,0,0,0.05)] sm:p-5">
          <ProfilesView />
        </section>
      </div>
    </main>
  );
}
