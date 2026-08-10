"use client";

import React, { useState, useMemo, useEffect } from "react";
import {
  Search, Bell, Calendar as CalendarIcon, GraduationCap, Users, Building2,
  AlertTriangle, Clock, CheckCircle2, Circle, ChevronRight, ChevronLeft,
  MessageCircle, Mail, Sparkles, X, Moon, Sun, Settings, LayoutGrid,
  List as ListIcon, BellRing, Trash2, LogIn
} from "lucide-react";
import { fetchBoard, markAsRead, dismissMessage, fetchCurrentUser } from "@/lib/api";

type CategoryKey = "placement" | "faculty" | "department" | "spam";

const CATEGORY_META: Record<CategoryKey, { label: string; color: string; tint: string; icon: React.ElementType }> = {
  placement: { label: "Placement & TPO", color: "#1E9E5A", tint: "rgba(30,158,90,0.12)", icon: GraduationCap },
  faculty:   { label: "Faculty",          color: "#0A72E8", tint: "rgba(10,114,232,0.10)", icon: Users },
  department:{ label: "Department",       color: "#FF9500", tint: "rgba(255,149,0,0.12)",  icon: Building2 },
  spam:      { label: "Flagged",          color: "#FF3B30", tint: "rgba(255,59,48,0.10)",  icon: AlertTriangle },
};

interface Item {
  id: number | string;
  day: number;
  source: string;
  category: CategoryKey;
  sender: string;
  title: string;
  time: string;
  urgency: "high" | "medium" | "low";
  deadline: string | null;
  preview: string;
}

const DEFAULT_ITEMS: Item[] = [
  { id: 1, day: 10, source: "gmail", category: "placement", sender: "TPO Cell — tpo@clg.edu.in",
    title: "Internship Drive: Infosys Springboard — Form closes today", time: "2h ago",
    urgency: "high", deadline: "Today, 5:00 PM",
    preview: "Eligible 3rd/4th year students must submit the registration form before the deadline. Resume upload mandatory. Late submissions will not be considered under any circumstances." },
  { id: 2, day: 10, source: "telegram", category: "placement", sender: "College Official · TPO Announcements",
    title: "Reminder: Pre-placement talk today, 4 PM, Seminar Hall", time: "3h ago",
    urgency: "high", deadline: "Today, 4:00 PM",
    preview: "Attendance is being tracked for all pre-final year students. Carry your ID card to the seminar hall." },
  { id: 3, day: 11, source: "gmail", category: "faculty", sender: "Dr. Mehta · Theory of Computation",
    title: "Assignment 4 evaluation sheet uploaded", time: "5h ago",
    urgency: "medium", deadline: null,
    preview: "Feedback on your automata conversion submission is now available on the shared drive." },
  { id: 4, day: 12, source: "gmail", category: "department", sender: "CSE Department Office",
    title: "Mid-sem timetable revised — check updated slots", time: "1d ago",
    urgency: "medium", deadline: "Aug 12",
    preview: "Two lab sessions have been swapped due to faculty availability. Revised PDF attached to this email." },
  { id: 5, day: 10, source: "gmail", category: "spam", sender: "\"CareerBoost Academy\"",
    title: "Guaranteed Internship + Certificate — Limited Seats", time: "6h ago",
    urgency: "low", deadline: null,
    preview: "Pay a small fee to unlock your guaranteed internship certificate today. Offer expires in 2 hours." },
  { id: 6, day: 14, source: "telegram", category: "department", sender: "College Official · General Notices",
    title: "Library timings extended during exam week", time: "1d ago",
    urgency: "low", deadline: null,
    preview: "Reading room will stay open till 11 PM from Aug 18 to Aug 30 to support exam preparation." },
  { id: 7, day: 16, source: "gmail", category: "placement", sender: "TPO Cell — tpo@clg.edu.in",
    title: "Aptitude mock test — registration opens Aug 16", time: "just now",
    urgency: "medium", deadline: "Aug 16", preview: "Slot booking for the HirePro mock aptitude round opens at 9 AM. Limited slots per batch." },
];

