export type ConnectionState = 'idle' | 'checking' | 'connecting' | 'connected' | 'disconnecting' | 'error';
export interface ProfileField { key: string; label: string; default?: string; placeholder?: string; options?: { label: string; value: string }[] }
export interface Profile { id: string; name: string; description: string; version: string; author: string; homepage: string; builtin: boolean; protocol: string; fields?: ProfileField[]; portalDiscovery?: { url: string }; archived?: boolean }
export interface Settings { profileId: string; username: string; rememberPassword: boolean; autoLaunch: boolean; autoConnect: boolean; autoReconnect: boolean; reconnectIntervalSeconds: number; minimizeToTray: boolean; appearance: 'classic' | 'liquid'; parameters: Record<string, string> }
export interface CredentialStatus { storage: 'encrypted' | 'session' | 'none'; available: boolean; needsRetry: boolean; message: string }
export interface CredentialInput { username: string; password: string; rememberPassword?: boolean }
export type OnboardingInput = { skip: true } | (CredentialInput & { reconnectIntervalSeconds: number });
export interface RequestDiagnostic { method: string; url: string; status?: number; statusText?: string; contentType?: string; durationMs: number; responseBody: string; truncated: boolean }
export interface LogEntry { id: string; time: string; level: 'info' | 'success' | 'warning' | 'error'; message: string; details?: { code: string; requests: RequestDiagnostic[] } }
export interface Snapshot { settings: Settings; hasPassword: boolean; credentialStatus: CredentialStatus; profiles: Profile[]; connection: { status: ConnectionState; message: string; monitoring: boolean; reconnectPaused?: boolean; portalUrl?: string; ip?: string; since?: string; checkedAt?: string; refreshing?: boolean; canDisconnect?: boolean }; logs: LogEntry[]; app: { version: string; platform: string; packaged: boolean; windowGlass: boolean; firstRun: boolean; secureStorage: boolean } }
export interface ConnectInput { profileId: string; username: string; password: string; rememberPassword: boolean; parameters: Record<string, string> }
export interface UpdateState { status: 'idle' | 'checking' | 'up-to-date' | 'available' | 'error'; currentVersion: string; latestVersion?: string; releaseUrl?: string; notes?: string; publishedAt?: string; checkedAt?: string; message?: string }
export interface CampusAPI {
  copyText(text: string): Promise<void>;
  getSnapshot(): Promise<Snapshot>;
  saveSettings(patch: Partial<Settings>): Promise<Snapshot>;
  setAppearance(value: 'classic' | 'liquid'): Promise<Snapshot>;
  saveCredentials(input: CredentialInput): Promise<Snapshot>;
  completeOnboarding(input: OnboardingInput): Promise<Snapshot>;
  retryCredentials(): Promise<Snapshot>;
  connect(input: ConnectInput): Promise<Snapshot>;
  disconnect(): Promise<Snapshot>;
  checkStatus(): Promise<Snapshot>;
  importProfile(): Promise<{ canceled: boolean; snapshot: Snapshot }>;
  removeProfile(id: string): Promise<Snapshot>;
  exportExample(kind?: 'http' | 'ruijie'): Promise<{ canceled: boolean; path?: string }>;
  exportDiagnostics(): Promise<{ canceled: boolean; path?: string }>;
  exportProfile(id: string): Promise<{ canceled: boolean; path?: string }>;
  getUpdateState(): Promise<UpdateState>;
  checkForUpdates(): Promise<UpdateState>;
  openRelease(): Promise<void>;
  onUpdate(callback: (state: UpdateState) => void): () => void;
  openPortal(profileId: string): Promise<void>;
  openUrl(url: string): Promise<void>;
  clearCredentials(): Promise<Snapshot>;
  windowAction(action: 'minimize' | 'maximize' | 'close'): Promise<void>;
  onSnapshot(callback: (snapshot: Snapshot) => void): () => void;
}
declare global { interface Window { campus?: CampusAPI } }
