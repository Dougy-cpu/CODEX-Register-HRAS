import { useState, useEffect } from "react";
import { useListEmailLogs, useGetWelcomeEmailTemplate, useUpdateWelcomeEmailTemplate, useResendBookingEmails } from "@workspace/api-client-react";
import AdminLayout from "@/components/layout/AdminLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCcw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function AdminEmails() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("logs");
  const [page, setPage] = useState(1);

  const { data: logsData, isLoading: logsLoading } = useListEmailLogs(undefined, {
    query: {
      queryKey: ["emailLogs", page],
    }
  });

  const { data: templateData, isLoading: templateLoading } = useGetWelcomeEmailTemplate({
    query: {
      queryKey: ["welcomeTemplate"],
    }
  });

  const updateTemplate = useUpdateWelcomeEmailTemplate();
  const resendEmails = useResendBookingEmails();

  const [subject, setSubject] = useState("");
  const [htmlBody, setHtmlBody] = useState("");

  useEffect(() => {
    if (templateData) {
      setSubject(templateData.subject);
      setHtmlBody(templateData.htmlBody);
    }
  }, [templateData]);

  const handleSaveTemplate = async () => {
    await updateTemplate.mutateAsync({
      data: { subject, htmlBody }
    });
    toast({
      title: "Template Saved",
      description: "The welcome email template has been updated successfully."
    });
    queryClient.invalidateQueries({ queryKey: ["welcomeTemplate"] });
  };

  const handleResend = async (bookingId: number) => {
    try {
      await resendEmails.mutateAsync({ bookingId });
      toast({
        title: "Emails Resent",
        description: `Emails for booking #${bookingId} have been queued for resending.`
      });
    } catch (e) {
      toast({
        title: "Error",
        description: "Failed to resend emails.",
        variant: "destructive"
      });
    }
  };

  return (
    <AdminLayout title="Email Management">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-white border border-border h-12 w-full justify-start rounded-none mb-6">
          <TabsTrigger value="logs" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary h-full px-8 rounded-none">Email Logs</TabsTrigger>
          <TabsTrigger value="template" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary h-full px-8 rounded-none">Welcome Template</TabsTrigger>
        </TabsList>

        <TabsContent value="logs">
          <div className="bg-white border border-border shadow-sm">
            {logsLoading ? (
              <div className="flex justify-center py-20">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            ) : (
              <>
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Recipient</TableHead>
                      <TableHead>Booking Ref</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logsData?.logs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="text-sm">{new Date(log.sentAt).toLocaleString()}</TableCell>
                        <TableCell className="capitalize">{log.type}</TableCell>
                        <TableCell>{log.recipient}</TableCell>
                        <TableCell>{log.bookingId || "-"}</TableCell>
                        <TableCell>
                          <Badge variant={log.status === 'sent' ? 'default' : log.status === 'failed' ? 'destructive' : 'secondary'} className="uppercase text-[10px]">
                            {log.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {log.bookingId && (
                            <Button variant="ghost" size="sm" onClick={() => handleResend(log.bookingId!)} className="h-8 px-2" title="Resend all emails for this booking">
                              <RefreshCcw className="w-4 h-4 mr-2" /> Resend
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {logsData?.logs.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                          No email logs found.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
                
                {logsData && logsData.total > 0 && (
                  <div className="p-4 border-t border-border flex justify-between items-center bg-muted/20">
                    <p className="text-sm text-muted-foreground">
                      Showing {(page - 1) * logsData.limit + 1} to {Math.min(page * logsData.limit, logsData.total)} of {logsData.total}
                    </p>
                    <div className="flex gap-2">
                      <Button variant="outline" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
                      <Button variant="outline" disabled={page * logsData.limit >= logsData.total} onClick={() => setPage(p => p + 1)}>Next</Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </TabsContent>

        <TabsContent value="template">
          {templateLoading ? (
            <div className="flex justify-center py-20">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : (
            <div className="bg-white p-6 border border-border shadow-sm space-y-6">
              <div>
                <h3 className="text-lg font-bold mb-2">Welcome Email Template</h3>
                <p className="text-sm text-muted-foreground">This email is sent to all attendees upon successful registration.</p>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-bold uppercase tracking-wider">Subject Line</label>
                  <Input 
                    value={subject} 
                    onChange={e => setSubject(e.target.value)} 
                    className="h-12"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-bold uppercase tracking-wider">HTML Body</label>
                  <div className="p-3 bg-muted/30 border border-border text-sm mb-2 font-mono text-muted-foreground">
                    Available variables: {'{{firstName}}'}, {'{{lastName}}'}, {'{{passType}}'}, {'{{orderReference}}'}
                  </div>
                  <Textarea 
                    value={htmlBody} 
                    onChange={e => setHtmlBody(e.target.value)} 
                    className="min-h-[400px] font-mono text-sm resize-y"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-4 border-t border-border">
                <Button onClick={handleSaveTemplate} disabled={updateTemplate.isPending} size="lg" className="px-8">
                  {updateTemplate.isPending ? "Saving..." : "Save Template"}
                </Button>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </AdminLayout>
  );
}
