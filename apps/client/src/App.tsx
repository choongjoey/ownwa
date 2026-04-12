import {
  createContext,
  startTransition,
  useContext,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type ReactNode
} from "react";
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams
} from "react-router-dom";
import {
  EmptyState,
  FeatureCard,
  Field,
  Icon,
  ImportProgressPanel,
  InfoTile,
  InlineAlert,
  LoadingScreen,
  StatCard,
  StatusPill
} from "./components/ui";
import { ImportModal } from "./features/imports/ImportModal";
import {
  clearImportRequest,
  createImportRequest,
  fetchImportRequest,
  retryImportRequest
} from "./features/imports/api";
import { getImportProgress } from "./features/imports/progress";
import { SettingsModal } from "./features/settings/SettingsModal";
import { api, logoutUser } from "./lib/api";
import {
  formatBytes,
  formatConversationCount,
  formatDateTime,
  formatRelativeChatTime,
  formatTime,
  getDateLabel,
  getInitials,
  humanizeKey
} from "./lib/format";
import type {
  AttachmentSummary,
  ChatDetail,
  ChatItem,
  ImportItem,
  MediaViewerItem,
  MessageItem,
  MessagePage,
  SearchResult,
  Settings,
  User
} from "./lib/types";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setUser: (user: User | null) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const IMPORT_POLL_MS = 3000;
const SEARCH_DEBOUNCE_MS = 180;
const MESSAGE_FOCUS_DELAY_MS = 120;
const CHAT_MESSAGES_PAGE_SIZE = 120;

function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}

function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const payload = await api<{ user: User | null }>("/api/auth/me");
      startTransition(() => {
        setUser(payload.user);
        setLoading(false);
      });
    } catch {
      startTransition(() => {
        setUser(null);
        setLoading(false);
      });
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        refresh,
        setUser
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

function AppShell({ children }: { children: ReactNode }) {
  const { loading } = useAuth();
  const location = useLocation();
  const isAuthRoute = location.pathname === "/login" || location.pathname === "/register";

  if (loading) {
    return <LoadingScreen label="Opening your archive..." fullScreen />;
  }

  return (
    <div className={isAuthRoute ? "min-h-screen px-4 py-6 sm:px-6 sm:py-8" : "min-h-screen p-3 sm:p-4 lg:p-5"}>
      {children}
    </div>
  );
}

function GuestRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return <LoadingScreen label="Checking session..." fullScreen />;
  }
  if (user) {
    return <Navigate to="/archive" replace />;
  }
  return <>{children}</>;
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return <LoadingScreen label="Checking session..." fullScreen />;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

