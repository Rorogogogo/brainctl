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
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={[
        'inline-flex min-h-[36px] items-center gap-2 rounded-lg border px-3.5 text-sm font-medium transition-all duration-200',
        active
          ? 'border-zinc-900 bg-zinc-900 text-white shadow-sm'
          : 'border-zinc-200/80 bg-white text-zinc-600 shadow-sm hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900',
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
        'flex items-start gap-3 rounded-xl border px-4 py-3 text-sm transition-all',
        tone === 'success'
          ? 'border-emerald-200/80 bg-emerald-50/50 text-emerald-800'
          : 'border-red-200/80 bg-red-50/50 text-red-800',
      ].join(' ')}
    >
      <div className="mt-[3px]">
        {tone === 'success' ? (
          <div className="size-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" />
        ) : (
          <div className="size-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]" />
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
    <div className="relative overflow-hidden rounded-2xl border border-zinc-200/80 bg-white p-6 shadow-xl shadow-zinc-200/40 lg:p-8">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="h-px w-4 bg-zinc-300"></span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Action Panel</span>
          </div>
          <h2 className="text-xl font-semibold tracking-tight text-zinc-900">{title}</h2>
          <p className="max-w-xl text-sm leading-relaxed text-zinc-500">{description}</p>
        </div>
        <button
          className="inline-flex size-8 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-200"
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

  const packPanelTitle =
    packSource === 'profile' ? 'Pack profile' : 'Pack agent config';
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
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-zinc-950 sm:px-6 lg:px-8">
      <div className="mx-auto grid w-full max-w-[1400px] gap-6">
        <header className="flex flex-col gap-4 rounded-2xl border border-zinc-200/80 bg-white px-5 py-4 shadow-sm lg:flex-row lg:items-center lg:justify-between lg:px-6 lg:py-5">
          <div className="flex min-w-0 items-center gap-4">
            <div className="grid size-11 place-items-center rounded-xl bg-gradient-to-b from-zinc-800 to-zinc-950 text-white shadow-md">
              <Bot size={20} className="drop-shadow-sm" />
            </div>
            <div className="space-y-0.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Brainctl</p>
              <h1 className="text-[1.15rem] font-semibold tracking-tight text-zinc-900">Transfer Board</h1>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:justify-center">
            {(['claude', 'codex', 'gemini'] as const).map((agent) => (
              <span
                key={agent}
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-200/80 bg-zinc-50 px-2.5 py-1.5 text-[13px] font-medium text-zinc-700 shadow-sm transition-colors hover:bg-white"
              >
                <span className="grid size-[16px] place-items-center overflow-hidden text-zinc-900">
                  <AgentLogo agent={agent} className="size-full object-contain" />
                </span>
                {agent === 'claude' ? 'Claude' : agent === 'codex' ? 'Codex' : 'Gemini'}
              </span>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <ActionButton
              icon={<Boxes size={16} />}
              label="Pack"
              active={activePanel === 'pack'}
              onClick={() => {
                setActivePanel((current) => (current === 'pack' ? null : 'pack'));
                setPackError(null);
                setPackResult(null);
              }}
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
            />
          </div>
        </header>

        {activePanel === 'pack' ? (
          <PanelShell
            title={packPanelTitle}
            description={packPanelDescription}
            onClose={() => setActivePanel(null)}
          >
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="space-y-5">
                <label className="grid gap-2 text-sm">
                  <span className="font-semibold text-zinc-800">Pack source</span>
                  <div className="relative">
                    <select
                      className="min-h-[44px] w-full appearance-none rounded-xl border border-zinc-200 bg-white px-4 pr-10 text-sm font-medium text-zinc-900 shadow-sm outline-none transition-all focus:border-zinc-400 focus:ring-4 focus:ring-zinc-100 disabled:opacity-50"
                      value={packSource}
                      onChange={(event) => setPackSource(event.target.value as 'profile' | 'agent')}
                      disabled={packBusy}
                    >
                      <option value="profile">Saved Brainctl profile</option>
                      <option value="agent">Live agent config</option>
                    </select>
                    <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-zinc-400">
                      <ChevronDown size={16} />
                    </div>
                  </div>
                </label>

                {packSource === 'profile' ? (
                  <label className="grid gap-2 text-sm">
                    <span className="font-semibold text-zinc-800">Profile to export</span>
                    <div className="relative">
                      <select
                        className="min-h-[44px] w-full appearance-none rounded-xl border border-zinc-200 bg-white px-4 pr-10 text-sm font-medium text-zinc-900 shadow-sm outline-none transition-all focus:border-zinc-400 focus:ring-4 focus:ring-zinc-100 disabled:opacity-50"
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
                  <label className="grid gap-2 text-sm">
                    <span className="font-semibold text-zinc-800">Agent to pack</span>
                    <div className="relative">
                      <select
                        className="min-h-[44px] w-full appearance-none rounded-xl border border-zinc-200 bg-white px-4 pr-10 text-sm font-medium text-zinc-900 shadow-sm outline-none transition-all focus:border-zinc-400 focus:ring-4 focus:ring-zinc-100 disabled:opacity-50"
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

                <label className="grid gap-2 text-sm">
                  <span className="font-semibold text-zinc-800">Output path <span className="font-normal text-zinc-400">(optional)</span></span>
                  <input
                    className="min-h-[44px] w-full rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 shadow-sm outline-none transition-all placeholder:font-normal placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-4 focus:ring-zinc-100 disabled:opacity-50"
                    placeholder="./my-profile.tar.gz"
                    value={packOutputPath}
                    onChange={(event) => setPackOutputPath(event.target.value)}
                    disabled={packBusy}
                  />
                </label>

                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <button
                    className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-zinc-950 px-6 text-sm font-medium text-white shadow-md transition-all hover:bg-zinc-800 hover:shadow-lg active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
                    type="button"
                    onClick={() => void handlePack()}
                    disabled={packBusy || (packSource === 'profile' && profiles.length === 0)}
                  >
                    {packBusy ? <Loader2 size={16} className="animate-spin" /> : <Boxes size={16} />}
                    Pack tarball
                  </button>
                  <button
                    className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-zinc-200 bg-white px-5 text-sm font-medium text-zinc-700 shadow-sm transition-all hover:bg-zinc-50 hover:text-zinc-900 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
                    type="button"
                    onClick={() => void loadProfiles()}
                    disabled={packBusy}
                  >
                    Refresh profiles
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-zinc-200/60 bg-zinc-50/50 p-5">
                <p className="mb-4 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                  <span className="h-px w-3 bg-zinc-300"></span>
                  {packSource === 'profile' ? 'Pack Preview' : 'Pack Preview'}
                </p>
                <div className="grid gap-4">
                  <div className="flex flex-wrap gap-2.5">
                    {packSource === 'profile' && profiles.length === 0 ? (
                      <span className="text-sm text-zinc-500">No profiles in this workspace yet.</span>
                    ) : packSource === 'profile' ? (
                      profiles.map((profile) => (
                        <button
                          key={profile}
                          className={[
                            'rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-all duration-200',
                            packProfileName === profile
                              ? 'border-zinc-900 bg-zinc-900 text-white shadow-md'
                              : 'border-zinc-200 bg-white text-zinc-600 shadow-sm hover:border-zinc-300 hover:text-zinc-900',
                          ].join(' ')}
                          type="button"
                          onClick={() => setPackProfileName(profile)}
                        >
                          {profile}{profile === activeProfile ? ' (active)' : ''}
                        </button>
                      ))
                    ) : (
                      packableAgents.map((agent) => (
                        <button
                          key={agent}
                          className={[
                            'rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-all duration-200',
                            packAgentName === agent
                              ? 'border-zinc-900 bg-zinc-900 text-white shadow-md'
                              : 'border-zinc-200 bg-white text-zinc-600 shadow-sm hover:border-zinc-300 hover:text-zinc-900',
                          ].join(' ')}
                          type="button"
                          onClick={() => setPackAgentName(agent)}
                        >
                          {agent}
                        </button>
                      ))
                    )}
                  </div>

                  {packPreviewLoading ? (
                    <span className="text-sm text-zinc-500">Loading preview…</span>
                  ) : null}

                  {packPreviewError ? (
                    <span className="text-sm text-red-700">{packPreviewError}</span>
                  ) : null}

                  {!packPreviewLoading && !packPreviewError ? (
                    <div className="grid gap-4 text-sm text-zinc-700">
                      <div className="grid gap-1 rounded-lg border border-zinc-200 bg-white p-3">
                        <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">Summary</span>
                        {packSource === 'profile' && packProfilePreview ? (
                          <>
                            <span className="font-semibold text-zinc-900">{packProfilePreview.name}</span>
                            <span>{Object.keys(packProfilePreview.skills).length} skills</span>
                            <span>{Object.keys(packProfilePreview.mcps).length} MCPs</span>
                            <span>{packProfilePreview.memory.paths.length} memory paths</span>
                          </>
                        ) : packSource === 'agent' && selectedAgentPreview ? (
                          <>
                            <span className="font-semibold text-zinc-900">{selectedAgentPreview.agent}</span>
                            <span>{selectedAgentPreview.exists ? 'Live config found' : 'Live config not found'}</span>
                            <span>{Object.keys(selectedAgentPreview.mcpServers).length + Object.keys(selectedAgentPreview.remoteMcpServers).length} MCPs</span>
                            <span>{selectedAgentSkillEntries.length} skills</span>
                            <span>{selectedAgentPluginEntries.length} plugins</span>
                          </>
                        ) : (
                          <span>No preview available.</span>
                        )}
                      </div>

                      <div className="grid gap-2 rounded-lg border border-zinc-200 bg-white p-3">
                        <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">MCPs</span>
                        {previewMcpEntries.length === 0 ? (
                          <span className="text-zinc-500">No MCPs will be packed.</span>
                        ) : (
                          previewMcpEntries.map(([key, value]) => (
                            <div key={key} className="rounded-md border border-zinc-100 bg-zinc-50 px-3 py-2">
                              <div className="flex items-center justify-between gap-3">
                                <span className="font-medium text-zinc-900">{key}</span>
                                <span className="text-[11px] uppercase tracking-widest text-zinc-500">
                                  {'source' in value
                                    ? value.kind === 'local'
                                      ? value.source
                                      : value.transport
                                    : value.kind}
                                </span>
                              </div>
                              {'label' in value ? (
                                <div className="mt-1 text-[13px] text-zinc-500">{value.label}</div>
                              ) : null}
                            </div>
                          ))
                        )}
                      </div>

                      <div className="grid gap-2 rounded-lg border border-zinc-200 bg-white p-3">
                        <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">Skills</span>
                        {previewSkillEntries.length === 0 ? (
                          <span className="text-zinc-500">No skills will be packed.</span>
                        ) : (
                          previewSkillEntries.map((skill) => (
                            <div key={skill.key} className="rounded-md border border-zinc-100 bg-zinc-50 px-3 py-2">
                              <div className="font-medium text-zinc-900">{skill.key}</div>
                              <div className="mt-1 text-[13px] text-zinc-500">{skill.label}</div>
                            </div>
                          ))
                        )}
                      </div>

                      {packSource === 'agent' ? (
                        <div className="grid gap-2 rounded-lg border border-zinc-200 bg-white p-3">
                          <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">Plugins</span>
                          {previewPluginEntries.length === 0 ? (
                            <span className="text-zinc-500">No plugins discovered.</span>
                          ) : (
                            previewPluginEntries.map((plugin) => (
                              <div key={plugin.key} className="rounded-md border border-zinc-100 bg-zinc-50 px-3 py-2">
                                <div className="font-medium text-zinc-900">{plugin.key}</div>
                                <div className="mt-1 text-[13px] text-zinc-500">{plugin.label}</div>
                              </div>
                            ))
                          )}
                        </div>
                      ) : null}

                      {packSource === 'profile' && packProfilePreview ? (
                        <div className="grid gap-2 rounded-lg border border-zinc-200 bg-white p-3">
                          <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">Memory Paths</span>
                          {packProfilePreview.memory.paths.length === 0 ? (
                            <span className="text-zinc-500">No memory paths.</span>
                          ) : (
                            packProfilePreview.memory.paths.map((memoryPath) => (
                              <div key={memoryPath} className="rounded-md border border-zinc-100 bg-zinc-50 px-3 py-2 text-[13px] text-zinc-600">
                                {memoryPath}
                              </div>
                            ))
                          )}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            {(packResult || packError) && (
              <div className="mt-6 grid gap-3">
                {packResult ? <StatusNote tone="success">{packResult}</StatusNote> : null}
                {packError ? <StatusNote tone="error">{packError}</StatusNote> : null}
              </div>
            )}
          </PanelShell>
        ) : null}

        {activePanel === 'install' ? (
          <PanelShell
            title="Install profile"
            description="Import a packed profile archive and unpack bundled MCPs into the local Brainctl store."
            onClose={() => setActivePanel(null)}
          >
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)]">
              <div className="space-y-5">
                <label className="grid gap-2 text-sm">
                  <span className="font-semibold text-zinc-800">Archive path</span>
                  <input
                    className="min-h-[44px] w-full rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 shadow-sm outline-none transition-all placeholder:font-normal placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-4 focus:ring-zinc-100 disabled:opacity-50"
                    placeholder="/path/to/profile.tar.gz"
                    value={installArchivePath}
                    onChange={(event) => setInstallArchivePath(event.target.value)}
                    disabled={installBusy}
                  />
                </label>

                <label className="grid gap-2 text-sm">
                  <span className="font-semibold text-zinc-800">Credentials JSON</span>
                  <textarea
                    className="min-h-[112px] w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-zinc-900 shadow-sm outline-none transition-all placeholder:font-normal placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-4 focus:ring-zinc-100 disabled:opacity-50"
                    placeholder={`{\n  "github_token": "ghp_...",\n  "internal_api_key": "sk_..."\n}`}
                    value={installCredentialsJson}
                    onChange={(event) => setInstallCredentialsJson(event.target.value)}
                    disabled={installBusy}
                  />
                </label>

                <label className="inline-flex cursor-pointer items-start gap-3 rounded-xl border border-zinc-200/80 bg-zinc-50/50 p-4 transition-colors hover:bg-zinc-50">
                  <div className="flex h-5 items-center">
                    <input
                      className="size-[18px] rounded-[4px] border-zinc-300 text-zinc-900 shadow-sm transition focus:ring-zinc-900"
                      type="checkbox"
                      checked={installForce}
                      onChange={(event) => setInstallForce(event.target.checked)}
                      disabled={installBusy}
                    />
                  </div>
                  <div className="grid gap-1">
                    <span className="text-sm font-semibold text-zinc-900">Force overwrite</span>
                    <span className="text-[13px] leading-relaxed text-zinc-500">Replace an existing profile if it shares the same name.</span>
                  </div>
                </label>

                <div className="pt-2">
                  <button
                    className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-zinc-950 px-6 text-sm font-medium text-white shadow-md transition-all hover:bg-zinc-800 hover:shadow-lg active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
                    type="button"
                    onClick={() => void handleInstall()}
                    disabled={installBusy}
                  >
                    {installBusy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                    Import archive
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-zinc-200/60 bg-zinc-50/50 p-5">
                <p className="mb-4 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                  <span className="h-px w-3 bg-zinc-300"></span>
                  What happens
                </p>
                <ul className="grid gap-3 text-[13px] leading-relaxed text-zinc-600">
                  <li className="flex gap-2">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-zinc-400"></span>
                    Unpacks the tarball into the Brainctl profile store.
                  </li>
                  <li className="flex gap-2">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-zinc-400"></span>
                    Installs bundled MCP dependencies when the package includes them.
                  </li>
                  <li className="flex gap-2">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-zinc-400"></span>
                    Keeps the transfer board focused on local agent sync after import.
                  </li>
                </ul>
              </div>
            </div>

            {(installResult || installError) && (
              <div className="mt-6 grid gap-3">
                {installResult ? <StatusNote tone="success">{installResult}</StatusNote> : null}
                {installError ? <StatusNote tone="error">{installError}</StatusNote> : null}
              </div>
            )}
          </PanelShell>
        ) : null}

        {activePanel === null ? (
          <section className="rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-sm sm:p-6 lg:p-8">
            <ProfilesView />
          </section>
        ) : null}
      </div>
    </main>
  );
}
