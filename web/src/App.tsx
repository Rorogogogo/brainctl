import { useEffect, useState, type ReactNode } from 'react';
import { Bot, Boxes, Download, Loader2, X, ChevronDown } from 'lucide-react';

import { AgentLogo } from './agent-brand';
import ProfilesView from './ProfilesView';

interface ProfilesResponse {
  profiles: string[];
  activeProfile: string | null;
}

interface SkillPreview {
  description?: string;
  prompt: string;
}

interface ProfilePreview {
  name: string;
  description?: string;
  skills: Record<string, SkillPreview>;
  mcps: Record<string, { kind: 'local' | 'remote'; source?: 'npm' | 'bundled'; transport?: 'http' | 'sse' }>;
  memory: {
    paths: string[];
  };
}

interface AgentLivePreview {
  agent: 'claude' | 'codex' | 'gemini';
  exists: boolean;
  mcpServers: Record<string, { command: string; args?: string[] }>;
  remoteMcpServers: Record<string, { transport: 'http' | 'sse'; url: string }>;
  skills: Array<{ name: string; source?: string; kind?: 'skill' | 'plugin' }>;
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
  disabled,
  tooltip,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  tooltip?: string;
}) {
  return (
    <div className="relative group">
      <button
        className={[
          'inline-flex h-9 items-center gap-2 rounded-xl px-4 text-sm font-medium transition-all duration-200',
          disabled
            ? 'cursor-not-allowed border border-zinc-200 bg-white/60 text-zinc-400'
            : active
              ? 'bg-zinc-900 text-white shadow-sm'
              : 'border border-zinc-200 bg-white text-zinc-700 shadow-sm hover:bg-zinc-50 hover:text-zinc-900',
        ].join(' ')}
        type="button"
        onClick={disabled ? undefined : onClick}
        disabled={disabled}
        aria-disabled={disabled}
      >
        {icon}
        <span>{label}</span>
      </button>
      {disabled && tooltip ? (
        <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-zinc-900 px-2.5 py-1.5 text-[11px] font-medium text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">
          {tooltip}
        </span>
      ) : null}
    </div>
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
        'flex items-start gap-3 rounded-xl border px-4 py-3 text-sm transition-all',
        tone === 'success'
          ? 'border-zinc-200 bg-zinc-50 text-zinc-800'
          : 'border-red-200 bg-red-50 text-red-800',
      ].join(' ')}
    >
      <div className="mt-1">
        {tone === 'success' ? (
          <div className="size-2 rounded-full bg-zinc-500" />
        ) : (
          <div className="size-2 rounded-full bg-red-500" />
        )}
      </div>
      <div className="leading-relaxed">{children}</div>
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
    <div className="relative overflow-hidden rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm lg:p-8 mb-8">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div className="space-y-2">
          <h2 className="text-xl font-semibold tracking-tight text-zinc-900">{title}</h2>
          <p className="max-w-xl text-sm leading-relaxed text-zinc-500">{description}</p>
        </div>
        <button
          className="inline-flex size-8 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
          type="button"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      {children}
    </div>
  );
}

