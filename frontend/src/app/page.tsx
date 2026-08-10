"use client";

import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import {
  Search, Bell, Calendar as CalendarIcon, GraduationCap, Users, Building2,
  AlertTriangle, Clock, CheckCircle2, Circle, ChevronRight, ChevronLeft,
  MessageCircle, Mail, Sparkles, X, Moon, Sun, Settings, LayoutGrid,
  List as ListIcon, BellRing, Trash2, LogIn, LogOut, RefreshCw, Tag,
  ExternalLink, Wifi, WifiOff, CheckCheck,
} from "lucide-react";
import {
  fetchBoard, markAsRead, dismissMessage, fetchCurrentUser,
  submitFeedback, addToCalendar, getAuthToken, removeAuthToken,
  triggerPollNow, fetchUserSettings, updateUserSettings, registerFCMToken,
  getLoginUrl, getCalendarEvents,
  type UserProfile, type ApiMessage, type NotificationPrefs,
} from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────
type CategoryKey = "placement" | "faculty" | "department" | "spam";

interface DashboardItem {
  id: string;
  day: number;
  month: number;
  year: number;
  source: "gmail" | "telegram";
  category: CategoryKey;
  sender: string;
  title: string;
  time: string;
  urgency: "high" | "medium" | "low";
  deadline: string | null;
  preview: string;
  confidence?: number;
  calendarEventId?: string | null;
  isRead: boolean;
}

// ── Design Tokens ─────────────────────────────────────────────────────
const CATEGORY_META: Record<CategoryKey, { label: string; color: string; tint: string; icon: React.ElementType }> = {
  placement: { label: "Placement & TPO", color: "#1E9E5A", tint: "rgba(30,158,90,0.12)", icon: GraduationCap },
  faculty:   { label: "Faculty",          color: "#0A72E8", tint: "rgba(10,114,232,0.10)", icon: Users },
  department:{ label: "Department",       color: "#FF9500", tint: "rgba(255,149,0,0.12)",  icon: Building2 },
  spam:      { label: "Flagged",          color: "#FF3B30", tint: "rgba(255,59,48,0.10)",  icon: AlertTriangle },
};

const THEME = {
  light: {
    bg: "#F5F5F7", sidebar: "rgba(255,255,255,0.72)", headerBg: "rgba(245,245,247,0.85)",
    card: "#FFFFFF", border: "#E5E5EA", text: "#1D1D1F", subtext: "#86868B",
    searchBg: "#ECECEE", accent: "#0A72E8",
  },
  dark: {
    bg: "#161617", sidebar: "rgba(28,28,30,0.72)", headerBg: "rgba(22,22,23,0.85)",
    card: "#1C1C1E", border: "#2C2C2E", text: "#F5F5F7", subtext: "#98989D",
    searchBg: "#242426", accent: "#409CFF",
  },
};

const COLUMNS = [
  { key: "today",   label: "Act now",       sub: "Due within 24 hours",    dotColor: "#1E9E5A" },
  { key: "week",    label: "This week",     sub: "Coming up",              dotColor: "#FF9500" },
  { key: "later",   label: "For reference", sub: "No action needed",       dotColor: "#8E8E93" },
  { key: "flagged", label: "Flagged",       sub: "Verify before trusting", dotColor: "#FF3B30" },
];

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

// Seed items for unauthenticated / loading state
const SEED_ITEMS: DashboardItem[] = [
  { id: "s1", day: 11, month: 8, year: 2026, source: "gmail", category: "placement",
    sender: "TPO Cell — tpo@clg.edu.in", title: "Internship Drive: Infosys Springboard — Form closes today",
    time: "2h ago", urgency: "high", deadline: "Today, 5:00 PM", isRead: false,
    preview: "Eligible 3rd/4th year students must submit the registration form before the deadline. Resume upload mandatory." },
  { id: "s2", day: 11, month: 8, year: 2026, source: "telegram", category: "placement",
    sender: "College Official · TPO Announcements", title: "Pre-placement talk today, 4 PM, Seminar Hall",
    time: "3h ago", urgency: "high", deadline: "Today, 4:00 PM", isRead: false,
    preview: "Attendance is being tracked for all pre-final year students. Carry your ID card." },
  { id: "s3", day: 12, month: 8, year: 2026, source: "gmail", category: "faculty",
    sender: "Dr. Mehta · Theory of Computation", title: "Assignment 4 evaluation sheet uploaded",
    time: "5h ago", urgency: "medium", deadline: null, isRead: false,
    preview: "Feedback on your automata conversion submission is now available on the shared drive." },
  { id: "s4", day: 13, month: 8, year: 2026, source: "gmail", category: "department",
    sender: "CSE Department Office", title: "Mid-sem timetable revised — check updated slots",
    time: "1d ago", urgency: "medium", deadline: "Aug 13", isRead: false,
    preview: "Two lab sessions have been swapped. Revised PDF attached to this email." },
  { id: "s5", day: 11, month: 8, year: 2026, source: "gmail", category: "spam",
    sender: "\"CareerBoost Academy\"", title: "Guaranteed Internship + Certificate — Limited Seats",
    time: "6h ago", urgency: "low", deadline: null, isRead: true,
    preview: "Pay a small fee to unlock your guaranteed internship certificate." },
];

