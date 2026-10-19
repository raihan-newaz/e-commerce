import React, { useState } from 'react';
import { Calendar, CheckCircle2, Clock, FileText, MessageSquare, PhoneCall, Plus, Send, ShieldAlert, Tag, User } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import type { Order } from '../../types';

interface OrderNotesCardProps {
  order: Order;
  onRefresh: () => void;
}

interface ParsedNoteEntry {
  id: string;
  timestamp: string;
  title: string;
  content: string;
  type: 'ivr' | 'system' | 'staff' | 'warning' | 'info';
  statusBadge?: string;
  badgeClass?: string;
}

export const OrderNotesCard: React.FC<OrderNotesCardProps> = ({ order, onRefresh }) => {
  const [newNote, setNewNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [isAdding, setIsAdding] = useState(false);

  let checkoutDetails: Record<string, any> = {};
  try {
    checkoutDetails = JSON.parse(order.checkoutDetails || '{}');
  } catch {
    checkoutDetails = {};
  }

  const formatDhakaDateTime = (dateStr?: string | Date) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return String(dateStr);
      return d.toLocaleString('en-GB', {
        timeZone: 'Asia/Dhaka',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });
    } catch {
      return String(dateStr);
    }
  };

  // Parse internalNote lines into structured timeline entries
  const parsedNotes: ParsedNoteEntry[] = [];

  // Parse lines in internalNote
  if (order.internalNote) {
    const rawLines = order.internalNote.split('\n').map((l) => l.trim()).filter(Boolean);

    rawLines.forEach((line, index) => {
      // Check for timestamp like [18/10/2026, 01:25:00 am] or [18 Oct 2026, 01:25 am]
      const tsMatch = line.match(/^\[([0-9A-Za-z/,\s:APMapm]+)\]\s*(.*)$/);
      let timestamp = 'Time not recorded';
      let content = line;

      if (tsMatch && (tsMatch[1].includes(':') || tsMatch[1].includes('/'))) {
        timestamp = tsMatch[1].trim();
        content = tsMatch[2].trim();
      }

      // Check if this line is an IVR call log
      if (line.includes('[IVR') || line.includes('[Automated IVR') || line.includes('result:')) {
        let statusBadge = 'IVR Call';
        let badgeClass = 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300';

        if (line.includes('CONFIRMED')) {
          statusBadge = 'CONFIRMED (নিশ্চিত)';
          badgeClass = 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300';
        } else if (line.includes('CANCELLED')) {
          statusBadge = 'CANCELLED (বাতিল)';
          badgeClass = 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300';
        } else if (line.includes('CALL_ENDED_NO_INPUT')) {
          statusBadge = 'NO INPUT (রিসিভ করে ইনপুট দেয়নি)';
          badgeClass = 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';
        } else if (line.includes('NO_ANSWER')) {
          statusBadge = 'NO ANSWER (উত্তর দেয়নি)';
          badgeClass = 'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-300';
        } else if (line.includes('BUSY')) {
          statusBadge = 'BUSY (ব্যস্ত)';
          badgeClass = 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300';
        }

        parsedNotes.push({
          id: `note-${index}`,
          timestamp,
          title: 'Automated IVR Call Log',
          content,
          type: 'ivr',
          statusBadge,
          badgeClass,
        });
      } else if (line.includes('[Courier review required]') || line.includes('amended after booking')) {
        parsedNotes.push({
          id: `note-${index}`,
          timestamp,
          title: 'Courier Review Required',
          content,
          type: 'warning',
          statusBadge: 'Warning',
          badgeClass: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
        });
      } else if (line.includes('Protection override') || line.includes('Fraud System')) {
        parsedNotes.push({
          id: `note-${index}`,
          timestamp,
          title: 'Order Protection & Security',
          content,
          type: 'warning',
          statusBadge: 'Security',
          badgeClass: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300',
        });
      } else {
        parsedNotes.push({
          id: `note-${index}`,
          timestamp,
          title: 'Internal Note',
          content,
          type: 'staff',
          statusBadge: 'Note',
          badgeClass: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
        });
      }
    });
  }

  // Also include recent IVR logs from messageLogs if available and not redundant
  if (order.messageLogs && order.messageLogs.length > 0) {
    order.messageLogs.forEach((log) => {
      if (log.channel === 'IVR_CALL') {
        const logTime = formatDhakaDateTime(log.createdAt);
        // Avoid duplicate if note with same timestamp/status already captured
        const alreadyExists = parsedNotes.some(
          (n) => n.type === 'ivr' && n.content.includes(`[call:${log.id}]`)
        );
        if (!alreadyExists) {
          let statusBadge = log.status || 'IVR Call';
          let badgeClass = 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300';
          if (log.status === 'CONFIRMED') {
            statusBadge = 'CONFIRMED';
            badgeClass = 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300';
          } else if (log.status === 'CANCELLED') {
            statusBadge = 'CANCELLED';
            badgeClass = 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300';
          } else if (log.status === 'CALL_ENDED_NO_INPUT') {
            statusBadge = 'NO INPUT';
            badgeClass = 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';
          }

          parsedNotes.unshift({
            id: `msg-${log.id}`,
            timestamp: logTime,
            title: `IVR Call to ${log.recipient || order.customerPhone}`,
            content: log.body || `Call status: ${log.status}`,
            type: 'ivr',
            statusBadge,
            badgeClass,
          });
        }
      }
    });
  }

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNote.trim()) return;

    setSavingNote(true);
    try {
      const res = await api.post(`/orders/${order.id}/notes`, { text: newNote.trim() });

      if (res.data?.success) {
        toast.success('Internal note added successfully');
        setNewNote('');
        setIsAdding(false);
        onRefresh();
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to save note');
    } finally {
      setSavingNote(false);
    }
  };

  const hasAnyContent =
    Boolean(order.customerNote) ||
    Object.keys(checkoutDetails).length > 0 ||
    parsedNotes.length > 0 ||
    isAdding;

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40">
        <div className="flex items-center gap-2.5">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400">
            <FileText className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Notes & Checkout Details
            </h3>
            <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
              <Calendar className="h-3 w-3 text-slate-400" />
              <span>Order Placed: {formatDhakaDateTime(order.createdAt)}</span>
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsAdding(!isAdding)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          <Plus className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
          <span>{isAdding ? 'Close Note' : 'Add Note (নোট যোগ করুন)'}</span>
        </button>
      </div>

      <div className="p-5 space-y-4">
        {/* Add Note Form */}
        {isAdding && (
          <form onSubmit={handleAddNote} className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3.5 dark:border-emerald-800/50 dark:bg-emerald-950/20">
            <label className="block text-xs font-bold text-emerald-900 dark:text-emerald-300 mb-1.5">
              New Internal Staff Note (অ্যাডমিন / স্টাফ নোট):
            </label>
            <textarea
              rows={2}
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="e.g. Spoke with customer, confirmed address and delivery time..."
              className="w-full rounded-lg border border-slate-200 bg-white p-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setIsAdding(false); setNewNote(''); }}
                className="rounded-lg px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingNote || !newNote.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1 text-xs font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50"
              >
                <Send className="h-3 w-3" />
                <span>{savingNote ? 'Saving…' : 'Save Note'}</span>
              </button>
            </div>
          </form>
        )}

        {/* 1. Customer Note Card */}
        {order.customerNote && (
          <div className="rounded-xl border border-sky-100 bg-sky-50/60 p-4 dark:border-sky-900/40 dark:bg-sky-950/20">
            <div className="flex items-center justify-between gap-2 border-b border-sky-100 pb-2 dark:border-sky-900/40">
              <div className="flex items-center gap-2 text-sky-800 dark:text-sky-300">
                <MessageSquare className="h-4 w-4" />
                <span className="text-xs font-bold uppercase tracking-wider">
                  Customer Note (গ্রাহকের বিশেষ নির্দেশনা)
                </span>
              </div>
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-sky-600 dark:text-sky-400">
                <Clock className="h-3 w-3" />
                {formatDhakaDateTime(order.createdAt)}
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-800 dark:text-slate-200 leading-relaxed font-medium">
              "{order.customerNote}"
            </p>
          </div>
        )}

        {/* 2. Checkout Custom Details */}
        {Object.keys(checkoutDetails).length > 0 && (
          <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/40">
            <div className="flex items-center justify-between gap-2 border-b border-slate-200/60 pb-2 dark:border-slate-800">
              <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                <Tag className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <span className="text-xs font-bold uppercase tracking-wider">
                  Checkout Form Fields (চেকআউট ফর্মের অতিরিক্ত তথ্য)
                </span>
              </div>
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500">
                <Clock className="h-3 w-3" />
                {formatDhakaDateTime(order.createdAt)}
              </span>
            </div>
            <div className="mt-3 grid gap-2.5 sm:grid-cols-2 md:grid-cols-3">
              {Object.entries(checkoutDetails).map(([key, val]) => (
                <div key={key} className="rounded-lg border border-slate-200/80 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-900 shadow-xs">
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    {key.replace(/_/g, ' ')}
                  </span>
                  <p className="mt-1 text-xs font-semibold text-slate-900 dark:text-white break-words">
                    {String(val)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 3. Internal Notes & Call History Timeline */}
        {parsedNotes.length > 0 ? (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-500">
              <span>Activity & Internal Notes Log (অ্যাক্টিভিটি ও কল হিস্ট্রি):</span>
              <span className="text-[11px] font-normal lowercase">{parsedNotes.length} entries</span>
            </div>

            <div className="divide-y divide-slate-100 rounded-xl border border-slate-100 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-950/40">
              {parsedNotes.map((entry) => (
                <div key={entry.id} className="p-3.5 hover:bg-slate-50/80 dark:hover:bg-slate-900/60 transition">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {entry.type === 'ivr' ? (
                        <PhoneCall className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                      ) : entry.type === 'warning' ? (
                        <ShieldAlert className="h-3.5 w-3.5 text-amber-600" />
                      ) : (
                        <User className="h-3.5 w-3.5 text-slate-500" />
                      )}
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                        {entry.title}
                      </span>
                      {entry.statusBadge && (
                        <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${entry.badgeClass || ''}`}>
                          {entry.statusBadge}
                        </span>
                      )}
                    </div>
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400">
                      <Clock className="h-3 w-3" />
                      {entry.timestamp}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs text-slate-700 dark:text-slate-300 leading-relaxed font-mono whitespace-pre-wrap pl-5">
                    {entry.content}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          !hasAnyContent && (
            <div className="py-6 text-center text-xs text-slate-400">
              No notes or checkout remarks recorded for this order. Click "Add Note" to write one.
            </div>
          )
        )}
      </div>
    </section>
  );
};
