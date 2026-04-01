import { useState, useEffect } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Bell, Trash2, Plus, Mail, Info } from "lucide-react";

interface NotificationEmail {
  id: number;
  email: string;
  label: string | null;
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

export default function AdminNotifications() {
  const [emails, setEmails] = useState<NotificationEmail[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);

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
    setAdding(true);
    try {
      const res = await adminFetch("/api/admin/notification-emails", {
        method: "POST",
        body: JSON.stringify({ email: newEmail.trim(), label: newLabel.trim() || null }),
      });
      if (res.ok) {
        const added = await res.json();
        setEmails(prev => [...(prev || []), added]);
        setNewEmail("");
        setNewLabel("");
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "Failed to add email");
      }
    } finally {
      setAdding(false);
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

  return (
    <AdminLayout title="Order Notifications">
      <div className="max-w-2xl">
        <div className="mb-8">
          <p className="text-muted-foreground">
            Add staff email addresses to receive notifications when someone registers or starts the checkout process.
            Each notification includes full attendee details, ticket counts, pricing, and payment information.
          </p>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-sm p-4 flex gap-3 mb-8">
          <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
          <div className="text-sm text-blue-800 space-y-1.5">
            <p>
              <strong>Completed bookings</strong> — Notifications are sent when a card payment is confirmed or an invoice request is submitted.
              Includes full attendee details, pricing, and payment method.
            </p>
            <p>
              <strong>Incomplete forms</strong> — A separate dark-styled notification is sent when someone fills in their attendee details but has not yet completed payment.
              Sent once per checkout session so you can follow up with them.
            </p>
          </div>
        </div>

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
            <ul className="divide-y divide-border">
              {(emails || []).map(e => (
                <li key={e.id} className="flex items-center justify-between px-6 py-4 gap-4">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{e.email}</p>
                    {e.label && (
                      <p className="text-sm text-muted-foreground">{e.label}</p>
                    )}
                  </div>
                  <button
                    onClick={() => handleDelete(e.id)}
                    disabled={deletingId === e.id}
                    className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40 shrink-0"
                    title="Remove"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
