import { useState } from "react";
import { z } from "zod";
import { useUpdateBooking, useCreateAttendee, useUpdateAttendee } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Checkbox } from "@/components/ui/checkbox";
import type { BookingWithAttendees } from "@/types/booking";

const attendeeSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  jobTitle: z.string().min(1, "Job title is required"),
  company: z.string().min(1, "Company is required"),
  workEmail: z.string().email("Valid email is required"),
  phone: z.string().optional(),
  gdprConsent: z.boolean().refine(val => val === true, {
    message: "You must agree to the terms",
  }),
});

interface AttendeeFormData {
  firstName: string;
  lastName: string;
  jobTitle: string;
  company: string;
  workEmail: string;
  phone: string;
  gdprConsent: boolean;
  id?: number;
}

interface Step3AttendeesProps {
  booking: BookingWithAttendees;
}

export default function Step3Attendees({ booking }: Step3AttendeesProps) {
  const updateBooking = useUpdateBooking();
  const createAttendee = useCreateAttendee();
  const updateAttendee = useUpdateAttendee();
  const queryClient = useQueryClient();

  // Determine how many additional attendees we need
  const totalQuantity = booking.quantity;
  const leadAttendee = booking.attendees?.find((a) => a.isLead);
  const additionalAttendees = booking.attendees?.filter((a) => !a.isLead) || [];

  const expectedAdditionalCount = totalQuantity - 1;

  const [openItem, setOpenItem] = useState<string>("attendee-0");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // We will maintain state for all forms locally, then submit all at once
  const [formsData, setFormsData] = useState<AttendeeFormData[]>(() => {
    const initial = [];
    for (let i = 0; i < expectedAdditionalCount; i++) {
      const existing = additionalAttendees[i];
      initial.push({
        firstName: existing?.firstName || "",
        lastName: existing?.lastName || "",
        jobTitle: existing?.jobTitle || "",
        company: existing?.company || leadAttendee?.company || "",
        workEmail: existing?.workEmail || "",
        phone: existing?.phone || "",
        gdprConsent: existing?.gdprConsent || false,
        id: existing?.id
      });
    }
    return initial;
  });

  const handleContinue = async () => {
    // Validate all forms manually
    let allValid = true;
    const validatedForms = formsData.map((data, index) => {
      const result = attendeeSchema.safeParse(data);
      if (!result.success) {
        allValid = false;
        setOpenItem(`attendee-${index}`);
      }
      return result;
    });

    if (!allValid) return;

    setIsSubmitting(true);
    try {
      for (let i = 0; i < expectedAdditionalCount; i++) {
        const data = formsData[i];
        if (data.id) {
          await updateAttendee.mutateAsync({
            bookingId: booking.id,
            attendeeId: data.id,
            data: {
              firstName: data.firstName,
              lastName: data.lastName,
              jobTitle: data.jobTitle,
              company: data.company,
              workEmail: data.workEmail,
              phone: data.phone || null,
              gdprConsent: data.gdprConsent,
            }
          });
        } else {
          await createAttendee.mutateAsync({
            bookingId: booking.id,
            data: {
              isLead: false,
              firstName: data.firstName,
              lastName: data.lastName,
              jobTitle: data.jobTitle,
              company: data.company,
              workEmail: data.workEmail,
              phone: data.phone || null,
              gdprConsent: data.gdprConsent,
              seatIndex: i + 1
            }
          });
        }
      }

      await updateBooking.mutateAsync({
        id: booking.id,
        data: { currentStep: 4 }
      });
      queryClient.invalidateQueries({ queryKey: ["booking"] });
    } catch (e) {
      console.error(e);
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateFormData = <K extends keyof AttendeeFormData>(index: number, field: K, value: AttendeeFormData[K]) => {
    const newFormsData = [...formsData];
    newFormsData[index] = { ...newFormsData[index], [field]: value };
    setFormsData(newFormsData);
  };

  if (expectedAdditionalCount === 0) {
    // Just show a simple view and continue button
    return (
      <div className="max-w-2xl mx-auto space-y-8 text-center">
        <div>
          <h1 className="text-4xl md:text-5xl font-bold mb-4">You're all set!</h1>
          <p className="text-lg text-muted-foreground">Since you purchased a single pass, we already have your details.</p>
        </div>
        <div className="bg-white p-8 border border-border inline-block text-left w-full">
          <h3 className="font-bold text-lg mb-2">Lead Attendee:</h3>
          <p>{leadAttendee?.firstName} {leadAttendee?.lastName}</p>
          <p className="text-muted-foreground">{leadAttendee?.jobTitle} at {leadAttendee?.company}</p>
          <p className="text-muted-foreground">{leadAttendee?.workEmail}</p>
        </div>
        <div className="flex justify-between pt-4">
          <Button variant="outline" size="lg" className="px-8 h-14 text-lg border-border" onClick={async () => {
            await updateBooking.mutateAsync({ id: booking.id, data: { currentStep: 2 } });
            queryClient.invalidateQueries({ queryKey: ["booking"] });
          }}>Back</Button>
          <Button size="lg" className="px-10 h-14 text-lg bg-primary hover:bg-primary/90 text-white border-none" onClick={() => {
            updateBooking.mutateAsync({ id: booking.id, data: { currentStep: 4 } }).then(() => queryClient.invalidateQueries({ queryKey: ["booking"] }));
          }}>Continue to Payment</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-4xl md:text-5xl font-bold mb-4">Attendee Details</h1>
        <p className="text-lg text-muted-foreground">Please provide details for the remaining {expectedAdditionalCount} attendee(s).</p>
      </div>

      <Accordion type="single" value={openItem} onValueChange={setOpenItem} className="space-y-4">
        {formsData.map((data, index) => (
          <AccordionItem key={index} value={`attendee-${index}`} className="bg-white border border-border px-6">
            <AccordionTrigger className="hover:no-underline py-6">
              <div className="flex flex-col text-left">
                <span className="font-bold text-xl">Attendee {index + 2}</span>
                <span className="text-sm text-muted-foreground font-normal">
                  {data.firstName && data.lastName ? `${data.firstName} ${data.lastName}` : "Pending details"}
                </span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pb-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-border">
                <div className="space-y-2">
                  <label className="text-sm font-medium">First Name *</label>
                  <Input value={data.firstName} onChange={(e) => updateFormData(index, "firstName", e.target.value)} className="h-12 bg-white" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Last Name *</label>
                  <Input value={data.lastName} onChange={(e) => updateFormData(index, "lastName", e.target.value)} className="h-12 bg-white" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Work Email *</label>
                  <Input type="email" value={data.workEmail} onChange={(e) => updateFormData(index, "workEmail", e.target.value)} className="h-12 bg-white" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Emergency Contact (optional)</label>
                  <Input value={data.phone} onChange={(e) => updateFormData(index, "phone", e.target.value)} className="h-12 bg-white" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Job Title *</label>
                  <Input value={data.jobTitle} onChange={(e) => updateFormData(index, "jobTitle", e.target.value)} className="h-12 bg-white" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Company *</label>
                  <Input value={data.company} onChange={(e) => updateFormData(index, "company", e.target.value)} className="h-12 bg-white" />
                </div>
              </div>
              <div className="pt-6 mt-6 border-t border-border">
                <div className="flex items-start space-x-3">
                  <Checkbox 
                    checked={data.gdprConsent} 
                    onCheckedChange={(val) => updateFormData(index, "gdprConsent", !!val)} 
                    className="mt-1"
                  />
                  <div className="space-y-1 leading-none">
                    <label className="font-normal text-base cursor-pointer">
                      I understand how my data will be processed in accordance with{" "}
                      <a href="https://peoplestrategyhub.com/your-data-gdpr" target="_blank" rel="noreferrer" className="underline text-primary hover:text-primary/80">GDPR</a>
                      {" "}and{" "}
                      <a href="https://www.hranalyticssummit.com/terms-and-conditions" target="_blank" rel="noreferrer" className="underline text-primary hover:text-primary/80">Conference T&Cs</a>
                    </label>
                  </div>
                </div>
              </div>
              <div className="flex justify-end mt-6">
                {index < expectedAdditionalCount - 1 && (
                  <Button type="button" onClick={() => setOpenItem(`attendee-${index + 1}`)}>
                    Next Attendee
                  </Button>
                )}
              </div>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>

      <div className="flex justify-between pt-4">
        <Button variant="outline" size="lg" className="px-8 h-14 text-lg border-border" onClick={async () => {
          await updateBooking.mutateAsync({ id: booking.id, data: { currentStep: 2 } });
          queryClient.invalidateQueries({ queryKey: ["booking"] });
        }}>Back</Button>
        <Button 
          size="lg" 
          className="px-10 h-14 text-lg bg-primary hover:bg-primary/90 text-white border-none" 
          onClick={handleContinue}
          disabled={isSubmitting}
        >
          {isSubmitting ? "Saving..." : "Continue to Payment"}
        </Button>
      </div>
    </div>
  );
}