export default function App() {
  const packableAgents = ['claude', 'codex', 'gemini'] as const;
  const [activePanel, setActivePanel] = useState<ActionPanel>(null);
  const [profiles, setProfiles] = useState<string[]>([]);
  const [activeProfile, setActiveProfile] = useState<string | null>(null);
  const [profilesLoading, setProfilesLoading] = useState(true);

  const [packSource, setPackSource] = useState<'profile' | 'agent'>('profile');
  const [packProfileName, setPackProfileName] = useState('');
  const [packAgentName, setPackAgentName] = useState<(typeof packableAgents)[number]>('claude');
  const [packOutputPath, setPackOutputPath] = useState('');
  const [packBusy, setPackBusy] = useState(false);
  const [packResult, setPackResult] = useState<string | null>(null);
  const [packError, setPackError] = useState<string | null>(null);
  const [packPreviewLoading, setPackPreviewLoading] = useState(false);
  const [packPreviewError, setPackPreviewError] = useState<string | null>(null);
  const [packProfilePreview, setPackProfilePreview] = useState<ProfilePreview | null>(null);
  const [liveAgentConfigs, setLiveAgentConfigs] = useState<AgentLivePreview[]>([]);

  const [installArchivePath, setInstallArchivePath] = useState('');
  const [installCredentialsJson, setInstallCredentialsJson] = useState('');
  const [installForce, setInstallForce] = useState(false);
  const [installBusy, setInstallBusy] = useState(false);
  const [installResult, setInstallResult] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  useEffect(() => {
    void loadProfiles();
  }, []);

  useEffect(() => {
    if (activePanel !== 'pack') {
      return;
    }

    void loadPackPreview();
  }, [activePanel, packSource, packProfileName, packAgentName]);

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
    if (packSource === 'profile' && !packProfileName) {
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
          source:
            packSource === 'profile'
              ? { source: 'profile', name: packProfileName }
              : { source: 'agent', agent: packAgentName },
          name: packSource === 'profile' ? packProfileName : undefined,
          agent: packSource === 'agent' ? packAgentName : undefined,
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

    let credentials: Record<string, string> | undefined;
    if (installCredentialsJson.trim()) {
      try {
        const parsed = JSON.parse(installCredentialsJson) as Record<string, unknown>;
        credentials = Object.fromEntries(
          Object.entries(parsed).map(([key, value]) => {
            if (typeof value !== 'string' || value.trim().length === 0) {
              throw new Error(`Credential "${key}" must be a non-empty string.`);
            }
            return [key, value];
          })
        );
      } catch (error) {
        setInstallError(
          error instanceof Error
            ? error.message
            : 'Credential map must be valid JSON with string values.'
        );
        return;
      }
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
          credentials,
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

  async function loadPackPreview(): Promise<void> {
    setPackPreviewLoading(true);
    setPackPreviewError(null);

    try {
      if (packSource === 'profile') {
        if (!packProfileName) {
          setPackProfilePreview(null);
          return;
        }

        const profile = await fetchJson<ProfilePreview>(`/api/profiles/${encodeURIComponent(packProfileName)}`);
        setPackProfilePreview(profile);
        return;
      }

      const configs = await fetchJson<AgentLivePreview[]>('/api/agents/live');
      setLiveAgentConfigs(configs);
    } catch (error) {
      setPackPreviewError((error as Error).message);
      if (packSource === 'profile') {
        setPackProfilePreview(null);
      }
    } finally {
      setPackPreviewLoading(false);
    }
  }

  const packPanelTitle = packSource === 'profile' ? 'Pack profile' : 'Pack agent config';
  const packPanelDescription =
    packSource === 'profile'
      ? 'Export a saved Brainctl profile into a portable tarball.'
      : 'Export a live agent config into a portable tarball.';
  const selectedAgentPreview = liveAgentConfigs.find((config) => config.agent === packAgentName) ?? null;
  const selectedAgentSkillEntries = (selectedAgentPreview?.skills ?? []).filter((skill) => skill.kind !== 'plugin');
  const selectedAgentPluginEntries = (selectedAgentPreview?.skills ?? []).filter((skill) => skill.kind === 'plugin');
  const previewMcpEntries =
    packSource === 'profile'
      ? Object.entries(packProfilePreview?.mcps ?? {})
      : [
          ...Object.entries(selectedAgentPreview?.mcpServers ?? {}).map(([key, entry]) => [
            key,
            { label: entry.command, kind: 'local' as const },
          ]),
          ...Object.entries(selectedAgentPreview?.remoteMcpServers ?? {}).map(([key, entry]) => [
            key,
            { label: `${entry.transport} ${entry.url}`, kind: 'remote' as const },
          ]),
        ];
  const previewSkillEntries =
    packSource === 'profile'
      ? Object.entries(packProfilePreview?.skills ?? {}).map(([key, skill]) => ({
          key,
          label: skill.description ?? 'Skill',
        }))
      : selectedAgentSkillEntries.map((skill) => ({
          key: skill.name,
          label: skill.source ?? 'Skill',
        }));
  const previewPluginEntries =
    packSource === 'agent'
      ? selectedAgentPluginEntries.map((skill) => ({
          key: skill.name,
          label: skill.source ? `Plugin · ${skill.source}` : 'Plugin',
        }))
      : [];

  return (
    <main className="min-h-screen bg-[#fcfcfc] p-4 lg:p-6 text-zinc-900">
      <div className="mx-auto grid w-full gap-4">
        <header className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="grid size-7 place-items-center rounded-lg bg-zinc-900 text-white shadow-sm">
              <img src="/favicon-light.svg" alt="Brainctl Logo" className="size-3.5" />
            </div>
            <div>
              <h1 className="text-sm font-semibold tracking-tight leading-none">Brainctl</h1>
              <p className="text-[9px] font-medium text-zinc-500 leading-tight">Transfer Board</p>
            </div>
          </div>

          <div className="hidden lg:flex items-center gap-1.5">
            {(['claude', 'codex', 'gemini'] as const).map((agent) => (
              <span
                key={agent}
                className="inline-flex h-8 items-center gap-1.5 rounded-xl flex-none border border-zinc-200 bg-white px-3 text-[10px] font-medium text-zinc-600 shadow-sm"
              >
                <span className="grid size-3.5 place-items-center overflow-hidden text-zinc-900">
                  <AgentLogo agent={agent} className="size-full object-contain" />
                </span>
                {agent.charAt(0).toUpperCase() + agent.slice(1)}
              </span>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <ActionButton
              icon={<Boxes size={12} />}
              label="Pack"
              active={activePanel === 'pack'}
              onClick={() => {
                setActivePanel((current) => (current === 'pack' ? null : 'pack'));
                setPackError(null);
                setPackResult(null);
              }}
              disabled
              tooltip="Coming soon — still grinding on portable packs"
            />
            <ActionButton
              icon={<Download size={16} />}
              label="Install"
              active={activePanel === 'install'}
              onClick={() => {
                setActivePanel((current) => (current === 'install' ? null : 'install'));
                setInstallError(null);
                setInstallResult(null);
              }}
              disabled
              tooltip="Coming soon — portable install flow under construction"
            />
          </div>
        </header>

        <div className="w-full">
          {activePanel === 'pack' ? (
            <PanelShell
              title={packPanelTitle}
              description={packPanelDescription}
              onClose={() => setActivePanel(null)}
            >
              <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr]">
                <div className="space-y-6">
                  <label className="grid gap-2">
                    <span className="text-sm font-medium text-zinc-700">Pack source</span>
                    <div className="relative">
                      <select
                        className="h-10 w-full appearance-none rounded-xl border border-zinc-200 bg-white px-3 pr-10 text-sm outline-none transition-colors focus:border-zinc-400 disabled:opacity-50"
                        value={packSource}
                        onChange={(event) => setPackSource(event.target.value as 'profile' | 'agent')}
                        disabled={packBusy}
                      >
                        <option value="profile">Saved profile</option>
                        <option value="agent">Live agent config</option>
                      </select>
                      <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-zinc-400">
                        <ChevronDown size={16} />
                      </div>
                    </div>
                  </label>

                  {packSource === 'profile' ? (
                    <label className="grid gap-2">
                      <span className="text-sm font-medium text-zinc-700">Profile to export</span>
                      <div className="relative">
                        <select
                          className="h-10 w-full appearance-none rounded-xl border border-zinc-200 bg-white px-3 pr-10 text-sm outline-none transition-colors focus:border-zinc-400 disabled:opacity-50"
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
                        <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-zinc-400">
                          <ChevronDown size={16} />
                        </div>
                      </div>
                    </label>
                  ) : (
                    <label className="grid gap-2">
                      <span className="text-sm font-medium text-zinc-700">Agent to pack</span>
                      <div className="relative">
                        <select
                          className="h-10 w-full appearance-none rounded-xl border border-zinc-200 bg-white px-3 pr-10 text-sm outline-none transition-colors focus:border-zinc-400 disabled:opacity-50"
                          value={packAgentName}
                          onChange={(event) =>
                            setPackAgentName(event.target.value as (typeof packableAgents)[number])
                          }
                          disabled={packBusy}
                        >
                          {packableAgents.map((agent) => (
                            <option key={agent} value={agent}>
                              {agent}
                            </option>
                          ))}
                        </select>
                        <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-zinc-400">
                          <ChevronDown size={16} />
                        </div>
                      </div>
                    </label>
                  )}

                  <label className="grid gap-2">
                    <span className="text-sm font-medium text-zinc-700">Output path <span className="text-zinc-400">(optional)</span></span>
                    <input
                      className="h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none transition-colors placeholder:text-zinc-400 focus:border-zinc-400 disabled:opacity-50"
                      placeholder="./my-profile.tar.gz"
                      value={packOutputPath}
                      onChange={(event) => setPackOutputPath(event.target.value)}
                      disabled={packBusy}
                    />
                  </label>

                  <div className="flex gap-3 pt-2">
                    <button
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-zinc-900 px-6 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
                      type="button"
                      onClick={() => void handlePack()}
                      disabled={packBusy || (packSource === 'profile' && profiles.length === 0)}
                    >
                      {packBusy ? <Loader2 size={16} className="animate-spin" /> : <Boxes size={16} />}
                      Pack tarball
                    </button>
                    <button
                      className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50"
                      type="button"
                      onClick={() => void loadProfiles()}
                      disabled={packBusy}
                    >
                      Refresh
                    </button>
                  </div>
                </div>

                <div className="rounded-2xl border border-zinc-200 bg-zinc-50/50 p-6">
                  <p className="mb-4 text-xs font-medium text-zinc-500">Preview</p>
                  <div className="grid gap-4">
                    {packPreviewLoading ? (
                      <span className="text-sm text-zinc-500">Loading...</span>
                    ) : null}

                    {packPreviewError ? (
                      <span className="text-sm text-red-600">{packPreviewError}</span>
                    ) : null}

                    {!packPreviewLoading && !packPreviewError ? (
                      <div className="grid gap-4 text-sm text-zinc-900">
                        <div className="grid gap-1 rounded-xl border border-zinc-200 bg-white p-4">
                          {packSource === 'profile' && packProfilePreview ? (
                            <>
                              <span className="font-semibold">{packProfilePreview.name}</span>
                              <span className="text-zinc-600">{Object.keys(packProfilePreview.skills).length} skills</span>
                              <span className="text-zinc-600">{Object.keys(packProfilePreview.mcps).length} MCPs</span>
                            </>
                          ) : packSource === 'agent' && selectedAgentPreview ? (
                            <>
                              <span className="font-semibold">{selectedAgentPreview.agent}</span>
                              <span className="text-zinc-600">{Object.keys(selectedAgentPreview.mcpServers).length + Object.keys(selectedAgentPreview.remoteMcpServers).length} MCPs</span>
                              <span className="text-zinc-600">{selectedAgentSkillEntries.length} skills</span>
                            </>
                          ) : (
                            <span className="text-zinc-500">No preview available</span>
                          )}
                        </div>

                        {previewMcpEntries.length > 0 && (
                          <div className="grid gap-2 rounded-xl border border-zinc-200 bg-white p-4">
                            <span className="text-xs font-medium text-zinc-500">MCPs</span>
                            {previewMcpEntries.map(([key, value]) => (
                              <div key={key} className="flex flex-col gap-1 py-1">
                                <span className="font-medium text-zinc-900">{key}</span>
                                {'label' in value ? (
                                  <span className="text-xs text-zinc-500 truncate">{value.label}</span>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        )}

                        {previewSkillEntries.length > 0 && (
                          <div className="grid gap-2 rounded-xl border border-zinc-200 bg-white p-4">
                            <span className="text-xs font-medium text-zinc-500">Skills</span>
                            {previewSkillEntries.map((skill) => (
                              <div key={skill.key} className="flex flex-col gap-1 py-1">
                                <span className="font-medium text-zinc-900">{skill.key}</span>
                                <span className="text-xs text-zinc-500 truncate">{skill.label}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              {(packResult || packError) && (
                <div className="mt-8 grid gap-3">
                  {packResult ? <StatusNote tone="success">{packResult}</StatusNote> : null}
                  {packError ? <StatusNote tone="error">{packError}</StatusNote> : null}
                </div>
              )}
            </PanelShell>
          ) : null}

          {activePanel === 'install' ? (
            <PanelShell
              title="Install profile"
              description="Import a packed archive and unpack bundled MCPs into the local store."
              onClose={() => setActivePanel(null)}
            >
              <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr]">
                <div className="space-y-6">
                  <label className="grid gap-2">
                    <span className="text-sm font-medium text-zinc-700">Archive path</span>
                    <input
                      className="h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none transition-colors placeholder:text-zinc-400 focus:border-zinc-400 disabled:opacity-50"
                      placeholder="/path/to/profile.tar.gz"
                      value={installArchivePath}
                      onChange={(event) => setInstallArchivePath(event.target.value)}
                      disabled={installBusy}
                    />
                  </label>

                  <label className="grid gap-2">
                    <span className="text-sm font-medium text-zinc-700">Credentials JSON</span>
                    <textarea
                      className="min-h-[120px] w-full rounded-xl border border-zinc-200 bg-white p-3 text-sm outline-none transition-colors focus:border-zinc-400 disabled:opacity-50 font-mono text-zinc-700"
                      placeholder={`{\n  "token": "..."\n}`}
                      value={installCredentialsJson}
                      onChange={(event) => setInstallCredentialsJson(event.target.value)}
                      disabled={installBusy}
                    />
                  </label>

                  <label className="flex items-center gap-3">
                    <input
                      className="size-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                      type="checkbox"
                      checked={installForce}
                      onChange={(event) => setInstallForce(event.target.checked)}
                      disabled={installBusy}
                    />
                    <span className="text-sm font-medium text-zinc-700">Force overwrite existing profile</span>
                  </label>

                  <div className="pt-2">
                    <button
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-zinc-900 px-6 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50 w-full md:w-auto"
                      type="button"
                      onClick={() => void handleInstall()}
                      disabled={installBusy}
                    >
                      {installBusy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                      Import Archive
                    </button>
                  </div>
                </div>

                <div className="rounded-2xl border border-zinc-200 bg-zinc-50/50 p-6">
                  <p className="mb-4 text-xs font-medium text-zinc-500">Execution Path</p>
                  <ul className="grid gap-3 text-sm text-zinc-600">
                    <li className="flex items-center gap-2">
                      <span className="size-1.5 rounded-full bg-zinc-400"></span>
                      Unpacks archive to local store
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="size-1.5 rounded-full bg-zinc-400"></span>
                      Installs bundled dependencies
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="size-1.5 rounded-full bg-zinc-400"></span>
                      Prepares board for live sync
                    </li>
                  </ul>
                </div>
              </div>

              {(installResult || installError) && (
                <div className="mt-8 grid gap-3">
                  {installResult ? <StatusNote tone="success">{installResult}</StatusNote> : null}
                  {installError ? <StatusNote tone="error">{installError}</StatusNote> : null}
                </div>
              )}
            </PanelShell>
          ) : null}

          {activePanel === null ? (
            <section className="w-full pt-4">
              <ProfilesView />
            </section>
          ) : null}
        </div>
      </div>
    </main>
  );
}