// ── Helpers ───────────────────────────────────────────────────────────
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatDeadline(iso: string | null): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    const today = new Date(); today.setHours(0,0,0,0);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate()+1);
    const dMid = new Date(d); dMid.setHours(0,0,0,0);
    if (dMid.getTime() === today.getTime())    return `Today, ${d.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}`;
    if (dMid.getTime() === tomorrow.getTime()) return `Tomorrow, ${d.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}`;
    return d.toLocaleDateString("en-IN",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});
  } catch { return iso; }
}

function apiToItem(m: ApiMessage): DashboardItem {
  const d = new Date(m.received_at || Date.now());
  return {
    id:           m.id,
    day:          d.getDate(),
    month:        d.getMonth() + 1,
    year:         d.getFullYear(),
    source:       m.source || "gmail",
    category:     (m.category as CategoryKey) || "department",
    sender:       m.sender || "Unknown",
    title:        m.subject || "No Subject",
    time:         relativeTime(m.received_at || new Date().toISOString()),
    urgency:      m.urgency || "low",
    deadline:     formatDeadline(m.deadline),
    preview:      m.body_text || "",
    confidence:   m.confidence,
    calendarEventId: m.calendar_event_id,
    isRead:       m.is_read,
  };
}

function timelineGroup(item: DashboardItem): string {
  if (item.category === "spam") return "flagged";
  if (item.urgency === "high")  return "today";
  if (item.urgency === "medium")return "week";
  return "later";
}

