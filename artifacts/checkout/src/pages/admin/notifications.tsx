import { useState, useEffect } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Bell, Trash2, Plus, Mail, Info, CheckCircle2, XCircle } from "lucide-react";

interface NotificationEmail {
  id: number;
  email: string;
  label: string | null;
  notifyComplete: boolean;
  notifyIncomplete: boolean;
  createdAt: string;
}

function adminFetch(path: string, init?: RequestInit) {
  const token = localStorage.getItem("admin_token") || "";
  return fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-admin-token": token,
      ...(init?.headers as Record<string, string>),
    },
  });
}

function Toggle({
  enabled,
  onChange,
  disabled,
}: {
  enabled: boolean;
  onChange: (val: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!enabled)}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
        enabled ? "bg-primary" : "bg-muted-foreground/30"
      } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          enabled ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

export default function AdminNotifications() {
  const [emails, setEmails] = useState<NotificationEmail[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newNotifyComplete, setNewNotifyComplete] = useState(true);
  const [newNotifyIncomplete, setNewNotifyIncomplete] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    adminFetch("/api/admin/notification-emails")
      .then(res => res.ok ? res.json() : [])
      .then(data => setEmails(data))
      .finally(() => setLoading(false));
  }, []);

  const handleAdd = async () => {
    setError("");
    if (!newEmail.trim()) {
      setError("Please enter an email address");
      return;
    }
    if (!newNotifyComplete && !newNotifyIncomplete) {
      setError("Please enable at least one notification type");
      return;
    }
    setAdding(true);
    try {
      const res = await adminFetch("/api/admin/notification-emails", {
        method: "POST",
        body: JSON.stringify({
          email: newEmail.trim(),
          label: newLabel.trim() || null,
          notifyComplete: newNotifyComplete,
          notifyIncomplete: newNotifyIncomplete,
        }),
      });
      if (res.ok) {
        const added = await res.json();
        setEmails(prev => [...(prev || []), added]);
        setNewEmail("");
        setNewLabel("");
        setNewNotifyComplete(true);
        setNewNotifyIncomplete(false);
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "Failed to add email");
      }
    } finally {
      setAdding(false);
    }
  };

  const handleToggle = async (id: number, field: "notifyComplete" | "notifyIncomplete", val: boolean) => {
    setTogglingId(id);
    try {
      const res = await adminFetch(`/api/admin/notification-emails/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ [field]: val }),
      });
      if (res.ok) {
        const updated = await res.json();
        setEmails(prev => (prev || []).map(e => e.id === id ? updated : e));
      }
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async (id: number) => {
    setDeletingId(id);
    try {
      const res = await adminFetch(`/api/admin/notification-emails/${id}`, { method: "DELETE" });
      if (res.ok || res.status === 204) {
        setEmails(prev => (prev || []).filter(e => e.id !== id));
      }
    } finally {
      setDeletingId(null);
    }
  };

  const completeCount = (emails || []).filter(e => e.notifyComplete).length;
  const incompleteCount = (emails || []).filter(e => e.notifyIncomplete).length;

  return (
    <AdminLayout title="Order Notifications">
      <div className="max-w-3xl">
        <div className="mb-8">
          <p className="text-muted-foreground">
            Add staff email addresses to receive notifications when someone registers or starts the checkout process.
            Use the toggles to control which type of notification each address receives.
          </p>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-sm p-4 flex gap-3 mb-8">
          <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
          <div className="text-sm text-blue-800 space-y-1.5">
            <p>
              <strong>Complete bookings</strong> — Sent when a card payment is confirmed or an invoice request is submitted.
              Includes full attendee details, pricing, and payment method.
            </p>
            <p>
              <strong>Incomplete forms</strong> — Sent when someone fills in attendee details but has not yet completed payment.
              Sent once per checkout session so you can follow up.
            </p>
          </div>
        </div>

        {/* Add new email */}
        <div className="bg-white border border-border p-6 mb-6">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
            <Plus className="w-5 h-5" /> Add Notification Email
          </h2>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Email Address *</label>
                <Input
                  type="email"
                  placeholder="e.g. sarah@company.com"
                  value={newEmail}
                  onChange={e => { setNewEmail(e.target.value); setError(""); }}
                  onKeyDown={e => e.key === "Enter" && handleAdd()}
                  className="h-11"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Label <span className="text-muted-foreground font-normal">(optional)</span></label>
                <Input
                  placeholder="e.g. Events Team"
                  value={newLabel}
                  onChange={e => setNewLabel(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleAdd()}
                  className="h-11"
                />
              </div>
            </div>

            {/* Notification type toggles for new email */}
            <div className="flex flex-wrap gap-6 pt-1">
              <div className="flex items-center gap-3">
                <Toggle enabled={newNotifyComplete} onChange={setNewNotifyComplete} />
                <div>
                  <p className="text-sm font-medium">Complete bookings</p>
                  <p className="text-xs text-muted-foreground">Paid or invoiced registrations</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Toggle enabled={newNotifyIncomplete} onChange={setNewNotifyIncomplete} />
                <div>
                  <p className="text-sm font-medium">Incomplete forms</p>
                  <p className="text-xs text-muted-foreground">Attendee details submitted, payment not yet done</p>
                </div>
              </div>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button
              onClick={handleAdd}
              disabled={adding}
              className="bg-primary hover:bg-primary/90 text-white"
            >
              {adding ? "Adding…" : "Add Email"}
            </Button>
          </div>
        </div>

        {/* Recipients list */}
        <div className="bg-white border border-border">
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Bell className="w-5 h-5" /> Notification Recipients
            </h2>
            <span className="text-sm text-muted-foreground">{emails?.length ?? "—"} configured</span>
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : emails && emails.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-6">
              <div className="w-14 h-14 bg-muted rounded-full flex items-center justify-center mb-4">
                <Mail className="w-7 h-7 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground font-medium">No notification emails configured yet.</p>
              <p className="text-sm text-muted-foreground mt-1">Add a staff email address above to get started.</p>
            </div>
          ) : (
            <>
              {/* Column headers */}
              <div className="hidden sm:grid grid-cols-[1fr_140px_140px_40px] gap-4 px-6 py-2 bg-muted/40 border-b border-border text-xs font-bold uppercase tracking-wider text-muted-foreground">
                <span>Recipient</span>
                <span className="text-center">Complete Bookings</span>
                <span className="text-center">Incomplete Forms</span>
                <span />
              </div>
              <ul className="divide-y divide-border">
                {(emails || []).map(e => (
                  <li key={e.id} className="grid grid-cols-1 sm:grid-cols-[1fr_140px_140px_40px] gap-4 items-center px-6 py-4">
                    {/* Email + label */}
                    <div className="min-w-0">
                      <p className="font-medium truncate">{e.email}</p>
                      {e.label && <p className="text-sm text-muted-foreground">{e.label}</p>}
                      {/* Mobile-only labels */}
                      <div className="flex flex-wrap gap-2 mt-2 sm:hidden">
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${e.notifyComplete ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground line-through"}`}>
                          {e.notifyComplete ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                          Complete
                        </span>
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${e.notifyIncomplete ? "bg-amber-100 text-amber-700" : "bg-muted text-muted-foreground line-through"}`}>
                          {e.notifyIncomplete ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                          Incomplete
                        </span>
                      </div>
                    </div>

                    {/* Complete toggle */}
                    <div className="hidden sm:flex justify-center">
                      <Toggle
                        enabled={e.notifyComplete}
                        onChange={val => handleToggle(e.id, "notifyComplete", val)}
                        disabled={togglingId === e.id}
                      />
                    </div>

                    {/* Incomplete toggle */}
                    <div className="hidden sm:flex justify-center">
                      <Toggle
                        enabled={e.notifyIncomplete}
                        onChange={val => handleToggle(e.id, "notifyIncomplete", val)}
                        disabled={togglingId === e.id}
                      />
                    </div>

                    {/* Delete */}
                    <div className="flex justify-end sm:justify-center">
                      <button
                        onClick={() => handleDelete(e.id)}
                        disabled={deletingId === e.id}
                        className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40"
                        title="Remove"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>

              {/* Summary footer */}
              {(emails?.length ?? 0) > 0 && (
                <div className="px-6 py-3 bg-muted/20 border-t border-border flex flex-wrap gap-4 text-sm text-muted-foreground">
                  <span><strong className="text-foreground">{completeCount}</strong> receive complete booking notifications</span>
                  <span><strong className="text-foreground">{incompleteCount}</strong> receive incomplete form notifications</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
