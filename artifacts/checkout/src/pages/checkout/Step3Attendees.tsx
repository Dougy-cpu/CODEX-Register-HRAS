import { useState, useEffect, useRef } from "react";
import { z } from "zod";
import { useUpdateBooking, useCreateAttendee, useUpdateAttendee } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Checkbox } from "@/components/ui/checkbox";
import { User, Clock, Info } from "lucide-react";
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

  const totalSeats = booking.quantity;
  const leadAttendee = booking.attendees?.find((a) => a.isLead);
  const additionalAttendees = booking.attendees?.filter((a) => !a.isLead) || [];

  const leadDefaults: AttendeeFormData = {
    firstName: leadAttendee?.firstName || "",
    lastName: leadAttendee?.lastName || "",
    jobTitle: leadAttendee?.jobTitle || "",
    company: leadAttendee?.company || "",
    workEmail: leadAttendee?.workEmail || "",
    phone: leadAttendee?.phone || "",
    gdprConsent: leadAttendee?.gdprConsent || false,
    id: leadAttendee?.id,
  };

  const [openItem, setOpenItem] = useState<string>("attendee-0");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [formsData, setFormsData] = useState<AttendeeFormData[]>(() => {
    const forms: AttendeeFormData[] = [];
    for (let i = 0; i < totalSeats; i++) {
      if (i === 0) {
        forms.push({ ...leadDefaults });
      } else {
        const existing = additionalAttendees[i - 1];
        forms.push({
          firstName: existing?.isTbc ? "" : (existing?.firstName || ""),
          lastName: existing?.isTbc ? "" : (existing?.lastName || ""),
          jobTitle: existing?.isTbc ? "" : (existing?.jobTitle || ""),
          company: existing?.isTbc ? (leadAttendee?.company || "") : (existing?.company || leadAttendee?.company || ""),
          workEmail: existing?.isTbc ? "" : (existing?.workEmail || ""),
          phone: existing?.isTbc ? "" : (existing?.phone || ""),
          gdprConsent: existing?.isTbc ? false : (existing?.gdprConsent || false),
          id: existing?.id,
        });
      }
    }
    return forms;
  });

  const [forMeFlags, setForMeFlags] = useState<boolean[]>(() =>
    Array.from({ length: totalSeats }, (_, i) => i === 0)
  );

  const [tbcFlags, setTbcFlags] = useState<boolean[]>(() =>
    Array.from({ length: totalSeats }, (_, i) => {
      if (i === 0) return false;
      const existing = additionalAttendees[i - 1];
      return existing?.isTbc ?? false;
    })
  );

  const [errors, setErrors] = useState<(Partial<Record<keyof AttendeeFormData, string>> | null)[]>(
    Array(totalSeats).fill(null)
  );

  const autosaveIdsRef = useRef<(number | undefined)[]>(formsData.map(f => f.id));

  useEffect(() => {
    if (formsData.length === 0) return;
    const timer = setTimeout(async () => {
      for (let i = 0; i < formsData.length; i++) {
        const form = formsData[i];
        const isTbc = tbcFlags[i];

        if (!isTbc && (!form.firstName || !form.workEmail)) continue;

        if (i === 0) {
          if (leadAttendee?.id) {
            try {
              await updateAttendee.mutateAsync({
                bookingId: booking.id,
                attendeeId: leadAttendee.id,
                data: {
                  firstName: form.firstName,
                  lastName: form.lastName,
                  jobTitle: form.jobTitle,
                  company: form.company,
                  workEmail: form.workEmail,
                  phone: form.phone || null,
                  gdprConsent: form.gdprConsent,
                },
              });
            } catch { /* silent */ }
          }
        } else {
          const existingId = form.id ?? autosaveIdsRef.current[i];
          try {
            if (existingId) {
              await updateAttendee.mutateAsync({
                bookingId: booking.id,
                attendeeId: existingId,
                data: isTbc
                  ? { isTbc: true, company: leadDefaults.company }
                  : {
                      isTbc: false,
                      firstName: form.firstName,
                      lastName: form.lastName,
                      jobTitle: form.jobTitle,
                      company: form.company,
                      workEmail: form.workEmail,
                      phone: form.phone || null,
                      gdprConsent: form.gdprConsent,
                    },
              });
            } else if (isTbc) {
              const created = await createAttendee.mutateAsync({
                bookingId: booking.id,
                data: {
                  isLead: false,
                  isTbc: true,
                  gdprConsent: false,
                  company: leadDefaults.company || "TBC",
                  seatIndex: i,
                },
              });
              autosaveIdsRef.current[i] = created.id;
            }
          } catch { /* silent */ }
        }
      }
    }, 1500);
    return () => clearTimeout(timer);
  }, [formsData, tbcFlags]);

  const handleForMeToggle = (index: number, checked: boolean) => {
    const newFlags = [...forMeFlags];
    newFlags[index] = checked;
    setForMeFlags(newFlags);

    const newForms = [...formsData];
    if (checked) {
      newForms[index] = {
        ...newForms[index],
        firstName: leadDefaults.firstName,
        lastName: leadDefaults.lastName,
        jobTitle: leadDefaults.jobTitle,
        company: leadDefaults.company,
        workEmail: leadDefaults.workEmail,
        phone: leadDefaults.phone,
        gdprConsent: newForms[index].gdprConsent,
      };
    } else {
      newForms[index] = {
        ...newForms[index],
        firstName: "",
        lastName: "",
        jobTitle: "",
        company: leadDefaults.company,
        workEmail: "",
        phone: "",
      };
    }
    setFormsData(newForms);
  };

  const handleTbcToggle = (index: number, checked: boolean) => {
    const newTbc = [...tbcFlags];
    newTbc[index] = checked;
    setTbcFlags(newTbc);

    if (checked) {
      const newForms = [...formsData];
      newForms[index] = {
        ...newForms[index],
        firstName: "",
        lastName: "",
        jobTitle: "",
        company: leadDefaults.company,
        workEmail: "",
        phone: "",
        gdprConsent: false,
      };
      setFormsData(newForms);
      const newErrors = [...errors];
      newErrors[index] = null;
      setErrors(newErrors);
    }
  };

  const updateFormData = <K extends keyof AttendeeFormData>(index: number, field: K, value: AttendeeFormData[K]) => {
    const newFormsData = [...formsData];
    newFormsData[index] = { ...newFormsData[index], [field]: value };
    setFormsData(newFormsData);
    if (field !== "gdprConsent") {
      const newFlags = [...forMeFlags];
      newFlags[index] = false;
      setForMeFlags(newFlags);
    }
  };

  const handleContinue = async () => {
    let allValid = true;
    const newErrors: (Partial<Record<keyof AttendeeFormData, string>> | null)[] = Array(totalSeats).fill(null);

    for (let i = 0; i < totalSeats; i++) {
      if (tbcFlags[i]) continue;
      const result = attendeeSchema.safeParse(formsData[i]);
      if (!result.success) {
        allValid = false;
        const fieldErrors: Partial<Record<keyof AttendeeFormData, string>> = {};
        for (const issue of result.error.issues) {
          const field = issue.path[0] as keyof AttendeeFormData;
          if (!fieldErrors[field]) fieldErrors[field] = issue.message;
        }
        newErrors[i] = fieldErrors;
        if (allValid === false && i === 0) setOpenItem("attendee-0");
        else if (!allValid) setOpenItem(`attendee-${i}`);
      }
    }

    setErrors(newErrors);
    if (!allValid) return;

    setIsSubmitting(true);
    try {
      for (let i = 0; i < totalSeats; i++) {
        const data = formsData[i];
        const isTbc = tbcFlags[i];

        if (i === 0) {
          if (leadAttendee?.id) {
            await updateAttendee.mutateAsync({
              bookingId: booking.id,
              attendeeId: leadAttendee.id,
              data: {
                firstName: data.firstName,
                lastName: data.lastName,
                jobTitle: data.jobTitle,
                company: data.company,
                workEmail: data.workEmail,
                phone: data.phone || null,
                gdprConsent: data.gdprConsent,
              },
            });
          }
        } else {
          const existingId = data.id ?? autosaveIdsRef.current[i];
          if (existingId) {
            await updateAttendee.mutateAsync({
              bookingId: booking.id,
              attendeeId: existingId,
              data: isTbc
                ? { isTbc: true, company: leadDefaults.company }
                : {
                    isTbc: false,
                    firstName: data.firstName,
                    lastName: data.lastName,
                    jobTitle: data.jobTitle,
                    company: data.company,
                    workEmail: data.workEmail,
                    phone: data.phone || null,
                    gdprConsent: data.gdprConsent,
                  },
            });
          } else {
            const created = await createAttendee.mutateAsync({
              bookingId: booking.id,
              data: isTbc
                ? {
                    isLead: false,
                    isTbc: true,
                    gdprConsent: false,
                    company: leadDefaults.company || "TBC",
                    seatIndex: i,
                  }
                : {
                    isLead: false,
                    isTbc: false,
                    firstName: data.firstName,
                    lastName: data.lastName,
                    jobTitle: data.jobTitle,
                    company: data.company,
                    workEmail: data.workEmail,
                    phone: data.phone || null,
                    gdprConsent: data.gdprConsent,
                    seatIndex: i,
                  },
            });
            autosaveIdsRef.current[i] = created.id;
          }
        }
      }

      await updateBooking.mutateAsync({
        id: booking.id,
        data: { currentStep: 4 },
      });
      queryClient.invalidateQueries({ queryKey: ["booking"] });
    } catch (e) {
      console.error(e);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-4xl md:text-5xl font-bold mb-4">Attendee Details</h1>
        <p className="text-lg text-muted-foreground">
          {totalSeats === 1
            ? "Please confirm who this ticket is for."
            : `Please confirm who each of the ${totalSeats} tickets is for.`}
        </p>
      </div>

      {totalSeats > 1 && (
        <div className="flex gap-3 bg-blue-50 border border-blue-200 rounded p-4 text-sm text-blue-800">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <p>
            <span className="font-semibold">Not sure who's attending yet?</span>{" "}
            Mark any additional ticket as <span className="font-semibold">TBC</span> to complete your booking now and confirm the attendee details later — just contact us after booking.
          </p>
        </div>
      )}

      <Accordion type="single" value={openItem} onValueChange={setOpenItem} className="space-y-4">
        {formsData.map((data, index) => {
          const fieldErrors = errors[index];
          const isForMe = forMeFlags[index];
          const isTbc = tbcFlags[index];
          const label = isTbc
            ? "TBC — details to be confirmed"
            : data.firstName && data.lastName
            ? `${data.firstName} ${data.lastName}`
            : "Pending details";

          return (
            <AccordionItem key={index} value={`attendee-${index}`} className="bg-white border border-border px-6">
              <AccordionTrigger className="hover:no-underline py-6">
                <div className="flex flex-col text-left">
                  <span className="font-bold text-xl">Attendee {index + 1}</span>
                  <span className={`text-sm font-normal ${isTbc ? "text-amber-600 font-medium" : "text-muted-foreground"}`}>
                    {label}
                  </span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="pb-6">
                <div className="mb-5 pt-4 border-t border-border flex flex-wrap gap-2">
                  {index === 0 && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleForMeToggle(index, !isForMe)}
                        className={`inline-flex items-center gap-2 px-4 py-2 rounded-full border text-sm font-medium transition-all ${
                          isForMe
                            ? "bg-primary text-white border-primary"
                            : "bg-white text-foreground border-border hover:border-primary/50"
                        }`}
                      >
                        <User className="w-4 h-4" />
                        This ticket is for me
                      </button>
                      {isForMe && (
                        <p className="w-full mt-1 text-xs text-muted-foreground">
                          Pre-filled from your profile. Edit any field to customise.
                        </p>
                      )}
                    </>
                  )}

                  {index > 0 && (
                    <button
                      type="button"
                      onClick={() => handleTbcToggle(index, !isTbc)}
                      className={`inline-flex items-center gap-2 px-4 py-2 rounded-full border text-sm font-medium transition-all ${
                        isTbc
                          ? "bg-amber-500 text-white border-amber-500"
                          : "bg-white text-foreground border-border hover:border-amber-400"
                      }`}
                    >
                      <Clock className="w-4 h-4" />
                      Not confirmed yet (TBC)
                    </button>
                  )}
                </div>

                {isTbc ? (
                  <div className="bg-amber-50 border border-amber-200 rounded p-4 text-sm text-amber-800">
                    <p className="font-semibold mb-1">This ticket is marked as TBC</p>
                    <p>You can confirm this attendee's details later — just contact us after booking and we'll update the registration for you.</p>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">First Name *</label>
                        <Input
                          value={data.firstName}
                          onChange={(e) => updateFormData(index, "firstName", e.target.value)}
                          className={`h-12 bg-white ${fieldErrors?.firstName ? "border-destructive" : ""}`}
                        />
                        {fieldErrors?.firstName && <p className="text-xs text-destructive">{fieldErrors.firstName}</p>}
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Last Name *</label>
                        <Input
                          value={data.lastName}
                          onChange={(e) => updateFormData(index, "lastName", e.target.value)}
                          className={`h-12 bg-white ${fieldErrors?.lastName ? "border-destructive" : ""}`}
                        />
                        {fieldErrors?.lastName && <p className="text-xs text-destructive">{fieldErrors.lastName}</p>}
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Work Email *</label>
                        <Input
                          type="email"
                          value={data.workEmail}
                          onChange={(e) => updateFormData(index, "workEmail", e.target.value)}
                          className={`h-12 bg-white ${fieldErrors?.workEmail ? "border-destructive" : ""}`}
                        />
                        {fieldErrors?.workEmail && <p className="text-xs text-destructive">{fieldErrors.workEmail}</p>}
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Phone (optional)</label>
                        <Input
                          value={data.phone}
                          onChange={(e) => updateFormData(index, "phone", e.target.value)}
                          className="h-12 bg-white"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Job Title *</label>
                        <Input
                          value={data.jobTitle}
                          onChange={(e) => updateFormData(index, "jobTitle", e.target.value)}
                          className={`h-12 bg-white ${fieldErrors?.jobTitle ? "border-destructive" : ""}`}
                        />
                        {fieldErrors?.jobTitle && <p className="text-xs text-destructive">{fieldErrors.jobTitle}</p>}
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Company *</label>
                        <Input
                          value={data.company}
                          onChange={(e) => updateFormData(index, "company", e.target.value)}
                          className={`h-12 bg-white ${fieldErrors?.company ? "border-destructive" : ""}`}
                        />
                        {fieldErrors?.company && <p className="text-xs text-destructive">{fieldErrors.company}</p>}
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
                          {fieldErrors?.gdprConsent && <p className="text-xs text-destructive">{fieldErrors.gdprConsent}</p>}
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {index < totalSeats - 1 && (
                  <div className="flex justify-end mt-6">
                    <Button type="button" onClick={() => setOpenItem(`attendee-${index + 1}`)}>
                      Next Attendee
                    </Button>
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>

      <div className="flex justify-between pt-4">
        <Button
          variant="outline"
          size="lg"
          className="px-8 h-14 text-lg border-border"
          onClick={async () => {
            await updateBooking.mutateAsync({ id: booking.id, data: { currentStep: 2 } });
            queryClient.invalidateQueries({ queryKey: ["booking"] });
          }}
        >
          Back
        </Button>
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
