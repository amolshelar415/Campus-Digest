"use client";

import React, { useState, useMemo, useEffect, useCallback } from "react";
import {
  Search, Bell, Calendar as CalendarIcon, GraduationCap, Users, Building2,
  AlertTriangle, Clock, CheckCircle2, Circle, ChevronRight, ChevronLeft,
  MessageCircle, Mail, Sparkles, X, Moon, Sun, Settings, LayoutGrid,
  List as ListIcon, BellRing, Trash2, LogIn, LogOut, RefreshCw, Tag,
  ExternalLink, CheckCheck, ArrowUpRight,
} from "lucide-react";
import {
  fetchBoard, markAsRead, dismissMessage, fetchCurrentUser,
  submitFeedback, addToCalendar, getAuthToken, removeAuthToken,
  triggerPollNow, fetchUserSettings, updateUserSettings,
  getLoginUrl,
  type UserProfile, type ApiMessage, type NotificationPrefs,
} from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────
type CategoryKey = "placement" | "faculty" | "department" | "spam";

interface DashboardItem {
  id: string;
  day: number; month: number; year: number;
  source: "gmail" | "telegram";
  category: CategoryKey;
  sender: string;
  title: string;
  time: string;
  urgency: "high" | "medium" | "low";
  deadline: string | null;
  preview: string;       // stripped plain text
  confidence?: number;
  calendarEventId?: string | null;
  isRead: boolean;
}

// ── Tokens ────────────────────────────────────────────────────────────
const CAT: Record<CategoryKey, { label: string; color: string; tint: string; icon: React.ElementType }> = {
  placement: { label: "Placement & TPO", color: "#1E9E5A", tint: "rgba(30,158,90,0.12)", icon: GraduationCap },
  faculty:   { label: "Faculty",          color: "#0A72E8", tint: "rgba(10,114,232,0.10)", icon: Users },
  department:{ label: "Department",       color: "#FF9500", tint: "rgba(255,149,0,0.12)",  icon: Building2 },
  spam:      { label: "Flagged",          color: "#FF3B30", tint: "rgba(255,59,48,0.10)",  icon: AlertTriangle },
};

const THEME = {
  light: { bg:"#F5F5F7", sidebar:"rgba(255,255,255,0.86)", headerBg:"rgba(245,245,247,0.92)", card:"#FFFFFF", border:"#E5E5EA", text:"#1D1D1F", subtext:"#86868B", searchBg:"#ECECEE", accent:"#0A72E8" },
  dark:  { bg:"#161617", sidebar:"rgba(28,28,30,0.86)",    headerBg:"rgba(22,22,23,0.92)",    card:"#1C1C1E", border:"#2C2C2E", text:"#F5F5F7", subtext:"#98989D", searchBg:"#242426", accent:"#409CFF" },
};

const COLS = [
  { key:"today",   label:"Act now",       sub:"Due within 24 hours",    dot:"#FF3B30" },
  { key:"week",    label:"This week",     sub:"Coming up",              dot:"#FF9500" },
  { key:"later",   label:"For reference", sub:"No action needed",       dot:"#8E8E93" },
  { key:"flagged", label:"Flagged",       sub:"Verify before trusting", dot:"#FF3B30" },
];

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

// ── Helpers ───────────────────────────────────────────────────────────
/** Strip HTML tags + decode entities → plain text */
function stripHtml(raw: string): string {
  if (!raw) return "";
  // Remove <style> and <script> content
  let t = raw.replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  // Block elements → newline
  t = t.replace(/<(br|p|div|li|tr|h[1-6])[^>]*>/gi, "\n");
  // All remaining tags removed
  t = t.replace(/<[^>]+>/g, "");
  // HTML entities
  t = t.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
       .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
       .replace(/&[a-z]+;/gi, " ");
  // Collapse whitespace
  t = t.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+/g, " ");
  return t.trim();
}

/** Human-readable relative time from ISO string */
function relTime(iso: string): string {
  if (!iso) return "";
  try {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 0) return "just now";
    const m = Math.floor(diff / 60000);
    if (m < 1)  return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 7)  return `${d}d ago`;
    const date = new Date(iso);
    return date.toLocaleDateString("en-IN", { day:"numeric", month:"short" });
  } catch { return ""; }
}

/** Format deadline — returns null if deadline is in the past or looks bogus */
function fmtDeadline(iso: string | null): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    const now = new Date();
    // Reject past deadlines
    if (d < now) return null;
    // Reject deadlines more than 1 year away (probably false positive)
    if (d.getTime() - now.getTime() > 365 * 24 * 3600 * 1000) return null;
    const today = new Date(); today.setHours(0,0,0,0);
    const dm = new Date(d); dm.setHours(0,0,0,0);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate()+1);
    if (dm.getTime() === today.getTime())    return `Today ${d.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}`;
    if (dm.getTime() === tomorrow.getTime()) return `Tomorrow ${d.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}`;
    return d.toLocaleDateString("en-IN", { day:"numeric", month:"short" }) +
      " " + d.toLocaleTimeString("en-IN", { hour:"2-digit", minute:"2-digit" });
  } catch { return null; }
}

