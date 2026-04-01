import { useState, Fragment } from "react";
import { useListRegistrations, useGetRegistration } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import AdminLayout from "@/components/layout/AdminLayout";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronDown, ChevronRight, Search, Download, Trash2, AlertTriangle } from "lucide-react";

const STATUS_OPTIONS = [
  { value: "paid", label: "Paid" },
  { value: "invoiced", label: "Invoiced" },
  { value: "pending_payment", label: "Pending Payment" },
  { value: "partial", label: "Partial (in progress)" },
  { value: "cancelled", label: "Cancelled" },
  { value: "disputed", label: "Disputed" },
];

const statusBadge = (status: string) => {
  const cls =
    status === "paid" ? "bg-green-100 text-green-800" :
    status === "invoiced" ? "bg-blue-100 text-blue-800" :
    status === "cancelled" ? "bg-red-100 text-red-800" :
    status === "disputed" ? "bg-amber-100 text-amber-800" :
    "bg-yellow-100 text-yellow-800";
  return (
    <span className={`px-2 py-1 rounded-full text-xs font-bold uppercase ${cls}`}>
      {STATUS_OPTIONS.find(s => s.value === status)?.label ?? status}
    </span>
  );
};

function ExpandedRegistrationDetail({ id, onStatusChanged }: { id: number; onStatusChanged: () => void }) {
  const { data, isLoading, refetch } = useGetRegistration(id, {
    query: { queryKey: ["registration", id] }
  });
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const handleStatusChange = async (newStatus: string) => {
    if (newStatus === data?.status) return;
    setUpdatingStatus(true);
    try {
      const token = localStorage.getItem("admin_token") || "";
      const res = await fetch(`/api/admin/registrations/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-admin-token": token },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error("Status update failed");
      await refetch();
      onStatusChanged();
    } catch {
      alert("Failed to update status. Please try again.");
    } finally {
      setUpdatingStatus(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
      </div>
    );
  }

  const isGroup = (data?.attendees?.length ?? 0) > 1;

  return (
    <div className="space-y-6">
      {/* Booking meta strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div className="bg-white border border-border p-3">
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-bold mb-1">Booking Ref</p>
          <p className="font-mono font-medium">{data?.orderReference || "—"}</p>
        </div>
        <div className="bg-white border border-border p-3">
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-bold mb-1">Payment</p>
          <p className="font-medium capitalize">{data?.paymentMethod || "—"}</p>
        </div>
        <div className="bg-white border border-border p-3">
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-bold mb-1">Billing Email</p>
          <p className="font-medium truncate">{data?.billingEmail || data?.attendees?.find(a => a.isLead)?.workEmail || "—"}</p>
        </div>
        <div className="bg-white border border-border p-3">
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-bold mb-1">Promo Code</p>
          <p className="font-medium">{data?.promoCode || "—"}</p>
        </div>
      </div>

      {/* Manual status override */}
      <div className="flex items-center gap-4 py-3 px-4 bg-slate-50 border border-border">
        <span className="text-sm font-bold uppercase tracking-wider text-muted-foreground shrink-0">
          Override Status
        </span>
        <Select value={data?.status ?? ""} onValueChange={handleStatusChange} disabled={updatingStatus}>
          <SelectTrigger className="w-52 h-9 bg-white text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map(opt => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {updatingStatus && (
          <span className="text-xs text-muted-foreground animate-pulse">Saving…</span>
        )}
        <span className="text-xs text-muted-foreground ml-2">
          Use this to mark invoice payments received directly to Tide, or to cancel a booking.
        </span>
      </div>

      {/* Invoice details — shown when payment method is invoice */}
      {data?.paymentMethod === "invoice" && (
        <div className="bg-blue-50 border border-blue-200 p-4">
          <h4 className="font-bold mb-3 uppercase text-xs tracking-wider text-blue-700">Invoice Details</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <div className="flex gap-2">
              <span className="text-muted-foreground w-36 shrink-0">Invoice Ref</span>
              <span className="font-mono font-semibold">{data?.orderReference || "—"}</span>
            </div>
            {data?.billingName && (
              <div className="flex gap-2">
                <span className="text-muted-foreground w-36 shrink-0">Billing Contact</span>
                <span className="font-medium">{data.billingName}</span>
              </div>
            )}
            {data?.billingCompany && (
              <div className="flex gap-2">
                <span className="text-muted-foreground w-36 shrink-0">Billing Company</span>
                <span className="font-medium">{data.billingCompany}</span>
              </div>
            )}
            {data?.billingEmail && (
              <div className="flex gap-2">
                <span className="text-muted-foreground w-36 shrink-0">Billing Email</span>
                <span className="font-medium">{data.billingEmail}</span>
              </div>
            )}
            {(data?.billingAddressLine1 || data?.billingAddress) && (
              <div className="flex gap-2 sm:col-span-2">
                <span className="text-muted-foreground w-36 shrink-0">Billing Address</span>
                <span className="font-medium">
                  {data.billingAddressLine1 ? (
                    <>
                      {data.billingAddressLine1}{data.billingAddressLine2 ? `, ${data.billingAddressLine2}` : ""}
                      {(data.billingTown || data.billingRegion) ? `, ${[data.billingTown, data.billingRegion].filter(Boolean).join(", ")}` : ""}
                      {data.billingPostcode ? `, ${data.billingPostcode}` : ""}
                      {data.billingCountry ? `, ${data.billingCountry}` : ""}
                    </>
                  ) : data.billingAddress}
                </span>
              </div>
            )}
          </div>
          {/* Invoice links */}
          {(data?.stripeInvoicePaymentUrl || data?.stripeInvoicePdfUrl) && (
            <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t border-blue-200">
              {data?.stripeInvoicePaymentUrl && (
                <a href={data.stripeInvoicePaymentUrl} target="_blank" rel="noreferrer"
                  className="text-sm font-semibold text-primary underline underline-offset-2 hover:text-primary/80">
                  View Invoice →
                </a>
              )}
              {data?.stripeInvoicePdfUrl && (
                <a href={data.stripeInvoicePdfUrl} target="_blank" rel="noreferrer"
                  className="text-sm font-semibold text-blue-700 underline underline-offset-2 hover:text-blue-900">
                  Download PDF →
                </a>
              )}
            </div>
          )}
        </div>
      )}

      {/* Card payment invoice links (non-invoice method) */}
      {data?.paymentMethod !== "invoice" && (data?.stripeInvoicePaymentUrl || data?.stripeInvoicePdfUrl) && (
        <div className="flex flex-wrap gap-3 text-sm">
          {data?.stripeInvoicePaymentUrl && (
            <a href={data.stripeInvoicePaymentUrl} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 font-semibold text-primary underline underline-offset-2 hover:text-primary/80">
              View Stripe Invoice →
            </a>
          )}
          {data?.stripeInvoicePdfUrl && (
            <a href={data.stripeInvoicePdfUrl} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 font-semibold text-blue-600 underline underline-offset-2 hover:text-blue-800">
              Download Invoice PDF →
            </a>
          )}
        </div>
      )}

      {/* Attendee table */}
      <div>
        <h4 className="font-bold mb-3 uppercase text-xs tracking-wider text-muted-foreground">
          All Attendees ({data?.attendees?.length ?? 0})
        </h4>
        <div className="border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-3 font-bold uppercase text-xs tracking-wider text-muted-foreground w-8">#</th>
                <th className="text-left p-3 font-bold uppercase text-xs tracking-wider text-muted-foreground">Name</th>
                <th className="text-left p-3 font-bold uppercase text-xs tracking-wider text-muted-foreground">Job Title</th>
                <th className="text-left p-3 font-bold uppercase text-xs tracking-wider text-muted-foreground">Company</th>
                <th className="text-left p-3 font-bold uppercase text-xs tracking-wider text-muted-foreground">Email</th>
                <th className="text-left p-3 font-bold uppercase text-xs tracking-wider text-muted-foreground">Phone</th>
                <th className="text-left p-3 font-bold uppercase text-xs tracking-wider text-muted-foreground">Dietary / Access</th>
                <th className="text-left p-3 font-bold uppercase text-xs tracking-wider text-muted-foreground">GDPR</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data?.attendees
                ?.slice()
                .sort((a, b) => (a.seatIndex ?? 0) - (b.seatIndex ?? 0))
                .map((a) => (
                  <tr key={a.seatIndex ?? a.id} className={a.isLead ? "bg-primary/5" : "bg-white"}>
                    <td className="p-3 text-muted-foreground">{(a.seatIndex ?? 0) + 1}</td>
                    <td className="p-3">
                      {a.isTbc ? (
                        <span className="inline-flex items-center gap-1.5 text-amber-700 font-medium italic">
                          TBC — pending
                        </span>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          {a.isLead && isGroup && (
                            <span className="text-primary font-bold text-base leading-none" title="Lead attendee">★</span>
                          )}
                          <span className="font-medium">{a.firstName} {a.lastName}</span>
                          {a.isLead && !isGroup && (
                            <span className="text-[10px] font-bold bg-primary text-white px-1.5 py-0.5 uppercase tracking-wider">Lead</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="p-3 text-muted-foreground">{a.isTbc ? "—" : (a.jobTitle || "—")}</td>
                    <td className="p-3 text-muted-foreground">{a.isTbc ? "—" : (a.company || "—")}</td>
                    <td className="p-3 text-muted-foreground">{a.isTbc ? "—" : (a.workEmail || "—")}</td>
                    <td className="p-3 text-muted-foreground">{a.isTbc ? "—" : (a.phone || "—")}</td>
                    <td className="p-3 text-muted-foreground max-w-[200px]">
                      {a.isTbc ? "—" : (a.dietaryAccessibility || "—")}
                    </td>
                    <td className="p-3">
                      {a.isTbc ? (
                        <span className="text-muted-foreground">—</span>
                      ) : a.gdprConsent ? (
                        <span className="text-[10px] font-bold bg-green-100 text-green-800 px-1.5 py-0.5 uppercase">✓ Yes</span>
                      ) : (
                        <span className="text-[10px] font-bold bg-red-100 text-red-800 px-1.5 py-0.5 uppercase">No</span>
                      )}
                    </td>
                  </tr>
                ))}
              {(!data?.attendees || data.attendees.length === 0) && (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-muted-foreground">No attendees recorded yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function AdminRegistrations() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [passType, setPassType] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const queryClient = useQueryClient();

  const queryKey = ["registrations", search, status, passType, page];

  const { data, isLoading } = useListRegistrations(
    {
      search: search.trim() || undefined,
      status: status !== "all" ? status : undefined,
      passType: passType !== "all" ? passType : undefined,
      page,
      limit: 20,
    },
    {
      query: { queryKey }
    }
  );

  const registrations = data?.registrations ?? [];
  const pageIds = registrations.map(r => r.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every(id => selected.has(id));
  const somePageSelected = pageIds.some(id => selected.has(id));

  const toggleAll = () => {
    if (allPageSelected) {
      const next = new Set(selected);
      pageIds.forEach(id => next.delete(id));
      setSelected(next);
    } else {
      const next = new Set(selected);
      pageIds.forEach(id => next.add(id));
      setSelected(next);
    }
  };

  const toggleOne = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const token = localStorage.getItem("admin_token") || "";
      const params = new URLSearchParams();
      if (status !== "all") params.set("status", status);
      if (passType !== "all") params.set("passType", passType);
      const res = await fetch(`/api/admin/registrations/export?${params.toString()}`, {
        headers: { "x-admin-token": token },
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const date = new Date().toISOString().split("T")[0];
      a.download = `hras26-registrations-${date}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Export failed. Please try again.");
    } finally {
      setExporting(false);
    }
  };

  const handleBulkDelete = async () => {
    setDeleting(true);
    try {
      const token = localStorage.getItem("admin_token") || "";
      const res = await fetch("/api/admin/registrations", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", "x-admin-token": token },
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      if (!res.ok) throw new Error("Delete failed");
      setSelected(new Set());
      setConfirmDelete(false);
      if (expandedId && selected.has(expandedId)) setExpandedId(null);
      await queryClient.invalidateQueries({ queryKey: ["registrations"] });
    } catch {
      alert("Delete failed. Please try again.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AdminLayout title="Registrations">

      {/* Confirm delete modal */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-border shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-6 h-6 text-red-600 shrink-0" />
              <h2 className="text-lg font-bold">Delete {selected.size} registration{selected.size !== 1 ? "s" : ""}?</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              This will permanently delete the selected booking{selected.size !== 1 ? "s" : ""} and all associated attendee records. This action cannot be undone.
            </p>
            <div className="flex gap-3 pt-2 justify-end">
              <Button variant="outline" onClick={() => setConfirmDelete(false)} disabled={deleting}>
                Cancel
              </Button>
              <Button
                className="bg-red-600 hover:bg-red-700 text-white"
                onClick={handleBulkDelete}
                disabled={deleting}
              >
                {deleting ? "Deleting…" : `Delete ${selected.size} record${selected.size !== 1 ? "s" : ""}`}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Filters bar */}
      <div className="bg-white p-6 border border-border shadow-sm mb-4 flex flex-col md:flex-row gap-4 items-end">
        <div className="flex-1 w-full">
          <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 block">Search</label>
          <div className="relative">
            <Search className="absolute left-3 top-3 w-5 h-5 text-muted-foreground" />
            <Input
              placeholder="Search by name, email or reference..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); setSelected(new Set()); }}
              className="pl-10 h-12"
            />
          </div>
        </div>
        <div className="w-full md:w-44">
          <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 block">Status</label>
          <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); setSelected(new Set()); }}>
            <SelectTrigger className="h-12 bg-white">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="invoiced">Invoiced</SelectItem>
              <SelectItem value="partial">Partial (in progress)</SelectItem>
              <SelectItem value="pending_payment">Pending Payment</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-full md:w-44">
          <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 block">Pass Type</label>
          <Select value={passType} onValueChange={(v) => { setPassType(v); setPage(1); setSelected(new Set()); }}>
            <SelectTrigger className="h-12 bg-white">
              <SelectValue placeholder="All Passes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Passes</SelectItem>
              <SelectItem value="single">Standard Pass (HR)</SelectItem>
              <SelectItem value="business">Business Pass (Vendor)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          onClick={handleExport}
          disabled={exporting}
          variant="outline"
          className="h-12 gap-2 shrink-0 border-primary text-primary hover:bg-primary hover:text-white"
        >
          <Download className="w-4 h-4" />
          {exporting ? "Exporting…" : "Export Excel"}
        </Button>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="mb-4 flex items-center gap-4 px-4 py-3 bg-slate-900 text-white border border-slate-700">
          <span className="text-sm font-semibold">{selected.size} selected</span>
          <Button
            size="sm"
            className="bg-red-600 hover:bg-red-700 text-white gap-2 h-8"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete selected
          </Button>
          <button
            className="text-xs text-slate-400 hover:text-white ml-auto"
            onClick={() => setSelected(new Set())}
          >
            Clear selection
          </button>
        </div>
      )}

      <div className="bg-white border border-border shadow-sm">
        {isLoading ? (
          <div className="flex justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : (
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="w-10 pl-4">
                  <Checkbox
                    checked={allPageSelected}
                    onCheckedChange={toggleAll}
                    aria-label="Select all on this page"
                    className={somePageSelected && !allPageSelected ? "opacity-50" : ""}
                  />
                </TableHead>
                <TableHead className="w-8"></TableHead>
                <TableHead>Ref</TableHead>
                <TableHead>Lead Attendee</TableHead>
                <TableHead>Pass Type</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Invoice</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {registrations.map((reg) => (
                <Fragment key={reg.id}>
                  <TableRow
                    className={`cursor-pointer hover:bg-muted/30 ${selected.has(reg.id) ? "bg-primary/5" : ""}`}
                    onClick={() => setExpandedId(expandedId === reg.id ? null : reg.id)}
                  >
                    <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selected.has(reg.id)}
                        onCheckedChange={() => toggleOne(reg.id)}
                        aria-label={`Select booking ${reg.orderReference}`}
                      />
                    </TableCell>
                    <TableCell>
                      {expandedId === reg.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </TableCell>
                    <TableCell className="font-mono text-sm">{reg.orderReference || "-"}</TableCell>
                    <TableCell>
                      <p className="font-bold">{reg.leadName || "Unknown"}</p>
                      <p className="text-xs text-muted-foreground">{reg.leadEmail}</p>
                    </TableCell>
                    <TableCell>
                      <span className={`text-xs font-bold px-2 py-0.5 uppercase rounded ${reg.passType === "business" ? "bg-violet-100 text-violet-800" : "bg-slate-100 text-slate-700"}`}>
                        {reg.passType === "business" ? "Business" : "Standard"}
                      </span>
                    </TableCell>
                    <TableCell>{reg.quantity}</TableCell>
                    <TableCell className="font-medium">£{reg.totalAmount}</TableCell>
                    <TableCell>{statusBadge(reg.status)}</TableCell>
                    <TableCell className="text-sm">{new Date(reg.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {reg.stripeInvoicePaymentUrl && (
                        <a
                          href={reg.stripeInvoicePaymentUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-semibold text-primary underline underline-offset-2 hover:text-primary/80 whitespace-nowrap"
                        >
                          Invoice ↗
                        </a>
                      )}
                    </TableCell>
                  </TableRow>
                  {expandedId === reg.id && (
                    <TableRow className="bg-muted/10">
                      <TableCell colSpan={10} className="p-6">
                        <ExpandedRegistrationDetail
                          id={reg.id}
                          onStatusChanged={() => queryClient.invalidateQueries({ queryKey: ["registrations"] })}
                        />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
              {registrations.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-12 text-muted-foreground">
                    No registrations found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </div>

      {data && data.total > 0 && (
        <div className="flex justify-between items-center mt-6">
          <p className="text-sm text-muted-foreground">
            Showing {(page - 1) * data.limit + 1} to {Math.min(page * data.limit, data.total)} of {data.total}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={page === 1}
              onClick={() => setPage(p => p - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              disabled={page * data.limit >= data.total}
              onClick={() => setPage(p => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
