import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { 
  useListPromoCodes, 
  useCreatePromoCode, 
  useUpdatePromoCode,
  useDeletePromoCode
} from "@workspace/api-client-react";
import AdminLayout from "@/components/layout/AdminLayout";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

const promoSchema = z.object({
  code: z.string().min(1, "Code is required").toUpperCase(),
  discountType: z.enum(["percentage", "fixed"]),
  discountValue: z.coerce.number().min(1, "Value must be greater than 0"),
  maxUses: z.coerce.number().optional().nullable(),
  isActive: z.boolean().default(true),
  applySingle: z.boolean().default(true),
  applyBusiness: z.boolean().default(true),
}).refine((data) => data.applySingle || data.applyBusiness, {
  message: "At least one pass type must be selected",
  path: ["applySingle"],
});

function passTypeBadges(types: string[] | undefined) {
  if (!types || types.length === 0) {
    return <Badge variant="secondary">Both</Badge>;
  }
  if (types.includes("single") && types.includes("business")) {
    return <Badge variant="secondary">Both</Badge>;
  }
  return (
    <div className="flex gap-1 flex-wrap">
      {types.includes("single") && (
        <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">Single</Badge>
      )}
      {types.includes("business") && (
        <Badge className="bg-purple-100 text-purple-800 hover:bg-purple-100">Business</Badge>
      )}
    </div>
  );
}

export default function AdminPromoCodes() {
  const queryClient = useQueryClient();
  const [isAddOpen, setIsAddOpen] = useState(false);

  const { data, isLoading } = useListPromoCodes({
    query: {
      queryKey: ["promoCodes"],
    }
  });

  const createPromo = useCreatePromoCode();
  const updatePromo = useUpdatePromoCode();
  const deletePromo = useDeletePromoCode();

  const form = useForm<z.infer<typeof promoSchema>>({
    resolver: zodResolver(promoSchema),
    defaultValues: {
      code: "",
      discountType: "percentage",
      discountValue: 10,
      maxUses: null,
      isActive: true,
      applySingle: true,
      applyBusiness: true,
    }
  });

  const { watch } = form;
  const applySingle = watch("applySingle");
  const applyBusiness = watch("applyBusiness");

  const onSubmit = async (values: z.infer<typeof promoSchema>) => {
    const applicablePassTypes: string[] = [];
    if (values.applySingle) applicablePassTypes.push("single");
    if (values.applyBusiness) applicablePassTypes.push("business");

    await createPromo.mutateAsync({
      data: {
        code: values.code,
        discountType: values.discountType,
        discountValue: values.discountValue,
        maxUses: values.maxUses,
        isActive: values.isActive,
        applicablePassTypes,
      }
    });
    queryClient.invalidateQueries({ queryKey: ["promoCodes"] });
    setIsAddOpen(false);
    form.reset();
  };

  const toggleActive = async (id: number, isActive: boolean) => {
    await updatePromo.mutateAsync({
      id,
      data: { isActive }
    });
    queryClient.invalidateQueries({ queryKey: ["promoCodes"] });
  };

  const handleDelete = async (id: number) => {
    if (confirm("Are you sure you want to delete this promo code?")) {
      await deletePromo.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: ["promoCodes"] });
    }
  };

  return (
    <AdminLayout title="Promo Codes">
      <div className="flex justify-between items-center mb-6">
        <p className="text-muted-foreground">Manage discount codes and special offers.</p>
        
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="w-4 h-4" />
              Add Promo Code
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Promo Code</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
                <FormField
                  control={form.control}
                  name="code"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Code</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. EARLYBIRD20" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="discountType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Type</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select type" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="percentage">Percentage (%)</SelectItem>
                            <SelectItem value="fixed">Fixed Amount (£)</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="discountValue"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Value</FormLabel>
                        <FormControl>
                          <Input type="number" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="maxUses"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Max Uses (optional)</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} value={field.value || ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="border rounded-md p-4 space-y-3">
                  <FormLabel className="text-base">Applies To</FormLabel>
                  <p className="text-xs text-muted-foreground">Select which pass types this code can be used with.</p>
                  <FormField
                    control={form.control}
                    name="applySingle"
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between">
                        <div>
                          <FormLabel className="font-normal">Single Pass</FormLabel>
                          <p className="text-xs text-muted-foreground">HR professional ticket (£199)</p>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            disabled={!applyBusiness && field.value}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="applyBusiness"
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between">
                        <div>
                          <FormLabel className="font-normal">Business Pass</FormLabel>
                          <p className="text-xs text-muted-foreground">Vendor / supplier ticket (£599)</p>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            disabled={!applySingle && field.value}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  {form.formState.errors.applySingle && (
                    <p className="text-sm text-destructive">{form.formState.errors.applySingle.message}</p>
                  )}
                </div>

                <FormField
                  control={form.control}
                  name="isActive"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between p-4 border rounded-md">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">Active Status</FormLabel>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <div className="flex justify-end pt-4">
                  <Button type="submit" disabled={createPromo.isPending}>Save Promo Code</Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
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
                <TableHead>Code</TableHead>
                <TableHead>Discount</TableHead>
                <TableHead>Applies To</TableHead>
                <TableHead>Usage</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.map((promo) => (
                <TableRow key={promo.id}>
                  <TableCell className="font-mono font-bold text-lg">{promo.code}</TableCell>
                  <TableCell>
                    {promo.discountType === "percentage" ? `${promo.discountValue}%` : `£${promo.discountValue}`}
                  </TableCell>
                  <TableCell>
                    {passTypeBadges(promo.applicablePassTypes)}
                  </TableCell>
                  <TableCell>
                    {promo.usedCount} {promo.maxUses ? `/ ${promo.maxUses}` : "used"}
                  </TableCell>
                  <TableCell>
                    <Switch 
                      checked={promo.isActive} 
                      onCheckedChange={(val) => toggleActive(promo.id, val)}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(promo.id)} className="text-destructive hover:bg-destructive/10">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {data?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                    No promo codes created yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </div>
    </AdminLayout>
  );
}