function timelineGroup(item: Item) {
  if (item.category === "spam") return "flagged";
  if (item.urgency === "high") return "today";
  if (item.urgency === "medium") return "week";
  return "later";
}

const COLUMNS = [
  { key: "today", label: "Act now", sub: "Due within 24 hours" },
  { key: "week", label: "This week", sub: "Coming up" },
  { key: "later", label: "For reference", sub: "No action needed" },
  { key: "flagged", label: "Flagged", sub: "Verify before trusting" },
];

const MONTH_DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
const TODAY = 10;

const THEME = {
  light: { bg: "#F5F5F7", sidebar: "rgba(255,255,255,0.72)", headerBg: "rgba(245,245,247,0.85)",
    card: "#FFFFFF", border: "#E5E5EA", text: "#1D1D1F", subtext: "#86868B",
    searchBg: "#ECECEE", accent: "#0A72E8" },
  dark: { bg: "#161617", sidebar: "rgba(28,28,30,0.72)", headerBg: "rgba(22,22,23,0.85)",
    card: "#1C1C1E", border: "#2C2C2E", text: "#F5F5F7", subtext: "#98989D",
    searchBg: "#242426", accent: "#409CFF" },
};

export default function CampusDigestDashboard() {
  const [dark, setDark] = useState(false);
  const [view, setView] = useState("board");
  const [activeCat, setActiveCat] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Item | null>(null);
  const [read, setRead] = useState<Record<string | number, boolean>>({});
  const [dismissed, setDismissed] = useState<Record<string | number, boolean>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [calDay, setCalDay] = useState(TODAY);
  const [items, setItems] = useState<Item[]>(DEFAULT_ITEMS);
  const [channels, setChannels] = useState({ gmail: true, telegram: true, push: true, digest: true });
  const [user, setUser] = useState<{ email?: string; name?: string } | null>(null);

  const t = dark ? THEME.dark : THEME.light;

  useEffect(() => {
    // Try fetching user session
    fetchCurrentUser().then((userData) => {
      if (userData) setUser(userData);
    });

    // Try fetching real items from backend
    fetchBoard().then((boardData) => {
      if (boardData && typeof boardData === "object") {
        const flat: Item[] = [];
        Object.keys(boardData).forEach((k) => {
          if (Array.isArray(boardData[k])) {
            boardData[k].forEach((m: any) => {
              flat.push({
                id: m.id,
                day: new Date(m.received_at || Date.now()).getDate(),
                source: m.source || "gmail",
                category: (m.category as CategoryKey) || "department",
                sender: m.sender || "College Notice",
                title: m.subject || "No Subject",
                time: "recent",
                urgency: m.urgency || "low",
                deadline: m.deadline || null,
                preview: m.body_text || "",
              });
            });
          }
        });
        if (flat.length > 0) setItems(flat);
      }
    });
  }, []);

  const filtered = items
    .filter((i) => !dismissed[i.id])
    .filter((i) => activeCat === "all" || i.category === activeCat)
    .filter((i) =>
      query.trim() === "" ||
      i.title.toLowerCase().includes(query.toLowerCase()) ||
      i.sender.toLowerCase().includes(query.toLowerCase())
    );

  const grouped = COLUMNS.map((col) => ({
    ...col,
    items: filtered.filter((i) => timelineGroup(i) === col.key),
  }));

  const dayItems = filtered.filter((i) => i.day === calDay);
  const daysWithItems = useMemo(() => new Set(filtered.map((i) => i.day)), [filtered]);

  const unread = items.filter((i) => !read[i.id] && !dismissed[i.id]).length;

  const handleOAuthLogin = () => {
    const backendAuthUrl = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api") + "/auth/login";
    window.location.href = backendAuthUrl;
  };

  return (
    <div
      style={{
        fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', Inter, sans-serif",
        background: t.bg, color: t.text,
      }}
      className="h-screen w-full flex overflow-hidden relative transition-colors duration-300"
    >
      {/* Sidebar */}
      <aside
        style={{ background: t.sidebar, borderColor: t.border }}
        className="w-64 shrink-0 border-r flex flex-col backdrop-blur-xl"
      >
        <div className="px-5 pt-6 pb-5">
          <div className="flex items-center gap-2 text-[17px] font-semibold tracking-tight">
            <span
              style={{ background: "linear-gradient(135deg,#0A72E8,#1E9E5A)" }}
              className="inline-flex h-7 w-7 rounded-[9px] items-center justify-center shadow-sm"
            >
              <Sparkles size={15} className="text-white" />
            </span>
            Campus Digest
          </div>
          <p style={{ color: t.subtext }} className="text-[12px] mt-1 ml-9 -mt-0.5">
            {unread} unread
          </p>
        </div>

        <nav className="flex-1 px-3 space-y-0.5">
          <SidebarItem t={t} active={activeCat === "all"} label="All Updates"
            count={items.filter(i=>!dismissed[i.id]).length} onClick={() => setActiveCat("all")} />
          {(Object.keys(CATEGORY_META) as CategoryKey[]).map((key) => {
            const meta = CATEGORY_META[key];
            return (
              <SidebarItem key={key} t={t} active={activeCat === key} label={meta.label}
                count={items.filter((i) => i.category === key && !dismissed[i.id]).length}
                dot={meta.color} onClick={() => setActiveCat(key)} />
            );
          })}
        </nav>

        <div className="px-3 pb-3">
          <div style={{ background: t.card, borderColor: t.border }} className="rounded-2xl p-3.5 border">
            <div className="flex items-center gap-2 text-[12.5px] font-medium">
              <CalendarIcon size={14} style={{ color: t.accent }} /> Synced to Calendar
            </div>
            <p style={{ color: t.subtext }} className="text-[11px] mt-1 leading-snug">
              3 deadlines added automatically this week
            </p>
          </div>
        </div>

        <div className="px-3 mb-4 space-y-2">
          {user ? (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-[12px] bg-black/5 dark:bg-white/5">
              <span className="font-medium truncate">{user.email || user.name}</span>
            </div>
          ) : (
            <button
              onClick={handleOAuthLogin}
              style={{ background: t.accent }}
              className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-white text-[12.5px] font-medium hover:opacity-90 transition shadow-sm"
            >
              <LogIn size={14} /> Sign in with Google
            </button>
          )}

          <button
            onClick={() => setSettingsOpen(true)}
            style={{ borderColor: t.border, color: t.subtext }}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border text-[12.5px] hover:opacity-80 transition"
          >
            <Settings size={14} /> Connected accounts
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        <header
          style={{ background: t.headerBg, borderColor: t.border }}
          className="h-16 shrink-0 border-b flex items-center gap-4 px-6 backdrop-blur-xl"
        >
          <div
            style={{ background: t.searchBg }}
            className="flex items-center gap-2 rounded-[10px] px-3 py-[7px] max-w-sm flex-1"
          >
            <Search size={14} style={{ color: t.subtext }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search updates, senders..."
              style={{ color: t.text }}
              className="bg-transparent outline-none text-[13px] w-full placeholder:opacity-50"
            />
          </div>

          {/* Segmented control */}
          <div style={{ background: t.searchBg }} className="flex items-center rounded-[10px] p-[3px] gap-[2px]">
            {[
              { key: "board", icon: LayoutGrid, label: "Board" },
              { key: "list", icon: ListIcon, label: "List" },
              { key: "calendar", icon: CalendarIcon, label: "Calendar" },
            ].map((s) => (
              <button
                key={s.key}
                onClick={() => setView(s.key)}
                style={{
                  background: view === s.key ? t.card : "transparent",
                  color: view === s.key ? t.text : t.subtext,
                  boxShadow: view === s.key ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                }}
                className="flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-[8px] transition-all"
              >
                <s.icon size={13} /> {s.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <button onClick={() => setDark((d) => !d)} style={{ color: t.subtext }}>
              {dark ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <button className="relative" style={{ color: t.subtext }}>
              <Bell size={17} />
              {unread > 0 && (
                <span
                  style={{ background: "#FF3B30" }}
                  className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full text-white text-[9px] flex items-center justify-center font-semibold"
                >
                  {unread}
                </span>
              )}
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-auto px-6 py-6">
          {view === "board" && (
            <div className="grid grid-cols-4 gap-4 min-w-[1040px]">
              {grouped.map((col) => (
                <div key={col.key} className="flex flex-col">
                  <div className="mb-3 px-1">
                    <div className="flex items-center gap-1.5 text-[13px] font-semibold">
                      <span className="h-[7px] w-[7px] rounded-full" style={{
                        background: col.key === "today" ? "#1E9E5A" : col.key === "week" ? "#FF9500" :
                          col.key === "flagged" ? "#FF3B30" : t.subtext,
                      }} />
                      {col.label}
                      <span style={{ color: t.subtext }} className="font-normal">· {col.items.length}</span>
                    </div>
                    <p style={{ color: t.subtext }} className="text-[11px] mt-0.5">{col.sub}</p>
                  </div>
                  <div className="space-y-2.5">
                    {col.items.map((item) => (
                      <Card key={item.id} item={item} t={t} isRead={!!read[item.id]}
                        onOpen={() => {
                          setSelected(item);
                          setRead((r) => ({ ...r, [item.id]: true }));
                          markAsRead(String(item.id));
                        }}
                        onDismiss={() => {
                          setDismissed((d) => ({ ...d, [item.id]: true }));
                          dismissMessage(String(item.id));
                        }} />
                    ))}
                    {col.items.length === 0 && (
                      <div style={{ color: t.subtext }} className="text-[11.5px] italic px-1 py-4 opacity-60">
                        Nothing here.
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {view === "list" && (
            <div style={{ background: t.card, borderColor: t.border }} className="rounded-2xl border overflow-hidden max-w-3xl">
              {filtered.map((item, idx) => {
                const meta = CATEGORY_META[item.category] || CATEGORY_META.department;
                const Icon = meta.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setSelected(item);
                      setRead((r) => ({ ...r, [item.id]: true }));
                      markAsRead(String(item.id));
                    }}
                    style={{ borderColor: t.border }}
                    className={`w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-black/[0.02] transition ${idx !== filtered.length - 1 ? "border-b" : ""}`}
                  >
                    <span style={{ background: meta.tint }} className="h-8 w-8 rounded-full flex items-center justify-center shrink-0">
                      <Icon size={14} style={{ color: meta.color }} />
                    </span>
                    <span className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-[13px] truncate ${read[item.id] ? "font-normal" : "font-semibold"}`}>{item.title}</span>
                      </div>
                      <div style={{ color: t.subtext }} className="text-[11.5px] truncate">{item.sender} · {item.time}</div>
                    </span>
                    {item.deadline && (
                      <span style={{ color: meta.color }} className="text-[11px] font-medium shrink-0">{item.deadline}</span>
                    )}
                    <ChevronRight size={14} style={{ color: t.subtext }} className="shrink-0" />
                  </button>
                );
              })}
            </div>
          )}

          {view === "calendar" && (
            <div className="flex gap-5 max-w-4xl">
              <div style={{ background: t.card, borderColor: t.border }} className="rounded-2xl border p-5 w-[360px] shrink-0">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-[15px] font-semibold">August 2026</span>
                  <div className="flex gap-1">
                    <button style={{ color: t.subtext }}><ChevronLeft size={16} /></button>
                    <button style={{ color: t.subtext }}><ChevronRight size={16} /></button>
                  </div>
                </div>
                <div className="grid grid-cols-7 gap-y-2 text-center">
                  {["S","M","T","W","T","F","S"].map((d,i) => (
                    <div key={i} style={{ color: t.subtext }} className="text-[10.5px] font-medium">{d}</div>
                  ))}
                  {MONTH_DAYS.map((d) => (
                    <button
                      key={d}
                      onClick={() => setCalDay(d)}
                      className="relative h-9 flex flex-col items-center justify-center rounded-full text-[12.5px] mx-auto w-9"
                      style={{
                        background: d === calDay ? t.accent : "transparent",
                        color: d === calDay ? "#fff" : d === TODAY ? t.accent : t.text,
                        fontWeight: d === TODAY || d === calDay ? 600 : 400,
                      }}
                    >
                      {d}
                      {daysWithItems.has(d) && (
                        <span
                          style={{ background: d === calDay ? "#fff" : t.accent }}
                          className="absolute bottom-1 h-[3px] w-[3px] rounded-full"
                        />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex-1">
                <p style={{ color: t.subtext }} className="text-[12px] font-medium mb-3">
                  Aug {calDay} · {dayItems.length} update{dayItems.length !== 1 ? "s" : ""}
                </p>
                <div className="space-y-2.5">
                  {dayItems.map((item) => (
                    <Card key={item.id} item={item} t={t} isRead={!!read[item.id]}
                      onOpen={() => {
                        setSelected(item);
                        setRead((r) => ({ ...r, [item.id]: true }));
                        markAsRead(String(item.id));
                      }}
                      onDismiss={() => {
                        setDismissed((d) => ({ ...d, [item.id]: true }));
                        dismissMessage(String(item.id));
                      }} />
                  ))}
                  {dayItems.length === 0 && (
                    <div style={{ color: t.subtext }} className="text-[12px] italic opacity-60">No updates on this day.</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Detail panel */}
      {selected && (
        <aside style={{ background: t.card, borderColor: t.border }} className="w-80 shrink-0 border-l flex flex-col">
          <div style={{ borderColor: t.border }} className="h-16 flex items-center justify-between px-5 border-b">
            <span style={{ color: t.subtext }} className="text-[12px] font-medium">Details</span>
            <button onClick={() => setSelected(null)} style={{ color: t.subtext }}><X size={16} /></button>
          </div>
          <div className="p-5 flex-1 overflow-auto">
            <span
              className="inline-flex items-center gap-1 text-[10.5px] font-medium px-2 py-1 rounded-full mb-3"
              style={{ color: (CATEGORY_META[selected.category] || CATEGORY_META.department).color,
                        background: (CATEGORY_META[selected.category] || CATEGORY_META.department).tint }}
            >
              {(CATEGORY_META[selected.category] || CATEGORY_META.department).label}
            </span>
            <h2 className="text-[16px] font-semibold leading-snug mb-2">{selected.title}</h2>
            <p style={{ color: t.subtext }} className="text-[12px] mb-4">{selected.sender} · {selected.time}</p>
            <p style={{ color: t.text, opacity: 0.85 }} className="text-[13px] leading-relaxed mb-5">{selected.preview}</p>
            {selected.deadline && (
              <div style={{ background: t.searchBg }} className="rounded-xl p-3 mb-4">
                <div className="flex items-center gap-2 text-[12px] font-medium" style={{ color: "#1E9E5A" }}>
                  <Clock size={13} /> Deadline: {selected.deadline}
                </div>
              </div>
            )}
            <div className="space-y-2">
              <ActionBtn icon={CalendarIcon} label="Add to Calendar" primary t={t} />
              <ActionBtn icon={BellRing} label="Remind me again" t={t} />
              {selected.category === "spam" && (
                <ActionBtn icon={Trash2} label="Mark as spam & dismiss" danger t={t}
                  onClick={() => {
                    setDismissed((d) => ({ ...d, [selected.id]: true }));
                    dismissMessage(String(selected.id));
                    setSelected(null);
                  }} />
              )}
            </div>
          </div>
        </aside>
      )}

      {/* Settings sheet */}
      {settingsOpen && (
        <div className="absolute inset-0 z-20 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.35)" }}
          onClick={() => setSettingsOpen(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: t.card, borderColor: t.border }}
            className="w-[380px] rounded-2xl border shadow-2xl overflow-hidden"
          >
            <div style={{ borderColor: t.border }} className="flex items-center justify-between px-5 py-4 border-b">
              <span className="text-[14px] font-semibold">Connected accounts</span>
              <button onClick={() => setSettingsOpen(false)} style={{ color: t.subtext }}><X size={16} /></button>
            </div>
            <div className="px-5 py-2">
              <SettingRow t={t} icon={Mail} label="Gmail" sub="College official inbox" value={channels.gmail}
                onToggle={() => setChannels((c) => ({ ...c, gmail: !c.gmail }))} />
              <SettingRow t={t} icon={MessageCircle} label="Telegram" sub="College Official group" value={channels.telegram}
                onToggle={() => setChannels((c) => ({ ...c, telegram: !c.telegram }))} />
              <SettingRow t={t} icon={Bell} label="Push notifications" sub="For high-priority updates" value={channels.push}
                onToggle={() => setChannels((c) => ({ ...c, push: !c.push }))} />
              <SettingRow t={t} icon={CalendarIcon} label="Daily digest" sub="9 AM summary via Telegram bot" value={channels.digest}
                onToggle={() => setChannels((c) => ({ ...c, digest: !c.digest }))} last />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SidebarItem({ t, active, label, count, dot, onClick }: any) {
  return (
    <button
      onClick={onClick}
      style={{ background: active ? t.card : "transparent", color: active ? t.text : t.subtext }}
      className="w-full flex items-center justify-between px-3 py-[7px] rounded-[9px] text-[13px] transition-colors font-medium"
    >
      <span className="flex items-center gap-2">
        {dot && <span className="h-[7px] w-[7px] rounded-full" style={{ background: dot }} />}
        {label}
      </span>
      <span style={{ color: t.subtext }} className="text-[11px]">{count}</span>
    </button>
  );
}

function Card({ item, t, isRead, onOpen, onDismiss }: any) {
  const meta = CATEGORY_META[item.category as CategoryKey] || CATEGORY_META.department;
  const Icon = meta.icon;
  return (
    <div
      style={{ background: t.card, borderColor: t.border, boxShadow: isRead ? "none" : "0 1px 3px rgba(0,0,0,0.06)" }}
      className="group relative rounded-2xl border p-3.5 transition-shadow hover:shadow-md"
    >
      <button onClick={onOpen} className="text-left w-full">
        <div className="flex items-center justify-between mb-1.5">
          <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full"
            style={{ color: meta.color, background: meta.tint }}>
            <Icon size={10} /> {meta.label}
          </span>
          {item.source === "telegram" ? <MessageCircle size={12} style={{ color: t.subtext }} /> : <Mail size={12} style={{ color: t.subtext }} />}
        </div>
        <div className="text-[13px] font-medium leading-snug mb-1 pr-2">{item.title}</div>
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
      <button
        onClick={onDismiss}
        style={{ background: t.searchBg, color: t.subtext }}
        className="absolute top-3 right-3 h-5 w-5 rounded-full opacity-0 group-hover:opacity-100 transition items-center justify-center hidden group-hover:flex"
        title="Dismiss"
      >
        <X size={11} />
      </button>
    </div>
  );
}

function ActionBtn({ icon: Icon, label, primary, danger, t, onClick }: any) {
  return (
    <button
      onClick={onClick}
      style={{
        background: primary ? t.accent : danger ? "transparent" : t.searchBg,
        color: primary ? "#fff" : danger ? "#FF3B30" : t.text,
      }}
      className="w-full text-[12.5px] font-medium rounded-[10px] py-2.5 flex items-center justify-center gap-1.5 transition hover:opacity-85"
    >
      <Icon size={13} /> {label}
    </button>
  );
}

function SettingRow({ t, icon: Icon, label, sub, value, onToggle, last }: any) {
  return (
    <div style={{ borderColor: t.border }} className={`flex items-center gap-3 py-3 ${!last ? "border-b" : ""}`}>
      <span style={{ background: t.searchBg }} className="h-8 w-8 rounded-full flex items-center justify-center shrink-0">
        <Icon size={14} style={{ color: t.accent }} />
      </span>
      <span className="flex-1 min-w-0">
        <div className="text-[13px] font-medium">{label}</div>
        <div style={{ color: t.subtext }} className="text-[11px]">{sub}</div>
      </span>
      <button
        onClick={onToggle}
        style={{ background: value ? "#34C759" : t.searchBg }}
        className="w-[42px] h-[25px] rounded-full relative transition-colors shrink-0"
      >
        <span
          style={{ transform: value ? "translateX(18px)" : "translateX(2px)" }}
          className="absolute top-[2px] h-[21px] w-[21px] rounded-full bg-white shadow transition-transform"
        />
      </button>
    </div>
  );
}
