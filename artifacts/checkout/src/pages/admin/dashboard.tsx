import { useGetAdminStats } from "@workspace/api-client-react";
import AdminLayout from "@/components/layout/AdminLayout";
import { Card } from "@/components/ui/card";
import { Users, CreditCard, Receipt, TrendingUp } from "lucide-react";

export default function AdminDashboard() {
  const { data: stats, isLoading } = useGetAdminStats({
    query: {
      queryKey: ["adminStats"],
    }
  });

  if (isLoading || !stats) {
    return (
      <AdminLayout title="Dashboard">
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title="Dashboard">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <Card className="p-6 border-l-4 border-l-primary rounded-sm shadow-sm">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-1">Total Revenue</p>
              <h2 className="text-4xl font-bold">£{stats.totalRevenue.toLocaleString()}</h2>
            </div>
            <div className="p-3 bg-primary/10 rounded-full">
              <TrendingUp className="w-6 h-6 text-primary" />
            </div>
          </div>
          <p className="text-sm text-muted-foreground mt-4">+ £{stats.totalVat.toLocaleString()} VAT</p>
        </Card>

        <Card className="p-6 border-l-4 border-l-secondary rounded-sm shadow-sm">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-1">Completed Regs</p>
              <h2 className="text-4xl font-bold">{stats.completedRegistrations}</h2>
            </div>
            <div className="p-3 bg-secondary/10 rounded-full">
              <Users className="w-6 h-6 text-secondary" />
            </div>
          </div>
          <p className="text-sm text-muted-foreground mt-4">{stats.partialRegistrations} partial checkouts</p>
        </Card>

        <Card className="p-6 border-l-4 border-l-accent rounded-sm shadow-sm">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-1">Card Payments</p>
              <h2 className="text-4xl font-bold">{stats.paymentMethodCounts.card}</h2>
            </div>
            <div className="p-3 bg-accent/20 rounded-full">
              <CreditCard className="w-6 h-6 text-accent-foreground" />
            </div>
          </div>
        </Card>

        <Card className="p-6 border-l-4 border-l-blue-500 rounded-sm shadow-sm">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-1">Invoices</p>
              <h2 className="text-4xl font-bold">{stats.paymentMethodCounts.invoice}</h2>
            </div>
            <div className="p-3 bg-blue-500/10 rounded-full">
              <Receipt className="w-6 h-6 text-blue-500" />
            </div>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <h3 className="text-xl font-bold mb-4">Recent Registrations</h3>
          <Card className="overflow-hidden border-border rounded-sm shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-muted text-muted-foreground uppercase text-xs font-bold">
                  <tr>
                    <th className="px-6 py-4">Ref</th>
                    <th className="px-6 py-4">Lead Attendee</th>
                    <th className="px-6 py-4">Pass</th>
                    <th className="px-6 py-4">Total</th>
                    <th className="px-6 py-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-white">
                  {stats.recentRegistrations.map((reg) => (
                    <tr key={reg.id} className="hover:bg-muted/50 transition-colors">
                      <td className="px-6 py-4 font-mono font-medium">{reg.orderReference || "-"}</td>
                      <td className="px-6 py-4">
                        <p className="font-bold">{reg.leadName || "Unknown"}</p>
                        <p className="text-xs text-muted-foreground">{reg.leadCompany}</p>
                      </td>
                      <td className="px-6 py-4">
                        <span className="capitalize">{reg.passType}</span>
                        <span className="text-muted-foreground ml-1">(×{reg.quantity})</span>
                      </td>
                      <td className="px-6 py-4 font-medium">£{reg.totalAmount}</td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-1 rounded-full text-xs font-bold uppercase ${
                          reg.status === 'paid' ? 'bg-green-100 text-green-800' :
                          reg.status === 'invoiced' ? 'bg-blue-100 text-blue-800' :
                          'bg-yellow-100 text-yellow-800'
                        }`}>
                          {reg.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {stats.recentRegistrations.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">
                        No registrations yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <div>
          <h3 className="text-xl font-bold mb-4">Pass Breakdown</h3>
          <Card className="p-6 border-border rounded-sm shadow-sm bg-white">
            <div className="space-y-6">
              <div>
                <div className="flex justify-between mb-2">
                  <span className="font-bold">Single Pass</span>
                  <span className="font-medium">{stats.passCounts.single}</span>
                </div>
                <div className="w-full bg-muted h-2 rounded-full overflow-hidden">
                  <div className="bg-primary h-full" style={{ width: `${(stats.passCounts.single / Math.max(1, stats.completedRegistrations)) * 100}%` }}></div>
                </div>
              </div>
              <div>
                <div className="flex justify-between mb-2">
                  <span className="font-bold">Business Pass</span>
                  <span className="font-medium">{stats.passCounts.business}</span>
                </div>
                <div className="w-full bg-muted h-2 rounded-full overflow-hidden">
                  <div className="bg-slate-800 h-full" style={{ width: `${(stats.passCounts.business / Math.max(1, stats.completedRegistrations)) * 100}%` }}></div>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </AdminLayout>
  );
}
