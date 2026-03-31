import { useState } from "react";
import { useListRegistrations, useGetRegistration } from "@workspace/api-client-react";
import AdminLayout from "@/components/layout/AdminLayout";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Search } from "lucide-react";

function ExpandedRegistrationDetail({ id }: { id: number }) {
  const { data, isLoading } = useGetRegistration(id, {
    query: { queryKey: ["registration", id] }
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-6">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-8">
      <div>
        <h4 className="font-bold mb-3 uppercase text-xs tracking-wider text-muted-foreground">Booking Details</h4>
        <div className="space-y-2 text-sm">
          <p><span className="font-medium">Company:</span> {data?.attendees?.find(a => a.isLead)?.company || "-"}</p>
          <p><span className="font-medium">Payment Method:</span> {data?.paymentMethod || "-"}</p>
          <p><span className="font-medium">Promo Code:</span> {data?.promoCode || "-"}</p>
          <p><span className="font-medium">Billing Email:</span> {data?.billingEmail || "-"}</p>
        </div>
      </div>
      <div>
        <h4 className="font-bold mb-3 uppercase text-xs tracking-wider text-muted-foreground">Attendees</h4>
        <div className="space-y-2">
          {data?.attendees?.map((a, i) => (
            <div key={i} className="text-sm border border-border rounded p-2 bg-white">
              {(a as any).isTbc ? (
                <>
                  <p className="font-medium text-amber-700">
                    TBC
                    {a.isLead ? <span className="text-xs text-primary font-bold ml-1">LEAD</span> : null}
                    <span className="ml-2 text-xs font-normal bg-amber-100 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded">To be confirmed</span>
                  </p>
                  <p className="text-muted-foreground">Seat {a.seatIndex + 1} — attendee details pending</p>
                </>
              ) : (
                <>
                  <p className="font-medium">{a.firstName} {a.lastName} {a.isLead ? <span className="text-xs text-primary font-bold ml-1">LEAD</span> : null}</p>
                  <p className="text-muted-foreground">{a.jobTitle} · {a.company}</p>
                  <p className="text-muted-foreground">{a.workEmail}</p>
                </>
              )}
            </div>
          ))}
          {(!data?.attendees || data.attendees.length === 0) && (
            <p className="text-sm text-muted-foreground">No attendees yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AdminRegistrations() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data, isLoading } = useListRegistrations(
    {
      search: search.trim() || undefined,
      status: status !== "all" ? status : undefined,
      page,
      limit: 20,
    },
    {
      query: {
        queryKey: ["registrations", search, status, page],
      }
    }
  );

  return (
    <AdminLayout title="Registrations">
      <div className="bg-white p-6 border border-border shadow-sm mb-6 flex flex-col md:flex-row gap-4 items-end">
        <div className="flex-1 w-full">
          <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 block">Search</label>
          <div className="relative">
            <Search className="absolute left-3 top-3 w-5 h-5 text-muted-foreground" />
            <Input 
              placeholder="Search by name, email or reference..." 
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="pl-10 h-12"
            />
          </div>
        </div>
        <div className="w-full md:w-64">
          <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 block">Status</label>
          <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
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
      </div>

      <div className="bg-white border border-border shadow-sm">
        {isLoading ? (
          <div className="flex justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : (
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="w-10"></TableHead>
                <TableHead>Ref</TableHead>
                <TableHead>Lead Attendee</TableHead>
                <TableHead>Pass Type</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.registrations?.map((reg) => (
                <>
                  <TableRow 
                    key={reg.id} 
                    className="cursor-pointer hover:bg-muted/30"
                    onClick={() => setExpandedId(expandedId === reg.id ? null : reg.id)}
                  >
                    <TableCell>
                      {expandedId === reg.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </TableCell>
                    <TableCell className="font-mono text-sm">{reg.orderReference || "-"}</TableCell>
                    <TableCell>
                      <p className="font-bold">{reg.leadName || "Unknown"}</p>
                      <p className="text-xs text-muted-foreground">{reg.leadEmail}</p>
                    </TableCell>
                    <TableCell className="capitalize">{reg.passType}</TableCell>
                    <TableCell>{reg.quantity}</TableCell>
                    <TableCell className="font-medium">£{reg.totalAmount}</TableCell>
                    <TableCell>
                      <span className={`px-2 py-1 rounded-full text-xs font-bold uppercase ${
                        reg.status === 'paid' ? 'bg-green-100 text-green-800' :
                        reg.status === 'invoiced' ? 'bg-blue-100 text-blue-800' :
                        'bg-yellow-100 text-yellow-800'
                      }`}>
                        {reg.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">{new Date(reg.createdAt).toLocaleDateString()}</TableCell>
                  </TableRow>
                  {expandedId === reg.id && (
                    <TableRow className="bg-muted/10">
                      <TableCell colSpan={8} className="p-6">
                        <ExpandedRegistrationDetail id={reg.id} />
                      </TableCell>
                    </TableRow>
                  )}
                </>
              ))}
              {data?.registrations?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
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
