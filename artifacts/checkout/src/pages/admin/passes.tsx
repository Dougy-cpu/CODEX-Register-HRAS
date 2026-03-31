import { useState, useEffect } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Ticket, Infinity, AlertTriangle, Check } from "lucide-react";

interface PassInventoryRow {
  passType: string;
  remaining: number | null;
}

interface PassConfig {
  passType: "single" | "business";
  label: string;
  description: string;
}

const PASSES: PassConfig[] = [
  {
    passType: "single",
    label: "HR Professional Pass",
    description: "Single tickets for HR professionals at £199 each",
  },
  {
    passType: "business",
    label: "Business Pass",
    description: "Business passes for consultants & vendors at £599 each",
  },
];

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

export default function AdminPasses() {
  const [inventory, setInventory] = useState<Record<string, number | null>>({
    single: null,
    business: null,
  });
  const [inputs, setInputs] = useState<Record<string, string>>({
    single: "",
    business: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setLoading(true);
    adminFetch("/api/admin/passes/inventory")
      .then(res => res.ok ? res.json() : [])
      .then((rows: PassInventoryRow[]) => {
        const inv: Record<string, number | null> = { single: null, business: null };
        const inp: Record<string, string> = { single: "", business: "" };
        for (const r of rows) {
          inv[r.passType] = r.remaining;
          inp[r.passType] = r.remaining !== null ? String(r.remaining) : "";
        }
        setInventory(inv);
        setInputs(inp);
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (passType: string) => {
    setErrors(e => ({ ...e, [passType]: "" }));
    const raw = inputs[passType].trim();
    let val: number | null = null;
    if (raw !== "") {
      const n = parseInt(raw, 10);
      if (isNaN(n) || n < 0) {
        setErrors(e => ({ ...e, [passType]: "Enter a positive number, or leave blank for unlimited" }));
        return;
      }
      val = n;
    }
    setSaving(s => ({ ...s, [passType]: true }));
    try {
      const res = await adminFetch(`/api/admin/passes/inventory/${passType}`, {
        method: "PUT",
        body: JSON.stringify({ remaining: val }),
      });
      if (res.ok) {
        const row: PassInventoryRow = await res.json();
        setInventory(i => ({ ...i, [passType]: row.remaining }));
        setSaved(s => ({ ...s, [passType]: true }));
        setTimeout(() => setSaved(s => ({ ...s, [passType]: false })), 2000);
      } else {
        const body = await res.json().catch(() => ({}));
        setErrors(e => ({ ...e, [passType]: body.error || "Failed to save" }));
      }
    } finally {
      setSaving(s => ({ ...s, [passType]: false }));
    }
  };

  return (
    <AdminLayout title="Pass Availability">
      <div className="max-w-2xl">
        <div className="mb-8">
          <p className="text-muted-foreground">
            Set the number of remaining tickets for each pass type. When a count is configured, it will be 
            displayed on the checkout as urgency messaging to encourage bookings. Leave blank for unlimited.
          </p>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-sm p-4 flex gap-3 mb-8">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800">
            These counts are informational only — the checkout does not enforce them or prevent over-booking. 
            They are purely for displaying urgency messaging to prospective attendees.
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : (
          <div className="space-y-4">
            {PASSES.map(({ passType, label, description }) => {
              const current = inventory[passType];
              return (
                <div key={passType} className="bg-white border border-border p-6">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-sm bg-primary/10 flex items-center justify-center shrink-0">
                      <Ticket className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-base mb-0.5">{label}</h3>
                      <p className="text-sm text-muted-foreground mb-4">{description}</p>

                      <div className="flex items-start gap-3 flex-wrap">
                        <div className="w-44">
                          <Input
                            type="number"
                            min="0"
                            placeholder="Unlimited"
                            value={inputs[passType]}
                            onChange={e => setInputs(i => ({ ...i, [passType]: e.target.value }))}
                            onKeyDown={e => e.key === "Enter" && handleSave(passType)}
                            className="h-10"
                          />
                        </div>
                        <Button
                          onClick={() => handleSave(passType)}
                          disabled={saving[passType]}
                          className={`h-10 ${saved[passType] ? "bg-green-600 hover:bg-green-700" : "bg-primary hover:bg-primary/90"} text-white`}
                        >
                          {saved[passType] ? (
                            <span className="flex items-center gap-1.5"><Check className="w-4 h-4" /> Saved</span>
                          ) : saving[passType] ? "Saving…" : "Save"}
                        </Button>
                        {inputs[passType] !== "" && (
                          <Button
                            variant="outline"
                            className="h-10"
                            onClick={() => {
                              setInputs(i => ({ ...i, [passType]: "" }));
                            }}
                          >
                            Set Unlimited
                          </Button>
                        )}
                      </div>

                      {errors[passType] && (
                        <p className="text-sm text-destructive mt-2">{errors[passType]}</p>
                      )}

                      <div className="mt-4 flex items-center gap-2 text-sm">
                        {current === null ? (
                          <>
                            <Infinity className="w-4 h-4 text-muted-foreground" />
                            <span className="text-muted-foreground">Currently showing as <strong>unlimited</strong> on checkout</span>
                          </>
                        ) : current <= 10 ? (
                          <>
                            <span className="inline-block w-2 h-2 rounded-full bg-red-500 shrink-0" />
                            <span className="text-red-700 font-semibold">Only {current} left — high urgency shown on checkout</span>
                          </>
                        ) : current <= 30 ? (
                          <>
                            <span className="inline-block w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                            <span className="text-amber-700 font-semibold">{current} remaining — urgency shown on checkout</span>
                          </>
                        ) : (
                          <>
                            <span className="inline-block w-2 h-2 rounded-full bg-green-500 shrink-0" />
                            <span className="text-muted-foreground">{current} remaining shown on checkout</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