function apiToItem(m: ApiMessage): DashboardItem {
  const d = new Date(m.received_at || Date.now());
  return {
    id:           m.id,
    day:  d.getDate(), month: d.getMonth()+1, year: d.getFullYear(),
    source:       m.source || "gmail",
    category:     (m.category as CategoryKey) || "department",
    sender:       m.sender || "Unknown",
    title:        stripHtml(m.subject || "No Subject"),
    time:         relTime(m.received_at),
    urgency:      m.urgency || "low",
    deadline:     fmtDeadline(m.deadline),
    preview:      stripHtml(m.body_text || ""),
    confidence:   m.confidence,
    calendarEventId: m.calendar_event_id,
    isRead:       m.is_read,
  };
}

function group(item: DashboardItem): string {
  if (item.category === "spam") return "flagged";
  if (item.urgency === "high")  return "today";
  if (item.urgency === "medium")return "week";
  return "later";
}

// Seed data shown when logged out
const SEED: DashboardItem[] = [
  { id:"s1", day:11, month:8, year:2026, source:"gmail", category:"placement",
    sender:"TPO Cell — tpo@clg.edu.in", title:"Infosys Springboard Internship — Form closes today",
    time:"2h ago", urgency:"high", deadline:"Today 5:00 PM", isRead:false,
    preview:"Eligible 3rd/4th year students must submit the registration form by 5 PM today.\n\nPlease upload your updated resume and fill all mandatory fields." },
  { id:"s2", day:11, month:8, year:2026, source:"telegram", category:"placement",
    sender:"TPO Announcements (Official)", title:"Pre-placement talk today 4 PM, Seminar Hall",
    time:"3h ago", urgency:"high", deadline:"Today 4:00 PM", isRead:false,
    preview:"Attendance is mandatory for all pre-final year students. Carry your student ID card. Company: Infosys." },
  { id:"s3", day:12, month:8, year:2026, source:"gmail", category:"faculty",
    sender:"Dr. Mehta — Theory of Computation", title:"Assignment 4 evaluation sheet uploaded",
    time:"5h ago", urgency:"medium", deadline:null, isRead:false,
    preview:"Your automata conversion submission has been evaluated. Feedback sheet is now available on the shared Drive folder." },
  { id:"s4", day:13, month:8, year:2026, source:"gmail", category:"department",
    sender:"CSE Department Office", title:"Mid-sem timetable revised — updated slots",
    time:"1d ago", urgency:"medium", deadline:null, isRead:false,
    preview:"Two lab sessions have been swapped due to faculty scheduling. Revised timetable PDF is attached." },
  { id:"s5", day:11, month:8, year:2026, source:"gmail", category:"spam",
    sender:"\"CareerBoost Academy\"", title:"Guaranteed Internship + Certificate — Limited Seats",
    time:"6h ago", urgency:"low", deadline:null, isRead:true,
    preview:"Pay a small registration fee to unlock your guaranteed internship and placement certificate." },
];

