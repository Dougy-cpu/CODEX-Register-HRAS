import { useState, useEffect, useRef, useCallback } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Check, Lock, Unlock, Settings2, Loader2 } from "lucide-react";

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
  refPrefix: string;
  refOffset: number;
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

async function saveLockSettings(locked: boolean, message: string | null): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await adminFetch("/api/admin/event-settings", {
      method: "PUT",
      body: JSON.stringify({
        attendeeChangesLocked: locked,
        attendeeChangesLockedMessage: message || DEFAULT_LOCKED_MESSAGE,
      }),
    });
    if (res.ok) return { ok: true };
    const body = await res.json().catch(() => ({}));
    return { ok: false, error: body.error || "Failed to save" };
  } catch {
    return { ok: false, error: "Network error" };
  }
}

export default function AdminSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const [lockSaving, setLockSaving] = useState(false);
  const [lockSaved, setLockSaved] = useState(false);
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
    refPrefix: "HRAS26",
    refOffset: 6541,
  });

  const [refSaving, setRefSaving] = useState(false);
  const [refSaved, setRefSaved] = useState(false);
  const [refError, setRefError] = useState("");

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestLockRef = useRef<{ locked: boolean; message: string | null }>({
    locked: false,
    message: null,
  });

  useEffect(() => {
    setLoading(true);
    adminFetch("/api/admin/event-settings")
      .then(res => res.ok ? res.json() : null)
      .then((data: EventSettings | null) => {
        if (data) {
          const lockState = {
            locked: data.attendeeChangesLocked ?? false,
            message: data.attendeeChangesLockedMessage ?? null,
          };
          latestLockRef.current = lockState;
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
            attendeeChangesLocked: lockState.locked,
            attendeeChangesLockedMessage: lockState.message,
            refPrefix: data.refPrefix ?? "HRAS26",
            refOffset: data.refOffset ?? 6541,
          });
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const persistLock = useCallback(async (locked: boolean, message: string | null) => {
    setLockSaving(true);
    setLockError("");
    const result = await saveLockSettings(locked, message);
    setLockSaving(false);
    if (result.ok) {
      setLockSaved(true);
      setTimeout(() => setLockSaved(false), 2500);
    } else {
      setLockError(result.error || "Failed to save");
    }
  }, []);

  const handleToggleLock = (locked: boolean) => {
    const message = form.attendeeChangesLockedMessage || DEFAULT_LOCKED_MESSAGE;
    latestLockRef.current = { locked, message };
    setForm(f => ({ ...f, attendeeChangesLocked: locked }));
    persistLock(locked, message);
  };

  const handleMessageChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const message = e.target.value;
    latestLockRef.current = { ...latestLockRef.current, message };
    setForm(f => ({ ...f, attendeeChangesLockedMessage: message }));
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const { locked, message: msg } = latestLockRef.current;
      persistLock(locked, msg);
    }, 800);
  };

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

  const handleSaveRef = async () => {
    const prefix = form.refPrefix.trim();
    const offset = parseInt(String(form.refOffset), 10);
    if (!prefix) { setRefError("Prefix is required"); return; }
    if (isNaN(offset) || offset < 0) { setRefError("Offset must be a non-negative number"); return; }
    setRefSaving(true);
    setRefError("");
    setRefSaved(false);
    try {
      const res = await adminFetch("/api/admin/event-settings", {
        method: "PUT",
        body: JSON.stringify({ refPrefix: prefix, refOffset: offset }),
      });
      if (res.ok) {
        setRefSaved(true);
        setTimeout(() => setRefSaved(false), 2500);
      } else {
        const body = await res.json().catch(() => ({}));
        setRefError(body.error || "Failed to save");
      }
    } finally {
      setRefSaving(false);
    }
  };

  return (
    <AdminLayout title="Settings">
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : (
        <div className="max-w-2xl space-y-8">

          {/* ── Event & Org Details ── */}
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
              <div className="ml-auto flex items-center gap-2">
                {lockSaving && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
                {lockSaved && !lockSaving && <Check className="w-3.5 h-3.5 text-green-600" />}
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${form.attendeeChangesLocked ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>
                  {form.attendeeChangesLocked ? "Locked" : "Open"}
                </span>
              </div>
            </div>
            <div className="p-6 space-y-5">
              <p className="text-sm text-muted-foreground">
                Control whether attendees can update their own details via the self-service management link. When locked, all <code className="text-xs bg-muted px-1 py-0.5 rounded">/manage/:token</code> links show a message instead of edit controls. Changes save immediately.
              </p>

              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => handleToggleLock(false)}
                  disabled={!form.attendeeChangesLocked && !lockSaving}
                  className={`flex-1 flex items-center gap-3 px-4 py-3 border-2 transition-all disabled:cursor-default ${
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
                  onClick={() => handleToggleLock(true)}
                  disabled={form.attendeeChangesLocked && !lockSaving}
                  className={`flex-1 flex items-center gap-3 px-4 py-3 border-2 transition-all disabled:cursor-default ${
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
                  onChange={handleMessageChange}
                  className="text-sm resize-none"
                  placeholder={DEFAULT_LOCKED_MESSAGE}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Displayed prominently on the attendee management page when the lock is active. Saves automatically after you stop typing.
                </p>
              </div>

              {lockError && <p className="text-sm text-destructive">{lockError}</p>}
            </div>
          </div>

          {/* ── Booking Reference Format ── */}
          <div className="bg-white border border-border">
            <div className="px-6 py-4 border-b border-border flex items-center gap-3">
              <Settings2 className="w-5 h-5 text-primary" />
              <h2 className="font-bold text-base">Booking Reference Format</h2>
            </div>
            <div className="p-6 space-y-5">
              <p className="text-sm text-muted-foreground">
                References are generated as <strong>PREFIX-[OFFSET + booking ID]</strong>.
                Adjust these when re-running the system for a new event to keep reference sequences clean and avoid conflicts with previous years.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Prefix</label>
                  <Input
                    value={form.refPrefix}
                    onChange={e => setForm(f => ({ ...f, refPrefix: e.target.value }))}
                    placeholder="HRAS26"
                    className="font-mono"
                  />
                  <p className="text-xs text-muted-foreground mt-1">e.g. HRAS27 for next year's event</p>
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Offset</label>
                  <Input
                    type="number"
                    min={0}
                    value={form.refOffset}
                    onChange={e => setForm(f => ({ ...f, refOffset: parseInt(e.target.value, 10) || 0 }))}
                    placeholder="6541"
                    className="font-mono"
                  />
                  <p className="text-xs text-muted-foreground mt-1">Added to the booking ID to form the number</p>
                </div>
              </div>

              {/* Preview */}
              <div className="bg-muted/40 border border-border rounded p-3 flex items-center gap-3">
                <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Preview:</span>
                <span className="font-mono text-sm font-semibold text-foreground">
                  {form.refPrefix.trim() || "PREFIX"}-{(form.refOffset || 0) + 1} &nbsp;/&nbsp; {form.refPrefix.trim() || "PREFIX"}-{(form.refOffset || 0) + 2} &nbsp;/&nbsp; …
                </span>
              </div>

              {refError && <p className="text-sm text-destructive">{refError}</p>}

              <div className="flex justify-end">
                <Button
                  type="button"
                  onClick={handleSaveRef}
                  disabled={refSaving}
                  className={`h-10 px-6 ${refSaved ? "bg-green-600 hover:bg-green-700" : "bg-primary hover:bg-primary/90"} text-white`}
                >
                  {refSaved ? (
                    <span className="flex items-center gap-1.5"><Check className="w-4 h-4" /> Saved</span>
                  ) : refSaving ? (
                    <span className="flex items-center gap-1.5"><Loader2 className="w-4 h-4 animate-spin" /> Saving…</span>
                  ) : "Save Reference Format"}
                </Button>
              </div>
            </div>
          </div>

        </div>
      )}
    </AdminLayout>
  );
}
