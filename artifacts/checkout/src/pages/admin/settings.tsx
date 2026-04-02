import { useState, useEffect } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Check, Lock, Unlock, Settings2 } from "lucide-react";

interface EventSettings {
  eventName: string;
  eventDate: string;
  eventVenue: string;
  eventVenuePostcode: string;
  orgName: string;
  orgAddress: string;
  orgWebsite: string;
  fromName: string;
  fromEmail: string;
  attendeeChangesLocked: boolean;
  attendeeChangesLockedMessage: string | null;
}

const DEFAULT_LOCKED_MESSAGE =
  "Attendee changes are now closed. If you need to make a change, please contact us at events@hranalyticssummit.com";

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

export default function AdminSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [lockSaving, setLockSaving] = useState(false);
  const [lockSaved, setLockSaved] = useState(false);
  const [error, setError] = useState("");
  const [lockError, setLockError] = useState("");

  const [form, setForm] = useState<EventSettings>({
    eventName: "HR Analytics Summit",
    eventDate: "3 September 2026",
    eventVenue: "155 Bishopsgate, London",
    eventVenuePostcode: "EC2M 3TQ",
    orgName: "Dynamic Business Leaders Limited",
    orgAddress: "London, UK",
    orgWebsite: "https://www.hranalyticssummit.com",
    fromName: "HR Analytics Summit",
    fromEmail: "noreply@hranalyticssummit.com",
    attendeeChangesLocked: false,
    attendeeChangesLockedMessage: null,
  });

  useEffect(() => {
    setLoading(true);
    adminFetch("/api/admin/event-settings")
      .then(res => res.ok ? res.json() : null)
      .then((data: EventSettings | null) => {
        if (data) {
          setForm({
            eventName: data.eventName,
            eventDate: data.eventDate,
            eventVenue: data.eventVenue,
            eventVenuePostcode: data.eventVenuePostcode,
            orgName: data.orgName,
            orgAddress: data.orgAddress,
            orgWebsite: data.orgWebsite,
            fromName: data.fromName,
            fromEmail: data.fromEmail,
            attendeeChangesLocked: data.attendeeChangesLocked ?? false,
            attendeeChangesLockedMessage: data.attendeeChangesLockedMessage ?? null,
          });
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const res = await adminFetch("/api/admin/event-settings", {
        method: "PUT",
        body: JSON.stringify({
          eventName: form.eventName,
          eventDate: form.eventDate,
          eventVenue: form.eventVenue,
          eventVenuePostcode: form.eventVenuePostcode,
          orgName: form.orgName,
          orgAddress: form.orgAddress,
          orgWebsite: form.orgWebsite,
          fromName: form.fromName,
          fromEmail: form.fromEmail,
        }),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "Failed to save settings");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleLockSave = async () => {
    setLockError("");
    setLockSaving(true);
    try {
      const res = await adminFetch("/api/admin/event-settings", {
        method: "PUT",
        body: JSON.stringify({
          attendeeChangesLocked: form.attendeeChangesLocked,
          attendeeChangesLockedMessage: form.attendeeChangesLockedMessage || DEFAULT_LOCKED_MESSAGE,
        }),
      });
      if (res.ok) {
        setLockSaved(true);
        setTimeout(() => setLockSaved(false), 2500);
      } else {
        const body = await res.json().catch(() => ({}));
        setLockError(body.error || "Failed to save");
      }
    } finally {
      setLockSaving(false);
    }
  };

  const toggleLock = (locked: boolean) => {
    setForm(f => ({
      ...f,
      attendeeChangesLocked: locked,
      attendeeChangesLockedMessage:
        f.attendeeChangesLockedMessage || DEFAULT_LOCKED_MESSAGE,
    }));
  };

  return (
    <AdminLayout title="Settings">
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : (
        <div className="max-w-2xl space-y-8">

          {/* ── Event Details ── */}
          <form onSubmit={handleSave} className="bg-white border border-border">
            <div className="px-6 py-4 border-b border-border flex items-center gap-3">
              <Settings2 className="w-5 h-5 text-primary" />
              <h2 className="font-bold text-base">Event &amp; Organisation Details</h2>
            </div>
            <div className="p-6 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Event Name</label>
                  <Input value={form.eventName} onChange={e => setForm(f => ({ ...f, eventName: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Event Date</label>
                  <Input value={form.eventDate} onChange={e => setForm(f => ({ ...f, eventDate: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Venue</label>
                  <Input value={form.eventVenue} onChange={e => setForm(f => ({ ...f, eventVenue: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Postcode</label>
                  <Input value={form.eventVenuePostcode} onChange={e => setForm(f => ({ ...f, eventVenuePostcode: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Organisation Name</label>
                  <Input value={form.orgName} onChange={e => setForm(f => ({ ...f, orgName: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Organisation Address</label>
                  <Input value={form.orgAddress} onChange={e => setForm(f => ({ ...f, orgAddress: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Website</label>
                <Input value={form.orgWebsite} onChange={e => setForm(f => ({ ...f, orgWebsite: e.target.value }))} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Email Sender Name</label>
                  <Input value={form.fromName} onChange={e => setForm(f => ({ ...f, fromName: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Email Sender Address</label>
                  <Input type="email" value={form.fromEmail} onChange={e => setForm(f => ({ ...f, fromEmail: e.target.value }))} />
                </div>
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <div className="flex justify-end">
                <Button
                  type="submit"
                  disabled={saving}
                  className={`h-10 px-6 ${saved ? "bg-green-600 hover:bg-green-700" : "bg-primary hover:bg-primary/90"} text-white`}
                >
                  {saved ? (
                    <span className="flex items-center gap-1.5"><Check className="w-4 h-4" /> Saved</span>
                  ) : saving ? "Saving…" : "Save Changes"}
                </Button>
              </div>
            </div>
          </form>

          {/* ── Attendee Self-Service ── */}
          <div className="bg-white border border-border">
            <div className="px-6 py-4 border-b border-border flex items-center gap-3">
              {form.attendeeChangesLocked ? (
                <Lock className="w-5 h-5 text-red-500" />
              ) : (
                <Unlock className="w-5 h-5 text-green-600" />
              )}
              <h2 className="font-bold text-base">Attendee Self-Service</h2>
              <span className={`ml-auto text-xs font-semibold px-2.5 py-1 rounded-full ${form.attendeeChangesLocked ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>
                {form.attendeeChangesLocked ? "Locked" : "Open"}
              </span>
            </div>
            <div className="p-6 space-y-5">
              <p className="text-sm text-muted-foreground">
                Control whether attendees can update their own details via the self-service management link. When locked, all <code className="text-xs bg-muted px-1 py-0.5 rounded">/manage/:token</code> links show a message instead of edit controls — attendee details remain visible but read-only.
              </p>

              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => toggleLock(false)}
                  className={`flex-1 flex items-center gap-3 px-4 py-3 border-2 transition-all ${
                    !form.attendeeChangesLocked
                      ? "border-green-500 bg-green-50"
                      : "border-border bg-white hover:border-muted-foreground"
                  }`}
                >
                  <Unlock className={`w-5 h-5 flex-shrink-0 ${!form.attendeeChangesLocked ? "text-green-600" : "text-muted-foreground"}`} />
                  <div className="text-left">
                    <p className={`font-semibold text-sm ${!form.attendeeChangesLocked ? "text-green-700" : "text-foreground"}`}>
                      Allow changes
                    </p>
                    <p className="text-xs text-muted-foreground">Attendees can update their details</p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => toggleLock(true)}
                  className={`flex-1 flex items-center gap-3 px-4 py-3 border-2 transition-all ${
                    form.attendeeChangesLocked
                      ? "border-red-400 bg-red-50"
                      : "border-border bg-white hover:border-muted-foreground"
                  }`}
                >
                  <Lock className={`w-5 h-5 flex-shrink-0 ${form.attendeeChangesLocked ? "text-red-500" : "text-muted-foreground"}`} />
                  <div className="text-left">
                    <p className={`font-semibold text-sm ${form.attendeeChangesLocked ? "text-red-700" : "text-foreground"}`}>
                      Lock changes
                    </p>
                    <p className="text-xs text-muted-foreground">Show message, disable edit controls</p>
                  </div>
                </button>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                  Message shown when locked
                </label>
                <Textarea
                  rows={3}
                  value={form.attendeeChangesLockedMessage || DEFAULT_LOCKED_MESSAGE}
                  onChange={e => setForm(f => ({ ...f, attendeeChangesLockedMessage: e.target.value }))}
                  className="text-sm resize-none"
                  placeholder={DEFAULT_LOCKED_MESSAGE}
                />
                <p className="text-xs text-muted-foreground mt-1">Displayed prominently on the attendee management page when the lock is active.</p>
              </div>

              {lockError && <p className="text-sm text-destructive">{lockError}</p>}

              <div className="flex justify-end">
                <Button
                  type="button"
                  onClick={handleLockSave}
                  disabled={lockSaving}
                  className={`h-10 px-6 ${lockSaved ? "bg-green-600 hover:bg-green-700" : "bg-primary hover:bg-primary/90"} text-white`}
                >
                  {lockSaved ? (
                    <span className="flex items-center gap-1.5"><Check className="w-4 h-4" /> Saved</span>
                  ) : lockSaving ? "Saving…" : "Save Self-Service Settings"}
                </Button>
              </div>
            </div>
          </div>

        </div>
      )}
    </AdminLayout>
  );
}
