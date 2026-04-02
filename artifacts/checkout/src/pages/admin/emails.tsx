import { useState, useEffect, useRef, useCallback } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { useListEmailLogs, useResendBookingEmails } from "@workspace/api-client-react";
import AdminLayout from "@/components/layout/AdminLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCcw, Send, Bold, Italic, Heading2, List, ListOrdered, Link2, Code, RotateCcw, ImageIcon, Upload, X, Loader2, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const API_BASE = `${import.meta.env.BASE_URL}api`;

function getAdminToken() {
  return localStorage.getItem("admin_token") || "";
}

// ─── TipTap Toolbar ───────────────────────────────────────────────────────────

function TipTapToolbar({ editor, onImageUpload }: { editor: ReturnType<typeof useEditor>; onImageUpload: () => void }) {
  if (!editor) return null;

  const handleSetLink = () => {
    const url = window.prompt("Enter URL:");
    if (url) editor.chain().focus().setLink({ href: url }).run();
    else editor.chain().focus().unsetLink().run();
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

// ─── Template Editor ──────────────────────────────────────────────────────────

type TemplateType = "welcome" | "confirmation" | "invoice_reminder";

const TEMPLATE_LABELS: Record<TemplateType, string> = {
  welcome: "Welcome Email",
  confirmation: "Booking Confirmation",
  invoice_reminder: "Invoice Reminder",
};

const TEMPLATE_VARIABLES: Record<TemplateType, string[]> = {
  welcome: ["{{firstName}}", "{{name}}"],
  confirmation: ["{{firstName}}", "{{orderReference}}", "{{passType}}", "{{quantity}}", "{{total}}"],
  invoice_reminder: ["{{firstName}}", "{{recipientName}}", "{{orderReference}}", "{{dueDate}}", "{{payOnlineButton}}"],
};

const TEMPLATE_DESCRIPTIONS: Record<TemplateType, string> = {
  welcome: "Sent as a personal follow-up after registration. Use this for a warm welcome message.",
  confirmation: "Sent automatically after every successful booking (card or invoice). Contains the attendee's order details.",
  invoice_reminder: "Sent manually from the Registrations panel when clicking 'Send Reminder' on an invoiced booking. The order summary table, payment button, and bank transfer details are automatically appended — edit only the intro message here. The subject supports {{orderReference}}.",
};

function TemplateEditor({ type, settings }: { type: TemplateType; settings: EventSettingsData | null }) {
  const { toast } = useToast();
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [subject, setSubject] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [testEmail, setTestEmail] = useState("");
  const [testName, setTestName] = useState("");
  const [isSendingTest, setIsSendingTest] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false } }),
      Image.configure({ inline: false, allowBase64: true }),
    ],
    content: "",
    editorProps: {
      attributes: { class: "prose prose-sm max-w-none focus:outline-none min-h-[360px] px-4 py-3" },
    },
  });

  useEffect(() => {
    async function loadTemplate() {
      setIsLoading(true);
      try {
        const resp = await fetch(`${API_BASE}/email-templates/${type}`, {
          headers: { "x-admin-token": getAdminToken() },
        });
        if (resp.ok) {
          const data = await resp.json();
          setSubject(data.subject || "");
          if (editor && data.htmlBody) editor.commands.setContent(data.htmlBody);
        }
      } catch { /* ignore */ }
      setIsLoading(false);
    }
    if (editor) loadTemplate();
  }, [type, editor]);

  const previewHtml = useCallback(() => {
    if (!settings || !editor) return "";
    const logoDataUrl = settings.logoDataUrl;
    const eventName = settings.eventName || "Your Event";
    const eventDate = settings.eventDate || "";
    const eventVenue = settings.eventVenue || "";
    const orgName = settings.orgName || "";
    const orgAddress = settings.orgAddress || "";
    const orgWebsite = settings.orgWebsite || "";

    const headerContent = logoDataUrl
      ? `<img src="${logoDataUrl}" alt="${eventName}" style="max-height:60px;max-width:200px;" />`
      : `<strong style="font-size:20px;color:#E74F3E;">${eventName}</strong>`;

    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  body{margin:0;background:#FCFBFA;font-family:Figtree,Arial,sans-serif;font-size:15px;color:#000}
  .wrapper{max-width:600px;margin:40px auto;background:#fff;border:1px solid #e5e5e5}
  .header{background:#FCFBFA;padding:24px 32px;border-bottom:2px solid #E74F3E;text-align:center}
  .content{padding:32px}
  .footer{background:#1a1a1a;color:#ccc;padding:24px 32px;text-align:center;font-size:12px}
  .footer a{color:#F48847;text-decoration:none}
  h2{color:#000}
  .info-box{background:#FCFBFA;border:1px solid #DEDDDC;padding:16px 20px;border-radius:4px;margin:16px 0}
</style></head>
<body><div class="wrapper">
  <div class="header">
    ${headerContent}
    <div style="font-size:13px;color:#666;margin-top:4px">${eventDate}${eventDate && eventVenue ? " · " : ""}${eventVenue}</div>
  </div>
  <div class="content">${editor.getHTML()}</div>
  <div class="footer">
    <p>&copy; 2026 ${eventName}. All rights reserved.</p>
    <p><a href="${orgWebsite}">${orgWebsite.replace(/^https?:\/\//, "")}</a></p>
    <p style="font-size:11px;color:#999">${orgName} · ${orgAddress}</p>
  </div>
</div></body></html>`;
  }, [editor, settings]);

  const handleSave = async () => {
    if (!editor) return;
    setIsSaving(true);
    try {
      const resp = await fetch(`${API_BASE}/email-templates/${type}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-admin-token": getAdminToken() },
        body: JSON.stringify({ subject, htmlBody: editor.getHTML() }),
      });
      if (!resp.ok) throw new Error("Failed to save");
      toast({ title: "Template Saved", description: `${TEMPLATE_LABELS[type]} template updated successfully.` });
    } catch {
      toast({ title: "Save Failed", description: "Could not save the template.", variant: "destructive" });
    }
    setIsSaving(false);
  };

  const handleTestSend = async () => {
    if (!testEmail) {
      toast({ title: "Email required", description: "Enter a recipient email address.", variant: "destructive" });
      return;
    }
    setIsSendingTest(true);
    try {
      const resp = await fetch(`${API_BASE}/email-templates/${type}/test-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-token": getAdminToken() },
        body: JSON.stringify({ toEmail: testEmail, toName: testName || "Test User" }),
      });
      if (!resp.ok) throw new Error("Failed to send");
      toast({ title: "Test Email Sent", description: `Test sent to ${testEmail}.` });
    } catch {
      toast({ title: "Send Failed", description: "Could not send test email.", variant: "destructive" });
    }
    setIsSendingTest(false);
  };

  const handleImageUpload = () => imageInputRef.current?.click();

  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editor) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const src = ev.target?.result as string;
      if (src) editor.chain().focus().setImage({ src }).run();
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 border border-border shadow-sm space-y-6">
        <div>
          <h3 className="text-lg font-bold mb-1">{TEMPLATE_LABELS[type]}</h3>
          <p className="text-sm text-muted-foreground">{TEMPLATE_DESCRIPTIONS[type]}</p>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-bold uppercase tracking-wider">Subject Line</label>
            <Input value={subject} onChange={e => setSubject(e.target.value)} className="h-12" />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-bold uppercase tracking-wider">Email Body</label>
              <Button variant="outline" size="sm" onClick={() => setShowPreview(p => !p)} className="text-xs">
                {showPreview ? "Edit" : "Preview"}
              </Button>
            </div>
            <div className="p-3 bg-muted/30 border border-border text-sm mb-2 font-mono text-muted-foreground flex flex-wrap gap-2">
              <span className="font-sans font-semibold text-foreground">Variables:</span>
              {TEMPLATE_VARIABLES[type].map(v => (
                <code key={v} className="bg-muted px-1.5 py-0.5 rounded text-xs">{v}</code>
              ))}
            </div>
            <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageFileChange} />
            {showPreview ? (
              <iframe
                className="border border-border rounded w-full min-h-[500px]"
                sandbox="allow-same-origin"
                srcDoc={previewHtml()}
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
          <Button onClick={handleSave} disabled={isSaving} size="lg" className="px-8">
            {isSaving ? "Saving..." : "Save Template"}
          </Button>
        </div>
      </div>

      <div className="bg-white p-6 border border-border shadow-sm space-y-4">
        <div>
          <h3 className="text-base font-bold mb-1">Send Test Email</h3>
          <p className="text-sm text-muted-foreground">Verify the current saved template before going live.</p>
        </div>
        <div className="flex gap-3 flex-wrap">
          <Input type="text" placeholder="Recipient name (optional)" value={testName} onChange={e => setTestName(e.target.value)} className="h-10 w-56" />
          <Input type="email" placeholder="test@example.com" value={testEmail} onChange={e => setTestEmail(e.target.value)} className="h-10 w-64" />
          <Button onClick={handleTestSend} disabled={isSendingTest} className="h-10 px-6">
            <Send className="w-4 h-4 mr-2" />
            {isSendingTest ? "Sending..." : "Send Test"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Branding Settings ────────────────────────────────────────────────────────

type EventSettingsData = {
  id: number;
  eventName: string;
  eventDate: string;
  eventVenue: string;
  eventVenuePostcode: string;
  orgName: string;
  orgAddress: string;
  orgWebsite: string;
  logoDataUrl: string | null;
  fromName: string;
  fromEmail: string;
};

function BrandingSettings() {
  const { toast } = useToast();
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [settings, setSettings] = useState<EventSettingsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    async function load() {
      setIsLoading(true);
      try {
        const resp = await fetch(`${API_BASE}/admin/event-settings`, {
          headers: { "x-admin-token": getAdminToken() },
        });
        if (resp.ok) setSettings(await resp.json());
      } catch { /* ignore */ }
      setIsLoading(false);
    }
    load();
  }, []);

  const handleSave = async () => {
    if (!settings) return;
    setIsSaving(true);
    try {
      const resp = await fetch(`${API_BASE}/admin/event-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-admin-token": getAdminToken() },
        body: JSON.stringify(settings),
      });
      if (!resp.ok) throw new Error("Failed to save");
      const updated = await resp.json();
      setSettings(updated);
      toast({ title: "Settings Saved", description: "Branding and event settings have been updated. All future emails will use the new settings." });
    } catch {
      toast({ title: "Save Failed", description: "Could not save settings.", variant: "destructive" });
    }
    setIsSaving(false);
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !settings) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const src = ev.target?.result as string;
      if (src) setSettings(s => s ? { ...s, logoDataUrl: src } : s);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const set = (key: keyof EventSettingsData, value: string | null) => {
    setSettings(s => s ? { ...s, [key]: value } : s);
  };

  if (isLoading || !settings) {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const field = (label: string, key: keyof EventSettingsData, placeholder?: string, hint?: string) => (
    <div className="space-y-1">
      <label className="text-sm font-bold uppercase tracking-wider text-muted-foreground">{label}</label>
      <Input
        value={(settings[key] as string) || ""}
        onChange={e => set(key, e.target.value)}
        placeholder={placeholder}
        className="h-11"
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Logo */}
      <div className="bg-white p-6 border border-border shadow-sm space-y-4">
        <div>
          <h3 className="text-lg font-bold mb-1">Logo</h3>
          <p className="text-sm text-muted-foreground">Upload your logo — it will appear at the top of all outgoing emails in place of the text header.</p>
        </div>
        <div className="flex items-center gap-6">
          {settings.logoDataUrl ? (
            <div className="relative border border-border rounded p-3 bg-muted/20">
              <img src={settings.logoDataUrl} alt="Logo preview" className="max-h-16 max-w-48 object-contain" />
              <button
                type="button"
                onClick={() => set("logoDataUrl", null)}
                className="absolute -top-2 -right-2 w-5 h-5 bg-destructive text-white rounded-full flex items-center justify-center text-xs"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <div className="border-2 border-dashed border-border rounded p-6 text-center text-muted-foreground w-48">
              <ImageIcon className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-xs">No logo uploaded</p>
            </div>
          )}
          <div>
            <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
            <Button variant="outline" onClick={() => logoInputRef.current?.click()} className="gap-2">
              <Upload className="w-4 h-4" />
              {settings.logoDataUrl ? "Replace Logo" : "Upload Logo"}
            </Button>
            <p className="text-xs text-muted-foreground mt-2">PNG, JPG or SVG recommended. Max 2MB.</p>
          </div>
        </div>
      </div>

      {/* Event Details */}
      <div className="bg-white p-6 border border-border shadow-sm space-y-4">
        <h3 className="text-lg font-bold">Event Details</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {field("Event Name", "eventName", "HR Analytics Summit", "Appears in email subject lines and body text.")}
          {field("Event Date", "eventDate", "3 September 2026")}
          {field("Venue", "eventVenue", "155 Bishopsgate, London")}
          {field("Venue Postcode", "eventVenuePostcode", "EC2M 3TQ")}
        </div>
      </div>

      {/* Organisation */}
      <div className="bg-white p-6 border border-border shadow-sm space-y-4">
        <h3 className="text-lg font-bold">Organisation</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {field("Organisation Name", "orgName", "People Strategy Hub Ltd", "Shown in email footers.")}
          {field("Organisation Address", "orgAddress", "London, UK")}
          {field("Website URL", "orgWebsite", "https://www.hranalyticssummit.com")}
        </div>
      </div>

      {/* Sender Details */}
      <div className="bg-white p-6 border border-border shadow-sm space-y-4">
        <div>
          <h3 className="text-lg font-bold mb-1">Sender Details</h3>
          <p className="text-sm text-muted-foreground">The display name and address that appears in recipients' inboxes. Note: the SMTP server must be configured to allow this sender address.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {field("Sender Name", "fromName", "HR Analytics Summit", 'Shown as the "From" name in email clients.')}
          {field("Sender Email", "fromEmail", "noreply@hranalyticssummit.com", "Must match your SMTP authentication.")}
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={isSaving} size="lg" className="px-10">
          {isSaving ? "Saving..." : "Save All Settings"}
        </Button>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminEmails() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("branding");
  const [page, setPage] = useState(1);
  const [eventSettings, setEventSettings] = useState<EventSettingsData | null>(null);

  const { data: logsData, isLoading: logsLoading } = useListEmailLogs(
    { page, limit: 20 },
    { query: { queryKey: ["emailLogs", page] } }
  );

  const resendEmails = useResendBookingEmails();
  const [sendingLogIds, setSendingLogIds] = useState<Set<number>>(new Set());
  const [sentLogIds, setSentLogIds] = useState<Set<number>>(new Set());

  // Load event settings for template preview
  useEffect(() => {
    async function load() {
      try {
        const resp = await fetch(`${API_BASE}/admin/event-settings`, {
          headers: { "x-admin-token": getAdminToken() },
        });
        if (resp.ok) setEventSettings(await resp.json());
      } catch { /* ignore */ }
    }
    load();
  }, []);

  const handleResend = async (logId: number, bookingId: number) => {
    if (sendingLogIds.has(logId)) return;
    setSendingLogIds(prev => new Set(prev).add(logId));
    setSentLogIds(prev => { const s = new Set(prev); s.delete(logId); return s; });
    try {
      await resendEmails.mutateAsync({ bookingId });
      setSentLogIds(prev => new Set(prev).add(logId));
      toast({ title: "Emails resent", description: `Confirmation emails for booking #${bookingId} have been resent.` });
      setTimeout(() => setSentLogIds(prev => { const s = new Set(prev); s.delete(logId); return s; }), 3000);
    } catch {
      toast({ title: "Failed to resend", description: "Something went wrong. Please try again.", variant: "destructive" });
    } finally {
      setSendingLogIds(prev => { const s = new Set(prev); s.delete(logId); return s; });
    }
  };

  return (
    <AdminLayout title="Email Communications">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-white border border-border h-12 w-full justify-start rounded-none mb-6 overflow-x-auto">
          <TabsTrigger value="branding" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary h-full px-6 rounded-none whitespace-nowrap">Branding & Settings</TabsTrigger>
          <TabsTrigger value="welcome" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary h-full px-6 rounded-none whitespace-nowrap">Welcome Email</TabsTrigger>
          <TabsTrigger value="confirmation" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary h-full px-6 rounded-none whitespace-nowrap">Booking Confirmation</TabsTrigger>
          <TabsTrigger value="invoice_reminder" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary h-full px-6 rounded-none whitespace-nowrap">Invoice Reminder</TabsTrigger>
          <TabsTrigger value="logs" className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary h-full px-6 rounded-none whitespace-nowrap">Email Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="branding">
          <BrandingSettings />
        </TabsContent>

        <TabsContent value="welcome">
          <TemplateEditor type="welcome" settings={eventSettings} />
        </TabsContent>

        <TabsContent value="confirmation">
          <TemplateEditor type="confirmation" settings={eventSettings} />
        </TabsContent>

        <TabsContent value="invoice_reminder">
          <TemplateEditor type="invoice_reminder" settings={eventSettings} />
        </TabsContent>

        <TabsContent value="logs">
          <div className="bg-white border border-border shadow-sm">
            {logsLoading ? (
              <div className="flex justify-center py-20">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : (
              <>
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Recipient</TableHead>
                      <TableHead>Booking #</TableHead>
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
                          <Badge
                            variant={log.status === "sent" ? "default" : log.status === "failed" ? "destructive" : "secondary"}
                            className="uppercase text-[10px]"
                          >
                            {log.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {log.bookingId && (
                            <Button
                              variant={sentLogIds.has(log.id) ? "default" : "outline"}
                              size="sm"
                              onClick={() => handleResend(log.id, log.bookingId!)}
                              disabled={sendingLogIds.has(log.id)}
                              className={`h-8 px-3 min-w-[100px] transition-all ${sentLogIds.has(log.id) ? "bg-green-600 hover:bg-green-700 text-white border-green-600" : ""}`}
                            >
                              {sendingLogIds.has(log.id) ? (
                                <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Sending…</>
                              ) : sentLogIds.has(log.id) ? (
                                <><CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> Sent</>
                              ) : (
                                <><RefreshCcw className="w-3.5 h-3.5 mr-1.5" /> Resend</>
                              )}
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
                      Showing {(page - 1) * logsData.limit + 1}–{Math.min(page * logsData.limit, logsData.total)} of {logsData.total}
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
      </Tabs>
    </AdminLayout>
  );
}