// ── Main Dashboard ─────────────────────────────────────────────────────
export default function CampusDigestDashboard() {
  const now = new Date();

  // Core state
  const [dark, setDark]                 = useState(false);
  const [view, setView]                 = useState("board");
  const [activeCat, setActiveCat]       = useState("all");
  const [query, setQuery]               = useState("");
  const [selected, setSelected]         = useState<DashboardItem | null>(null);
  const [read, setRead]                 = useState<Record<string, boolean>>({});
  const [dismissed, setDismissed]       = useState<Record<string, boolean>>({});
  const [items, setItems]               = useState<DashboardItem[]>(SEED_ITEMS);
  const [user, setUser]                 = useState<UserProfile | null>(null);
  const [settings, setSettings_]        = useState<NotificationPrefs | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [loading, setLoading]           = useState(false);
  const [syncing, setSyncing]           = useState(false);
  const [syncMsg, setSyncMsg]           = useState("");
  const [calToast, setCalToast]         = useState("");
  const [calMonth, setCalMonth]         = useState(now.getMonth());
  const [calYear, setCalYear]           = useState(now.getFullYear());
  const [calDay, setCalDay]             = useState(now.getDate());
  const [channels, setChannels]         = useState({ gmail: true, telegram: true, push: true, digest: true });
  const [notifGranted, setNotifGranted] = useState(false);

  const t = dark ? THEME.dark : THEME.light;

  // ── Load user + messages ──────────────────────────────────────────
  const loadData = useCallback(async (showLoading = true) => {
    const token = getAuthToken();
    if (!token) { setUser(null); return; }
    if (showLoading) setLoading(true);
    try {
      const [userData, boardData, prefs] = await Promise.all([
        fetchCurrentUser(),
        fetchBoard(),
        fetchUserSettings(),
      ]);
      if (userData) setUser(userData);
      else { removeAuthToken(); setUser(null); }

      if (boardData) {
        const flat: DashboardItem[] = [];
        (["today","week","later","flagged"] as const).forEach((col) => {
          (boardData[col] || []).forEach((m) => flat.push(apiToItem(m)));
        });
        if (flat.length > 0) {
          setItems(flat);
          // Sync read state from backend
          const readMap: Record<string, boolean> = {};
          flat.forEach((i) => { if (i.isRead) readMap[i.id] = true; });
          setRead((r) => ({ ...readMap, ...r }));
        }
      }

      if (prefs) {
        setSettings_(prefs);
        setChannels({
          gmail:    true,
          telegram: true,
          push:     prefs.push_enabled,
          digest:   prefs.telegram_digest_enabled,
        });
      }
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  // On mount: check token, load data, listen for storage changes (after callback redirect)
  useEffect(() => {
    loadData();
    const onStorage = (e: StorageEvent) => {
      if (e.key === "campus_digest_token" && e.newValue) {
        loadData();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [loadData]);

  // ── FCM / Browser Push ────────────────────────────────────────────
  const initNotifications = useCallback(async () => {
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return;
    }
    if (Notification.permission === "granted") {
      setNotifGranted(true);
      // Register service worker + get FCM token if available
      // For now, we just mark as granted; FCM requires firebase SDK
    }
  }, []);

  useEffect(() => {
    if (user) initNotifications();
  }, [user, initNotifications]);

  // ── Derived ───────────────────────────────────────────────────────
  const filtered = useMemo(() =>
    items
      .filter((i) => !dismissed[i.id])
      .filter((i) => activeCat === "all" || i.category === activeCat)
      .filter((i) =>
        query.trim() === "" ||
        i.title.toLowerCase().includes(query.toLowerCase()) ||
        i.sender.toLowerCase().includes(query.toLowerCase())
      ),
    [items, dismissed, activeCat, query]
  );

  const grouped = useMemo(() =>
    COLUMNS.map((col) => ({ ...col, items: filtered.filter((i) => timelineGroup(i) === col.key) })),
    [filtered]
  );

  const MONTH_DAYS = useMemo(() => {
    const days = new Date(calYear, calMonth + 1, 0).getDate();
    return Array.from({ length: days }, (_, i) => i + 1);
  }, [calMonth, calYear]);

  const firstDayOfMonth = useMemo(() => new Date(calYear, calMonth, 1).getDay(), [calMonth, calYear]);

  const daysWithItems = useMemo(
    () => new Set(filtered.filter(i => i.month - 1 === calMonth && i.year === calYear).map((i) => i.day)),
    [filtered, calMonth, calYear]
  );
  const dayItems = filtered.filter((i) => i.day === calDay && i.month - 1 === calMonth && i.year === calYear);
  const unread = items.filter((i) => !read[i.id] && !dismissed[i.id] && i.category !== "spam").length;

  // ── Actions ───────────────────────────────────────────────────────
  const handleOpen = (item: DashboardItem) => {
    setSelected(item);
    if (!read[item.id]) {
      setRead((r) => ({ ...r, [item.id]: true }));
      markAsRead(item.id);
    }
  };

  const handleDismiss = (item: DashboardItem) => {
    setDismissed((d) => ({ ...d, [item.id]: true }));
    dismissMessage(item.id);
    if (selected?.id === item.id) setSelected(null);
  };

  const handleFeedback = async (correctedCategory: string) => {
    if (!selected) return;
    await submitFeedback(selected.id, correctedCategory);
    setItems((prev) => prev.map((i) =>
      i.id === selected.id ? { ...i, category: correctedCategory as CategoryKey } : i
    ));
    setFeedbackOpen(false);
  };

  const handleCalendar = async () => {
    if (!selected) return;
    if (!selected.deadline) {
      setCalToast("No deadline found in this message to add to Calendar.");
      setTimeout(() => setCalToast(""), 3000);
      return;
    }
    const res = await addToCalendar(selected.id);
    if (res?.event_link) {
      setCalToast(`✅ Added to Calendar: "${res.summary}"`);
      // Mark the item as having a calendar event
      setItems((prev) => prev.map((i) =>
        i.id === selected.id ? { ...i, calendarEventId: res.event_id } : i
      ));
      if (selected) setSelected({ ...selected, calendarEventId: res.event_id });
      setTimeout(() => setCalToast(""), 4000);
      // Open in Google Calendar
      window.open(res.event_link, "_blank");
    } else {
      setCalToast("❌ Could not add to Calendar. Make sure Calendar access is granted.");
      setTimeout(() => setCalToast(""), 4000);
    }
  };

  const handleSyncNow = async () => {
    if (!user) { handleLogin(); return; }
    setSyncing(true);
    setSyncMsg("Fetching your college emails…");
    const res = await triggerPollNow();
    setSyncMsg(res?.message || "Sync started! Refresh in 15 seconds.");
    setTimeout(async () => {
      setSyncMsg("Loading new messages…");
      await loadData(false);
      setSyncing(false);
      setSyncMsg("");
    }, 15000);
  };

  const handleLogin = () => {
    window.location.href = getLoginUrl();
  };

  const handleLogout = () => {
    removeAuthToken();
    setUser(null);
    setItems(SEED_ITEMS);
    setSelected(null);
  };

  const handleSettingToggle = async (key: keyof NotificationPrefs, val: boolean) => {
    setSettings_((prev) => prev ? { ...prev, [key]: val } : null);
    await updateUserSettings({ [key]: val });
  };

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div
      style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', Inter, sans-serif", background: t.bg, color: t.text }}
      className="h-screen w-full flex overflow-hidden relative transition-colors duration-300"
    >
      {/* ── Toast ─────────────────────────────────────────────────── */}
      {(calToast || syncMsg) && (
        <div className="absolute top-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl text-[13px] font-medium shadow-xl"
          style={{ background: t.card, color: t.text, border: `1px solid ${t.border}` }}>
          {calToast || syncMsg}
        </div>
      )}

      {/* ── Sidebar ───────────────────────────────────────────────── */}
      <aside style={{ background: t.sidebar, borderColor: t.border }} className="w-64 shrink-0 border-r flex flex-col backdrop-blur-xl">
        {/* Brand */}
        <div className="px-5 pt-6 pb-2">
          <div className="flex items-center gap-2 text-[17px] font-semibold tracking-tight">
            <span style={{ background: "linear-gradient(135deg,#0A72E8,#1E9E5A)" }}
              className="inline-flex h-7 w-7 rounded-[9px] items-center justify-center shadow-sm">
              <Sparkles size={15} className="text-white" />
            </span>
            Campus Digest
          </div>
          <p style={{ color: t.subtext }} className="text-[12px] mt-1 ml-9">
            {user
              ? (unread > 0
                  ? <><span className="font-semibold" style={{ color: "#FF3B30" }}>{unread}</span> unread messages</>
                  : <span style={{ color: "#1E9E5A" }}>✓ All caught up</span>)
              : "Sign in to see your emails"}
          </p>
        </div>

        {/* Category nav */}
        <nav className="flex-1 px-3 pt-2 space-y-0.5 overflow-y-auto">
          <SidebarItem t={t} active={activeCat === "all"} label="All Updates"
            count={items.filter(i => !dismissed[i.id]).length} onClick={() => setActiveCat("all")} />
          {(Object.keys(CATEGORY_META) as CategoryKey[]).map((key) => {
            const meta = CATEGORY_META[key];
            return (
              <SidebarItem key={key} t={t} active={activeCat === key} label={meta.label}
                count={items.filter((i) => i.category === key && !dismissed[i.id]).length}
                dot={meta.color} onClick={() => setActiveCat(key)} />
            );
          })}
        </nav>

        {/* Calendar sync card */}
        <div className="px-3 pb-2">
          <div style={{ background: t.card, borderColor: t.border }} className="rounded-2xl p-3.5 border">
            <div className="flex items-center gap-2 text-[12.5px] font-medium">
              <CalendarIcon size={14} style={{ color: "#1E9E5A" }} />
              {user ? "Google Calendar" : "Calendar Sync"}
            </div>
            <p style={{ color: t.subtext }} className="text-[11px] mt-1 leading-snug">
              {user
                ? "Click 'Add to Calendar' on any message with a deadline"
                : "Sign in to enable auto-sync"}
            </p>
          </div>
        </div>

        {/* User / Login */}
        <div className="px-3 pb-4 space-y-2">
          {user ? (
            /* ── Profile card ── */
            <div style={{ background: t.card, borderColor: t.border }} className="rounded-2xl border overflow-hidden">
              <div className="p-3">
                <div className="flex items-center gap-2.5">
                  {user.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={user.avatar_url} alt={user.name} width={32} height={32}
                      className="h-8 w-8 rounded-full object-cover shrink-0" />
                  ) : (
                    <div style={{ background: "linear-gradient(135deg,#0A72E8,#1E9E5A)" }}
                      className="h-8 w-8 rounded-full flex items-center justify-center text-white text-[13px] font-bold shrink-0">
                      {(user.name || user.email || "U")[0].toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold truncate">{user.name || "Student"}</div>
                    <div style={{ color: t.subtext }} className="text-[10.5px] truncate">{user.email}</div>
                  </div>
                </div>
                {/* Gmail & Calendar status */}
                <div className="mt-2.5 flex gap-1.5">
                  <span className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-1 rounded-lg"
                    style={{ background: "rgba(30,158,90,0.1)", color: "#1E9E5A" }}>
                    <Mail size={10} /> Gmail ✓
                  </span>
                  <span className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-1 rounded-lg"
                    style={{ background: "rgba(10,114,232,0.1)", color: "#0A72E8" }}>
                    <CalendarIcon size={10} /> Calendar ✓
                  </span>
                  {notifGranted && (
                    <span className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-1 rounded-lg"
                      style={{ background: "rgba(255,149,0,0.1)", color: "#FF9500" }}>
                      <Bell size={10} /> Notifs ✓
                    </span>
                  )}
                </div>
              </div>
              <div style={{ borderColor: t.border }} className="border-t px-3 py-2 flex gap-1.5">
                <button onClick={() => setSettingsOpen(true)}
                  style={{ color: t.subtext, borderColor: t.border }}
                  className="flex-1 flex items-center justify-center gap-1 text-[11px] py-1.5 rounded-lg border hover:opacity-70 transition">
                  <Settings size={11} /> Settings
                </button>
                <button onClick={handleLogout}
                  style={{ color: "#FF3B30", borderColor: t.border }}
                  className="flex-1 flex items-center justify-center gap-1 text-[11px] py-1.5 rounded-lg border hover:opacity-70 transition">
                  <LogOut size={11} /> Sign out
                </button>
              </div>
            </div>
          ) : (
            /* ── Sign in button ── */
            <button onClick={handleLogin} style={{ background: t.accent }}
              className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-white text-[13px] font-semibold hover:opacity-90 transition shadow-sm">
              <LogIn size={15} /> Sign in with Google
            </button>
          )}

          {/* Sync now button */}
          {user && (
            <button onClick={handleSyncNow} disabled={syncing}
              style={{ borderColor: t.border, color: syncing ? t.subtext : t.accent }}
              className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border text-[12.5px] font-medium hover:opacity-80 transition disabled:opacity-50">
              <RefreshCw size={13} className={syncing ? "animate-spin" : ""} />
              {syncing ? "Syncing…" : "Sync my emails now"}
            </button>
          )}
        </div>
      </aside>

      {/* ── Main ──────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header style={{ background: t.headerBg, borderColor: t.border }}
          className="h-16 shrink-0 border-b flex items-center gap-4 px-6 backdrop-blur-xl">

          {/* Search */}
          <div style={{ background: t.searchBg }}
            className="flex items-center gap-2 rounded-[10px] px-3 py-[7px] max-w-sm flex-1">
            <Search size={14} style={{ color: t.subtext }} />
            <input value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Search updates, senders…"
              style={{ color: t.text }}
              className="bg-transparent outline-none text-[13px] w-full placeholder:opacity-50" />
            {query && <button onClick={() => setQuery("")} style={{ color: t.subtext }}><X size={12} /></button>}
          </div>

          {/* View switcher */}
          <div style={{ background: t.searchBg }} className="flex items-center rounded-[10px] p-[3px] gap-[2px]">
            {[
              { key: "board",    icon: LayoutGrid,   label: "Board" },
              { key: "list",     icon: ListIcon,      label: "List" },
              { key: "calendar", icon: CalendarIcon,  label: "Calendar" },
            ].map((s) => (
              <button key={s.key} onClick={() => setView(s.key)}
                style={{
                  background: view === s.key ? t.card : "transparent",
                  color: view === s.key ? t.text : t.subtext,
                  boxShadow: view === s.key ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                }}
                className="flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-[8px] transition-all">
                <s.icon size={13} /> {s.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3">
            {/* Refresh */}
            <button onClick={() => loadData()} style={{ color: t.subtext }}
              className={`hover:opacity-70 transition ${loading ? "animate-spin" : ""}`}>
              <RefreshCw size={16} />
            </button>
            {/* Dark mode */}
            <button onClick={() => setDark((d) => !d)} style={{ color: t.subtext }} className="hover:opacity-70 transition">
              {dark ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            {/* Bell */}
            <button className="relative" style={{ color: t.subtext }}
              onClick={user ? initNotifications : handleLogin}>
              <Bell size={17} />
              {unread > 0 && (
                <span style={{ background: "#FF3B30" }}
                  className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full text-white text-[9px] flex items-center justify-center font-semibold">
                  {unread}
                </span>
              )}
            </button>
          </div>
        </header>

        {/* ── Content ───────────────────────────────────────────── */}
        <div className="flex-1 overflow-auto px-6 py-6">

          {/* Empty state when not logged in */}
          {!user && !loading && (
            <div className="flex flex-col items-center justify-center h-full gap-4 pb-20">
              <div style={{ background: "linear-gradient(135deg,#0A72E8,#1E9E5A)" }}
                className="h-16 w-16 rounded-[18px] flex items-center justify-center shadow-lg">
                <Sparkles size={28} className="text-white" />
              </div>
              <h2 className="text-[20px] font-bold">Smart Academic Notifications</h2>
              <p style={{ color: t.subtext }} className="text-[14px] text-center max-w-xs leading-relaxed">
                Sign in with your college Google account to see your classified emails, deadlines, and urgent notices.
              </p>
              <button onClick={handleLogin} style={{ background: t.accent }}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-white text-[14px] font-semibold hover:opacity-90 transition shadow-md mt-2">
                <LogIn size={16} /> Sign in with Google
              </button>
              <p style={{ color: t.subtext }} className="text-[11px] mt-1">Preview mode shown below ↓</p>
            </div>
          )}

          {/* Board view */}
          {view === "board" && (
            <div className="grid grid-cols-4 gap-4 min-w-[1040px]">
              {grouped.map((col) => (
                <div key={col.key} className="flex flex-col">
                  <div className="mb-3 px-1">
                    <div className="flex items-center gap-1.5 text-[13px] font-semibold">
                      <span className="h-[7px] w-[7px] rounded-full" style={{ background: col.dotColor }} />
                      {col.label}
                      <span style={{ color: t.subtext }} className="font-normal">· {col.items.length}</span>
                    </div>
                    <p style={{ color: t.subtext }} className="text-[11px] mt-0.5">{col.sub}</p>
                  </div>
                  <div className="space-y-2.5">
                    {col.items.map((item) => (
                      <Card key={item.id} item={item} t={t} isRead={!!read[item.id]}
                        onOpen={() => handleOpen(item)}
                        onDismiss={() => handleDismiss(item)} />
                    ))}
                    {col.items.length === 0 && (
                      <div style={{ color: t.subtext }}
                        className="text-[11.5px] italic px-1 py-4 opacity-60">Nothing here.</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* List view */}
          {view === "list" && (
            <div style={{ background: t.card, borderColor: t.border }}
              className="rounded-2xl border overflow-hidden max-w-3xl">
              {filtered.length === 0 && (
                <div style={{ color: t.subtext }}
                  className="text-[13px] italic px-6 py-10 text-center opacity-60">
                  No updates found.
                </div>
              )}
              {filtered.map((item, idx) => {
                const meta = CATEGORY_META[item.category] || CATEGORY_META.department;
                const Icon = meta.icon;
                return (
                  <button key={item.id} onClick={() => handleOpen(item)}
                    style={{ borderColor: t.border }}
                    className={`w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-black/[0.02] transition ${idx !== filtered.length - 1 ? "border-b" : ""}`}>
                    <span style={{ background: meta.tint }}
                      className="h-8 w-8 rounded-full flex items-center justify-center shrink-0">
                      <Icon size={14} style={{ color: meta.color }} />
                    </span>
                    <span className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-[13px] truncate ${read[item.id] ? "font-normal opacity-70" : "font-semibold"}`}>
                          {item.title}
                        </span>
                        {item.urgency === "high" && (
                          <span className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                            style={{ background: "rgba(255,59,48,0.1)", color: "#FF3B30" }}>
                            URGENT
                          </span>
                        )}
                      </div>
                      <div style={{ color: t.subtext }} className="text-[11.5px] truncate">
                        {item.sender} · {item.time}
                      </div>
                    </span>
                    {item.deadline && (
                      <span style={{ color: "#1E9E5A" }} className="text-[11px] font-medium shrink-0">
                        {item.deadline}
                      </span>
                    )}
                    <ChevronRight size={14} style={{ color: t.subtext }} className="shrink-0" />
                  </button>
                );
              })}
            </div>
          )}

          {/* Calendar view */}
          {view === "calendar" && (
            <div className="flex gap-5 max-w-4xl">
              {/* Month grid */}
              <div style={{ background: t.card, borderColor: t.border }}
                className="rounded-2xl border p-5 w-[360px] shrink-0">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-[15px] font-semibold">{MONTH_NAMES[calMonth]} {calYear}</span>
                  <div className="flex gap-1">
                    <button style={{ color: t.subtext }} onClick={() => {
                      if (calMonth === 0) { setCalMonth(11); setCalYear(y => y-1); }
                      else setCalMonth(m => m-1);
                    }}><ChevronLeft size={16} /></button>
                    <button style={{ color: t.subtext }} onClick={() => {
                      if (calMonth === 11) { setCalMonth(0); setCalYear(y => y+1); }
                      else setCalMonth(m => m+1);
                    }}><ChevronRight size={16} /></button>
                  </div>
                </div>
                <div className="grid grid-cols-7 gap-y-2 text-center">
                  {["S","M","T","W","T","F","S"].map((d,i) => (
                    <div key={i} style={{ color: t.subtext }} className="text-[10.5px] font-medium">{d}</div>
                  ))}
                  {Array.from({ length: firstDayOfMonth }).map((_,i) => <div key={`e${i}`} />)}
                  {MONTH_DAYS.map((d) => {
                    const isToday = d === now.getDate() && calMonth === now.getMonth() && calYear === now.getFullYear();
                    const isSelected = d === calDay;
                    return (
                      <button key={d} onClick={() => setCalDay(d)}
                        className="relative h-9 flex flex-col items-center justify-center rounded-full text-[12.5px] mx-auto w-9"
                        style={{
                          background: isSelected ? t.accent : "transparent",
                          color: isSelected ? "#fff" : isToday ? t.accent : t.text,
                          fontWeight: isToday || isSelected ? 600 : 400,
                        }}>
                        {d}
                        {daysWithItems.has(d) && (
                          <span style={{ background: isSelected ? "#fff" : t.accent }}
                            className="absolute bottom-1 h-[3px] w-[3px] rounded-full" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Day agenda */}
              <div className="flex-1">
                <p style={{ color: t.subtext }} className="text-[12px] font-medium mb-3">
                  {MONTH_NAMES[calMonth]} {calDay} · {dayItems.length} update{dayItems.length !== 1 ? "s" : ""}
                </p>
                <div className="space-y-2.5">
                  {dayItems.map((item) => (
                    <Card key={item.id} item={item} t={t} isRead={!!read[item.id]}
                      onOpen={() => handleOpen(item)}
                      onDismiss={() => handleDismiss(item)} />
                  ))}
                  {dayItems.length === 0 && (
                    <div style={{ color: t.subtext }} className="text-[12px] italic opacity-60">
                      No updates on this day.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ── Detail Panel ──────────────────────────────────────────── */}
      {selected && (
        <aside style={{ background: t.card, borderColor: t.border }}
          className="w-80 shrink-0 border-l flex flex-col">
          <div style={{ borderColor: t.border }}
            className="h-16 flex items-center justify-between px-5 border-b">
            <span style={{ color: t.subtext }} className="text-[12px] font-medium">Details</span>
            <button onClick={() => setSelected(null)} style={{ color: t.subtext }}><X size={16} /></button>
          </div>

          <div className="p-5 flex-1 overflow-auto">
            {/* Badges */}
            <div className="flex flex-wrap items-center gap-1.5 mb-3">
              <span className="inline-flex items-center gap-1 text-[10.5px] font-medium px-2 py-1 rounded-full"
                style={{
                  color: (CATEGORY_META[selected.category] || CATEGORY_META.department).color,
                  background: (CATEGORY_META[selected.category] || CATEGORY_META.department).tint,
                }}>
                {(CATEGORY_META[selected.category] || CATEGORY_META.department).label}
              </span>
              <span style={{ color: t.subtext }} className="inline-flex items-center gap-1 text-[10px]">
                {selected.source === "telegram" ? <MessageCircle size={11}/> : <Mail size={11}/>}
                {selected.source}
              </span>
              {selected.confidence !== undefined && selected.confidence < 0.7 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                  style={{ background: "rgba(255,149,0,0.1)", color: "#FF9500" }}>
                  Unverified
                </span>
              )}
              {selected.calendarEventId && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                  style={{ background: "rgba(30,158,90,0.1)", color: "#1E9E5A" }}>
                  ✓ In Calendar
                </span>
              )}
            </div>

            {/* Urgency label */}
            {selected.urgency === "high" && (
              <div className="flex items-center gap-1.5 text-[11px] font-semibold mb-3"
                style={{ color: "#FF3B30" }}>
                <AlertTriangle size={12} /> High Priority — Act now
              </div>
            )}

            <h2 className="text-[16px] font-semibold leading-snug mb-2">{selected.title}</h2>
            <p style={{ color: t.subtext }} className="text-[12px] mb-4">{selected.sender} · {selected.time}</p>
            <p style={{ color: t.text, opacity: 0.85 }} className="text-[13px] leading-relaxed mb-5">
              {selected.preview || "No preview available."}
            </p>

            {/* Deadline */}
            {selected.deadline && (
              <div style={{ background: t.searchBg }} className="rounded-xl p-3 mb-4">
                <div className="flex items-center gap-2 text-[12px] font-semibold" style={{ color: "#1E9E5A" }}>
                  <Clock size={13} /> Deadline: {selected.deadline}
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="space-y-2">
              {user ? (
                <>
                  <ActionBtn icon={CalendarIcon} label={selected.calendarEventId ? "✓ Added to Calendar" : "Add to Google Calendar"} primary t={t}
                    onClick={handleCalendar} disabled={!!selected.calendarEventId} />
                  <ActionBtn icon={BellRing} label="Remind me again" t={t}
                    onClick={() => {
                      if (!("Notification" in window)) return;
                      if (selected.deadline) {
                        new Notification("Campus Digest Reminder", {
                          body: `${selected.title} — ${selected.deadline}`,
                        });
                      }
                    }} />
                  <ActionBtn icon={Tag} label="Wrong category?" t={t} onClick={() => setFeedbackOpen(true)} />
                  {selected.category === "spam" && (
                    <ActionBtn icon={Trash2} label="Mark as spam & dismiss" danger t={t}
                      onClick={() => {
                        submitFeedback(selected.id, "spam", "mark_spam");
                        handleDismiss(selected);
                      }} />
                  )}
                </>
              ) : (
                <ActionBtn icon={LogIn} label="Sign in to use actions" primary t={t} onClick={handleLogin} />
              )}
            </div>
          </div>

          {/* Feedback sub-panel */}
          {feedbackOpen && (
            <div style={{ borderColor: t.border, background: t.searchBg }} className="border-t p-4">
              <p className="text-[12px] font-semibold mb-2">What category is this really?</p>
              <div className="grid grid-cols-2 gap-1.5">
                {(Object.keys(CATEGORY_META) as CategoryKey[]).map((cat) => (
                  <button key={cat} onClick={() => handleFeedback(cat)}
                    style={{ background: t.card, borderColor: t.border, color: CATEGORY_META[cat].color }}
                    className="text-[11px] font-medium px-2 py-1.5 rounded-lg border hover:opacity-80 transition">
                    {CATEGORY_META[cat].label}
                  </button>
                ))}
              </div>
              <button onClick={() => setFeedbackOpen(false)}
                style={{ color: t.subtext }} className="text-[11px] mt-2 w-full text-center hover:opacity-70">
                Cancel
              </button>
            </div>
          )}
        </aside>
      )}

      {/* ── Settings Sheet ────────────────────────────────────────── */}
      {settingsOpen && (
        <div className="absolute inset-0 z-20 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.4)" }} onClick={() => setSettingsOpen(false)}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: t.card, borderColor: t.border }}
            className="w-[400px] rounded-2xl border shadow-2xl overflow-hidden">
            {/* Header */}
            <div style={{ borderColor: t.border }} className="flex items-center justify-between px-5 py-4 border-b">
              <span className="text-[14px] font-semibold">Settings & Connected Accounts</span>
              <button onClick={() => setSettingsOpen(false)} style={{ color: t.subtext }}><X size={16} /></button>
            </div>
            <div className="px-5 py-3 space-y-0">
              <SettingRow t={t} icon={Mail} label="Gmail"
                sub={user ? `Connected as ${user.email}` : "Not connected"}
                value={!!user} onToggle={user ? handleLogout : handleLogin} />
              <SettingRow t={t} icon={CalendarIcon} label="Google Calendar"
                sub={user ? "Auto-sync deadlines" : "Connect Gmail first"}
                value={!!user} onToggle={user ? () => {} : handleLogin} />
              <SettingRow t={t} icon={Bell} label="Push Notifications"
                sub={notifGranted ? "Browser notifications enabled" : "Click to enable"}
                value={notifGranted} onToggle={initNotifications} />
              <SettingRow t={t} icon={MessageCircle} label="Telegram Digest" sub="9 AM daily summary via bot"
                value={channels.digest} onToggle={async () => {
                  const next = !channels.digest;
                  setChannels(c => ({ ...c, digest: next }));
                  await handleSettingToggle("telegram_digest_enabled", next);
                }} last />
            </div>
            {/* User info */}
            {user && (
              <div style={{ borderColor: t.border, background: t.searchBg }}
                className="px-5 py-3 border-t flex items-center justify-between">
                <div>
                  <p style={{ color: t.subtext }} className="text-[10.5px]">Signed in as</p>
                  <p className="text-[12px] font-medium">{user.email}</p>
                </div>
                <button onClick={handleLogout}
                  style={{ color: "#FF3B30", borderColor: t.border }}
                  className="text-[11px] font-medium px-3 py-1.5 rounded-lg border hover:opacity-80 transition flex items-center gap-1">
                  <LogOut size={11} /> Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────

function SidebarItem({ t, active, label, count, dot, onClick }: {
  t: typeof THEME.light; active: boolean; label: string; count: number; dot?: string; onClick: () => void;
}) {
  return (
    <button onClick={onClick}
      style={{ background: active ? t.card : "transparent", color: active ? t.text : t.subtext }}
      className="w-full flex items-center justify-between px-3 py-[7px] rounded-[9px] text-[13px] transition-colors font-medium">
      <span className="flex items-center gap-2">
        {dot && <span className="h-[7px] w-[7px] rounded-full" style={{ background: dot }} />}
        {label}
      </span>
      <span style={{ color: t.subtext }} className="text-[11px]">{count}</span>
    </button>
  );
}

function Card({ item, t, isRead, onOpen, onDismiss }: {
  item: DashboardItem; t: typeof THEME.light; isRead: boolean;
  onOpen: () => void; onDismiss: () => void;
}) {
  const meta = CATEGORY_META[item.category] || CATEGORY_META.department;
  const Icon = meta.icon;
  return (
    <div style={{
      background: t.card, borderColor: t.border,
      boxShadow: isRead ? "none" : "0 1px 3px rgba(0,0,0,0.06)",
    }}
      className="group relative rounded-2xl border p-3.5 transition-shadow hover:shadow-md">
      <button onClick={onOpen} className="text-left w-full">
        <div className="flex items-center justify-between mb-1.5">
          <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full"
            style={{ color: meta.color, background: meta.tint }}>
            <Icon size={10} /> {meta.label}
          </span>
          <span className="flex items-center gap-1.5">
            {item.urgency === "high" && (
              <span className="h-[5px] w-[5px] rounded-full animate-pulse" style={{ background: "#FF3B30" }} />
            )}
            {item.source === "telegram" ? <MessageCircle size={12} style={{ color: t.subtext }} /> : <Mail size={12} style={{ color: t.subtext }} />}
          </span>
        </div>
        <div className={`text-[13px] leading-snug mb-1 pr-2 ${isRead ? "font-normal opacity-70" : "font-medium"}`}>
          {item.title}
        </div>
        <div style={{ color: t.subtext }} className="text-[11px] mb-1.5 truncate">{item.sender}</div>
        <div className="flex items-center justify-between text-[10.5px]" style={{ color: t.subtext }}>
          <span className="flex items-center gap-1">
            {isRead ? <CheckCircle2 size={11} /> : <Circle size={11} />} {item.time}
          </span>
          {item.deadline && (
            <span className="flex items-center gap-1 font-medium" style={{ color: "#1E9E5A" }}>
              <Clock size={11} /> {item.deadline}
            </span>
          )}
        </div>
      </button>
      <button onClick={onDismiss} style={{ background: t.searchBg, color: t.subtext }}
        className="absolute top-3 right-3 h-5 w-5 rounded-full opacity-0 group-hover:opacity-100 transition items-center justify-center hidden group-hover:flex"
        title="Dismiss">
        <X size={11} />
      </button>
    </div>
  );
}

function ActionBtn({ icon: Icon, label, primary, danger, t, onClick, disabled }: {
  icon: React.ElementType; label: string; primary?: boolean; danger?: boolean;
  t: typeof THEME.light; onClick?: () => void; disabled?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{
        background: primary ? t.accent : danger ? "transparent" : t.searchBg,
        color: primary ? "#fff" : danger ? "#FF3B30" : t.text,
        opacity: disabled ? 0.5 : 1,
      }}
      className="w-full text-[12.5px] font-medium rounded-[10px] py-2.5 flex items-center justify-center gap-1.5 transition hover:opacity-85 disabled:cursor-default">
      <Icon size={13} /> {label}
    </button>
  );
}

function SettingRow({ t, icon: Icon, label, sub, value, onToggle, last }: {
  t: typeof THEME.light; icon: React.ElementType; label: string; sub: string;
  value: boolean; onToggle: () => void; last?: boolean;
}) {
  return (
    <div style={{ borderColor: t.border }} className={`flex items-center gap-3 py-3 ${!last ? "border-b" : ""}`}>
      <span style={{ background: t.searchBg }}
        className="h-8 w-8 rounded-full flex items-center justify-center shrink-0">
        <Icon size={14} style={{ color: t.accent }} />
      </span>
      <span className="flex-1 min-w-0">
        <div className="text-[13px] font-medium">{label}</div>
        <div style={{ color: t.subtext }} className="text-[11px]">{sub}</div>
      </span>
      <button onClick={onToggle} style={{ background: value ? "#34C759" : t.searchBg }}
        className="w-[42px] h-[25px] rounded-full relative transition-colors shrink-0">
        <span style={{ transform: value ? "translateX(18px)" : "translateX(2px)" }}
          className="absolute top-[2px] h-[21px] w-[21px] rounded-full bg-white shadow transition-transform" />
      </button>
    </div>
  );
}