// ── Calendar success modal ─────────────────────────────────────────────
function CalendarSuccessModal({ event, onClose }: { event: { summary: string; event_link: string }; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)" }}
      onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="bg-white rounded-3xl shadow-2xl p-6 w-[340px] flex flex-col items-center gap-4 animate-in fade-in zoom-in-95 duration-200">
        {/* Checkmark */}
        <div style={{ background: "linear-gradient(135deg,#1E9E5A,#34C759)" }}
          className="h-16 w-16 rounded-full flex items-center justify-center shadow-lg">
          <CheckCheck size={30} className="text-white" />
        </div>
        <div className="text-center">
          <div className="text-[17px] font-bold text-[#1D1D1F]">Added to Calendar!</div>
          <div className="text-[13px] text-[#86868B] mt-1 leading-snug">
            "{event.summary}"
          </div>
          <div className="text-[11px] text-[#86868B] mt-2">
            You'll get reminders 2 hours and 30 minutes before.
          </div>
        </div>
        <div className="flex gap-2 w-full">
          <a href={event.event_link} target="_blank" rel="noopener noreferrer"
            style={{ background: "#0A72E8" }}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-white text-[13px] font-semibold hover:opacity-90 transition">
            <ExternalLink size={13} /> Open in Google Calendar
          </a>
          <button onClick={onClose} style={{ background: "#F5F5F7" }}
            className="px-4 py-2.5 rounded-xl text-[13px] font-medium text-[#1D1D1F] hover:opacity-80 transition">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Message Detail Modal (Apple-style center popup) ───────────────────
function MessageModal({
  item, t, user, onClose, onDismiss, onCalendar, onFeedback
}: {
  item: DashboardItem;
  t: typeof THEME.light;
  user: UserProfile | null;
  onClose: () => void;
  onDismiss: () => void;
  onCalendar: () => void;
  onFeedback: (cat: string) => void;
}) {
  const meta = CAT[item.category] || CAT.department;
  const Icon = meta.icon;
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(8px)" }}
      onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: t.card, borderColor: t.border }}
        className="w-full max-w-lg rounded-3xl border shadow-2xl flex flex-col max-h-[85vh] overflow-hidden"
        // Simple fade-in via CSS class
      >
        {/* ── Header bar ── */}
        <div style={{ borderColor: t.border }}
          className="flex items-start justify-between px-6 pt-5 pb-4 border-b">
          <div className="flex items-center gap-3">
            <span style={{ background: meta.tint }}
              className="h-10 w-10 rounded-2xl flex items-center justify-center shrink-0">
              <Icon size={18} style={{ color: meta.color }} />
            </span>
            <div>
              <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-2 py-0.5 rounded-full"
                style={{ color: meta.color, background: meta.tint }}>
                {meta.label}
              </span>
              <div style={{ color: t.subtext }} className="text-[11px] mt-0.5 flex items-center gap-1">
                {item.source === "telegram" ? <MessageCircle size={10}/> : <Mail size={10}/>}
                {item.source} · {item.time}
              </div>
            </div>
          </div>
          <button onClick={onClose}
            style={{ background: t.searchBg, color: t.subtext }}
            className="h-7 w-7 rounded-full flex items-center justify-center hover:opacity-70 transition">
            <X size={14} />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="px-6 py-4 overflow-y-auto flex-1">
          {/* Urgency */}
          {item.urgency === "high" && (
            <div className="flex items-center gap-1.5 text-[11px] font-semibold mb-3 px-3 py-2 rounded-xl"
              style={{ background: "rgba(255,59,48,0.08)", color: "#FF3B30" }}>
              <AlertTriangle size={12} /> High Priority — Action needed
            </div>
          )}
          {/* Unverified */}
          {item.confidence !== undefined && item.confidence < 0.7 && (
            <div className="flex items-center gap-1.5 text-[11px] font-medium mb-3 px-3 py-2 rounded-xl"
              style={{ background: "rgba(255,149,0,0.08)", color: "#FF9500" }}>
              <Sparkles size={11} /> AI confidence low — verify this classification
            </div>
          )}

          <h2 style={{ color: t.text }} className="text-[18px] font-bold leading-snug mb-2">
            {item.title}
          </h2>
          <p style={{ color: t.subtext }} className="text-[12.5px] mb-4">
            {item.sender}
          </p>

          {/* Deadline pill */}
          {item.deadline && (
            <div style={{ background: "rgba(30,158,90,0.08)", borderColor: "rgba(30,158,90,0.2)" }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border mb-4 text-[12px] font-semibold"
              style={{ color: "#1E9E5A" } as React.CSSProperties}>
              <Clock size={12} /> Deadline: {item.deadline}
            </div>
          )}

          {/* Message body */}
          <div style={{ color: t.text, borderColor: t.border }}
            className="text-[13px] leading-relaxed whitespace-pre-wrap border-t pt-4">
            {item.preview || "No content available."}
          </div>
        </div>

        {/* ── Footer actions ── */}
        <div style={{ borderColor: t.border }} className="px-6 py-4 border-t space-y-2">
          {user ? (
            <>
              {/* Calendar button */}
              <button onClick={onCalendar}
                disabled={!!item.calendarEventId || !item.deadline}
                style={{
                  background: item.calendarEventId ? "rgba(30,158,90,0.08)" : "#0A72E8",
                  color: item.calendarEventId ? "#1E9E5A" : "#fff",
                  opacity: (!item.deadline && !item.calendarEventId) ? 0.45 : 1,
                }}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-[13.5px] font-semibold transition hover:opacity-85 disabled:cursor-default">
                <CalendarIcon size={15} />
                {item.calendarEventId
                  ? "✓ Event added to Google Calendar"
                  : item.deadline
                    ? "Add deadline to Google Calendar"
                    : "No deadline to add to Calendar"}
              </button>

              {/* Secondary row */}
              <div className="flex gap-2">
                <button onClick={() => setFeedbackOpen(f => !f)}
                  style={{ background: t.searchBg, color: t.subtext }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[12px] font-medium hover:opacity-80 transition">
                  <Tag size={12} /> Wrong category?
                </button>
                <button onClick={onDismiss}
                  style={{ background: t.searchBg, color: "#FF3B30" }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[12px] font-medium hover:opacity-80 transition">
                  <Trash2 size={12} /> Dismiss
                </button>
              </div>

              {/* Feedback category picker */}
              {feedbackOpen && (
                <div style={{ background: t.searchBg }} className="rounded-2xl p-3">
                  <p style={{ color: t.subtext }} className="text-[11px] font-medium mb-2">
                    Correct the category:
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(Object.keys(CAT) as CategoryKey[]).map(cat => (
                      <button key={cat}
                        onClick={() => { onFeedback(cat); setFeedbackOpen(false); }}
                        style={{ background: t.card, borderColor: t.border, color: CAT[cat].color }}
                        className="text-[11.5px] font-medium px-2 py-2 rounded-xl border hover:opacity-80 transition text-left flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full shrink-0" style={{ background: CAT[cat].color }} />
                        {CAT[cat].label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <a href={getLoginUrl()}
              style={{ background: "#0A72E8" }}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-white text-[13.5px] font-semibold hover:opacity-90 transition">
              <LogIn size={15} /> Sign in to use actions
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────────────
export default function CampusDigestDashboard() {
  const now = new Date();
  const [dark, setDark]               = useState(false);
  const [view, setView]               = useState("board");
  const [activeCat, setActiveCat]     = useState("all");
  const [query, setQuery]             = useState("");
  const [selected, setSelected]       = useState<DashboardItem | null>(null);
  const [read, setRead]               = useState<Record<string, boolean>>({});
  const [dismissed, setDismissed]     = useState<Record<string, boolean>>({});
  const [items, setItems]             = useState<DashboardItem[]>(SEED);
  const [user, setUser]               = useState<UserProfile | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loading, setLoading]         = useState(false);
  const [syncing, setSyncing]         = useState(false);
  const [syncToast, setSyncToast]     = useState("");
  const [calSuccess, setCalSuccess]   = useState<{ summary: string; event_link: string } | null>(null);
  const [calError, setCalError]       = useState("");
  const [calMonth, setCalMonth]       = useState(now.getMonth());
  const [calYear, setCalYear]         = useState(now.getFullYear());
  const [calDay, setCalDay]           = useState(now.getDate());
  const [notifGranted, setNotifGranted] = useState(false);
  const [prefs, setPrefs]             = useState<NotificationPrefs | null>(null);

  const t = dark ? THEME.dark : THEME.light;

  // ── Load data ──────────────────────────────────────────────────────
  const loadData = useCallback(async (showLoading = true) => {
    if (!getAuthToken()) { setUser(null); return; }
    if (showLoading) setLoading(true);
    try {
      const [me, board, settings] = await Promise.all([
        fetchCurrentUser(), fetchBoard(), fetchUserSettings()
      ]);
      if (!me) { removeAuthToken(); setUser(null); return; }
      setUser(me);
      if (board) {
        const flat: DashboardItem[] = [];
        (["today","week","later","flagged"] as const).forEach(col => {
          (board[col] || []).forEach(m => flat.push(apiToItem(m)));
        });
        if (flat.length > 0) {
          setItems(flat);
          const rMap: Record<string,boolean> = {};
          flat.forEach(i => { if (i.isRead) rMap[i.id] = true; });
          setRead(r => ({ ...rMap, ...r }));
        }
      }
      if (settings) setPrefs(settings);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const onStorage = (e: StorageEvent) => {
      if (e.key === "campus_digest_token" && e.newValue) loadData();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [loadData]);

  useEffect(() => {
    if (user && "Notification" in window && Notification.permission === "granted") {
      setNotifGranted(true);
    }
  }, [user]);

  // ── Derived ───────────────────────────────────────────────────────
  const filtered = useMemo(() =>
    items
      .filter(i => !dismissed[i.id])
      .filter(i => activeCat === "all" || i.category === activeCat)
      .filter(i => !query.trim() ||
        i.title.toLowerCase().includes(query.toLowerCase()) ||
        i.sender.toLowerCase().includes(query.toLowerCase())),
    [items, dismissed, activeCat, query]
  );

  const grouped = useMemo(() =>
    COLS.map(col => ({ ...col, items: filtered.filter(i => group(i) === col.key) })),
    [filtered]
  );

  const MDAYS = useMemo(() => {
    const n = new Date(calYear, calMonth + 1, 0).getDate();
    return Array.from({ length: n }, (_, i) => i + 1);
  }, [calMonth, calYear]);
  const firstDOW = new Date(calYear, calMonth, 1).getDay();
  const daysWithItems = useMemo(() =>
    new Set(filtered.filter(i => i.month-1 === calMonth && i.year === calYear).map(i => i.day)),
    [filtered, calMonth, calYear]
  );
  const dayItems = filtered.filter(i => i.day === calDay && i.month-1 === calMonth && i.year === calYear);
  const unread = items.filter(i => !read[i.id] && !dismissed[i.id] && i.category !== "spam").length;

  // ── Actions ───────────────────────────────────────────────────────
  const handleOpen = (item: DashboardItem) => {
    setSelected(item);
    if (!read[item.id]) {
      setRead(r => ({ ...r, [item.id]: true }));
      markAsRead(item.id);
    }
  };

  const handleDismiss = (item: DashboardItem) => {
    setDismissed(d => ({ ...d, [item.id]: true }));
    dismissMessage(item.id);
    if (selected?.id === item.id) setSelected(null);
  };

  const handleFeedback = async (cat: string) => {
    if (!selected) return;
    await submitFeedback(selected.id, cat);
    const updated = { ...selected, category: cat as CategoryKey };
    setItems(prev => prev.map(i => i.id === selected.id ? { ...i, category: cat as CategoryKey } : i));
    setSelected(updated);
  };

  const handleCalendar = async () => {
    if (!selected) return;
    if (!selected.deadline) {
      setCalError("This email has no detected deadline. Calendar events need a deadline date.");
      setTimeout(() => setCalError(""), 4000);
      return;
    }
    const res = await addToCalendar(selected.id);
    if (res?.event_link) {
      setSelected(prev => prev ? { ...prev, calendarEventId: res.event_id } : null);
      setItems(prev => prev.map(i => i.id === selected.id ? { ...i, calendarEventId: res.event_id } : i));
      setCalSuccess({ summary: res.summary || selected.title, event_link: res.event_link });
    } else {
      setCalError("Could not create Calendar event. Please try signing out and signing in again to re-grant Calendar access.");
      setTimeout(() => setCalError(""), 5000);
    }
  };

  const handleSyncNow = async () => {
    if (!user) { window.location.href = getLoginUrl(); return; }
    setSyncing(true);
    setSyncToast("Fetching your college emails…");
    const res = await triggerPollNow();
    setSyncToast(res?.message || "Sync started — refresh in 15 seconds");
    setTimeout(async () => {
      await loadData(false);
      setSyncing(false);
      setSyncToast("");
    }, 15000);
  };

  const handleLogin = () => { window.location.href = getLoginUrl(); };
  const handleLogout = () => {
    removeAuthToken(); setUser(null); setItems(SEED); setSelected(null);
  };

  const requestNotifPermission = async () => {
    if (!("Notification" in window)) return;
    const perm = await Notification.requestPermission();
    if (perm === "granted") setNotifGranted(true);
  };

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Display','SF Pro Text',Inter,sans-serif", background:t.bg, color:t.text }}
      className="h-screen w-full flex overflow-hidden relative">

      {/* Calendar success modal */}
      {calSuccess && <CalendarSuccessModal event={calSuccess} onClose={() => setCalSuccess(null)} />}

      {/* Message detail modal */}
      {selected && (
        <MessageModal item={selected} t={t} user={user}
          onClose={() => setSelected(null)}
          onDismiss={() => handleDismiss(selected)}
          onCalendar={handleCalendar}
          onFeedback={handleFeedback} />
      )}

      {/* Calendar error toast */}
      {calError && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 px-4 py-3 rounded-2xl text-[12.5px] font-medium shadow-xl max-w-sm text-center"
          style={{ background:"#FF3B30", color:"#fff" }}>
          {calError}
        </div>
      )}
      {/* Sync toast */}
      {syncToast && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl text-[12.5px] font-medium shadow-xl"
          style={{ background:t.card, color:t.text, border:`1px solid ${t.border}` }}>
          {syncToast}
        </div>
      )}

      {/* ── Sidebar ───────────────────────────────────────────────── */}
      <aside style={{ background:t.sidebar, borderColor:t.border }}
        className="w-[230px] shrink-0 border-r flex flex-col backdrop-blur-xl">
        {/* Brand */}
        <div className="px-5 pt-6 pb-3">
          <div className="flex items-center gap-2 text-[16px] font-bold tracking-tight">
            <span style={{ background:"linear-gradient(135deg,#0A72E8,#1E9E5A)" }}
              className="h-7 w-7 rounded-[9px] flex items-center justify-center shrink-0 shadow">
              <Sparkles size={14} className="text-white" />
            </span>
            Campus Digest
          </div>
          <p style={{ color:t.subtext }} className="text-[11px] mt-1 ml-9">
            {user
              ? unread > 0
                ? <><span style={{ color:"#FF3B30" }} className="font-semibold">{unread}</span> unread</>
                : <span style={{ color:"#1E9E5A" }}>✓ All caught up</span>
              : "Sign in to see your emails"}
          </p>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto">
          {[{ key:"all", label:"All Updates", count:filtered.length },
            ...Object.keys(CAT).map(k => ({
              key:k, label:(CAT[k as CategoryKey].label),
              count:filtered.filter(i => i.category === k).length,
              dot:(CAT[k as CategoryKey].color),
            }))
          ].map(item => (
            <button key={item.key} onClick={() => setActiveCat(item.key)}
              style={{
                background: activeCat === item.key ? t.card : "transparent",
                color: activeCat === item.key ? t.text : t.subtext,
              }}
              className="w-full flex items-center justify-between px-3 py-[7px] rounded-[9px] text-[12.5px] font-medium transition-colors">
              <span className="flex items-center gap-2">
                {"dot" in item && <span className="h-[6px] w-[6px] rounded-full shrink-0" style={{ background:item.dot }} />}
                {item.label}
              </span>
              <span style={{ color:t.subtext }} className="text-[11px]">{item.count}</span>
            </button>
          ))}
        </nav>

        {/* Profile / Login */}
        <div className="px-3 pb-4 space-y-2">
          {user ? (
            <div style={{ background:t.card, borderColor:t.border }} className="rounded-2xl border overflow-hidden">
              <div className="p-3 flex items-center gap-2.5">
                {user.avatar_url
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={user.avatar_url} alt={user.name} width={34} height={34}
                      className="h-[34px] w-[34px] rounded-full object-cover shrink-0" />
                  : <div style={{ background:"linear-gradient(135deg,#0A72E8,#1E9E5A)" }}
                      className="h-[34px] w-[34px] rounded-full flex items-center justify-center text-white text-[13px] font-bold shrink-0">
                      {(user.name||user.email||"U")[0].toUpperCase()}
                    </div>
                }
                <div className="min-w-0">
                  <div className="text-[12.5px] font-semibold truncate">{user.name||"Student"}</div>
                  <div style={{ color:t.subtext }} className="text-[10px] truncate">{user.email}</div>
                </div>
              </div>
              {/* Status badges */}
              <div style={{ borderColor:t.border }} className="border-t px-3 py-2 flex flex-wrap gap-1">
                <span style={{ background:"rgba(30,158,90,0.08)", color:"#1E9E5A" }}
                  className="text-[10px] font-medium px-1.5 py-0.5 rounded flex items-center gap-0.5">
                  <Mail size={9}/> Gmail ✓
                </span>
                <span style={{ background:"rgba(10,114,232,0.08)", color:"#0A72E8" }}
                  className="text-[10px] font-medium px-1.5 py-0.5 rounded flex items-center gap-0.5">
                  <CalendarIcon size={9}/> Calendar ✓
                </span>
                {notifGranted && (
                  <span style={{ background:"rgba(255,149,0,0.08)", color:"#FF9500" }}
                    className="text-[10px] font-medium px-1.5 py-0.5 rounded flex items-center gap-0.5">
                    <Bell size={9}/> Notifs ✓
                  </span>
                )}
              </div>
              {/* Actions */}
              <div style={{ borderColor:t.border }} className="border-t px-3 py-2 flex gap-1.5">
                <button onClick={() => setSettingsOpen(true)}
                  style={{ color:t.subtext, borderColor:t.border }}
                  className="flex-1 flex items-center justify-center gap-1 text-[11px] py-1.5 rounded-lg border hover:opacity-70 transition">
                  <Settings size={10}/> Settings
                </button>
                <button onClick={handleLogout}
                  style={{ color:"#FF3B30", borderColor:t.border }}
                  className="flex-1 flex items-center justify-center gap-1 text-[11px] py-1.5 rounded-lg border hover:opacity-70 transition">
                  <LogOut size={10}/> Sign out
                </button>
              </div>
            </div>
          ) : (
            <button onClick={handleLogin} style={{ background:t.accent }}
              className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-white text-[13px] font-semibold hover:opacity-90 transition shadow">
              <LogIn size={14}/> Sign in with Google
            </button>
          )}

          {user && (
            <button onClick={handleSyncNow} disabled={syncing}
              style={{ borderColor:t.border, color:syncing ? t.subtext : t.accent }}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl border text-[12px] font-medium hover:opacity-80 transition disabled:opacity-50">
              <RefreshCw size={12} className={syncing ? "animate-spin" : ""} />
              {syncing ? "Syncing…" : "Sync emails now"}
            </button>
          )}

          {user && !notifGranted && (
            <button onClick={requestNotifPermission}
              style={{ borderColor:t.border, color:"#FF9500" }}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl border text-[12px] font-medium hover:opacity-80 transition">
              <Bell size={12}/> Enable push notifications
            </button>
          )}
        </div>
      </aside>

      {/* ── Main ──────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header style={{ background:t.headerBg, borderColor:t.border }}
          className="h-14 shrink-0 border-b flex items-center gap-3 px-5 backdrop-blur-xl">
          <div style={{ background:t.searchBg }}
            className="flex items-center gap-2 rounded-[10px] px-3 py-[6px] max-w-sm flex-1">
            <Search size={13} style={{ color:t.subtext }}/>
            <input value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Search updates, senders…"
              style={{ color:t.text, background:"transparent" }}
              className="outline-none text-[12.5px] w-full placeholder:opacity-40"/>
            {query && <button onClick={() => setQuery("")} style={{ color:t.subtext }}><X size={11}/></button>}
          </div>

          {/* View toggle */}
          <div style={{ background:t.searchBg }} className="flex items-center rounded-[10px] p-[3px] gap-[2px]">
            {[{key:"board",icon:LayoutGrid,label:"Board"},{key:"list",icon:ListIcon,label:"List"},{key:"calendar",icon:CalendarIcon,label:"Calendar"}].map(s => (
              <button key={s.key} onClick={() => setView(s.key)}
                style={{
                  background: view===s.key ? t.card : "transparent",
                  color: view===s.key ? t.text : t.subtext,
                  boxShadow: view===s.key ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                }}
                className="flex items-center gap-1.5 text-[11.5px] font-medium px-2.5 py-1.5 rounded-[8px] transition-all">
                <s.icon size={12}/> {s.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2.5 ml-auto">
            <button onClick={() => loadData()} style={{ color:t.subtext }} className={loading ? "animate-spin" : ""}>
              <RefreshCw size={15}/>
            </button>
            <button onClick={() => setDark(d => !d)} style={{ color:t.subtext }}>
              {dark ? <Sun size={16}/> : <Moon size={16}/>}
            </button>
            <button className="relative" style={{ color:t.subtext }}
              onClick={user ? requestNotifPermission : handleLogin}>
              <Bell size={16}/>
              {unread > 0 && (
                <span style={{ background:"#FF3B30" }}
                  className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full text-white text-[8px] flex items-center justify-center font-bold">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </button>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-auto px-5 py-5">

          {/* Sign-in splash */}
          {!user && !loading && (
            <div className="flex flex-col items-center justify-center h-full gap-4 pb-16">
              <div style={{ background:"linear-gradient(135deg,#0A72E8,#1E9E5A)" }}
                className="h-16 w-16 rounded-[18px] flex items-center justify-center shadow-lg">
                <Sparkles size={28} className="text-white"/>
              </div>
              <h2 className="text-[20px] font-bold">Smart Academic Notifications</h2>
              <p style={{ color:t.subtext }} className="text-[14px] text-center max-w-xs leading-relaxed">
                Sign in with your college Google account to see classified emails, deadlines, and urgent notices.
              </p>
              <button onClick={handleLogin} style={{ background:t.accent }}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-white text-[14px] font-semibold hover:opacity-90 transition shadow-md">
                <LogIn size={16}/> Sign in with Google
              </button>
              <p style={{ color:t.subtext }} className="text-[11px]">Preview mode shown below ↓</p>
            </div>
          )}

          {/* ── Board ── */}
          {view === "board" && (
            <div className="grid grid-cols-4 gap-4 min-w-[960px]">
              {grouped.map(col => (
                <div key={col.key}>
                  <div className="mb-3 px-1">
                    <div className="flex items-center gap-1.5 text-[12.5px] font-semibold">
                      <span className="h-[6px] w-[6px] rounded-full shrink-0" style={{ background:col.dot }}/>
                      {col.label}
                      <span style={{ color:t.subtext }} className="font-normal">· {col.items.length}</span>
                    </div>
                    <p style={{ color:t.subtext }} className="text-[10.5px] mt-0.5">{col.sub}</p>
                  </div>
                  <div className="space-y-2.5">
                    {col.items.map(item => (
                      <Card key={item.id} item={item} t={t} isRead={!!read[item.id]}
                        onOpen={() => handleOpen(item)}
                        onDismiss={e => { e.stopPropagation(); handleDismiss(item); }}/>
                    ))}
                    {col.items.length === 0 && (
                      <p style={{ color:t.subtext }} className="text-[11px] italic px-1 py-4 opacity-50">Nothing here.</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── List ── */}
          {view === "list" && (
            <div style={{ background:t.card, borderColor:t.border }} className="rounded-2xl border overflow-hidden max-w-2xl">
              {filtered.length === 0 && (
                <p style={{ color:t.subtext }} className="text-[13px] italic px-6 py-10 text-center opacity-60">No updates found.</p>
              )}
              {filtered.map((item, idx) => {
                const meta = CAT[item.category] || CAT.department;
                const Icon = meta.icon;
                return (
                  <button key={item.id} onClick={() => handleOpen(item)}
                    style={{ borderColor:t.border }}
                    className={`w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-black/[0.025] transition ${idx !== filtered.length-1 ? "border-b" : ""}`}>
                    <span style={{ background:meta.tint }} className="h-8 w-8 rounded-full flex items-center justify-center shrink-0">
                      <Icon size={13} style={{ color:meta.color }}/>
                    </span>
                    <span className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[12.5px] truncate ${read[item.id] ? "opacity-60" : "font-semibold"}`}>{item.title}</span>
                        {item.urgency === "high" && (
                          <span style={{ background:"rgba(255,59,48,0.1)", color:"#FF3B30" }}
                            className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full">URGENT</span>
                        )}
                      </div>
                      <div style={{ color:t.subtext }} className="text-[11px] truncate">{item.sender} · {item.time}</div>
                    </span>
                    {item.deadline && (
                      <span style={{ color:"#1E9E5A" }} className="text-[11px] font-medium shrink-0">{item.deadline}</span>
                    )}
                    <ChevronRight size={13} style={{ color:t.subtext }} className="shrink-0"/>
                  </button>
                );
              })}
            </div>
          )}

          {/* ── Calendar ── */}
          {view === "calendar" && (
            <div className="flex gap-5 max-w-3xl">
              <div style={{ background:t.card, borderColor:t.border }} className="rounded-2xl border p-5 w-[320px] shrink-0">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-[14px] font-semibold">{MONTHS[calMonth]} {calYear}</span>
                  <div className="flex gap-1">
                    <button style={{ color:t.subtext }} onClick={() => {
                      if (calMonth===0) { setCalMonth(11); setCalYear(y=>y-1); } else setCalMonth(m=>m-1);
                    }}><ChevronLeft size={15}/></button>
                    <button style={{ color:t.subtext }} onClick={() => {
                      if (calMonth===11) { setCalMonth(0); setCalYear(y=>y+1); } else setCalMonth(m=>m+1);
                    }}><ChevronRight size={15}/></button>
                  </div>
                </div>
                <div className="grid grid-cols-7 gap-y-1 text-center">
                  {["S","M","T","W","T","F","S"].map((d,i) => (
                    <div key={i} style={{ color:t.subtext }} className="text-[10px] font-medium">{d}</div>
                  ))}
                  {Array.from({length:firstDOW}).map((_,i) => <div key={`e${i}`}/>)}
                  {MDAYS.map(d => {
                    const isTod = d===now.getDate() && calMonth===now.getMonth() && calYear===now.getFullYear();
                    const isSel = d===calDay;
                    return (
                      <button key={d} onClick={() => setCalDay(d)}
                        className="relative h-8 w-8 mx-auto flex flex-col items-center justify-center rounded-full text-[12px]"
                        style={{
                          background: isSel ? t.accent : "transparent",
                          color: isSel ? "#fff" : isTod ? t.accent : t.text,
                          fontWeight: isTod||isSel ? 700 : 400,
                        }}>
                        {d}
                        {daysWithItems.has(d) && (
                          <span className="absolute bottom-0.5 h-[3px] w-[3px] rounded-full"
                            style={{ background: isSel ? "#fff" : t.accent }}/>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex-1">
                <p style={{ color:t.subtext }} className="text-[11.5px] font-medium mb-3">
                  {MONTHS[calMonth]} {calDay} · {dayItems.length} update{dayItems.length!==1?"s":""}
                </p>
                <div className="space-y-2.5">
                  {dayItems.map(item => (
                    <Card key={item.id} item={item} t={t} isRead={!!read[item.id]}
                      onOpen={() => handleOpen(item)}
                      onDismiss={e => { e.stopPropagation(); handleDismiss(item); }}/>
                  ))}
                  {dayItems.length===0 && (
                    <p style={{ color:t.subtext }} className="text-[12px] italic opacity-50">No updates on this day.</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ── Settings Sheet ────────────────────────────────────────── */}
      {settingsOpen && (
        <div className="fixed inset-0 z-30 flex items-center justify-center"
          style={{ background:"rgba(0,0,0,0.4)", backdropFilter:"blur(6px)" }}
          onClick={() => setSettingsOpen(false)}>
          <div onClick={e => e.stopPropagation()}
            style={{ background:t.card, borderColor:t.border }}
            className="w-[380px] rounded-2xl border shadow-2xl overflow-hidden">
            <div style={{ borderColor:t.border }} className="flex items-center justify-between px-5 py-4 border-b">
              <span className="text-[14px] font-semibold">Settings</span>
              <button onClick={() => setSettingsOpen(false)} style={{ color:t.subtext }}><X size={15}/></button>
            </div>
            <div className="px-5 py-2 divide-y" style={{ borderColor:t.border }}>
              <SettRow t={t} icon={Mail} label="Gmail" sub={user ? `Connected — ${user.email}` : "Not connected"} on={!!user}
                onToggle={user ? handleLogout : handleLogin}/>
              <SettRow t={t} icon={CalendarIcon} label="Google Calendar" sub="Auto-add deadlines" on={!!user}
                onToggle={() => {}}/>
              <SettRow t={t} icon={Bell} label="Push Notifications" sub={notifGranted ? "Browser notifications enabled" : "Click to enable"}
                on={notifGranted} onToggle={requestNotifPermission} last/>
            </div>
            {user && (
              <div style={{ borderColor:t.border, background:t.searchBg }}
                className="px-5 py-3 border-t flex items-center justify-between">
                <p style={{ color:t.subtext }} className="text-[11px]">{user.email}</p>
                <button onClick={handleLogout}
                  style={{ color:"#FF3B30", borderColor:t.border }}
                  className="text-[11px] font-medium px-3 py-1.5 rounded-lg border hover:opacity-80 transition flex items-center gap-1">
                  <LogOut size={10}/> Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Card component ─────────────────────────────────────────────────────
function Card({ item, t, isRead, onOpen, onDismiss }: {
  item: DashboardItem; t: typeof THEME.light; isRead: boolean;
  onOpen: () => void; onDismiss: (e: React.MouseEvent) => void;
}) {
  const meta = CAT[item.category] || CAT.department;
  const Icon = meta.icon;
  return (
    <div onClick={onOpen}
      style={{ background:t.card, borderColor:t.border, cursor:"pointer" }}
      className="group relative rounded-2xl border p-3.5 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-2">
        <span style={{ color:meta.color, background:meta.tint }}
          className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full">
          <Icon size={9}/> {meta.label}
        </span>
        <div className="flex items-center gap-1.5">
          {item.urgency === "high" && <span className="h-[5px] w-[5px] rounded-full bg-red-500 animate-pulse"/>}
          {item.source === "telegram" ? <MessageCircle size={11} style={{ color:t.subtext }}/> : <Mail size={11} style={{ color:t.subtext }}/>}
        </div>
      </div>
      <div className={`text-[12.5px] leading-snug mb-1.5 pr-4 ${isRead ? "opacity-60" : "font-semibold"}`}>
        {item.title}
      </div>
      <div style={{ color:t.subtext }} className="text-[10.5px] truncate mb-1">{item.sender}</div>
      <div className="flex items-center justify-between">
        <span style={{ color:t.subtext }} className="text-[10px] flex items-center gap-1">
          {isRead ? <CheckCircle2 size={10}/> : <Circle size={10}/>} {item.time}
        </span>
        {item.deadline && (
          <span style={{ color:"#1E9E5A" }} className="text-[10px] font-semibold flex items-center gap-1">
            <Clock size={10}/> {item.deadline}
          </span>
        )}
      </div>
      {/* Dismiss on hover */}
      <button onClick={onDismiss}
        style={{ background:t.searchBg, color:t.subtext }}
        className="absolute top-2.5 right-2.5 h-5 w-5 rounded-full items-center justify-center opacity-0 group-hover:opacity-100 transition hidden group-hover:flex"
        title="Dismiss">
        <X size={10}/>
      </button>
    </div>
  );
}

// ── Settings row ────────────────────────────────────────────────────────
function SettRow({ t, icon:Icon, label, sub, on, onToggle, last }: {
  t: typeof THEME.light; icon: React.ElementType; label: string; sub: string;
  on: boolean; onToggle: () => void; last?: boolean;
}) {
  return (
    <div style={{ borderColor:t.border }} className={`flex items-center gap-3 py-3 ${!last ? "border-b" : ""}`}>
      <span style={{ background:t.searchBg }} className="h-8 w-8 rounded-full flex items-center justify-center shrink-0">
        <Icon size={13} style={{ color:t.accent }}/>
      </span>
      <span className="flex-1 min-w-0">
        <div className="text-[13px] font-medium">{label}</div>
        <div style={{ color:t.subtext }} className="text-[10.5px]">{sub}</div>
      </span>
      <button onClick={onToggle}
        style={{ background: on ? "#34C759" : t.searchBg }}
        className="w-[40px] h-[24px] rounded-full relative transition-colors shrink-0">
        <span style={{ transform: on ? "translateX(17px)" : "translateX(2px)" }}
          className="absolute top-[2px] h-5 w-5 rounded-full bg-white shadow transition-transform"/>
      </button>
    </div>
  );
}
