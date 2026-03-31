import { useState, useEffect, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import { useListEmailLogs, useGetWelcomeEmailTemplate, useUpdateWelcomeEmailTemplate, useResendBookingEmails } from "@workspace/api-client-react";
import AdminLayout from "@/components/layout/AdminLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCcw, Send, Bold, Italic, Heading2, List, ListOrdered, Link2, Code, RotateCcw, ImageIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const API_BASE = `${import.meta.env.BASE_URL}api`;

function TipTapToolbar({ editor, onImageUpload }: { editor: ReturnType<typeof useEditor>; onImageUpload: () => void }) {
  if (!editor) return null;

  const handleSetLink = () => {
    const url = window.prompt("Enter URL:");
    if (url) {
      editor.chain().focus().setLink({ href: url }).run();
    } else {
      editor.chain().focus().unsetLink().run();
    }
  };

  const btn = (active: boolean, onClick: () => void, title: string, children: React.ReactNode) => (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`p-1.5 rounded text-sm transition-colors ${active ? "bg-primary/10 text-primary" : "hover:bg-muted text-muted-foreground hover:text-foreground"}`}
    >
      {children}
    </button>
  );

  return (
    <div className="flex flex-wrap gap-0.5 p-2 border-b border-border bg-muted/30">
      {btn(editor.isActive("bold"), () => editor.chain().focus().toggleBold().run(), "Bold", <Bold className="w-4 h-4" />)}
      {btn(editor.isActive("italic"), () => editor.chain().focus().toggleItalic().run(), "Italic", <Italic className="w-4 h-4" />)}
      <span className="w-px bg-border mx-1 self-stretch" />
      {btn(editor.isActive("heading", { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run(), "Heading 2", <Heading2 className="w-4 h-4" />)}
      <span className="w-px bg-border mx-1 self-stretch" />
      {btn(editor.isActive("bulletList"), () => editor.chain().focus().toggleBulletList().run(), "Bullet List", <List className="w-4 h-4" />)}
      {btn(editor.isActive("orderedList"), () => editor.chain().focus().toggleOrderedList().run(), "Ordered List", <ListOrdered className="w-4 h-4" />)}
      <span className="w-px bg-border mx-1 self-stretch" />
      {btn(editor.isActive("link"), handleSetLink, "Link", <Link2 className="w-4 h-4" />)}
      {btn(editor.isActive("code"), () => editor.chain().focus().toggleCode().run(), "Inline Code", <Code className="w-4 h-4" />)}
      {btn(false, onImageUpload, "Insert Image", <ImageIcon className="w-4 h-4" />)}
      <span className="w-px bg-border mx-1 self-stretch" />
      {btn(false, () => editor.chain().focus().undo().run(), "Undo", <RotateCcw className="w-4 h-4" />)}
    </div>
  );
}

const BRANDED_PREVIEW_WRAPPER = (body: string) => `
<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  body{margin:0;background:#FCFBFA;font-family:Figtree,Arial,sans-serif;font-size:15px;color:#000}
  .wrapper{max-width:600px;margin:40px auto;background:#fff;border:1px solid #e5e5e5}
  .header{background:#E74F3E;padding:24px 32px;text-align:center}
  .header strong{font-size:20px;color:#fff;letter-spacing:.5px}
  .header div{font-size:13px;color:rgba(255,255,255,.8);margin-top:4px}
  .content{padding:32px}
  .footer{border-top:1px solid #e5e5e5;padding:20px 32px;text-align:center;font-size:12px;color:#999}
  .footer a{color:#E74F3E;text-decoration:none}
</style></head>
<body>
<div class="wrapper">
  <div class="header">
    <strong>HR Analytics Summit</strong>
    <div>3 September 2026 · 155 Bishopsgate, London</div>
  </div>
  <div class="content">${body}</div>
  <div class="footer">
    <p>&copy; 2026 HR Analytics Summit. All rights reserved.</p>
    <p><a href="https://www.hranalyticssummit.com">www.hranalyticssummit.com</a></p>
    <p style="font-size:11px;color:#999">People Strategy Hub Ltd · London, UK</p>
  </div>
</div>
</body></html>`;

export default function AdminEmails() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("logs");
  const [page, setPage] = useState(1);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const { data: logsData, isLoading: logsLoading } = useListEmailLogs(
    { page, limit: 20 },
    {
      query: {
        queryKey: ["emailLogs", page],
      }
    }
  );

  const { data: templateData, isLoading: templateLoading } = useGetWelcomeEmailTemplate({
    query: {
      queryKey: ["welcomeTemplate"],
    }
  });

  const updateTemplate = useUpdateWelcomeEmailTemplate();
  const resendEmails = useResendBookingEmails();

  const [subject, setSubject] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [testName, setTestName] = useState("");
  const [isSendingTest, setIsSendingTest] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false }),
      Image.configure({ inline: false, allowBase64: true }),
    ],
    content: "",
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none focus:outline-none min-h-[360px] px-4 py-3",
      },
    },
  });

  const handleImageUpload = () => {
    imageInputRef.current?.click();
  };

  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editor) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const src = ev.target?.result as string;
      if (src) {
        editor.chain().focus().setImage({ src }).run();
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  useEffect(() => {
    if (templateData) {
      setSubject(templateData.subject);
      if (editor && templateData.htmlBody) {
        editor.commands.setContent(templateData.htmlBody);
      }
    }
  }, [templateData, editor]);

  const handleSaveTemplate = async () => {
    const htmlBody = editor ? editor.getHTML() : "";
    await updateTemplate.mutateAsync({
      data: { subject, htmlBody }
    });
    toast({
      title: "Template Saved",
      description: "The welcome email template has been updated successfully."
    });
    queryClient.invalidateQueries({ queryKey: ["welcomeTemplate"] });
  };

  const handleTestSend = async () => {
    if (!testEmail) {
      toast({ title: "Email required", description: "Enter a recipient email address.", variant: "destructive" });
      return;
    }
    setIsSendingTest(true);
    try {
      const token = localStorage.getItem("admin_token") || "";
      const resp = await fetch(`${API_BASE}/email-templates/welcome/test-send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-token": token,
        },
        body: JSON.stringify({ toEmail: testEmail, toName: testName || "Test User" }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Unknown error" }));
        throw new Error((err as { error?: string }).error || "Failed to send");
      }
      toast({ title: "Test Email Sent", description: `Test email dispatched to ${testEmail}.` });
    } catch (e) {
      toast({ title: "Send Failed", description: e instanceof Error ? e.message : "Failed to send test email.", variant: "destructive" });
    } finally {
      setIsSendingTest(false);
    }
  };

  const handleResend = async (bookingId: number) => {
    try {
      await resendEmails.mutateAsync({ bookingId });
      toast({
        title: "Emails Resent",
        description: `Emails for booking #${bookingId} have been queued for resending.`
      });
    } catch {
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
            <div className="space-y-6">
              <div className="bg-white p-6 border border-border shadow-sm space-y-6">
                <div>
                  <h3 className="text-lg font-bold mb-1">Welcome Email Template</h3>
                  <p className="text-sm text-muted-foreground">Sent to all attendees upon successful registration. Edit the content below then save.</p>
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
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-bold uppercase tracking-wider">Email Body</label>
                      <Button variant="outline" size="sm" onClick={() => setShowPreview(p => !p)} className="text-xs">
                        {showPreview ? "Edit" : "Preview HTML"}
                      </Button>
                    </div>
                    <div className="p-3 bg-muted/30 border border-border text-sm mb-2 font-mono text-muted-foreground">
                      Variables: {`{{firstName}}`}, {`{{lastName}}`}, {`{{passType}}`}, {`{{orderReference}}`}
                    </div>
                    <input
                      ref={imageInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleImageFileChange}
                    />
                    {showPreview ? (
                      <iframe
                        className="border border-border rounded w-full min-h-[500px]"
                        sandbox="allow-same-origin"
                        srcDoc={BRANDED_PREVIEW_WRAPPER(editor ? editor.getHTML() : "")}
                        title="Email Preview"
                      />
                    ) : (
                      <div className="border border-border rounded overflow-hidden bg-white">
                        <TipTapToolbar editor={editor} onImageUpload={handleImageUpload} />
                        <EditorContent editor={editor} />
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex justify-end pt-4 border-t border-border">
                  <Button onClick={handleSaveTemplate} disabled={updateTemplate.isPending} size="lg" className="px-8">
                    {updateTemplate.isPending ? "Saving..." : "Save Template"}
                  </Button>
                </div>
              </div>

              <div className="bg-white p-6 border border-border shadow-sm space-y-4">
                <div>
                  <h3 className="text-base font-bold mb-1">Send Test Email</h3>
                  <p className="text-sm text-muted-foreground">Send the current saved template to a test address to verify formatting before going live.</p>
                </div>
                <div className="flex gap-3 flex-wrap">
                  <Input
                    type="text"
                    placeholder="Recipient name (optional)"
                    value={testName}
                    onChange={e => setTestName(e.target.value)}
                    className="h-10 w-56"
                  />
                  <Input
                    type="email"
                    placeholder="test@example.com"
                    value={testEmail}
                    onChange={e => setTestEmail(e.target.value)}
                    className="h-10 w-64"
                  />
                  <Button onClick={handleTestSend} disabled={isSendingTest} className="h-10 px-6">
                    <Send className="w-4 h-4 mr-2" />
                    {isSendingTest ? "Sending..." : "Send Test"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </AdminLayout>
  );
}