function AuthPage({ mode }: { mode: "login" | "register" }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const { setUser } = useAuth();

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const payload = await api<{ user: User }>(`/api/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify({
          username,
          password
        })
      });
      setUser(payload.user);
      navigate("/archive");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to continue");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto grid min-h-[calc(100vh-3rem)] max-w-6xl items-center gap-6 lg:grid-cols-[1.06fr_0.94fr]">
      <section className="archive-card archive-card-strong flex min-h-[32rem] flex-col justify-between p-8 sm:p-10">
        <div className="space-y-8">
          <div className="inline-flex w-fit items-center rounded-full border border-[#d7d2c6] bg-white/72 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.28em] text-[#486a58]">
            OwnWA archive
          </div>
          <div className="space-y-4">
            <h1 className="max-w-xl text-4xl font-extrabold leading-[1.02] tracking-[-0.04em] text-[#18261d] sm:text-5xl">
              A WhatsApp archive that still feels like chat.
            </h1>
            <p className="max-w-xl text-base leading-7 text-[#5b665e]">
              Import manual exports, keep storage encrypted, and move through conversations in a calm,
              familiar messaging layout instead of a dashboard.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <FeatureCard
              title="Inline media"
              body="Photos, videos, GIFs, and stickers stay part of the transcript."
            />
            <FeatureCard
              title="Global search"
              body="Search messages, call history, and WhatsApp notices across every chat."
            />
            <FeatureCard
              title="Encrypted storage"
              body="Messages and blobs remain protected at rest with owner-scoped isolation."
            />
          </div>
        </div>
        <p className="max-w-lg text-sm leading-6 text-[#6d756f]">
          The archive viewer is optimized for long reading sessions, large imports, and familiar chat
          scanning.
        </p>
      </section>

      <section className="archive-card p-8 sm:p-10">
        <div className="mb-8">
          <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[#5d7c6d]">
            {mode === "login" ? "Welcome back" : "Create account"}
          </div>
          <h2 className="mt-3 text-3xl font-extrabold tracking-[-0.03em] text-[#1d241f]">
            {mode === "login" ? "Open your archive" : "Start a new archive"}
          </h2>
          <p className="mt-3 max-w-md text-sm leading-6 text-[#5f6862]">
            {mode === "login"
              ? "Sign in to browse your imported history."
              : "Choose a lowercase username and a password with at least eight characters."}
          </p>
        </div>

        <form className="space-y-5" onSubmit={(event) => void handleSubmit(event)}>
          <Field
            label="Username"
            value={username}
            onChange={setUsername}
            placeholder="joey"
            autoComplete="username"
          />
          <Field
            label="Password"
            value={password}
            onChange={setPassword}
            placeholder="••••••••"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
          />
          {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
          <button type="submit" disabled={submitting} className="archive-primary-button w-full">
            {submitting ? "Working..." : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>

        <p className="mt-6 text-sm text-[#5f6862]">
          {mode === "login" ? "Need an account?" : "Already have an account?"}{" "}
          <Link className="font-semibold text-[#27664f] underline-offset-4 hover:underline" to={mode === "login" ? "/register" : "/login"}>
            {mode === "login" ? "Register" : "Log in"}
          </Link>
        </p>
      </section>
    </div>
  );
}

function ArchiveWorkspace() {
  const { chatId } = useParams();
  const navigate = useNavigate();
  const { user, setUser } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [imports, setImports] = useState<ImportItem[]>([]);
  const [chats, setChats] = useState<ChatItem[]>([]);
  const [settings, setSettings] = useState<Settings>({ selfDisplayName: "" });
  const [settingsDraft, setSettingsDraft] = useState("");
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [activeChat, setActiveChat] = useState<ChatDetail | null>(null);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [messagePage, setMessagePage] = useState<MessagePage | null>(null);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [sidebarLoading, setSidebarLoading] = useState(true);
  const [chatLoading, setChatLoading] = useState(false);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [importActionId, setImportActionId] = useState<string | null>(null);
  const [importActionKind, setImportActionKind] = useState<"retry" | "clear" | null>(null);
  const [mediaViewerItem, setMediaViewerItem] = useState<MediaViewerItem | null>(null);
  const [renamingChat, setRenamingChat] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const deferredQuery = useDeferredValue(searchQuery);
  const focusedMessageId = searchParams.get("message");
  const trimmedSearchQuery = searchQuery.trim();

  const loadSidebarData = async (keepError = false) => {
    try {
      const [importsPayload, chatsPayload, settingsPayload] = await Promise.all([
        api<{ imports: ImportItem[] }>("/api/imports"),
        api<{ chats: ChatItem[] }>("/api/chats"),
        api<{ settings: Settings }>("/api/settings")
      ]);

      startTransition(() => {
        setImports(importsPayload.imports);
        setChats(chatsPayload.chats);
        setSettings(settingsPayload.settings);
        setSettingsDraft(settingsPayload.settings.selfDisplayName);
        setSidebarLoading(false);
        if (!keepError) {
          setError("");
        }
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load archive");
      setSidebarLoading(false);
    }
  };

  useEffect(() => {
    void loadSidebarData();
  }, []);

  useEffect(() => {
    if (!imports.some((item) => item.status === "pending" || item.status === "processing")) {
      return;
    }

    const interval = window.setInterval(() => {
      void loadSidebarData(true);
    }, IMPORT_POLL_MS);

    return () => window.clearInterval(interval);
  }, [imports]);

  useEffect(() => {
    if (!chatId) {
      setActiveChat(null);
      setMessages([]);
      setMessagePage(null);
      setLoadingOlderMessages(false);
      setRenamingChat(false);
      setTitleDraft("");
      return;
    }

    setChatLoading(true);

    const messageParams = new URLSearchParams({
      limit: String(CHAT_MESSAGES_PAGE_SIZE)
    });
    if (focusedMessageId) {
      messageParams.set("aroundMessageId", focusedMessageId);
    }

    void Promise.all([
      api<{ chat: ChatDetail }>(`/api/chats/${chatId}`),
      api<{ messages: MessageItem[]; page: MessagePage }>(`/api/chats/${chatId}/messages?${messageParams.toString()}`)
    ])
      .then(([chatPayload, messagePayload]) => {
        setActiveChat(chatPayload.chat);
        setMessages(messagePayload.messages);
        setMessagePage(messagePayload.page);
        setTitleDraft(chatPayload.chat.displayTitle);
      })
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "Unable to load chat");
        setActiveChat(null);
        setMessages([]);
        setMessagePage(null);
      })
      .finally(() => {
        setChatLoading(false);
      });
  }, [chatId, focusedMessageId]);

  useEffect(() => {
    const trimmedDeferredQuery = deferredQuery.trim();
    if (!trimmedDeferredQuery) {
      setSearchResults([]);
      return;
    }

    const timeout = window.setTimeout(() => {
      void api<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(trimmedDeferredQuery)}`)
        .then((payload) => setSearchResults(payload.results))
        .catch(() => setSearchResults([]));
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timeout);
  }, [deferredQuery]);

  const matchedChatIds = useMemo(() => new Set(searchResults.map((result) => result.chatId)), [searchResults]);
  const filteredChats = useMemo(() => {
    const normalizedQuery = trimmedSearchQuery.toLowerCase();
    if (!normalizedQuery) {
      return chats;
    }

    return [...chats]
      .filter((chat) => {
        const titleMatch =
          chat.displayTitle.toLowerCase().includes(normalizedQuery) ||
          chat.sourceTitle.toLowerCase().includes(normalizedQuery);
        return titleMatch || matchedChatIds.has(chat.id);
      })
      .sort((left, right) => {
        const leftScore =
          Number(matchedChatIds.has(left.id)) * 2 + Number(left.displayTitle.toLowerCase().includes(normalizedQuery));
        const rightScore =
          Number(matchedChatIds.has(right.id)) * 2 + Number(right.displayTitle.toLowerCase().includes(normalizedQuery));
        if (leftScore !== rightScore) {
          return rightScore - leftScore;
        }
        return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
      });
  }, [chats, matchedChatIds, trimmedSearchQuery]);

  const summary = useMemo(
    () => ({
      chatCount: chats.length,
      importCount: imports.length,
      messageCount: chats.reduce((sum, chat) => sum + chat.messageCount, 0),
      attachmentCount: chats.reduce((sum, chat) => sum + chat.attachmentCount, 0)
    }),
    [chats, imports]
  );

  const activeImports = imports.filter((item) => item.status === "pending" || item.status === "processing");
  const activeImportCount = activeImports.length;

  const resetImportSelection = () => {
    setFile(null);
    setDragActive(false);
    setFileInputKey((current) => current + 1);
  };

  const closeMessageFocus = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("message");
    setSearchParams(next, { replace: true });
  };

  const clearSearch = () => {
    setSearchQuery("");
    setSearchResults([]);
  };

  const openChat = (nextChatId: string) => {
    clearSearch();
    closeMessageFocus();
    navigate(`/chats/${nextChatId}`);
  };

  const closeImportModal = () => {
    if (uploading) {
      return;
    }
    setImportModalOpen(false);
    resetImportSelection();
  };

  const openSettingsModal = () => {
    setSettingsDraft(settings.selfDisplayName);
    setError("");
    setSettingsModalOpen(true);
  };

  const closeSettingsModal = () => {
    if (settingsSaving) {
      return;
    }
    setSettingsDraft(settings.selfDisplayName);
    setSettingsModalOpen(false);
  };

  const handleLogout = async () => {
    await logoutUser(navigate, setUser);
  };

  const submitImport = async () => {
    if (!file) {
      setError("Pick a .txt or .zip export first");
      return;
    }

    setUploading(true);
    setError("");

    try {
      await createImportRequest(file);
      resetImportSelection();
      setImportModalOpen(false);
      await loadSidebarData(true);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleRetryImport = async (importId: string) => {
    setImportActionId(importId);
    setImportActionKind("retry");
    setError("");

    try {
      await retryImportRequest(importId);
      await loadSidebarData(true);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Unable to retry import");
    } finally {
      setImportActionId(null);
      setImportActionKind(null);
    }
  };

  const handleClearImport = async (importId: string) => {
    const confirmed = window.confirm("Clear this failed import and remove its saved source file?");
    if (!confirmed) {
      return;
    }

    setImportActionId(importId);
    setImportActionKind("clear");
    setError("");

    try {
      await clearImportRequest(importId);
      await loadSidebarData(true);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Unable to clear import");
    } finally {
      setImportActionId(null);
      setImportActionKind(null);
    }
  };

  const handleSaveSettings = async (event: FormEvent) => {
    event.preventDefault();
    setSettingsSaving(true);
    setError("");

    try {
      const payload = await api<{ settings: Settings }>("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({
          selfDisplayName: settingsDraft
        })
      });
      setSettings(payload.settings);
      setSettingsDraft(payload.settings.selfDisplayName);
      setSettingsModalOpen(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save settings");
    } finally {
      setSettingsSaving(false);
    }
  };

  const handleRenameChat = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeChat) {
      return;
    }

    try {
      const payload = await api<{ chat: ChatDetail }>(`/api/chats/${activeChat.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          displayTitle: titleDraft
        })
      });
      setActiveChat(payload.chat);
      setTitleDraft(payload.chat.displayTitle);
      setRenamingChat(false);
      await loadSidebarData(true);
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : "Unable to rename chat");
    }
  };

  const openSearchResult = (result: SearchResult) => {
    clearSearch();
    setSearchParams(new URLSearchParams({ message: result.id }));
    navigate(`/chats/${result.chatId}?message=${result.id}`);
  };

  const loadOlderMessages = async () => {
    if (!chatId || !messagePage?.hasOlder || messagePage.nextOlderOffset === null || loadingOlderMessages) {
      return;
    }

    setLoadingOlderMessages(true);
    try {
      const payload = await api<{ messages: MessageItem[]; page: MessagePage }>(
        `/api/chats/${chatId}/messages?limit=${CHAT_MESSAGES_PAGE_SIZE}&beforeOffset=${messagePage.nextOlderOffset}`
      );
      setMessages((current) => [...payload.messages, ...current]);
      setMessagePage(payload.page);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load older messages");
    } finally {
      setLoadingOlderMessages(false);
    }
  };

  const handleFileSelection = (event: ChangeEvent<HTMLInputElement>) => {
    setFile(event.target.files?.[0] || null);
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragActive(false);
    const droppedFile = event.dataTransfer.files?.[0];
    if (droppedFile) {
      setFile(droppedFile);
    }
  };

  if (sidebarLoading) {
    return <LoadingScreen label="Loading conversations..." fullScreen />;
  }

  return (
    <>
      <div className="grid gap-3 xl:grid-cols-[22rem_minmax(0,1fr)]">
        <aside className="archive-sidebar flex min-h-[42rem] flex-col overflow-hidden rounded-[2rem] border border-white/55 shadow-[0_26px_60px_rgba(50,45,31,0.12)] xl:h-[calc(100vh-2.5rem)]">
          <div className="border-b border-white/55 px-5 pb-4 pt-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-[2rem] font-extrabold tracking-[-0.06em] text-[#17241b]">OwnWA</h1>
                <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.28em] text-[#78817a]">
                  Digital curator
                </p>
              </div>
              <button className="archive-icon-button" onClick={() => void handleLogout()} title="Logout">
                <Icon name="logout" className="h-4 w-4" />
              </button>
            </div>

            <button
              className="mt-5 flex w-full items-center gap-3 rounded-[1.25rem] bg-white/70 p-3 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] transition hover:-translate-y-0.5 hover:bg-white/84 hover:shadow-[0_16px_28px_rgba(60,54,36,0.08)]"
              onClick={openSettingsModal}
              type="button"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#dce9df] text-sm font-bold uppercase text-[#275843]">
                {getInitials(user?.username || "U")}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-[#223128]">{user?.username}</div>
                    <div className="text-xs text-[#728078]">
                      {settings.selfDisplayName ? `Your name: ${settings.selfDisplayName}` : "Add your WhatsApp display name"}
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-[#eef2eb] px-2.5 py-1 text-[11px] font-semibold text-[#4f6959]">
                    {settings.selfDisplayName ? "Saved" : "Needed"}
                  </span>
                </div>
              </div>
            </button>

            <button className="archive-primary-button mt-5 w-full" onClick={() => setImportModalOpen(true)}>
              <Icon name="upload" className="h-4 w-4" />
              Import to OwnWA
            </button>

            <label className="archive-search-field mt-4 flex items-center gap-3">
              <Icon name="search" className="h-4 w-4 text-[#8d938d]" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search all chats and events..."
                className="w-full bg-transparent text-sm text-[#26312a] outline-none placeholder:text-[#8d938d]"
              />
            </label>
          </div>

          <div className="soft-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-4">
            <div>
              <div className="mb-3 flex items-center justify-between px-1">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#6c786e]">Chats</div>
                  <div className="mt-1 text-sm font-semibold text-[#1e2a22]">
                    {trimmedSearchQuery ? `${filteredChats.length} matches` : formatConversationCount(filteredChats.length)}
                  </div>
                </div>
                {trimmedSearchQuery ? (
                  <button
                    className="text-xs font-semibold text-[#426a54] underline-offset-4 hover:underline"
                    onClick={clearSearch}
                  >
                    Clear
                  </button>
                ) : null}
              </div>

              <div className="space-y-2 pb-1">
                {filteredChats.length === 0 ? (
                  <EmptyState
                    title="No matching chats"
                    body="Try a broader term or import another export to widen the archive."
                    compact
                  />
                ) : (
                  filteredChats.map((chat) => {
                    const active = chat.id === chatId;
                    const matchedBySearch = matchedChatIds.has(chat.id);

                    return (
                      <button
                        key={chat.id}
                        className={`w-full rounded-[1.35rem] px-3.5 py-3 text-left transition ${
                          active
                            ? "bg-[#dfe6de] shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_12px_24px_rgba(72,84,72,0.12)]"
                            : "bg-white/64 hover:bg-white/86"
                        }`}
                        onClick={() => openChat(chat.id)}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`archive-avatar ${active ? "bg-[#cae6d2] text-[#0d6630]" : ""}`}>
                            {getInitials(chat.displayTitle)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate text-[15px] font-bold text-[#1c241f]">{chat.displayTitle}</div>
                                <div className="mt-1 truncate text-[13px] text-[#728078]">
                                  {chat.lastMessageAt ? formatRelativeChatTime(chat.lastMessageAt) : "No timestamp yet"}
                                </div>
                              </div>
                              {matchedBySearch ? (
                                <span className="shrink-0 rounded-full bg-[#eaf4df] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#5d7b2a]">
                                  Match
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-[#6d786f]">
                              <span>{chat.messageCount.toLocaleString()} msgs</span>
                              <span>{chat.attachmentCount.toLocaleString()} media</span>
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </aside>

        <main className="archive-stage flex min-h-[42rem] flex-col overflow-hidden rounded-[2rem] border border-white/55 shadow-[0_28px_70px_rgba(45,41,28,0.12)] xl:h-[calc(100vh-2.5rem)]">
          {error ? (
            <div className="border-b border-[#e7d3d1] bg-[#fff5f3] px-5 py-3">
              <InlineAlert tone="error">{error}</InlineAlert>
            </div>
          ) : null}

          {trimmedSearchQuery ? (
            <SearchResultsPane
              query={searchQuery}
              results={searchResults}
              onOpenResult={openSearchResult}
              onPreviewMedia={(attachment, result) =>
                setMediaViewerItem({
                  attachment,
                  chatTitle: result.chatTitle,
                  sender: result.sender,
                  timestamp: result.timestamp
                })
              }
            />
          ) : chatLoading ? (
            <LoadingScreen label="Loading chat..." />
          ) : activeChat ? (
            <ChatPane
              chat={activeChat}
              messages={messages}
              messagePage={messagePage}
              loadingOlderMessages={loadingOlderMessages}
              focusedMessageId={focusedMessageId}
              renamingChat={renamingChat}
              titleDraft={titleDraft}
              onTitleDraftChange={setTitleDraft}
              onStartRenaming={() => setRenamingChat(true)}
              onCancelRenaming={() => {
                setRenamingChat(false);
                setTitleDraft(activeChat.displayTitle);
              }}
              onSubmitRename={handleRenameChat}
              onPreviewMedia={(attachment, message) =>
                setMediaViewerItem({
                  attachment,
                  chatTitle: activeChat.displayTitle,
                  sender: message.sender,
                  timestamp: message.timestamp
                })
              }
              onLoadOlderMessages={loadOlderMessages}
            />
          ) : (
            <EmptyTranscriptState imports={imports} chats={chats} />
          )}
        </main>
      </div>

      {importModalOpen ? (
        <ImportModal
          file={file}
          imports={imports}
          summary={summary}
          uploading={uploading}
          dragActive={dragActive}
          fileInputKey={fileInputKey}
          activeImportCount={activeImportCount}
          onClose={closeImportModal}
          onFileChange={handleFileSelection}
          onDrop={handleDrop}
          onDragStateChange={setDragActive}
          importActionId={importActionId}
          importActionKind={importActionKind}
          onRetryImport={(importId) => void handleRetryImport(importId)}
          onClearImport={(importId) => void handleClearImport(importId)}
          onSubmit={() => void submitImport()}
        />
      ) : null}

      {settingsModalOpen ? (
        <SettingsModal
          username={user?.username || ""}
          value={settingsDraft}
          savedValue={settings.selfDisplayName}
          saving={settingsSaving}
          onChange={setSettingsDraft}
          onClose={closeSettingsModal}
          onSubmit={(event) => void handleSaveSettings(event)}
        />
      ) : null}

      {mediaViewerItem ? <MediaViewer item={mediaViewerItem} onClose={() => setMediaViewerItem(null)} /> : null}
    </>
  );
}

function SearchResultsPane({
  query,
  results,
  onOpenResult,
  onPreviewMedia
}: {
  query: string;
  results: SearchResult[];
  onOpenResult: (result: SearchResult) => void;
  onPreviewMedia: (attachment: AttachmentSummary, result: SearchResult) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-white/60 bg-white/72 px-5 py-4 sm:px-6">
        <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[#557464]">Global search</div>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-[1.85rem] font-extrabold tracking-[-0.04em] text-[#17211b]">
              Results for "{query.trim()}"
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#65716a]">
              Matches include normal messages, call history, and historical WhatsApp notices.
            </p>
          </div>
          <span className="rounded-full bg-[#edf2eb] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-[#4e6858]">
            {results.length} hits
          </span>
        </div>
      </div>

      <div className="archive-wallpaper soft-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        {results.length === 0 ? (
          <EmptyState
            title="No results yet"
            body="Try a broader search term, a contact name, or import more chats into the archive."
          />
        ) : (
          <div className="space-y-4">
            {results.map((result) => (
              <button
                key={`${result.chatId}-${result.id}`}
                className="archive-panel w-full p-4 text-left transition hover:-translate-y-0.5 hover:shadow-[0_18px_34px_rgba(63,56,41,0.1)]"
                onClick={() => onOpenResult(result)}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#5f7468]">{result.chatTitle}</div>
                    <div className="mt-2 text-sm font-semibold text-[#1c241f]">
                      {result.messageKind === "event" ? "Historical event" : result.sender}
                    </div>
                  </div>
                  <div className="text-xs text-[#738078]">
                    {result.timestamp ? formatDateTime(result.timestamp) : result.rawTimestampLabel}
                  </div>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-[#445048]">{result.body}</p>
                {result.attachments.length > 0 ? (
                  <div className="mt-4 flex flex-wrap gap-3">
                    {result.attachments.slice(0, 3).map((attachment) => (
                      <AttachmentPreview
                        key={attachment.id}
                        attachment={attachment}
                        compact
                        onOpen={() => onPreviewMedia(attachment, result)}
                      />
                    ))}
                  </div>
                ) : null}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ChatPane({
  chat,
  messages,
  messagePage,
  loadingOlderMessages,
  focusedMessageId,
  renamingChat,
  titleDraft,
  onTitleDraftChange,
  onStartRenaming,
  onCancelRenaming,
  onSubmitRename,
  onPreviewMedia,
  onLoadOlderMessages
}: {
  chat: ChatDetail;
  messages: MessageItem[];
  messagePage: MessagePage | null;
  loadingOlderMessages: boolean;
  focusedMessageId: string | null;
  renamingChat: boolean;
  titleDraft: string;
  onTitleDraftChange: (value: string) => void;
  onStartRenaming: () => void;
  onCancelRenaming: () => void;
  onSubmitRename: (event: FormEvent) => void;
  onPreviewMedia: (attachment: AttachmentSummary, message: MessageItem) => void;
  onLoadOlderMessages: () => Promise<void>;
}) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const prependAnchorHeightRef = useRef<number | null>(null);
  const initialScrollHandledRef = useRef(false);

  useEffect(() => {
    initialScrollHandledRef.current = false;
    prependAnchorHeightRef.current = null;
  }, [chat.id, focusedMessageId]);

  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || messages.length === 0) {
      return;
    }

    if (prependAnchorHeightRef.current !== null) {
      const previousHeight = prependAnchorHeightRef.current;
      prependAnchorHeightRef.current = null;
      container.scrollTop += container.scrollHeight - previousHeight;
      return;
    }

    if (!initialScrollHandledRef.current) {
      initialScrollHandledRef.current = true;
      if (focusedMessageId) {
        window.setTimeout(() => {
          document.getElementById(`message-${focusedMessageId}`)?.scrollIntoView({
            behavior: "smooth",
            block: "center"
          });
        }, MESSAGE_FOCUS_DELAY_MS);
      } else {
        container.scrollTop = container.scrollHeight;
      }
    }
  }, [chat.id, focusedMessageId, messages]);

  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (!container || loadingOlderMessages || !messagePage?.hasOlder || container.scrollTop > 220) {
      return;
    }
    prependAnchorHeightRef.current = container.scrollHeight;
    void onLoadOlderMessages();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-white/60 bg-white/72 px-4 py-4 sm:px-6">
        {renamingChat ? (
          <form className="flex flex-col gap-3 lg:flex-row lg:items-end" onSubmit={(event) => void onSubmitRename(event)}>
            <label className="flex-1 space-y-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#557464]">Rename chat</span>
              <input
                value={titleDraft}
                onChange={(event) => onTitleDraftChange(event.target.value)}
                placeholder={chat.sourceTitle}
                className="archive-input w-full"
              />
            </label>
            <div className="flex gap-2">
              <button type="submit" className="archive-primary-button">
                Save
              </button>
              <button type="button" onClick={onCancelRenaming} className="archive-secondary-button">
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div className="archive-avatar h-12 w-12 bg-[#dceadd] text-[#1b6240]">{getInitials(chat.displayTitle)}</div>
              <div className="min-w-0">
                <div className="truncate text-[1.3rem] font-extrabold tracking-[-0.04em] text-[#17211b]">
                  {chat.displayTitle}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[#6b776f]">
                  <span>{chat.stats.messageCount.toLocaleString()} messages</span>
                  <span>{chat.stats.attachmentMessageCount.toLocaleString()} with media</span>
                  {chat.titleOverridden ? <span>Source: {chat.sourceTitle}</span> : null}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[#eef3ed] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-[#566d5f]">
                Updated {formatDateTime(chat.updatedAt)}
              </span>
              <button className="archive-secondary-button" onClick={onStartRenaming}>
                <Icon name="edit" className="h-4 w-4" />
                Rename
              </button>
            </div>
          </div>
        )}
      </div>

      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="archive-wallpaper soft-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-5 sm:px-5"
      >
        <div className="mx-auto flex max-w-5xl flex-col gap-1">
          {messagePage?.hasOlder ? (
            <div className="mb-4 flex justify-center">
              <button
                className="rounded-full bg-[#f4f3ed] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#66746d] shadow-[0_10px_22px_rgba(93,84,66,0.07)]"
                onClick={() => void onLoadOlderMessages()}
                disabled={loadingOlderMessages}
              >
                {loadingOlderMessages ? "Loading older messages..." : "Load older messages"}
              </button>
            </div>
          ) : null}

          {messages.map((message, index) => {
            const previous = messages[index - 1];
            const currentDateLabel = getDateLabel(message);
            const previousDateLabel = previous ? getDateLabel(previous) : null;
            const showDate = currentDateLabel !== previousDateLabel;
            const showSender =
              message.messageKind === "message" &&
              !message.isMe &&
              (!previous || previous.sender !== message.sender || previous.messageKind === "event");
            const isFocused = focusedMessageId === message.id;

            return (
              <div key={message.id} id={`message-${message.id}`}>
                {showDate ? (
                  <div className="my-5 flex justify-center">
                    <span className="rounded-full bg-[#f5f4ef] px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-[#8a8e86] shadow-[0_8px_18px_rgba(93,84,66,0.07)]">
                      {currentDateLabel}
                    </span>
                  </div>
                ) : null}

                {message.messageKind === "event" ? (
                  <div className="my-3 flex justify-center">
                    <div
                      className={`max-w-xl rounded-full bg-[#f0efe8] px-4 py-2 text-center text-sm text-[#6a726d] shadow-[0_6px_16px_rgba(91,84,67,0.07)] ${
                        isFocused ? "ring-2 ring-[#e5bc6b]" : ""
                      }`}
                    >
                      {message.body}
                    </div>
                  </div>
                ) : (
                  <div className={`flex ${message.isMe ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`message-bubble-shadow max-w-[90%] rounded-[1.45rem] px-4 py-3 sm:max-w-[72%] ${
                        message.isMe
                          ? "bg-[#d7f3dc] text-[#183120]"
                          : "bg-[#fffdf7] text-[#1e2722]"
                      } ${isFocused ? "ring-2 ring-[#e5bc6b]" : ""}`}
                    >
                      {showSender ? (
                        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#9b5d2c]">
                          {message.sender}
                        </div>
                      ) : null}

                      {shouldRenderMessageBody(message) ? (
                        <div className="whitespace-pre-wrap text-[15px] leading-7">{message.body}</div>
                      ) : null}

                      {message.attachments.length > 0 ? (
                        <div className={`${shouldRenderMessageBody(message) ? "mt-3" : ""} space-y-3`}>
                          {message.attachments.map((attachment) => (
                            <AttachmentPreview
                              key={attachment.id}
                              attachment={attachment}
                              onOpen={() => onPreviewMedia(attachment, message)}
                            />
                          ))}
                        </div>
                      ) : null}

                      <div className="mt-2 flex items-center justify-end gap-1.5 text-[11px] text-[#748078]">
                        <span>{message.timestamp ? formatTime(message.timestamp) : message.rawTimestampLabel}</span>
                        {message.isMe ? <Icon name="check" className="h-3.5 w-3.5 text-[#1d7f43]" /> : null}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {messagePage?.hasNewer && focusedMessageId ? (
            <div className="mt-5 flex justify-center">
              <span className="rounded-full bg-[#f4f3ed] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#66746d] shadow-[0_10px_22px_rgba(93,84,66,0.07)]">
                Opened around the selected result
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function EmptyTranscriptState({
  imports,
  chats
}: {
  imports: ImportItem[];
  chats: ChatItem[];
}) {
  const completedImports = imports.filter((item) => item.status === "completed").length;

  return (
    <div className="archive-wallpaper flex h-full min-h-[32rem] items-center justify-center px-6 py-12">
      <div className="archive-card archive-card-strong max-w-3xl p-8 text-center sm:p-10">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-[#eef2eb] text-[#5d6f63]">
          <Icon name="archive" className="h-10 w-10" />
        </div>
        <div className="mt-6 text-[11px] font-semibold uppercase tracking-[0.3em] text-[#5f7768]">
          Archive workspace
        </div>
        <h2 className="mt-3 text-3xl font-extrabold tracking-[-0.04em] text-[#17211b] sm:text-[2.35rem]">
          Select a conversation and read it like a real chat.
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-[#66736b]">
          OwnWA keeps the familiar WhatsApp rhythm: conversation list on the left, transcript on the
          right, inline media in context, and historical notices rendered as centered event bubbles.
        </p>

        <div className="mt-8 grid gap-3 text-left sm:grid-cols-3">
          <StatCard label="Chats" value={chats.length.toLocaleString()} />
          <StatCard label="Imports" value={imports.length.toLocaleString()} />
          <StatCard label="Completed" value={completedImports.toLocaleString()} />
        </div>

        <div className="mt-6 grid gap-3 text-left sm:grid-cols-2">
          <InfoTile
            title="Search across all chats"
            body="Use the sidebar search field to match contacts, message bodies, call events, and archive notices."
          />
          <InfoTile
            title="Import more history"
            body="The sidebar import button opens a guided modal for .txt and .zip WhatsApp exports."
          />
        </div>
      </div>
    </div>
  );
}

function ImportDetailPage() {
  const { id } = useParams();
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [item, setItem] = useState<ImportItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [action, setAction] = useState<"retry" | "clear" | null>(null);

  const loadImport = async (keepError = false) => {
    if (!id) {
      setLoading(false);
      setError("Import not found");
      return;
    }

    try {
      const nextItem = await fetchImportRequest(id);
      setItem(nextItem);
      setLoading(false);
      if (!keepError) {
        setError("");
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load import");
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadImport();
  }, [id]);

  useEffect(() => {
    if (!id || (item?.status !== "pending" && item?.status !== "processing")) {
      return;
    }

    const interval = window.setInterval(() => {
      void loadImport(true);
    }, IMPORT_POLL_MS);

    return () => window.clearInterval(interval);
  }, [id, item?.status]);

  const handleLogout = async () => {
    await logoutUser(navigate, setUser);
  };

  const handleRetry = async () => {
    if (!id) {
      return;
    }

    setAction("retry");
    setError("");
    try {
      const nextItem = await retryImportRequest(id);
      setItem(nextItem);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Unable to retry import");
    } finally {
      setAction(null);
    }
  };

  const handleClear = async () => {
    if (!id) {
      return;
    }
    const confirmed = window.confirm("Clear this failed import and remove its saved source file?");
    if (!confirmed) {
      return;
    }

    setAction("clear");
    setError("");
    try {
      await clearImportRequest(id);
      navigate("/archive");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Unable to clear import");
      setAction(null);
    }
  };

  if (loading) {
    return <LoadingScreen label="Loading import..." fullScreen />;
  }

  if (error || !item) {
    return (
      <div className="mx-auto max-w-3xl">
        <InlineAlert tone="error">{error || "Import not found"}</InlineAlert>
      </div>
    );
  }

  const importProgress = getImportProgress(item);
  const isImportActive = item.status === "pending" || item.status === "processing";

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="archive-card flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <Link to="/archive" className="inline-flex items-center gap-2 text-sm font-semibold text-[#295f49]">
          <Icon name="arrow-left" className="h-4 w-4" />
          Back to archive
        </Link>
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-[#eef2eb] px-3 py-1.5 text-sm font-semibold text-[#456452]">
            {user?.username}
          </span>
          <button className="archive-secondary-button" onClick={() => void handleLogout()}>
            <Icon name="logout" className="h-4 w-4" />
            Logout
          </button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1.08fr]">
        <section className="archive-card p-6 sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[#63796b]">Import detail</div>
              <h2 className="mt-3 text-3xl font-extrabold tracking-[-0.04em] text-[#17211b]">{item.chatTitle}</h2>
              <p className="mt-3 text-sm leading-6 text-[#65716a]">{item.fileName}</p>
            </div>
            <StatusPill status={item.status} />
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <StatCard label="Source size" value={formatBytes(item.sourceSize)} />
            <StatCard label="Updated" value={formatDateTime(item.updatedAt)} />
            <StatCard label="Created" value={formatDateTime(item.createdAt)} />
            <StatCard label="Completed" value={item.completedAt ? formatDateTime(item.completedAt) : "Pending"} />
          </div>

          {item.errorMessage ? (
            <div className="mt-5">
              <InlineAlert tone="error">{item.errorMessage}</InlineAlert>
            </div>
          ) : null}

          {isImportActive && importProgress ? <ImportProgressPanel progress={importProgress} /> : null}

          {item.status === "failed" ? (
            <div className="mt-5 rounded-[1.4rem] border border-[#ecd8cf] bg-[#fff8f4] p-4">
              <div className="text-sm font-semibold text-[#6e4636]">Keep the saved file and decide what to do next.</div>
              <p className="mt-2 text-sm leading-6 text-[#816456]">
                Retry uses the encrypted source already stored on the server, and clear removes the failed record plus
                that saved source file.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <button className="archive-primary-button" disabled={action !== null} onClick={() => void handleRetry()}>
                  {action === "retry" ? "Retrying..." : "Retry import"}
                </button>
                <button className="archive-secondary-button" disabled={action !== null} onClick={() => void handleClear()}>
                  {action === "clear" ? "Clearing..." : "Clear failed import"}
                </button>
              </div>
            </div>
          ) : null}
        </section>

        <section className="archive-card p-6 sm:p-7">
          <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[#63796b]">Parse summary</div>
          <h3 className="mt-3 text-2xl font-extrabold tracking-[-0.04em] text-[#17211b]">What the worker extracted</h3>
          <p className="mt-3 text-sm leading-6 text-[#67736c]">
            Uploads are encrypted, parsed, deduplicated, and indexed before they appear in the archive.
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {Object.entries(item.parseSummary || {}).length === 0 ? (
              <EmptyState
                title="No summary yet"
                body="The summary appears once processing finishes and the normalized records are stored."
              />
            ) : (
              Object.entries(item.parseSummary).map(([key, value]) => (
                <StatCard key={key} label={humanizeKey(key)} value={String(value)} />
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function MediaViewer({
  item,
  onClose
}: {
  item: MediaViewerItem;
  onClose: () => void;
}) {
  const { attachment } = item;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#111612]/88 p-4 backdrop-blur-md">
      <button className="archive-icon-button absolute right-5 top-5 text-white" onClick={onClose}>
        <Icon name="close" className="h-4 w-4" />
      </button>

      <div className="flex max-h-full w-full max-w-6xl flex-col gap-4 rounded-[2rem] border border-white/10 bg-black/25 p-4 shadow-[0_38px_80px_rgba(0,0,0,0.45)]">
        <div className="flex flex-wrap items-center justify-between gap-3 text-white/85">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.28em] text-white/55">{item.chatTitle}</div>
            <div className="mt-2 text-sm text-white/82">
              {item.sender}
              {item.timestamp ? ` · ${formatDateTime(item.timestamp)}` : ""}
            </div>
          </div>
          <a
            href={attachment.contentUrl || undefined}
            target="_blank"
            rel="noreferrer"
            className="archive-secondary-button border-white/15 bg-white/10 text-white hover:bg-white/16"
          >
            Open original
          </a>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[1.5rem] bg-black/35">
          {attachment.mediaKind === "video" && attachment.contentUrl ? (
            <video
              className="max-h-[78vh] w-full rounded-[1.2rem] bg-black object-contain"
              src={attachment.contentUrl}
              controls
              autoPlay
              playsInline
            />
          ) : attachment.previewUrl ? (
            <img
              className={`max-h-[78vh] w-full rounded-[1.2rem] object-contain ${
                attachment.mediaKind === "sticker" ? "bg-[radial-gradient(circle_at_center,_rgba(255,255,255,0.12),_transparent_60%)]" : ""
              }`}
              src={attachment.previewUrl}
              alt={attachment.fileName}
            />
          ) : (
            <div className="p-8 text-center text-white/76">{attachment.fileName}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function AttachmentPreview({
  attachment,
  onOpen,
  compact = false
}: {
  attachment: AttachmentSummary;
  onOpen: () => void;
  compact?: boolean;
}) {
  if (!attachment.hasBlob || !attachment.contentUrl) {
    return (
      <a
        className="inline-flex items-center gap-2 rounded-[1rem] border border-[#d8ddd4] bg-[#f6f6f1] px-3 py-2 text-xs font-semibold text-[#435048]"
        href={attachment.contentUrl || undefined}
        target="_blank"
        rel="noreferrer"
      >
        <Icon name="file" className="h-4 w-4" />
        {attachment.placeholderText || attachment.fileName}
      </a>
    );
  }

  if (attachment.mediaKind === "video") {
    return (
      <button
        className={`group block overflow-hidden rounded-[1.25rem] border border-[#d5dbd1] bg-[#14211a] text-left ${
          compact ? "w-40" : "w-full max-w-sm"
        }`}
        onClick={onOpen}
      >
        <div className="relative">
          <video
            className={`w-full object-cover ${compact ? "h-24" : "max-h-72 min-h-44"}`}
            src={attachment.contentUrl}
            muted
            playsInline
            preload="metadata"
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm">
              <Icon name="play" className="h-5 w-5" />
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 text-xs text-white/80">
          <Icon name="video" className="h-4 w-4" />
          <span className="truncate">
            {attachment.fileName} · {formatBytes(attachment.byteSize)}
          </span>
        </div>
      </button>
    );
  }

  if (attachment.mediaKind === "image" || attachment.mediaKind === "sticker") {
    return (
      <button
        className={`block overflow-hidden rounded-[1.25rem] border border-[#d8ddd4] bg-[#fffdf7] ${
          compact ? "w-32" : attachment.mediaKind === "sticker" ? "max-w-[180px]" : "max-w-sm"
        }`}
        onClick={onOpen}
      >
        <img
          className={`w-full object-cover ${
            compact ? "h-24" : attachment.mediaKind === "sticker" ? "max-h-48 object-contain" : "max-h-80"
          } ${attachment.mediaKind === "sticker" ? "bg-[radial-gradient(circle_at_center,_rgba(39,91,82,0.08),_transparent_60%)] p-3" : ""}`}
          src={attachment.previewUrl || attachment.contentUrl}
          alt={attachment.fileName}
        />
        <div className="flex items-center gap-2 px-3 py-2 text-left text-xs text-[#5a6660]">
          <Icon name={attachment.mediaKind === "sticker" ? "spark" : "image"} className="h-4 w-4" />
          <span className="truncate">
            {attachment.fileName} · {formatBytes(attachment.byteSize)}
          </span>
        </div>
      </button>
    );
  }

  return (
    <a
      className="inline-flex items-center gap-2 rounded-[1rem] border border-[#d8ddd4] bg-[#f6f6f1] px-3 py-2 text-xs font-semibold text-[#435048]"
      href={attachment.contentUrl}
      target="_blank"
      rel="noreferrer"
    >
      <Icon name="file" className="h-4 w-4" />
      {attachment.fileName} · {formatBytes(attachment.byteSize)}
    </a>
  );
}

function shouldRenderMessageBody(message: MessageItem) {
  const trimmed = message.body.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed === "[Media omitted]" && message.attachments.length > 0) {
    return false;
  }
  if (
    message.attachments.length === 1 &&
    (trimmed === message.attachments[0]?.fileName || trimmed === message.attachments[0]?.placeholderText)
  ) {
    return false;
  }
  return true;
}

export default function App() {
  return (
    <AuthProvider>
      <AppShell>
        <Routes>
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Navigate to="/archive" replace />
              </ProtectedRoute>
            }
          />
          <Route
            path="/login"
            element={
              <GuestRoute>
                <AuthPage mode="login" />
              </GuestRoute>
            }
          />
          <Route
            path="/register"
            element={
              <GuestRoute>
                <AuthPage mode="register" />
              </GuestRoute>
            }
          />
          <Route
            path="/archive"
            element={
              <ProtectedRoute>
                <ArchiveWorkspace />
              </ProtectedRoute>
            }
          />
          <Route
            path="/chats/:chatId"
            element={
              <ProtectedRoute>
                <ArchiveWorkspace />
              </ProtectedRoute>
            }
          />
          <Route
            path="/imports/:id"
            element={
              <ProtectedRoute>
                <ImportDetailPage />
              </ProtectedRoute>
            }
          />
        </Routes>
      </AppShell>
    </AuthProvider>
  );
}
